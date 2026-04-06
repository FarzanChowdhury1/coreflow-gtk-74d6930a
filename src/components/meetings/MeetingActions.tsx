import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, ListChecks, Lightbulb, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  meetingId: string;
  members: { id: string; full_name: string }[];
}

export function MeetingActions({ meetingId, members }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const queryClient = useQueryClient();
  const isAdmin = currentRole === "admin";

  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"action" | "decision">("action");
  const [newAssignee, setNewAssignee] = useState("__none__");
  const [newDueDate, setNewDueDate] = useState<Date | undefined>();
  const [adding, setAdding] = useState(false);

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ["meeting-actions", meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_actions" as any)
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!meetingId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["meeting-actions", meetingId] });
  }, [queryClient, meetingId]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !wsId) return;
    setAdding(true);
    try {
      const { error } = await supabase.from("meeting_actions" as any).insert({
        meeting_id: meetingId,
        workspace_id: wsId,
        action_type: newType,
        title: newTitle.trim(),
        assignee_id: newAssignee !== "__none__" ? newAssignee : null,
        due_date: newDueDate ? format(newDueDate, "yyyy-MM-dd") : null,
      } as any);
      if (error) throw error;
      setNewTitle("");
      setNewAssignee("__none__");
      setNewDueDate(undefined);
      invalidate();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const toggleStatus = async (id: string, current: string) => {
    const next = current === "open" ? "done" : "open";
    const { error } = await supabase
      .from("meeting_actions" as any)
      .update({ status: next, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) toast.error(error.message);
    else invalidate();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("meeting_actions" as any)
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else invalidate();
  };

  const actionItems = actions.filter((a: any) => a.action_type === "action");
  const decisions = actions.filter((a: any) => a.action_type === "decision");

  const getMemberName = (id: string | null) => {
    if (!id) return null;
    const m = members.find((m) => m.id === id);
    return m?.full_name || "Unknown";
  };

  return (
    <div className="space-y-5">
      {/* Add new */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Add Action or Decision
        </h4>
        <div className="flex gap-2">
          <Select value={newType} onValueChange={(v) => setNewType(v as any)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="action">Action</SelectItem>
              <SelectItem value="decision">Decision</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={newType === "action" ? "What needs to be done…" : "What was decided…"}
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        {newType === "action" && (
          <div className="flex gap-2">
            <Select value={newAssignee} onValueChange={setNewAssignee}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No assignee</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-36 justify-start text-left font-normal text-sm", !newDueDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {newDueDate ? format(newDueDate, "dd MMM") : "Due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={newDueDate} onSelect={setNewDueDate} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}
        <Button size="sm" onClick={handleAdd} disabled={adding || !newTitle.trim()}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>

      {/* Decisions */}
      {decisions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-4 w-4 text-yellow-500" /> Decisions ({decisions.length})
          </h4>
          <div className="space-y-1.5">
            {decisions.map((d: any) => (
              <div key={d.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 bg-yellow-50/50 dark:bg-yellow-900/10">
                <p className="text-sm text-foreground">{d.title}</p>
                {isAdmin && (
                  <button onClick={() => handleDelete(d.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action items */}
      {actionItems.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-primary" /> Action Items ({actionItems.length})
          </h4>
          <div className="space-y-1.5">
            {actionItems.map((a: any) => (
              <div key={a.id} className={cn("flex items-center gap-3 rounded-md border px-3 py-2", a.status === "done" && "opacity-60")}>
                <Checkbox
                  checked={a.status === "done"}
                  onCheckedChange={() => toggleStatus(a.id, a.status)}
                />
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm text-foreground", a.status === "done" && "line-through")}>{a.title}</p>
                  <div className="flex gap-2 mt-0.5 flex-wrap">
                    {a.assignee_id && (
                      <span className="text-xs text-muted-foreground">→ {getMemberName(a.assignee_id)}</span>
                    )}
                    {a.due_date && (
                      <span className="text-xs text-muted-foreground">Due: {a.due_date}</span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => handleDelete(a.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {actions.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-3">
          No actions or decisions recorded yet. Add them above.
        </p>
      )}
    </div>
  );
}
