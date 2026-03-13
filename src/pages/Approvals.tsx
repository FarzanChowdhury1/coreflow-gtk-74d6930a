import { useEffect, useState, useCallback } from "react";
import { CheckSquare, Plus, Settings2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { WorkflowFormDialog } from "@/components/approvals/WorkflowFormDialog";
import { ApprovalDecisionDialog } from "@/components/approvals/ApprovalDecisionDialog";
import { toast } from "sonner";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
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

    // Fetch profile names for members
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

  const getMemberName = (userId: string) => {
    return members.find((m) => m.user_id === userId)?.full_name || userId.slice(0, 8);
  };

  // Determine which requests the current user can act on
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

  const submitForApproval = async (entityType: string, entityId: string) => {
    if (!currentWorkspace) return;
    const { data, error } = await supabase.rpc("submit_for_approval", {
      _workspace_id: currentWorkspace.id,
      _entity_type: entityType,
      _entity_id: entityId,
    });
    if (error) { toast.error(error.message); return; }
    const result = data as any;
    if (!result.success) { toast.error(result.error); return; }
    toast.success("Submitted for approval");
    fetchData();
  };

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CheckSquare className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Approvals</h1>
          {myPendingRequests.length > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              {myPendingRequests.length} awaiting you
            </Badge>
          )}
        </div>
        {isAdmin && (
          <Button onClick={() => setShowWorkflowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Workflow
          </Button>
        )}
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-4 w-4" /> Pending ({requests.filter((r) => r.status === "pending").length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> History
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="workflows" className="gap-1.5">
              <Settings2 className="h-4 w-4" /> Workflows
            </TabsTrigger>
          )}
        </TabsList>

        {/* Pending Requests */}
        <TabsContent value="pending">
          {requests.filter((r) => r.status === "pending").length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              No pending approval requests.
            </div>
          ) : (
            <div className="space-y-3 mt-4">
              {requests
                .filter((r) => r.status === "pending")
                .map((req) => {
                  const workflow = workflows.find((w) => w.id === req.workflow_id);
                  const totalSteps = workflow?.approval_steps?.length || 0;
                  const currentStepData = (workflow?.approval_steps || []).find(
                    (s: any) => s.step_order === req.current_step
                  );
                  const isMyTurn = currentStepData?.approver_id === user?.id;

                  return (
                    <Card key={req.id} className={isMyTurn ? "border-primary" : ""}>
                      <CardContent className="flex items-center justify-between py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {req.entity_type.replace("_", " ")}
                            </span>
                            <Badge className={STATUS_COLORS.pending}>
                              Step {req.current_step}/{totalSteps}
                            </Badge>
                            {isMyTurn && (
                              <Badge className="bg-primary text-primary-foreground">Your turn</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Workflow: {workflow?.name || "—"} · Requested by: {getMemberName(req.requested_by)} · {format(new Date(req.created_at), "dd MMM yyyy HH:mm")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Current approver: {currentStepData ? getMemberName(currentStepData.approver_id) : "—"}
                          </p>
                        </div>
                        {isMyTurn && (
                          <Button size="sm" onClick={() => setDecisionRequestId(req.id)}>
                            Review
                          </Button>
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
          {requests.filter((r) => r.status !== "pending").length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              No completed approval requests yet.
            </div>
          ) : (
            <div className="rounded-lg border bg-card mt-4 overflow-x-auto">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Resolved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests
                    .filter((r) => r.status !== "pending")
                    .map((req) => {
                      const workflow = workflows.find((w) => w.id === req.workflow_id);
                      return (
                        <TableRow key={req.id}>
                          <TableCell className="text-foreground">{req.entity_type.replace("_", " ")}</TableCell>
                          <TableCell>{workflow?.name || "—"}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[req.status]}>{req.status}</Badge>
                          </TableCell>
                          <TableCell>{getMemberName(req.requested_by)}</TableCell>
                          <TableCell>
                            {req.resolved_at ? format(new Date(req.resolved_at), "dd MMM yyyy HH:mm") : "—"}
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
              <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
                No workflows configured. Create one to enable approval chains.
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                {workflows.map((wf) => (
                  <Card key={wf.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{wf.name}</span>
                          <Badge variant="outline">{wf.entity_type.replace("_", " ")}</Badge>
                          <Badge variant={wf.is_active ? "default" : "secondary"}>
                            {wf.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {(wf.approval_steps || []).length} step(s): {(wf.approval_steps || [])
                            .sort((a: any, b: any) => a.step_order - b.step_order)
                            .map((s: any) => getMemberName(s.approver_id))
                            .join(" → ")}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteWorkflow(wf.id)}>
                        Delete
                      </Button>
                    </CardContent>
                  </Card>
                ))}
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
