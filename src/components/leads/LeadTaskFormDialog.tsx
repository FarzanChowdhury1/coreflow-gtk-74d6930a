import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

interface LeadTask {
  id: string;
  lead_id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  task: LeadTask | null;
}

export function LeadTaskFormDialog({ open, onOpenChange, leadId, task }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "todo",
    assigned_to: "",
    due_date: "",
  });

  const workspaceId = currentWorkspace?.id;

  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members-slim", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase
        .from("workspace_memberships")
        .select("user_id, profiles:user_id(full_name)")
        .eq("workspace_id", workspaceId);
      return (data || []).map((m: any) => ({
        user_id: m.user_id,
        full_name: m.profiles?.full_name || m.user_id.slice(0, 8),
      }));
    },
    enabled: !!workspaceId && open,
    staleTime: 60000,
  });

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title,
        description: task.description || "",
        status: task.status,
        assigned_to: task.assigned_to || "",
        due_date: task.due_date || "",
      });
    } else {
      setForm({ title: "", description: "", status: "todo", assigned_to: "", due_date: "" });
    }
  }, [task, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !workspaceId || !user) return;
    setLoading(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status as any,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      workspace_id: workspaceId,
      lead_id: leadId,
      created_by: user.id,
    };

    if (task) {
      const { title, description, status, assigned_to, due_date } = payload;
      const { error } = await supabase
        .from("lead_tasks")
        .update({ title, description, status, assigned_to, due_date, updated_at: new Date().toISOString() } as any)
        .eq("id", task.id);
      if (error) toast.error(error.message);
      else { toast.success("Task updated"); onOpenChange(false); }
    } else {
      const { error } = await supabase.from("lead_tasks").insert(payload as any);
      if (error) toast.error(error.message);
      else { toast.success("Task created"); onOpenChange(false); }
    }

    queryClient.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Work Item" : "New Work Item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Prepare sample deliverable"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Assign To</label>
            <select
              value={form.assigned_to}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="Details, context, blockers..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !form.title.trim()}>
              {loading ? "Saving..." : task ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
