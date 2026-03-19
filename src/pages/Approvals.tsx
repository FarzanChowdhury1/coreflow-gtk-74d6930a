import { useEffect, useState, useCallback } from "react";
import { CheckSquare, Plus, Settings2, Clock, CheckCircle2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { WorkflowFormDialog } from "@/components/approvals/WorkflowFormDialog";
import { ApprovalDecisionDialog } from "@/components/approvals/ApprovalDecisionDialog";
import { toast } from "sonner";
import { format } from "date-fns";

const STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting Review",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const ENTITY_LABELS: Record<string, string> = {
  proposal_version: "Proposal",
  invoice: "Invoice",
  project: "Project",
};

export default function ApprovalsPage() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [members, setMembers] = useState<{ user_id: string; full_name: string | null }[]>([]);
  const [showWorkflowForm, setShowWorkflowForm] = useState(false);
  const [decisionRequestId, setDecisionRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = currentRole === "admin";

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    const [wfRes, reqRes, actRes, memRes] = await Promise.all([
      supabase
        .from("approval_workflows")
        .select("*, approval_steps(*)")
        .eq("workspace_id", currentWorkspace.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_requests")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_actions")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("acted_at", { ascending: false })
        .limit(50),
      supabase
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", currentWorkspace.id),
    ]);

    if (wfRes.data) setWorkflows(wfRes.data);
    if (reqRes.data) setRequests(reqRes.data);
    if (actRes.data) setActions(actRes.data);

    if (memRes.data) {
      const userIds = memRes.data.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      setMembers(profiles || []);
    }

    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getMemberName = (userId: string) =>
    members.find((m) => m.user_id === userId)?.full_name || userId.slice(0, 8);

  const formatEntity = (type: string) => ENTITY_LABELS[type] || type.replace(/_/g, " ");

  const myPendingRequests = requests.filter((r) => {
    if (r.status !== "pending") return false;
    const workflow = workflows.find((w) => w.id === r.workflow_id);
    if (!workflow) return false;
    const currentStep = (workflow.approval_steps || []).find(
      (s: any) => s.step_order === r.current_step
    );
    return currentStep?.approver_id === user?.id;
  });

  const deleteWorkflow = async (id: string) => {
    const { error } = await supabase.from("approval_workflows").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Workflow deleted"); fetchData(); }
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const completedRequests = requests.filter((r) => r.status !== "pending");

  // Get recent actions for a request to show decision trail
  const getRequestActions = (requestId: string) =>
    actions.filter((a) => a.request_id === requestId).slice(0, 5);

  if (loading) return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <CheckSquare className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Approvals</h1>
      </div>
      <div className="text-center py-8 text-muted-foreground">Loading…</div>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CheckSquare className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Approvals</h1>
          {myPendingRequests.length > 0 && (
            <Badge className="bg-primary text-primary-foreground">
              {myPendingRequests.length} need{myPendingRequests.length === 1 ? "s" : ""} your review
            </Badge>
          )}
        </div>
        {isAdmin && (
          <Button onClick={() => setShowWorkflowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Workflow
          </Button>
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Track proposals, invoices, and projects that need sign-off. Items move through each reviewer in sequence — work can continue while approval is in progress.
      </p>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-4 w-4" /> Needs Review ({pendingRequests.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Completed
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="workflows" className="gap-1.5">
              <Settings2 className="h-4 w-4" /> Workflows
            </TabsTrigger>
          )}
        </TabsList>

        {/* Pending Requests */}
        <TabsContent value="pending">
          {pendingRequests.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">All clear</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Nothing is waiting for approval right now. When a proposal, invoice, or project is submitted for review, it will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3 mt-4">
              {pendingRequests.map((req) => {
                const workflow = workflows.find((w) => w.id === req.workflow_id);
                const totalSteps = workflow?.approval_steps?.length || 0;
                const sortedSteps = (workflow?.approval_steps || []).sort(
                  (a: any, b: any) => a.step_order - b.step_order
                );
                const currentStepData = sortedSteps.find(
                  (s: any) => s.step_order === req.current_step
                );
                const isMyTurn = currentStepData?.approver_id === user?.id;
                const reqActions = getRequestActions(req.id);

                return (
                  <Card key={req.id} className={isMyTurn ? "border-primary shadow-sm" : ""}>
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {formatEntity(req.entity_type)}
                            </span>
                            <Badge className={STATUS_COLORS.pending}>
                              Step {req.current_step} of {totalSteps}
                            </Badge>
                            {isMyTurn && (
                              <Badge className="bg-primary text-primary-foreground">
                                Action needed — your review
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Submitted by {getMemberName(req.requested_by)} · {format(new Date(req.created_at), "dd MMM yyyy")}
                          </p>
                        </div>
                        {isMyTurn && (
                          <Button size="sm" onClick={() => setDecisionRequestId(req.id)}>
                            Review & Decide
                          </Button>
                        )}
                      </div>

                      {/* Step progress visualization */}
                      <div className="flex items-center gap-1 text-xs">
                        {sortedSteps.map((step: any, i: number) => {
                          const isPast = step.step_order < req.current_step;
                          const isCurrent = step.step_order === req.current_step;
                          return (
                            <div key={step.id} className="flex items-center gap-1">
                              {i > 0 && <span className="text-muted-foreground/40">→</span>}
                              <span className={
                                isPast
                                  ? "text-green-600 dark:text-green-400 line-through"
                                  : isCurrent
                                    ? "text-primary font-medium"
                                    : "text-muted-foreground"
                              }>
                                {getMemberName(step.approver_id)}
                              </span>
                              {isPast && <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />}
                              {isCurrent && <Clock className="h-3 w-3 text-primary" />}
                            </div>
                          );
                        })}
                      </div>

                      {/* Show recent decision comments */}
                      {reqActions.length > 0 && (
                        <div className="border-t pt-2 space-y-1">
                          {reqActions.map((a) => (
                            <p key={a.id} className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{getMemberName(a.actor_id)}</span>
                              {" "}
                              {a.decision === "approved" ? "approved" : "declined"}
                              {a.comment && <span> — "{a.comment}"</span>}
                            </p>
                          ))}
                        </div>
                      )}

                      {!isMyTurn && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Waiting for {currentStepData ? getMemberName(currentStepData.approver_id) : "next reviewer"} to review
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          {completedRequests.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center">
              <Clock className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">No completed reviews yet</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Once items are approved or declined, they'll appear here as a record.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card mt-4 overflow-x-auto">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedRequests.map((req) => {
                    const workflow = workflows.find((w) => w.id === req.workflow_id);
                    return (
                      <TableRow key={req.id}>
                        <TableCell className="text-foreground font-medium">
                          {formatEntity(req.entity_type)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{workflow?.name || "—"}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[req.status]}>
                            {STATUS_LABELS[req.status] || req.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{getMemberName(req.requested_by)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {req.resolved_at ? format(new Date(req.resolved_at), "dd MMM yyyy") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Workflows (admin only) */}
        {isAdmin && (
          <TabsContent value="workflows">
            {workflows.length === 0 ? (
              <div className="rounded-lg border bg-card p-10 text-center">
                <Settings2 className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <h2 className="text-sm font-medium text-foreground mb-1">No workflows yet</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  Workflows define who needs to review and approve proposals, invoices, or projects before they move forward. Each workflow can have multiple reviewers in sequence.
                </p>
                <Button size="sm" onClick={() => setShowWorkflowForm(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Create First Workflow
                </Button>
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <Info className="h-3 w-3" />
                  Workflows define the review chain. When someone submits an item, each reviewer is notified in order.
                </p>
                {workflows.map((wf) => {
                  const sortedSteps = (wf.approval_steps || []).sort(
                    (a: any, b: any) => a.step_order - b.step_order
                  );
                  return (
                    <Card key={wf.id}>
                      <CardContent className="flex items-center justify-between py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{wf.name}</span>
                            <Badge variant="outline">{formatEntity(wf.entity_type)}</Badge>
                            <Badge variant={wf.is_active ? "default" : "secondary"}>
                              {wf.is_active ? "Active" : "Paused"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {sortedSteps.length} reviewer{sortedSteps.length !== 1 ? "s" : ""}: {sortedSteps
                              .map((s: any) => getMemberName(s.approver_id))
                              .join(" → ")}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteWorkflow(wf.id)}>
                          Delete
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <WorkflowFormDialog
        open={showWorkflowForm}
        onOpenChange={setShowWorkflowForm}
        onCreated={fetchData}
        members={members}
      />

      {decisionRequestId && (
        <ApprovalDecisionDialog
          open={!!decisionRequestId}
          onOpenChange={(v) => !v && setDecisionRequestId(null)}
          requestId={decisionRequestId}
          onDecided={fetchData}
        />
      )}
    </div>
  );
}
