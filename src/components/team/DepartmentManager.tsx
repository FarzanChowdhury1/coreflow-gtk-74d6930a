import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Building } from "lucide-react";
import { toast } from "sonner";

interface Department {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  workspace_id: string;
}

export function DepartmentManager() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = currentWorkspace?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["departments", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (error) throw error;
      return data as Department[];
    },
    enabled: !!workspaceId,
  });

  // Count members per department
  const { data: memberCounts = {} } = useQuery({
    queryKey: ["department_member_counts", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return {};
      const { data, error } = await supabase
        .from("workspace_memberships")
        .select("department_id")
        .eq("workspace_id", workspaceId)
        .not("department_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((m: any) => {
        counts[m.department_id] = (counts[m.department_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!workspaceId,
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setDialogOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditing(dept);
    setName(dept.name);
    setDescription(dept.description || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!workspaceId || !name.trim()) return;
    setSaving(true);

    if (editing) {
      const { error } = await supabase
        .from("departments")
        .update({ name: name.trim(), description: description.trim() || null })
        .eq("id", editing.id);
      if (error) {
        toast.error(error.message.includes("duplicate") ? "A department with this name already exists" : error.message);
      } else {
        toast.success("Department updated");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["departments"] });
      }
    } else {
      const { error } = await supabase
        .from("departments")
        .insert({ workspace_id: workspaceId, name: name.trim(), description: description.trim() || null });
      if (error) {
        toast.error(error.message.includes("duplicate") ? "A department with this name already exists" : error.message);
      } else {
        toast.success("Department created");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["departments"] });
      }
    }
    setSaving(false);
  };

  const handleDelete = async (dept: Department) => {
    const { error } = await supabase.from("departments").delete().eq("id", dept.id);
    if (error) {
      toast.error("Failed to delete department");
    } else {
      toast.success("Department deleted");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Departments</CardTitle>
            <CardDescription>
              Permanent functional groups like Sales, Engineering, Finance, or Operations.
              Each team member can be assigned to one department.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Department
          </Button>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-8 text-center">
              <Building className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h3 className="text-sm font-medium text-foreground mb-1">No departments yet</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                Departments organize your team into functional groups. Common examples: Sales, Engineering, Design, Finance, Operations.
              </p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Create First Department
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {departments.map((dept) => (
                <div
                  key={dept.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{dept.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {dept.description && (
                        <p className="text-xs text-muted-foreground">{dept.description}</p>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {memberCounts[dept.id] || 0} member{(memberCounts[dept.id] || 0) !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(dept)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(dept)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Department" : "New Department"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update department details."
                : "Create a new functional department for your organization."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dept-name">Name</Label>
              <Input
                id="dept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Engineering, Sales, Finance"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dept-desc">Description (optional)</Label>
              <Input
                id="dept-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this department do?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={!name.trim() || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
