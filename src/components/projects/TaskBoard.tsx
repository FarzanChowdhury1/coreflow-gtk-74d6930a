import { useState } from "react";
import { Plus, LayoutList, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskCalendarView } from "./TaskCalendarView";
import type { Tables } from "@/integrations/supabase/types";

type Task = Tables<"tasks">;

interface Props {
  projectId: string;
  members: any[];
}

const columns = [
  { key: "todo", label: "To Do", color: "bg-muted" },
  { key: "in_progress", label: "In Progress", color: "bg-secondary/30" },
  { key: "review", label: "Review", color: "bg-warning/10" },
  { key: "done", label: "Done", color: "bg-success/10" },
];

const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-primary/10 text-primary",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
};

export function TaskBoard({ projectId, members }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "calendar">("board");
  const workspaceId = currentWorkspace?.id;

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["workspace_profiles", workspaceId],
    queryFn: async () => {
      const memberUserIds = members.map((m) => m.user_id);
      if (memberUserIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", memberUserIds);
      return data || [];
    },
    enabled: members.length > 0,
  });

  const getAssigneeName = (userId: string | null) => {
    if (!userId) return null;
    return profiles.find((p) => p.user_id === userId)?.full_name || "Unknown";
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus as any })
      .eq("id", taskId);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Tasks ({tasks.length})</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border bg-muted/30 p-0.5">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("board")}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "calendar" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("calendar")}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setEditingTask(null); setTaskDialogOpen(true); }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Task
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading tasks...</div>
      ) : viewMode === "calendar" ? (
        <TaskCalendarView
          tasks={tasks}
          onTaskClick={(task) => { setEditingTask(task); setTaskDialogOpen(true); }}
        />
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className={`rounded-lg ${col.color} p-3 min-h-[200px]`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    {col.label}
                  </h4>
                  <span className="text-xs text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => { setEditingTask(task); setTaskDialogOpen(true); }}
                      className="rounded-md border bg-card p-3 cursor-pointer hover:border-primary/30 transition-colors"
                    >
                      <p className="text-sm font-medium text-foreground mb-2 leading-tight">{task.title}</p>
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className={`text-[10px] ${priorityColors[task.priority]}`}>
                          {task.priority}
                        </Badge>
                        {task.assigned_to && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                            {getAssigneeName(task.assigned_to)}
                          </span>
                        )}
                      </div>
                      {task.due_date && (
                        <p className={`text-[10px] mt-1 ${
                          new Date(task.due_date) < new Date() ? "text-destructive" : "text-muted-foreground"
                        }`}>
                          Due: {task.due_date}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskFormDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        task={editingTask}
        projectId={projectId}
        members={members}
        profiles={profiles}
      />
    </div>
  );
}
