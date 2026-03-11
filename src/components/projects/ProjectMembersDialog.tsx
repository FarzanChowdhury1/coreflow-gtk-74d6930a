import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  members: any[];
}

export function ProjectMembersDialog({ open, onOpenChange, projectId, members }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const workspaceId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";

  // Get all workspace members to allow adding
  const { data: workspaceMembers = [] } = useQuery({
    queryKey: ["workspace_members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase
        .from("workspace_memberships")
        .select("*, profiles:user_id(full_name)")
        .eq("workspace_id", workspaceId);
      return data || [];
    },
    enabled: !!workspaceId && open,
  });

  const memberUserIds = new Set(members.map((m: any) => m.user_id));
  const availableUsers = workspaceMembers.filter((wm: any) => !memberUserIds.has(wm.user_id));

  const handleAdd = async () => {
    if (!selectedUserId || !workspaceId) return;
    setAdding(true);
    const { error } = await supabase.from("project_members").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      user_id: selectedUserId,
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Member added" });
      setSelectedUserId("");
      queryClient.invalidateQueries({ queryKey: ["project_members", projectId] });
    }
    setAdding(false);
  };

  const handleRemove = async (memberId: string) => {
    const { error } = await supabase.from("project_members").delete().eq("id", memberId);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Member removed" });
      queryClient.invalidateQueries({ queryKey: ["project_members", projectId] });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Project Members</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {members.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm text-foreground">
                {(m.profiles as any)?.full_name || "Unknown"}
              </span>
              {isAdmin && (
                <button
                  onClick={() => handleRemove(m.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          {members.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No members yet.</p>
          )}

          {isAdmin && availableUsers.length > 0 && (
            <div className="flex gap-2 pt-2 border-t">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Add member...</option>
                {availableUsers.map((u: any) => (
                  <option key={u.user_id} value={u.user_id}>
                    {(u.profiles as any)?.full_name || u.user_id}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={handleAdd} disabled={!selectedUserId || adding}>
                Add
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
