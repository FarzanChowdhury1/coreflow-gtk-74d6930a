import { useState } from "react";
import { MessageSquare, Plus, Search, Send, Eye, EyeOff, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

export default function ClientUpdates() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const workspaceId = currentWorkspace?.id;

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Form state
  const [formProjectId, setFormProjectId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase
        .from("projects")
        .select("id, name, company_id, companies(legal_name)")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("name");
      return data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: updates = [], isLoading } = useQuery({
    queryKey: ["client_updates", workspaceId, selectedProjectId],
    queryFn: async () => {
      if (!workspaceId) return [];
      let query = supabase
        .from("client_updates")
        .select("*, projects(name), companies(legal_name)")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (selectedProjectId !== "all") {
        query = query.eq("project_id", selectedProjectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!workspaceId,
  });

  const filteredUpdates = updates.filter((u: any) =>
    u.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = async () => {
    if (!formProjectId || !formTitle.trim() || !workspaceId || !user) return;

    setSubmitting(true);
    try {
      const project = projects.find((p: any) => p.id === formProjectId);
      if (!project) throw new Error("Project not found");

      const { error } = await supabase.from("client_updates").insert({
        workspace_id: workspaceId,
        project_id: formProjectId,
        company_id: (project as any).company_id,
        author_id: user.id,
        title: formTitle.trim(),
        body: formBody.trim() || null,
        is_published: false,
      });

      if (error) throw error;
      toast.success("Update created as draft");
      setCreateOpen(false);
      setFormProjectId("");
      setFormTitle("");
      setFormBody("");
      queryClient.invalidateQueries({ queryKey: ["client_updates"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const togglePublish = async (updateId: string, currentlyPublished: boolean) => {
    try {
      const { error } = await supabase
        .from("client_updates")
        .update({
          is_published: !currentlyPublished,
          published_at: !currentlyPublished ? new Date().toISOString() : null,
        })
        .eq("id", updateId);

      if (error) throw error;
      toast.success(currentlyPublished ? "Unpublished" : "Published to client");
      queryClient.invalidateQueries({ queryKey: ["client_updates"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Client Updates</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Update
        </Button>
      </div>

      <div className="mb-4 flex gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search updates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
      ) : filteredUpdates.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p>No client updates yet. Create one to keep clients informed about project progress.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUpdates.map((update: any) => (
            <Card key={update.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">{update.title}</CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {(update.projects as any)?.name} · {(update.companies as any)?.legal_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        by {(update.profiles as any)?.full_name || "Unknown"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={update.is_published ? "default" : "secondary"}>
                      {update.is_published ? "Published" : "Draft"}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => togglePublish(update.id, update.is_published)}
                      title={update.is_published ? "Unpublish" : "Publish"}
                    >
                      {update.is_published ? <EyeOff className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {update.body && (
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{update.body}</p>
                </CardContent>
              )}
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  {format(new Date(update.created_at), "dd MMM yyyy HH:mm")}
                  {update.published_at && ` · Published ${format(new Date(update.published_at), "dd MMM yyyy HH:mm")}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Client Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Project</label>
              <Select value={formProjectId} onValueChange={setFormProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {(p.companies as any)?.legal_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Update title" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Body</label>
              <Textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder="Write a client-facing update..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting || !formProjectId || !formTitle.trim()}>
              {submitting ? "Creating…" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
