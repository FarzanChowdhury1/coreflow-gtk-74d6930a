import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Building2, Zap, AlertTriangle,
  CheckCircle2, Circle, TrendingUp, Rocket, Activity, Users,
  Clock, UserCheck, MessageSquare,
} from "lucide-react";
import { formatDistanceToNow, differenceInDays, format } from "date-fns";
import { WorkspaceFollowupSheet } from "@/components/platform/WorkspaceFollowupSheet";

interface WorkspaceRow {
  id: string;
  name: string;
  plan: string;
  seat_limit: number;
  seat_count: number;
  trial_ends_at: string | null;
  created_at: string;
  last_activity: string | null;
  event_count: number;
  event_names: string[] | null;
  company_count: number;
  admin_emails: string[] | null;
  admin_count: number;
  team_member_count: number;
  billing_owner_email: string | null;
  followup_stage: string | null;
  next_followup_date: string | null;
  last_contacted_at: string | null;
  followup_priority: string | null;
  followup_owner_email: string | null;
  last_note: string | null;
  note_count: number;
  deleted_at: string | null;
}

interface Summary {
  total: number;
  free: number;
  growth: number;
  enterprise: number;
  active_trials: number;
  expired_trials: number;
  over_seat_limit: number;
}

const MODULE_EVENTS = [
  "lead.first_created", "proposal.first_created", "project.first_created",
  "invoice.first_issued", "payment.first_recorded", "renewal.first_created",
  "vendor.first_created", "expense.first_created", "subscription.first_created",
  "budget.first_created", "meeting.first_created", "portal.first_token_created",
] as const;

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  trialing: "Trialing",
  activated_free: "Activated (Free)",
  expansion_opportunity: "Expansion",
  trial_expired: "Trial Expired",
  follow_up_needed: "Follow-up Needed",
  converted_manual: "Converted",
  enterprise_pipeline: "Enterprise",
  churn_risk: "Churn Risk",
  inactive: "Inactive",
  closed_lost: "Closed/Lost",
};

const STAGE_COLORS: Record<string, string> = {
  new: "bg-muted text-muted-foreground",
  trialing: "bg-primary/10 text-primary border-primary/30",
  activated_free: "bg-accent/50 text-accent-foreground",
  expansion_opportunity: "bg-primary/20 text-primary border-primary/40",
  trial_expired: "bg-destructive/10 text-destructive border-destructive/30",
  follow_up_needed: "bg-warning/10 text-warning border-warning/30",
  converted_manual: "bg-primary/10 text-primary border-primary/30",
  enterprise_pipeline: "bg-accent/50 text-accent-foreground border-accent",
  churn_risk: "bg-destructive/10 text-destructive border-destructive/30",
  inactive: "bg-muted text-muted-foreground",
  closed_lost: "bg-muted text-muted-foreground/50",
};

function getFollowUpFlags(ws: WorkspaceRow): string[] {
  const flags: string[] = [];
  const now = new Date();

  if (ws.trial_ends_at) {
    const trialEnd = new Date(ws.trial_ends_at);
    const daysLeft = differenceInDays(trialEnd, now);
    if (daysLeft > 0 && daysLeft <= 3) flags.push("Trial expiring soon");
    if (daysLeft <= 0) flags.push("Trial expired");
  }

  if (ws.seat_count > ws.seat_limit) flags.push("Over seat limit");
  if (ws.seat_count >= ws.seat_limit && ws.plan === "free") flags.push("At seat limit (free)");

  const moduleCount = ws.event_names?.filter(e => MODULE_EVENTS.includes(e as any)).length ?? 0;
  if (moduleCount >= 5 && ws.plan === "free") flags.push("Strong activation, still free");

  if (ws.last_activity) {
    const daysSince = differenceInDays(now, new Date(ws.last_activity));
    if (daysSince >= 14) flags.push("Stalled 14d+");
    else if (daysSince >= 7) flags.push("Inactive 7d+");
  } else {
    flags.push("No activity recorded");
  }

  if (ws.next_followup_date) {
    const fDate = new Date(ws.next_followup_date);
    if (fDate < now) flags.push("Follow-up overdue");
  }

  if (!ws.followup_owner_email) flags.push("No owner assigned");

  return flags;
}

function PlanBadge({ plan, trialEnd }: { plan: string; trialEnd: string | null }) {
  const now = new Date();
  const isActiveTrial = trialEnd && new Date(trialEnd) > now;

  if (plan === "enterprise") return <Badge variant="outline" className="bg-accent/50 text-accent-foreground border-accent">Enterprise</Badge>;
  if (plan === "growth" && isActiveTrial) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Growth Trial</Badge>;
  if (plan === "growth") return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Growth</Badge>;
  return <Badge variant="secondary">Free</Badge>;
}

function AdminEmailsCell({ emails, billingOwnerEmail }: { emails: string[] | null; billingOwnerEmail: string | null }) {
  if (!emails || emails.length === 0) {
    return <span className="text-xs text-muted-foreground/50">No admins</span>;
  }

  const primary = billingOwnerEmail || emails[0];
  const others = emails.filter(e => e !== primary);

  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground truncate max-w-[180px]" title={primary}>
        {primary}
      </p>
      {billingOwnerEmail && (
        <p className="text-[10px] text-primary font-medium">Billing owner</p>
      )}
      {others.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-muted-foreground cursor-help">
                +{others.length} more
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-0.5">
                {others.map((e) => (
                  <p key={e} className="text-xs">{e}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function StageBadge({ stage }: { stage: string | null }) {
  const s = stage || "new";
  return (
    <Badge variant="outline" className={`text-[10px] ${STAGE_COLORS[s] || ""}`}>
      {STAGE_LABELS[s] || s}
    </Badge>
  );
}

export default function PlatformDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterFlag, setFilterFlag] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [sortBy, setSortBy] = useState<"created" | "activity" | "seats" | "activation" | "followup">("activity");
  const [selectedWs, setSelectedWs] = useState<WorkspaceRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("platform_workspace_overview" as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const result = data as any;
    setWorkspaces(result?.workspaces ?? []);
    setSummary(result?.summary ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let rows = [...workspaces];

    if (filterPlan !== "all") {
      if (filterPlan === "trial_active") rows = rows.filter(w => w.trial_ends_at && new Date(w.trial_ends_at) > new Date());
      else if (filterPlan === "trial_expired") rows = rows.filter(w => w.trial_ends_at && new Date(w.trial_ends_at) <= new Date());
      else rows = rows.filter(w => w.plan === filterPlan);
    }

    if (filterStage !== "all") {
      rows = rows.filter(w => (w.followup_stage || "new") === filterStage);
    }

    if (filterFlag === "over_limit") rows = rows.filter(w => w.seat_count > w.seat_limit);
    else if (filterFlag === "stalled") rows = rows.filter(w => {
      if (!w.last_activity) return true;
      return differenceInDays(new Date(), new Date(w.last_activity)) >= 7;
    });
    else if (filterFlag === "needs_followup") rows = rows.filter(w => getFollowUpFlags(w).length > 0);
    else if (filterFlag === "overdue") rows = rows.filter(w => w.next_followup_date && new Date(w.next_followup_date) < new Date());
    else if (filterFlag === "no_owner") rows = rows.filter(w => !w.followup_owner_email);
    else if (filterFlag === "activated") {
      rows = rows.filter(w => (w.event_names?.filter(e => MODULE_EVENTS.includes(e as any)).length ?? 0) >= 3);
    }

    rows.sort((a, b) => {
      if (sortBy === "activity") {
        const aT = a.last_activity ? new Date(a.last_activity).getTime() : 0;
        const bT = b.last_activity ? new Date(b.last_activity).getTime() : 0;
        return bT - aT;
      }
      if (sortBy === "seats") return b.seat_count - a.seat_count;
      if (sortBy === "activation") return (b.event_count ?? 0) - (a.event_count ?? 0);
      if (sortBy === "followup") {
        const aD = a.next_followup_date ? new Date(a.next_followup_date).getTime() : Infinity;
        const bD = b.next_followup_date ? new Date(b.next_followup_date).getTime() : Infinity;
        return aD - bD;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return rows;
  }, [workspaces, filterPlan, filterFlag, filterStage, sortBy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const overdueCount = workspaces.filter(w => w.next_followup_date && new Date(w.next_followup_date) < new Date()).length;
  const unownedCount = workspaces.filter(w => !w.followup_owner_email).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Platform Operations</h1>
            <p className="text-sm text-muted-foreground">Internal sales ops & workspace follow-up — CoreFlow only</p>
          </div>
          <div className="ml-auto">
            <Link to="/platform/feedback">
              <Button variant="outline" size="sm">Feedback Inbox</Button>
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Workspaces</CardDescription>
                <CardTitle className="text-3xl">{summary.total}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Free: {summary.free} · Growth: {summary.growth} · Enterprise: {summary.enterprise}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Trials</CardDescription>
                <CardTitle className="text-3xl">{summary.active_trials}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Active: {summary.active_trials} · Expired: {summary.expired_trials}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Over Seat Limit</CardDescription>
                <CardTitle className="text-3xl">{summary.over_seat_limit}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Exceeding seat cap</p>
              </CardContent>
            </Card>

            <Card className={overdueCount > 0 ? "border-destructive/30" : ""}>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Follow-up Overdue</CardDescription>
                <CardTitle className="text-3xl">{overdueCount}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Past scheduled follow-up date</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" /> Unowned</CardDescription>
                <CardTitle className="text-3xl">{unownedCount}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">No internal owner assigned</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterPlan} onValueChange={setFilterPlan}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="trial_active">Trial Active</SelectItem>
              <SelectItem value="trial_expired">Trial Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStage} onValueChange={setFilterStage}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {Object.entries(STAGE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterFlag} onValueChange={setFilterFlag}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Flag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              <SelectItem value="needs_followup">Any Flag</SelectItem>
              <SelectItem value="overdue">Follow-up Overdue</SelectItem>
              <SelectItem value="no_owner">No Owner</SelectItem>
              <SelectItem value="over_limit">Over Seat Limit</SelectItem>
              <SelectItem value="stalled">Stalled (7d+)</SelectItem>
              <SelectItem value="activated">Activated (3+)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Last Activity</SelectItem>
              <SelectItem value="followup">Next Follow-up</SelectItem>
              <SelectItem value="created">Created Date</SelectItem>
              <SelectItem value="seats">Seat Count</SelectItem>
              <SelectItem value="activation">Activation</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Workspace Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Workspaces ({filtered.length})</CardTitle>
            <CardDescription>Click a row to open follow-up details. Operational metadata only.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Admin / Billing</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Seats</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Next Follow-up</TableHead>
                    <TableHead className="text-center">Notes</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No workspaces match filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((ws) => {
                      const flags = getFollowUpFlags(ws);
                      const isOverdue = ws.next_followup_date && new Date(ws.next_followup_date) < new Date();

                      return (
                        <TableRow
                          key={ws.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedWs(ws)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium text-foreground">
                                {ws.name}
                                {ws.deleted_at && (
                                  <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Deactivated</Badge>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {ws.company_count} client{ws.company_count !== 1 ? "s" : ""}
                                {" · "}
                                <span className="inline-flex items-center gap-0.5">
                                  <Users className="h-3 w-3" />
                                  {ws.admin_count}A / {ws.team_member_count}M
                                </span>
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <AdminEmailsCell
                              emails={ws.admin_emails}
                              billingOwnerEmail={ws.billing_owner_email}
                            />
                          </TableCell>
                          <TableCell>
                            <PlanBadge plan={ws.plan} trialEnd={ws.trial_ends_at} />
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={ws.seat_count > ws.seat_limit ? "text-destructive font-semibold" : ""}>
                              {ws.seat_count}/{ws.seat_limit}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StageBadge stage={ws.followup_stage} />
                          </TableCell>
                          <TableCell>
                            {ws.followup_owner_email ? (
                              <span className="text-xs text-foreground truncate max-w-[120px] block" title={ws.followup_owner_email}>
                                {ws.followup_owner_email.split("@")[0]}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {ws.next_followup_date ? (
                              <span className={`text-xs ${isOverdue ? "text-destructive font-semibold" : "text-foreground"}`}>
                                {format(new Date(ws.next_followup_date), "dd MMM")}
                                {isOverdue && " ⚠"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {ws.note_count > 0 ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-0.5 text-xs text-foreground cursor-help">
                                      <MessageSquare className="h-3 w-3" /> {ws.note_count}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="text-xs">{ws.last_note}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-xs text-muted-foreground/30">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {flags.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {flags.slice(0, 2).map((f) => (
                                  <Badge key={f} variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                                    {f}
                                  </Badge>
                                ))}
                                {flags.length > 2 && (
                                  <Badge variant="outline" className="text-[10px]">
                                    +{flags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Module Adoption Heatmap */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              Module Adoption
            </CardTitle>
            <CardDescription>
              First-use adoption per module — not usage volume.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {MODULE_EVENTS.map((ev) => {
                const label = ev.replace(/\.\w+_\w+$/, "").replace(".", " ");
                const adopted = workspaces.filter(w => w.event_names?.includes(ev)).length;
                const total = workspaces.length;
                const pct = total > 0 ? Math.round((adopted / total) * 100) : 0;

                return (
                  <div key={ev} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground capitalize">{label}</p>
                    <p className="text-lg font-semibold">{adopted}/{total}</p>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{pct}% adoption</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center py-4">
          Internal sales ops dashboard. No customer business data exposed. Follow-up metadata is visible only to platform admins.
        </p>
      </div>

      {/* Follow-up Detail Sheet */}
      <WorkspaceFollowupSheet
        workspace={selectedWs}
        open={!!selectedWs}
        onOpenChange={(open) => { if (!open) setSelectedWs(null); }}
        onUpdated={fetchData}
      />
    </div>
  );
}
