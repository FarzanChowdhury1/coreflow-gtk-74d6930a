import { useState } from "react";
import { FolderKanban, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { ProjectDetail } from "@/components/projects/ProjectDetail";

const statusColors: Record<string, string> = {
  active: "bg-success/15 text-success",
  on_hold: "bg-warning/15 text-warning",
  completed: "bg-primary/15 text-primary",
  cancelled: "bg-secondary text-foreground/80",
};

export default function Projects() {
  const { currentWorkspace } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const workspaceId = currentWorkspace?.id;

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("projects")
        .select("*, companies(legal_name)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (selectedProjectId) {
    return <ProjectDetail projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />;
  }

  return (
    <div>
      {/* Shell renders immediately */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FolderKanban className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Projects</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Project
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground max-w-2xl">
        Track both client delivery and internal initiatives. Projects linked to a client company are client work; projects without a company are internal.
      </p>

      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">No projects yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Projects track delivery work for your clients. You can create one from an approved proposal or start fresh. Each project has its own task board.
          </p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create First Project
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
              className="rounded-lg border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <h2 className="font-medium text-foreground text-sm leading-tight">{project.name}</h2>
                <Badge variant="secondary" className={`text-xs shrink-0 ml-2 ${statusColors[project.status]}`}>
                  {project.status.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-xs text-foreground/70 mb-3">
                {(project.companies as any)?.legal_name ?? <span className="italic text-foreground/50">Internal project</span>}
              </p>
              <div className="flex gap-4 text-xs text-foreground/60">
                {project.start_date && <span>Start: {project.start_date}</span>}
                {project.target_end_date && <span>Target: {project.target_end_date}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
