import { useState } from "react";
import { Plus, ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { LeadTaskFormDialog } from "./LeadTaskFormDialog";

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

const statusConfig: Record<string, { label: string; className: string }> = {
  todo: { label: "To Do", className: "bg-secondary text-secondary-foreground" },
  in_progress: { label: "In Progress", className: "bg-primary/15 text-primary" },
  done: { label: "Done", className: "bg-success/15 text-success" },
  blocked: { label: "Blocked", className: "bg-destructive/15 text-destructive" },
};

interface Props {
  leadId: string;
  workspaceId: string;
}

export function LeadTasksPanel({ leadId, workspaceId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<LeadTask | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["lead-tasks", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tasks")
        .select("*")
        .eq("lead_id", leadId)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }) as any;
      if (error) throw error;
      return (data || []) as LeadTask[];
    },
    enabled: expanded,
    staleTime: 30000,
  });

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <ClipboardList className="h-3 w-3" />
        <span>Pre-sales work</span>
        {openCount > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            {openCount}
          </Badge>
        )}
        {blockedCount > 0 && (
          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
            {blockedCount} blocked
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="mt-2 ml-1 border-l-2 border-muted pl-3 space-y-1.5">
          {isLoading ? (
            <div className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No work items yet</p>
          ) : (
            tasks.map((task) => {
              const cfg = statusConfig[task.status] || statusConfig.todo;
              const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";
              return (
                <button
                  key={task.id}
                  onClick={() => { setEditingTask(task); setDialogOpen(true); }}
                  className="flex items-center gap-2 w-full text-left text-xs py-1 px-1.5 rounded hover:bg-muted/50 transition-colors group"
                >
                  <Badge variant="secondary" className={`${cfg.className} h-4 px-1.5 text-[10px] shrink-0`}>
                    {cfg.label}
                  </Badge>
                  <span className="truncate text-foreground">{task.title}</span>
                  {isOverdue && (
                    <span className="text-destructive text-[10px] shrink-0">overdue</span>
                  )}
                </button>
              );
            })
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => { setEditingTask(null); setDialogOpen(true); }}
          >
            <Plus className="h-3 w-3 mr-1" /> Add item
          </Button>
        </div>
      )}

      <LeadTaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leadId={leadId}
        task={editingTask}
      />
    </div>
  );
}
