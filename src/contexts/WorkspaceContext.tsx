import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import type { Tables } from "@/integrations/supabase/types";

type Workspace = Tables<"workspaces">;
type Membership = Tables<"workspace_memberships">;

interface WorkspaceContextType {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  currentRole: "admin" | "team_member" | null;
  memberships: Membership[];
  setCurrentWorkspaceId: (id: string) => void;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspaces: [],
  currentWorkspace: null,
  currentRole: null,
  memberships: [],
  setCurrentWorkspaceId: () => {},
  loading: true,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setMemberships([]);
      setCurrentWorkspaceId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchWorkspaces = async () => {
      setLoading(true);

      // Step 1: Check for and accept any pending invites before anything else
      try {
        const { data: pendingInvites } = await supabase
          .from("workspace_invites" as any)
          .select("id")
          .eq("status", "pending");

        if (!cancelled && pendingInvites && pendingInvites.length > 0) {
          for (const invite of pendingInvites) {
            await supabase.rpc("accept_workspace_invite" as any, {
              _invite_id: (invite as any).id,
            });
          }
        }
      } catch {
        // Table may not exist yet during migration rollout — ignore
      }

      if (cancelled) return;

      // Step 2: Fetch memberships (now includes any just-accepted invites)
      const { data: membershipData } = await supabase
        .from("workspace_memberships")
        .select("*")
        .eq("user_id", user.id);

      if (cancelled) return;

      if (membershipData && membershipData.length > 0) {
        setMemberships(membershipData);

        // Fetch workspaces
        const workspaceIds = membershipData.map((m) => m.workspace_id);
        const { data: workspaceData } = await supabase
          .from("workspaces")
          .select("*")
          .in("id", workspaceIds)
          .is("deleted_at", null);

        if (cancelled) return;

        if (workspaceData) {
          setWorkspaces(workspaceData);
          if (!currentWorkspaceId && workspaceData.length > 0) {
            setCurrentWorkspaceId(workspaceData[0].id);
          }
        }
      } else {
        // No memberships even after invite acceptance — bootstrap a new workspace
        const { data: result, error: rpcError } = await supabase
          .rpc("bootstrap_workspace", { _user_id: user.id, _name: "My Workspace" });

        if (cancelled || rpcError || !result) {
          if (!cancelled) setLoading(false);
          return;
        }

        const wsResult = result as unknown as { workspace_id: string; membership_id: string };

        // Re-fetch the created workspace and membership
        const { data: wsData } = await supabase
          .from("workspaces")
          .select("*")
          .eq("id", wsResult.workspace_id)
          .single();

        const { data: memData } = await supabase
          .from("workspace_memberships")
          .select("*")
          .eq("id", wsResult.membership_id)
          .single();

        if (cancelled) return;

        if (wsData && memData) {
          setMemberships([memData]);
          setWorkspaces([wsData]);
          setCurrentWorkspaceId(wsData.id);
        }
      }

      if (!cancelled) setLoading(false);
    };

    fetchWorkspaces();
    return () => { cancelled = true; };
  }, [user]);

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) ?? null;
  const currentMembership = memberships.find(
    (m) => m.workspace_id === currentWorkspaceId && m.user_id === user?.id
  );
  const currentRole = currentMembership?.role ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        currentRole,
        memberships,
        setCurrentWorkspaceId,
        loading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
