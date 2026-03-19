import { useState } from "react";
import { ArrowLeft, Plus, Users, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TaskBoard } from "./TaskBoard";
import { ProjectMembersDialog } from "./ProjectMembersDialog";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";

interface Props {
  projectId: string;
  onBack: () => void;
}

const statusColors: Record<string, string> = {
  active: "bg-success/15 text-success",
  on_hold: "bg-warning/15 text-warning",
  completed: "bg-primary/15 text-primary",
  cancelled: "bg-muted text-muted-foreground",
};

export function ProjectDetail({ projectId, onBack }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [membersOpen, setMembersOpen] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, companies(legal_name)")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["project_members", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_members")
        .select("*, profiles:user_id(full_name)")
        .eq("project_id", projectId);
      if (error) throw error;
      return data;
    },
  });

  const handleStatusChange = async (status: string) => {
    if (currentRole !== "admin") return;
    const { error } = await supabase
      .from("projects")
      .update({ status: status as any })
      .eq("id", projectId);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  };

  if (!project) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
            <Badge variant="secondary" className={statusColors[project.status]}>
              {project.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {(project.companies as any)?.legal_name}
            {project.start_date && ` · Started ${project.start_date}`}
            {project.target_end_date && ` · Target ${project.target_end_date}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMembersOpen(true)}>
            <Users className="h-4 w-4 mr-1" /> Members ({members.length})
          </Button>
          {currentRole === "admin" && (
            <select
              value={project.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
        </div>
      </div>

      {project.description && (
        <p className="text-sm text-muted-foreground mb-6">{project.description}</p>
      )}

      <TaskBoard projectId={projectId} members={members} />

      <ProjectMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        projectId={projectId}
        members={members}
      />
    </div>
  );
}
