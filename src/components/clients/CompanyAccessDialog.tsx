import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, X, Crown, Users } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export function CompanyAccessDialog({ open, onOpenChange, company }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [savingOwner, setSavingOwner] = useState(false);

  const workspaceId = currentWorkspace?.id;

  // Fetch workspace members
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("workspace_memberships")
        .select("user_id, role, profiles!inner(full_name, user_id)")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return (data || []).map((m: any) => ({
        user_id: m.user_id,
        role: m.role,
        full_name: m.profiles?.full_name || "Unnamed",
      }));
    },
    enabled: !!workspaceId && open,
  });

  // Fetch current access grants
  const { data: accessGrants = [], refetch: refetchGrants } = useQuery({
    queryKey: ["company-access", company?.id],
    queryFn: async () => {
      if (!company) return [];
      const { data, error } = await supabase
        .from("company_access")
        .select("*")
        .eq("company_id", company.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!company && open,
  });

  const grantedUserIds = new Set(accessGrants.map((g) => g.user_id));
  const ownerId = company?.owner_id;

  const availableMembers = members.filter(
    (m) => m.user_id !== ownerId && !grantedUserIds.has(m.user_id) && m.role !== "admin"
  );

  const handleSetOwner = async (userId: string) => {
    if (!company) return;
    setSavingOwner(true);
    const { error } = await supabase
      .from("companies")
      .update({ owner_id: userId || null })
      .eq("id", company.id);
    if (error) {
      toast({ title: "Failed to set owner", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Relationship owner updated" });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    }
    setSavingOwner(false);
  };

  const handleGrantAccess = async () => {
    if (!company || !selectedUserId || !workspaceId) return;
    const { error } = await supabase.from("company_access").insert({
      company_id: company.id,
      user_id: selectedUserId,
      workspace_id: workspaceId,
    } as any);
    if (error) {
      toast({ title: "Failed to grant access", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access granted" });
      setSelectedUserId("");
      refetchGrants();
    }
  };

  const handleRevokeAccess = async (grantId: string) => {
    const { error } = await supabase.from("company_access").delete().eq("id", grantId);
    if (error) {
      toast({ title: "Failed to revoke", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access revoked" });
      refetchGrants();
    }
  };

  const getMemberName = (userId: string) =>
    members.find((m) => m.user_id === userId)?.full_name || "Unknown";

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Access — {company.legal_name}</DialogTitle>
          <DialogDescription>
            Control which team members can view this client company, its contacts, leads, and proposals.
            Admins always have full access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Owner Section */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Crown className="h-3.5 w-3.5 text-amber-500" />
              Relationship Owner
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              The primary person responsible for this client relationship. They automatically get access.
            </p>
            <select
              value={ownerId || ""}
              onChange={(e) => handleSetOwner(e.target.value)}
              disabled={savingOwner}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">No owner assigned</option>
              {members
                .filter((m) => m.role !== "admin")
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
            </select>
          </div>

          {/* Collaborators Section */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" />
              Collaborators
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Additional team members who need visibility into this client.
            </p>

            {accessGrants.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {accessGrants.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">{getMemberName(grant.user_id)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeAccess(grant.id)}
                      className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {availableMembers.length > 0 && (
              <div className="flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="h-9 flex-1 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select team member…</option>
                  {availableMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={handleGrantAccess}
                  disabled={!selectedUserId}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Grant
                </Button>
              </div>
            )}

            {availableMembers.length === 0 && accessGrants.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No additional team members available to grant access.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
