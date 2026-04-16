import { useState } from "react";
import { AlertTriangle, Shield, Trash2, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export function DataErasureTab() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wsId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; action: "approved" | "denied" } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: requests = [] } = useQuery({
    queryKey: ["erasure-requests", wsId],
    queryFn: async () => {
      const { data } = await supabase
        .from("data_erasure_requests")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!wsId,
  });

  const handleSubmit = async () => {
    if (!wsId || !user) return;
    setLoading(true);

    const { error } = await supabase
      .from("data_erasure_requests")
      .insert({
        workspace_id: wsId,
        requested_by: user.id,
        reason: reason.trim() || null,
        request_type: "full_erasure",
      });

    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Data erasure request submitted", description: "An admin will review your request." });
      queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
      setReason("");
    }
    setLoading(false);
    setConfirmOpen(false);
  };

  const handleReview = async () => {
    if (!reviewTarget || !user || !wsId) return;
    setLoading(true);

    const updatePayload: Record<string, unknown> = {
      status: reviewTarget.action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      notes: reviewNotes.trim() || null,
    };

    const { error } = await supabase
      .from("data_erasure_requests")
      .update(updatePayload)
      .eq("id", reviewTarget.id)
      .eq("workspace_id", wsId);

    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
    } else {
      await supabase.from("audit_logs").insert({
        workspace_id: wsId,
        entity_type: "data_erasure_request",
        entity_id: reviewTarget.id,
        action: `erasure_${reviewTarget.action}`,
        actor_id: user.id,
        metadata: { notes: reviewNotes.trim() || null },
      });

      toast({
        title: reviewTarget.action === "approved" ? "Request approved" : "Request denied",
        description: reviewTarget.action === "approved"
          ? "The erasure request has been approved. Execute deactivation when ready."
          : "The erasure request has been denied.",
      });
      queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
    }
    setLoading(false);
    setReviewTarget(null);
    setReviewNotes("");
  };

  // Stage 1: Deactivate — revoke tokens, expire invites, soft-delete workspace
  const handleExecute = async (requestId: string) => {
    if (!wsId || !user) return;
    setLoading(true);

    const { data, error } = await supabase.rpc("execute_data_erasure", {
      _workspace_id: wsId,
      _request_id: requestId,
    });

    const result = data as Record<string, unknown> | null;

    if (error) {
      toast({ title: "Deactivation failed", description: error.message, variant: "destructive" });
    } else if (result && !result.success) {
      toast({ title: "Deactivation blocked", description: String(result.error || "Unknown error"), variant: "destructive" });
    } else {
      toast({
        title: "Workspace deactivated",
        description: `Tokens revoked (${result?.portal_tokens_revoked ?? 0}), invites expired (${result?.invites_expired ?? 0}). Workspace access cut off. Ready for final purge.`,
      });
      queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
    }
    setLoading(false);
  };

  // Stage 2: Destructive purge — server-owned storage + data deletion
  const handlePurge = async () => {
    if (!wsId || !user || !purgeTarget) return;
    setLoading(true);

    const { data, error } = await supabase.rpc("purge_workspace_data", {
      _workspace_id: wsId,
      _request_id: purgeTarget,
    });

    const result = data as Record<string, unknown> | null;

    if (error) {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
    } else if (result && !result.success) {
      toast({ title: "Purge blocked", description: String(result.error || "Unknown error"), variant: "destructive" });
    } else {
      toast({
        title: "Data purge complete",
        description: `All tenant records and ${result?.storage_deleted ?? 0} storage objects destroyed server-side. ${result?.storage_failed ?? 0} storage failures. Audit trail preserved.`,
      });
      queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
    }
    setLoading(false);
    setPurgeTarget(null);
  };

  const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
    pending: { icon: Clock, color: "bg-warning/15 text-warning", label: "Pending Review" },
    approved: { icon: CheckCircle2, color: "bg-primary/15 text-primary", label: "Approved" },
    pending_purge: { icon: Zap, color: "bg-orange-500/15 text-orange-600", label: "Pending Purge" },
    purged: { icon: Trash2, color: "bg-emerald-500/15 text-emerald-600", label: "Purged" },
    denied: { icon: XCircle, color: "bg-destructive/15 text-destructive", label: "Denied" },
  };

  const pendingRequests = requests.filter((r: any) => r.status === "pending");
  const approvedRequests = requests.filter((r: any) => r.status === "approved");
  const pendingPurgeRequests = requests.filter((r: any) => r.status === "pending_purge");

  return (
    <div className="space-y-6">
      {/* Submit request card */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-destructive" />
            Data Erasure Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">This action cannot be undone</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Submitting a data erasure request will initiate a multi-stage process:
                  <strong> 1) Review → 2) Deactivation</strong> (access cut off, tokens revoked)
                  <strong> → 3) Purge</strong> (all data permanently destroyed).
                  Audit logs are preserved as evidence of erasure.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="Why are you requesting data erasure?"
              maxLength={500}
            />
          </div>

          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Request Data Erasure
          </Button>
        </CardContent>
      </Card>

      {/* Admin: Pending review queue */}
      {isAdmin && pendingRequests.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              Pending Review ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingRequests.map((r: any) => (
                <div key={r.id} className="rounded-md border px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {r.request_type === "full_erasure" ? "Full Data Erasure" : r.request_type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submitted {format(new Date(r.created_at), "dd MMM yyyy HH:mm")}
                        {r.reason && ` · "${r.reason}"`}
                      </p>
                    </div>
                    <Badge variant="secondary" className="bg-warning/15 text-warning">Pending</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { setReviewTarget({ id: r.id, action: "approved" }); setReviewNotes(""); }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setReviewTarget({ id: r.id, action: "denied" }); setReviewNotes(""); }}
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin: Approved — ready for deactivation */}
      {isAdmin && approvedRequests.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Stage 1: Deactivation ({approvedRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Deactivation revokes portal tokens, expires pending invites, and soft-deletes the workspace to cut all access.
              No data is destroyed yet.
            </p>
            <div className="space-y-3">
              {approvedRequests.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Full Data Erasure</p>
                    <p className="text-xs text-muted-foreground">
                      Approved {r.reviewed_at ? format(new Date(r.reviewed_at), "dd MMM yyyy") : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleExecute(r.id)}
                    disabled={loading}
                  >
                    Deactivate Workspace
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin: Pending purge — ready for destructive deletion */}
      {isAdmin && pendingPurgeRequests.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
              <Zap className="h-4 w-4" />
              Stage 2: Final Purge ({pendingPurgeRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mb-3">
              <p className="text-xs text-destructive font-medium">⚠ IRREVERSIBLE</p>
              <p className="text-xs text-muted-foreground mt-1">
                This will permanently hard-delete ALL workspace data: companies, contacts, leads, proposals,
                projects, tasks, invoices, payments, expenses, files, and all related records.
                Only audit logs are preserved as evidence of erasure. Storage objects will be destroyed.
              </p>
            </div>
            <div className="space-y-3">
              {pendingPurgeRequests.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-destructive/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Full Data Erasure</p>
                    <p className="text-xs text-muted-foreground">
                      Deactivated · {r.notes?.includes("tokens=") ? r.notes.split("|").pop()?.trim() : "workspace offline"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPurgeTarget(r.id)}
                    disabled={loading}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Purge All Data
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request history */}
      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">All Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {requests.map((r: any) => {
                const cfg = statusConfig[r.status] || statusConfig.pending;
                const StatusIcon = cfg.icon;
                return (
                  <div key={r.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {r.request_type === "full_erasure" ? "Full Data Erasure" : r.request_type}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {format(new Date(r.created_at), "dd MMM yyyy")}
                          {r.reason && ` · ${r.reason}`}
                          {r.completed_at && ` · Completed ${format(new Date(r.completed_at), "dd MMM yyyy")}`}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className={cfg.color}>
                      {cfg.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Data Erasure Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to submit a data erasure request? This will be reviewed by an admin.
              Once approved, the workspace will be deactivated and all data will be permanently destroyed in a final purge stage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={loading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {loading ? "Submitting..." : "Confirm Request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Review confirmation */}
      <AlertDialog open={!!reviewTarget} onOpenChange={(o) => { if (!o) setReviewTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reviewTarget?.action === "approved" ? "Approve Erasure Request" : "Deny Erasure Request"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reviewTarget?.action === "approved"
                ? "This will approve the request. You will still need to execute deactivation and then final purge separately."
                : "This will deny the request. No data will be affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Admin notes (optional)</label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="Add review notes..."
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReview}
              disabled={loading}
              className={reviewTarget?.action === "approved" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {loading ? "Processing..." : reviewTarget?.action === "approved" ? "Approve" : "Deny"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Purge confirmation — extra safety */}
      <AlertDialog open={!!purgeTarget} onOpenChange={(o) => { if (!o) setPurgeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">⚠ Permanent Data Destruction</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently and irreversibly destroy ALL workspace data including:
              companies, contacts, leads, proposals, projects, tasks, invoices, payments, expenses,
              vendors, subscriptions, renewals, files, and all related records.
              <br /><br />
              <strong>Only audit logs will be preserved as evidence of the erasure.</strong>
              <br /><br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel — Keep Data</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? "Purging..." : "Permanently Destroy All Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
