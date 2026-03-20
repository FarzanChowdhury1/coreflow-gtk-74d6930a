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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectFormDialog({ open, onOpenChange }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"manual" | "from_proposal">("manual");
  const workspaceId = currentWorkspace?.id;

  const [form, setForm] = useState({
    name: "",
    company_id: "",
    description: "",
    start_date: "",
    target_end_date: "",
  });
  const [selectedVersionId, setSelectedVersionId] = useState("");

  const { data: companies = [] } = useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase.from("companies").select("*").eq("workspace_id", workspaceId);
      return data || [];
    },
    enabled: !!workspaceId,
  });

  // Fetch approved versions that don't already have projects
  const { data: approvedVersions = [] } = useQuery({
    queryKey: ["approved_versions_available", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data: versions } = await supabase
        .from("proposal_versions")
        .select("*, proposals(title, companies(legal_name))")
        .eq("workspace_id", workspaceId)
        .eq("status", "approved");
      if (!versions) return [];

      // Filter out versions that already have projects
      const { data: existingProjects } = await supabase
        .from("projects")
        .select("proposal_version_id")
        .eq("workspace_id", workspaceId)
        .not("proposal_version_id", "is", null);

      const usedIds = new Set((existingProjects || []).map((p) => p.proposal_version_id));
      return versions.filter((v) => !usedIds.has(v.id));
    },
    enabled: !!workspaceId && open,
  });

  useEffect(() => {
    if (open) {
      setForm({ name: "", company_id: "", description: "", start_date: "", target_end_date: "" });
      setSelectedVersionId("");
      setMode("manual");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !user) return;
    setLoading(true);

    if (mode === "from_proposal" && selectedVersionId) {
      // Use RPC to create project from approved version
      const { data, error } = await supabase.rpc("create_project_from_approved_version", {
        _workspace_id: workspaceId,
        _proposal_version_id: selectedVersionId,
        _created_by: user.id,
      });

      if (error) {
        toast({ title: "Failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Project created from approved proposal with tasks" });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["approved_versions_available"] });
        onOpenChange(false);
      }
    } else {
      if (!form.name.trim()) {
        setLoading(false);
        return;
      }

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          company_id: form.company_id || null,
          name: form.name.trim(),
          description: form.description || null,
          start_date: form.start_date || null,
          target_end_date: form.target_end_date || null,
        })
        .select()
        .single();

      if (error || !project) {
        toast({ title: "Failed", description: error?.message, variant: "destructive" });
      } else {
        // Add creator as member
        await supabase.from("project_members").insert({
          workspace_id: workspaceId,
          project_id: project.id,
          user_id: user.id,
        });
        toast({ title: "Project created" });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        onOpenChange(false);
      }
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode("from_proposal")}
            className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
              mode === "from_proposal"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            From Approved Proposal
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
              mode === "manual"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "from_proposal" ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Approved Proposal Version *
              </label>
              <select
                value={selectedVersionId}
                onChange={(e) => setSelectedVersionId(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="">Select a version</option>
                {approvedVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {(v.proposals as any)?.title} (v{v.version_number}) — {(v.proposals as any)?.companies?.legal_name}
                  </option>
                ))}
              </select>
              {approvedVersions.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No approved proposal versions available. Approve a proposal first.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Tasks will be auto-created from proposal line items.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Project name"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Client Company <span className="text-xs text-muted-foreground font-normal">(leave empty for internal projects)</span>
                </label>
                <select
                  value={form.company_id}
                  onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No client (internal project)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.legal_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Start Date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Target End</label>
                  <input
                    type="date"
                    value={form.target_end_date}
                    onChange={(e) => setForm((f) => ({ ...f, target_end_date: e.target.value }))}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={3}
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
