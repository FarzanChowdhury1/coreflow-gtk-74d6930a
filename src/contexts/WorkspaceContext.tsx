import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
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
  pendingInvites: PendingInvite[];
  refreshWorkspaces: () => void;
}

interface PendingInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspaces: [],
  currentWorkspace: null,
  currentRole: null,
  memberships: [],
  setCurrentWorkspaceId: () => {},
  loading: true,
  pendingInvites: [],
  refreshWorkspaces: () => {},
});

// Cache workspace data so route transitions don't re-fetch
let cachedWorkspaces: Workspace[] | null = null;
let cachedMemberships: Membership[] | null = null;
let cachedForUserId: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(
    cachedForUserId === user?.id && cachedWorkspaces ? cachedWorkspaces : []
  );
  const [memberships, setMemberships] = useState<Membership[]>(
    cachedForUserId === user?.id && cachedMemberships ? cachedMemberships : []
  );
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    cachedForUserId === user?.id && cachedWorkspaces?.length ? cachedWorkspaces[0].id : null
  );
  const [loading, setLoading] = useState(
    !(cachedForUserId === user?.id && cachedWorkspaces && Date.now() - cacheTimestamp < CACHE_TTL)
  );
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [fetchKey, setFetchKey] = useState(0);

  const refreshWorkspaces = useCallback(() => {
    cachedWorkspaces = null;
    cachedMemberships = null;
    cacheTimestamp = 0;
    setFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setMemberships([]);
      setCurrentWorkspaceId(null);
      setPendingInvites([]);
      setLoading(false);
      cachedForUserId = null;
      return;
    }

    // If cache is fresh, skip network fetch
    if (
      cachedForUserId === user.id &&
      cachedWorkspaces &&
      cachedMemberships &&
      Date.now() - cacheTimestamp < CACHE_TTL &&
      fetchKey === 0
    ) {
      setWorkspaces(cachedWorkspaces);
      setMemberships(cachedMemberships);
      if (!currentWorkspaceId && cachedWorkspaces.length > 0) {
        setCurrentWorkspaceId(cachedWorkspaces[0].id);
      }
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchWorkspaces = async () => {
      setLoading(true);

      const [membershipRes, invitesRes] = await Promise.all([
        supabase
          .from("workspace_memberships")
          .select("*")
          .eq("user_id", user.id),
        supabase
          .from("workspace_invites")
          .select("id, workspace_id, email, role, created_at, expires_at")
          .eq("status", "pending"),
      ]);

      if (cancelled) return;

      const membershipData = membershipRes.data ?? [];
      const inviteData = (invitesRes.data ?? []) as unknown as PendingInvite[];
      const validInvites = inviteData.filter(
        (i) => new Date(i.expires_at) > new Date()
      );
      setPendingInvites(validInvites);

      if (membershipData.length > 0) {
        setMemberships(membershipData);

        const workspaceIds = membershipData.map((m) => m.workspace_id);
        const { data: workspaceData } = await supabase
          .from("workspaces")
          .select("*")
          .in("id", workspaceIds)
          .is("deleted_at", null);

        if (cancelled) return;

        if (workspaceData) {
          setWorkspaces(workspaceData);
          // Update cache
          cachedWorkspaces = workspaceData;
          cachedMemberships = membershipData;
          cachedForUserId = user.id;
          cacheTimestamp = Date.now();

          if (!currentWorkspaceId && workspaceData.length > 0) {
            setCurrentWorkspaceId(workspaceData[0].id);
          }
        }
      } else if (validInvites.length > 0) {
        setWorkspaces([]);
        setMemberships([]);
      } else {
        const { data: result, error: rpcError } = await supabase
          .rpc("bootstrap_workspace", { _user_id: user.id, _name: "My Workspace" });

        if (cancelled || rpcError || !result) {
          if (!cancelled) setLoading(false);
          return;
        }

        const wsResult = result as unknown as { workspace_id: string; membership_id: string };

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
          // Update cache
          cachedWorkspaces = [wsData];
          cachedMemberships = [memData];
          cachedForUserId = user.id;
          cacheTimestamp = Date.now();
        }
      }

      if (!cancelled) setLoading(false);
    };

    fetchWorkspaces();
    return () => { cancelled = true; };
  }, [user, fetchKey]);

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
        pendingInvites,
        refreshWorkspaces,
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
