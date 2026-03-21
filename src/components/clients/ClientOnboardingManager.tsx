import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus, GripVertical, Pencil, Trash2, CheckCircle2, Clock, AlertTriangle,
  RotateCcw, ClipboardList, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClientTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  due_date: string | null;
  response_text: string | null;
  response_link: string | null;
  response_notes: string | null;
  revision_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  project_id: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  todo: { label: "To Do", color: "bg-muted text-muted-foreground", icon: Clock },
  submitted: { label: "Submitted", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: ClipboardList },
  approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle2 },
  revision_requested: { label: "Revision Requested", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", icon: AlertTriangle },
};

export function ClientOnboardingManager({ companyId, companyName, open, onOpenChange }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const workspaceId = currentWorkspace?.id;

  const [editingTask, setEditingTask] = useState<ClientTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState<ClientTask | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["client_tasks", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_tasks")
        .select("*")
        .eq("company_id", companyId)
        .eq("workspace_id", workspaceId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ClientTask[];
    },
    enabled: !!workspaceId && open,
  });

  useEffect(() => {
    if (formOpen && editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description || "");
      setDueDate(editingTask.due_date || "");
    } else if (formOpen) {
      setTitle("");
      setDescription("");
      setDueDate("");
    }
  }, [formOpen, editingTask]);

  const handleSave = async () => {
    if (!title.trim() || !workspaceId || !user) return;
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      workspace_id: workspaceId,
      company_id: companyId,
      sort_order: editingTask ? editingTask.sort_order : tasks.length,
      created_by: user.id,
    };

    if (editingTask) {
      const { error } = await supabase
        .from("client_tasks")
        .update({ title: payload.title, description: payload.description, due_date: payload.due_date, updated_at: new Date().toISOString() } as any)
        .eq("id", editingTask.id);
      if (error) { toast.error("Failed to update task"); return; }
      toast.success("Task updated");
    } else {
      const { error } = await supabase.from("client_tasks").insert(payload as any);
      if (error) { toast.error("Failed to create task"); return; }
      toast.success("Task created");
    }
    setFormOpen(false);
    setEditingTask(null);
    queryClient.invalidateQueries({ queryKey: ["client_tasks", companyId] });
  };

  const handleDelete = async (taskId: string) => {
    const { error } = await supabase.from("client_tasks").delete().eq("id", taskId);
    if (error) { toast.error("Failed to delete task"); return; }
    toast.success("Task deleted");
    queryClient.invalidateQueries({ queryKey: ["client_tasks", companyId] });
  };

  const handleApprove = async (task: ClientTask) => {
    const { error } = await supabase
      .from("client_tasks")
      .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
      .eq("id", task.id);
    if (error) { toast.error("Failed to approve"); return; }
    toast.success("Task approved");
    setReviewTask(null);
    queryClient.invalidateQueries({ queryKey: ["client_tasks", companyId] });
  };

  const [revisionNote, setRevisionNote] = useState("");
  const handleRequestRevision = async (task: ClientTask) => {
    const { error } = await supabase
      .from("client_tasks")
      .update({
        status: "revision_requested",
        revision_note: revisionNote.trim() || "Please review and resubmit.",
        submitted_at: null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", task.id);
    if (error) { toast.error("Failed to request revision"); return; }
    toast.success("Revision requested");
    setReviewTask(null);
    setRevisionNote("");
    queryClient.invalidateQueries({ queryKey: ["client_tasks", companyId] });
  };

  const completed = tasks.filter((t) => t.status === "approved").length;
  const total = tasks.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Client Onboarding — {companyName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Create intake tasks for your client. These appear in the client portal for them to complete.
          </p>
        </DialogHeader>

        {/* Progress */}
        {total > 0 && (
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary transition-all rounded-full"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-muted-foreground shrink-0">
              {completed}/{total} completed
            </span>
          </div>
        )}

        {/* Task list */}
        <div className="space-y-2">
          {isLoading ? (
            <p className="text-center py-6 text-sm text-muted-foreground">Loading tasks…</p>
          ) : tasks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium text-foreground mb-1">No onboarding tasks yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Create tasks that your client needs to complete, such as uploading brand assets, submitting briefs, or sharing credentials.
                </p>
              </CardContent>
            </Card>
          ) : (
            tasks.map((task) => {
              const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;
              const StatusIcon = cfg.icon;
              return (
                <div key={task.id} className="flex items-start gap-3 rounded-lg border bg-card p-3 group">
                  <GripVertical className="h-4 w-4 text-muted-foreground/30 mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{task.title}</span>
                      <Badge className={`text-[10px] h-5 ${cfg.color}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      {task.due_date && (
                        <span className="text-xs text-muted-foreground">
                          Due {format(new Date(task.due_date), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                    )}
                    {task.status === "submitted" && (
                      <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-xs" onClick={() => { setReviewTask(task); setRevisionNote(""); }}>
                        Review submission →
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingTask(task); setFormOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(task.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Button variant="outline" className="w-full mt-2" onClick={() => { setEditingTask(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Task
        </Button>

        {/* Create/Edit task form */}
        {formOpen && (
          <Dialog open={formOpen} onOpenChange={(v) => { setFormOpen(v); if (!v) setEditingTask(null); }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingTask ? "Edit Task" : "New Onboarding Task"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Title *</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Upload brand assets" className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Description / Instructions</label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the client needs to do…" className="mt-1" rows={3} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Due Date</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setFormOpen(false); setEditingTask(null); }}>Cancel</Button>
                  <Button onClick={handleSave} disabled={!title.trim()}>{editingTask ? "Update" : "Create"}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Review submission dialog */}
        {reviewTask && (
          <Dialog open={!!reviewTask} onOpenChange={(v) => { if (!v) setReviewTask(null); }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Review Submission</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{reviewTask.title}</p>
                  {reviewTask.description && <p className="text-xs text-muted-foreground mt-1">{reviewTask.description}</p>}
                </div>
                {reviewTask.submitted_at && (
                  <p className="text-xs text-muted-foreground">
                    Submitted {format(new Date(reviewTask.submitted_at), "dd MMM yyyy 'at' HH:mm")}
                  </p>
                )}
                {reviewTask.response_text && (
                  <div className="rounded-md border bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Client Response</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{reviewTask.response_text}</p>
                  </div>
                )}
                {reviewTask.response_link && (
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={reviewTask.response_link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline truncate">
                      {reviewTask.response_link}
                    </a>
                  </div>
                )}
                {reviewTask.response_notes && (
                  <div className="rounded-md border bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Client Notes</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{reviewTask.response_notes}</p>
                  </div>
                )}

                <div className="border-t pt-3 space-y-2">
                  <div>
                    <label className="text-sm font-medium text-foreground">Revision note (optional)</label>
                    <Textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} placeholder="Explain what needs to change…" className="mt-1" rows={2} />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={() => handleApprove(reviewTask)} className="flex-1 gap-1">
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                    <Button variant="outline" onClick={() => handleRequestRevision(reviewTask)} className="flex-1 gap-1">
                      <RotateCcw className="h-4 w-4" /> Request Revision
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
