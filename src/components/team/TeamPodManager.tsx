import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Users2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

interface Team {
  id: string;
  name: string;
  description: string | null;
  department_id: string | null;
  workspace_id: string;
  created_at: string;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  workspace_id: string;
}

interface MemberProfile {
  user_id: string;
  full_name: string | null;
}

export function TeamPodManager() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = currentWorkspace?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [addMemberUserId, setAddMemberUserId] = useState("");

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (error) throw error;
      return data as Team[];
    },
    enabled: !!workspaceId,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team_members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data as TeamMember[];
    },
    enabled: !!workspaceId,
  });

  const { data: workspaceMembers = [] } = useQuery({
    queryKey: ["workspace_members_profiles", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data: memberships, error } = await supabase
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", workspaceId);
      if (error || !memberships) return [];
      const userIds = memberships.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      return (profiles || []) as MemberProfile[];
    },
    enabled: !!workspaceId,
  });

  const getProfileName = (userId: string) =>
    workspaceMembers.find((p) => p.user_id === userId)?.full_name || "Unknown";

  const getDeptName = (deptId: string | null) =>
    deptId ? departments.find((d) => d.id === deptId)?.name || "—" : "—";

  const getMembersForTeam = (teamId: string) =>
    teamMembers.filter((tm) => tm.team_id === teamId);

  const getAvailableMembers = (teamId: string) => {
    const existing = new Set(getMembersForTeam(teamId).map((m) => m.user_id));
    return workspaceMembers.filter((p) => !existing.has(p.user_id));
  };

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setDepartmentId("none");
    setDialogOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditing(team);
    setName(team.name);
    setDescription(team.description || "");
    setDepartmentId(team.department_id || "none");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!workspaceId || !name.trim()) return;
    setSaving(true);
    const deptVal = departmentId === "none" ? null : departmentId;

    if (editing) {
      const { error } = await supabase
        .from("teams")
        .update({ name: name.trim(), description: description.trim() || null, department_id: deptVal })
        .eq("id", editing.id);
      if (error) {
        toast.error(error.message.includes("duplicate") ? "A team with this name already exists" : error.message);
      } else {
        toast.success("Team updated");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["teams"] });
      }
    } else {
      const { error } = await supabase
        .from("teams")
        .insert({ workspace_id: workspaceId, name: name.trim(), description: description.trim() || null, department_id: deptVal });
      if (error) {
        toast.error(error.message.includes("duplicate") ? "A team with this name already exists" : error.message);
      } else {
        toast.success("Team created");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["teams"] });
      }
    }
    setSaving(false);
  };

  const handleDelete = async (team: Team) => {
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    if (error) toast.error("Failed to delete team");
    else {
      toast.success("Team deleted");
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    }
  };

  const handleAddMember = async (teamId: string) => {
    if (!workspaceId || !addMemberUserId) return;
    const { error } = await supabase
      .from("team_members")
      .insert({ team_id: teamId, user_id: addMemberUserId, workspace_id: workspaceId });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Already a member" : error.message);
    } else {
      toast.success("Member added to team");
      setAddMemberUserId("");
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from("team_members").delete().eq("id", memberId);
    if (error) toast.error("Failed to remove member");
    else {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
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
            <CardTitle>Teams &amp; Pods</CardTitle>
            <CardDescription>
              Cross-functional working groups that may span departments.
              Use teams to organize people around specific projects, initiatives, or specialties.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Team
          </Button>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-8 text-center">
              <Users2 className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h3 className="text-sm font-medium text-foreground mb-1">No teams yet</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                Teams (pods/squads) are cross-functional working groups. Create a team for a project squad, a product pod, or any working group that needs coordination.
              </p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Create First Team
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => {
                const members = getMembersForTeam(team.id);
                const isExpanded = expandedTeam === team.id;
                const available = getAvailableMembers(team.id);

                return (
                  <div key={team.id} className="rounded-md border">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{team.name}</p>
                          <Badge variant="secondary" className="text-xs">
                            {members.length} member{members.length !== 1 ? "s" : ""}
                          </Badge>
                          {team.department_id && (
                            <Badge variant="outline" className="text-xs">
                              {getDeptName(team.department_id)}
                            </Badge>
                          )}
                        </div>
                        {team.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{team.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(team)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(team)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                        {members.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No members assigned yet.</p>
                        ) : (
                          members.map((tm) => (
                            <div key={tm.id} className="flex items-center justify-between py-1">
                              <span className="text-sm text-foreground">{getProfileName(tm.user_id)}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveMember(tm.id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))
                        )}

                        {available.length > 0 && (
                          <div className="flex gap-2 pt-2 border-t">
                            <select
                              value={addMemberUserId}
                              onChange={(e) => setAddMemberUserId(e.target.value)}
                              className="h-8 flex-1 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              <option value="">Add member...</option>
                              {available.map((p) => (
                                <option key={p.user_id} value={p.user_id}>
                                  {p.full_name || p.user_id.slice(0, 8)}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleAddMember(team.id)}
                              disabled={!addMemberUserId}
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Team" : "New Team"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update team details."
                : "Create a cross-functional working group. Teams can optionally belong to a department."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alpha Squad, Design Pod, Growth Team"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-desc">Description (optional)</Label>
              <Input
                id="team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this team focus on?"
              />
            </div>
            <div className="space-y-2">
              <Label>Department (optional)</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
