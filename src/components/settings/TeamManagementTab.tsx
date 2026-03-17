import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Shield, User, Clock, XCircle, Copy, Check, Mail } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface MemberRow {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  full_name: string | null;
  email: string | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  token: string;
}

export function TeamManagementTab() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("team_member");
  const [inviting, setInviting] = useState(false);
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
  const [lastCreatedInviteId, setLastCreatedInviteId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sent" | "failed" | "skipped">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    const [membershipsRes, invitesRes] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select("id, user_id, role, created_at")
        .eq("workspace_id", currentWorkspace.id),
      supabase
        .from("workspace_invites")
        .select("id, email, role, status, created_at, expires_at, token")
        .eq("workspace_id", currentWorkspace.id)
        .order("created_at", { ascending: false }),
    ]);

    const memberships = membershipsRes.data ?? [];
    const inviteData = (invitesRes.data ?? []) as unknown as InviteRow[];

    if (memberships.length > 0) {
      const userIds = memberships.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map((p) => [p.user_id, p.full_name]) ?? []);

      const enriched: MemberRow[] = memberships.map((m) => ({
        ...m,
        full_name: profileMap.get(m.user_id) || null,
        email: m.user_id === user?.id ? user.email ?? null : null,
      }));
      setMembers(enriched);
    } else {
      setMembers([]);
    }

    setInvites(inviteData);
    setLoading(false);
  }, [currentWorkspace, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRoleChange = async (membershipId: string, newRole: AppRole, targetUserId: string) => {
    if (targetUserId === user?.id) {
      toast.error("You cannot change your own role");
      return;
    }
    const { error } = await supabase
      .from("workspace_memberships")
      .update({ role: newRole })
      .eq("id", membershipId);

    if (error) {
      toast.error("Failed to update role");
    } else {
      toast.success("Role updated");
      fetchData();
    }
  };

  const handleRemoveMember = async (membershipId: string, targetUserId: string) => {
    if (targetUserId === user?.id) {
      toast.error("You cannot remove yourself");
      return;
    }
    const { error } = await supabase
      .from("workspace_memberships")
      .delete()
      .eq("id", membershipId);

    if (error) {
      toast.error("Failed to remove member");
    } else {
      toast.success("Member removed");
      fetchData();
    }
  };

  const handleInvite = async () => {
    if (!currentWorkspace || !inviteEmail.trim()) return;
    setInviting(true);

    const { data, error } = await supabase.rpc("create_workspace_invite", {
      _workspace_id: currentWorkspace.id,
      _email: inviteEmail.trim(),
      _role: inviteRole,
    });

    if (error) {
      toast.error("Failed to create invite: " + error.message);
    } else {
      const res = data as any;
      if (res.success) {
        toast.success(`Invite created for ${inviteEmail.trim()}`);
        setLastCreatedToken(res.token);
        // RPC already returns invite_id — no second lookup needed
        setLastCreatedInviteId(res.invite_id || null);
        setEmailStatus("idle");
        setEmailError(null);
        setInviteEmail("");
        setInviteRole("team_member");
        fetchData();
      } else {
        toast.error(res.error || "Failed to create invite");
      }
    }
    setInviting(false);
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const { data, error } = await supabase.rpc("revoke_workspace_invite", {
      _invite_id: inviteId,
    });

    if (error) {
      toast.error("Failed to revoke invite");
    } else {
      const res = data as any;
      if (res.success) {
        toast.success("Invite revoked");
        fetchData();
      } else {
        toast.error(res.error || "Failed to revoke invite");
      }
    }
  };

  const getInviteLink = (token: string) => {
    return `${window.location.origin}/invite?token=${token}`;
  };

  const handleCopyLink = async (token: string) => {
    await navigator.clipboard.writeText(getInviteLink(token));
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleSendInviteEmail = async (inviteId: string) => {
    if (!currentWorkspace || sendingEmail) return;
    setSendingEmail(true);
    setEmailStatus("idle");
    setEmailError(null);

    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          type: "invite",
          workspace_id: currentWorkspace.id,
          invite_id: inviteId,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setEmailStatus("sent");
        toast.success("Invite email sent successfully");
      } else if (data?.status === "skipped") {
        setEmailStatus("skipped");
        setEmailError(data.error);
      } else {
        setEmailStatus("failed");
        setEmailError(data?.error || "Failed to send email");
        toast.error(data?.error || "Failed to send invite email");
      }
    } catch {
      setEmailStatus("failed");
      setEmailError("Failed to send email");
      toast.error("Failed to send invite email");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendInviteEmailFromRow = async (invite: InviteRow) => {
    if (!currentWorkspace || sendingEmail) return;
    setSendingEmail(true);

    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          type: "invite",
          workspace_id: currentWorkspace.id,
          invite_id: invite.id,
          app_base_url: window.location.origin,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Invite email sent to ${invite.email}`);
      } else if (data?.status === "skipped") {
        toast.info(data.error || "Email sending is not configured yet");
      } else {
        toast.error(data?.error || "Failed to send invite email");
      }
    } catch (err: any) {
      toast.error("Failed to send invite email");
    } finally {
      setSendingEmail(false);
    }
  };

  const pendingInvites = invites.filter((i) => i.status === "pending");
  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>Manage who has access to this workspace</CardDescription>
          </div>
          <Button size="sm" onClick={() => { setInviteOpen(true); setLastCreatedToken(null); setLastCreatedInviteId(null); setEmailStatus("idle"); setEmailError(null); }}>
            <Plus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          {m.role === "admin" ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {m.full_name || "Unnamed User"}
                            {m.user_id === user?.id && (
                              <Badge variant="secondary" className="ml-2 text-xs">You</Badge>
                            )}
                          </p>
                          {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.user_id === user?.id ? (
                        <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                          {m.role === "admin" ? "Admin" : "Team Member"}
                        </Badge>
                      ) : (
                        <Select value={m.role} onValueChange={(v) => handleRoleChange(m.id, v as AppRole, m.user_id)}>
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="team_member">Team Member</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {m.user_id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMember(m.id, m.user_id)}
                          aria-label="Remove member"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Invites</CardTitle>
            <CardDescription>Invitations awaiting acceptance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvites.map((inv) => {
                    const expired = isExpired(inv.expires_at);
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              <Clock className="h-4 w-4" />
                            </div>
                            <span className="text-sm">{inv.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {inv.role === "admin" ? "Admin" : "Team Member"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {expired ? (
                            <Badge variant="destructive" className="text-xs">Expired</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(inv.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {!expired && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => handleCopyLink(inv.token)}
                              >
                                <Copy className="h-3 w-3" />
                                Copy
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => handleSendInviteEmailFromRow(inv)}
                                disabled={sendingEmail}
                                aria-label={`Send invite email to ${inv.email}`}
                              >
                                {sendingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                                Email
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleRevokeInvite(inv.id)}
                            aria-label="Revoke invite"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invite link. The user will need to accept it after logging in or signing up.
            </DialogDescription>
          </DialogHeader>

          {lastCreatedToken ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Invite created! Share this link with the user:</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
                <code className="flex-1 text-xs break-all">{getInviteLink(lastCreatedToken)}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyLink(lastCreatedToken)}
                  aria-label="Copy invite link"
                >
                  {copiedToken ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              {/* Email send action */}
              {lastCreatedInviteId && emailStatus === "idle" && (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => handleSendInviteEmail(lastCreatedInviteId)}
                  disabled={sendingEmail}
                >
                  {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Send Invite via Email
                </Button>
              )}

              {emailStatus === "sent" && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
                  <Check className="inline h-4 w-4 mr-1" /> Invite email sent successfully.
                </div>
              )}

              {emailStatus === "skipped" && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-300">
                  <Mail className="inline h-4 w-4 mr-1" /> {emailError || "Email sending is not configured yet. Share the link manually."}
                </div>
              )}

              {emailStatus === "failed" && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  Email failed: {emailError || "Unknown error"}. You can still share the link manually.
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => { setInviteOpen(false); setLastCreatedToken(null); setLastCreatedInviteId(null); setEmailStatus("idle"); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="team_member">Team Member</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Invite
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
