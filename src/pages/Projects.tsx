import { useState, useEffect, useMemo } from "react";
import { FolderKanban, Plus, Search, Building2, Wrench, Download, AlertTriangle } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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
  const [filterType, setFilterType] = useState<"all" | "client" | "internal">("all");
  const workspaceId = currentWorkspace?.id;

  // Deep-link from search: ?open=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (openId) {
      setSelectedProjectId(openId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: projects = [], isLoading, isError: projectsError } = useQuery({
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

  // Fetch task counts per project for progress bars
  const projectIds = projects.map((p) => p.id);
  const { data: taskCounts = [] } = useQuery({
    queryKey: ["project-task-counts", workspaceId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data, error } = await supabase
        .from("tasks")
        .select("project_id, status")
        .in("project_id", projectIds);
      if (error) throw error;
      return data || [];
    },
    enabled: projectIds.length > 0,
    staleTime: 30000,
  });

  const progressByProject = useMemo(() => {
    const map: Record<string, { total: number; done: number }> = {};
    for (const t of taskCounts) {
      if (!map[t.project_id]) map[t.project_id] = { total: 0, done: 0 };
      map[t.project_id].total++;
      if (t.status === "done") map[t.project_id].done++;
    }
    return map;
  }, [taskCounts]);

  const filtered = projects
    .filter((p) => {
      if (filterType === "client") return p.company_id != null;
      if (filterType === "internal") return p.company_id == null;
      return true;
    })
    .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

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
          <PageInfoButton
            title="Projects"
            description="Track both client delivery and internal initiatives. Client projects are linked to a company; internal projects have no company."
            actions={["Create client or internal projects", "Manage tasks within each project", "Filter by client vs internal work", "Assign team members to projects"]}
            audience="Project managers, team leads, and admins."
            note="Team members see only projects they are assigned to."
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportToCSV(
                filtered.map((p: any) => ({
                  name: p.name,
                  company: p.companies?.legal_name || "Internal",
                  status: p.status,
                  start_date: p.start_date || "",
                  target_end_date: p.target_end_date || "",
                })),
                [
                  { key: "name", label: "Project Name" },
                  { key: "company", label: "Company" },
                  { key: "status", label: "Status" },
                  { key: "start_date", label: "Start Date" },
                  { key: "target_end_date", label: "Target End" },
                ],
                "projects-export"
              )
            }
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Project
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground max-w-2xl">
        Track both client delivery and internal initiatives. Projects linked to a client company are client work; projects without a company are internal.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "client", "internal"] as const).map((type) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFilterType(type)}
            >
              {type === "all" && "All"}
              {type === "client" && <><Building2 className="h-3 w-3 mr-1" />Client</>}
              {type === "internal" && <><Wrench className="h-3 w-3 mr-1" />Internal</>}
            </Button>
          ))}
        </div>
      </div>

      {projectsError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load projects. Try refreshing the page.</p>
        </div>
      )}

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
          <h2 className="text-sm font-medium text-foreground mb-1">
            {(searchTerm || filterType !== "all") ? "No projects match your filters" : "No projects yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {(searchTerm || filterType !== "all")
              ? "Try adjusting your search or filter."
              : "Projects track delivery work for your clients. You can create one from an approved proposal or start fresh. Each project has its own task board."}
          </p>
          {!(searchTerm || filterType !== "all") && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create First Project
            </Button>
          )}
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
