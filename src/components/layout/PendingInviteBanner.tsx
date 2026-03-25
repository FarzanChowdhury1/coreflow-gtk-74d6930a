import { useState } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Users, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PendingInviteBanner() {
  const { user } = useAuth();
  const { pendingInvites, refreshWorkspaces } = useWorkspace();
  const [processing, setProcessing] = useState<string | null>(null);

  // Filter invites that match the current user's email
  const myInvites = pendingInvites.filter(
    (inv) => inv.email.toLowerCase() === user?.email?.toLowerCase()
  );

  if (myInvites.length === 0) return null;

  const handleAccept = async (inviteId: string) => {
    setProcessing(inviteId);
    try {
      // Look up the invite's token to use the existing accept flow
      const { data: invite } = await supabase
        .from("workspace_invites")
        .select("token")
        .eq("id", inviteId)
        .single();

      if (!invite?.token) {
        toast.error("Invite not found");
        return;
      }

      const { data, error } = await supabase.rpc("accept_invite_by_token", {
        _token: invite.token,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const res = data as any;
      if (res.success) {
        toast.success(res.already_member ? "Already a member" : "Invite accepted!");
        refreshWorkspaces();
      } else {
        toast.error(res.error || "Failed to accept invite");
      }
    } catch {
      toast.error("Failed to accept invite");
    } finally {
      setProcessing(null);
    }
  };

  const handleDecline = async (inviteId: string) => {
    setProcessing(inviteId);
    try {
      const { data, error } = await supabase.rpc("decline_workspace_invite", {
        _invite_id: inviteId,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const res = data as any;
      if (res.success) {
        toast.success("Invite declined");
        refreshWorkspaces();
      } else {
        toast.error(res.error || "Failed to decline invite");
      }
    } catch {
      toast.error("Failed to decline invite");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-2 px-4 sm:px-6 pt-4">
      {myInvites.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                Workspace invite pending
              </p>
              <p className="text-xs text-muted-foreground">
                You've been invited as{" "}
                <span className="font-medium text-foreground">
                  {inv.role === "admin" ? "Admin" : "Team Member"}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-8 gap-1.5"
              onClick={() => handleAccept(inv.id)}
              disabled={processing === inv.id}
            >
              {processing === inv.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => handleDecline(inv.id)}
              disabled={processing === inv.id}
            >
              <X className="h-3.5 w-3.5" />
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
