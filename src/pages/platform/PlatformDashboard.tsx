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
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Building2, Zap, AlertTriangle,
  CheckCircle2, Circle, TrendingUp, Rocket, Activity,
} from "lucide-react";
import { formatDistanceToNow, differenceInDays, format } from "date-fns";

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

  if (ws.event_names?.includes("workspace.sample_data_loaded") && moduleCount <= 1) {
    flags.push("Sample data only");
  }

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

export default function PlatformDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterFlag, setFilterFlag] = useState("all");
  const [sortBy, setSortBy] = useState<"created" | "activity" | "seats" | "activation">("activity");

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

    if (filterFlag === "over_limit") rows = rows.filter(w => w.seat_count > w.seat_limit);
    else if (filterFlag === "stalled") rows = rows.filter(w => {
      if (!w.last_activity) return true;
      return differenceInDays(new Date(), new Date(w.last_activity)) >= 7;
    });
    else if (filterFlag === "needs_followup") rows = rows.filter(w => getFollowUpFlags(w).length > 0);
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
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return rows;
  }, [workspaces, filterPlan, filterFlag, sortBy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Platform Operations</h1>
            <p className="text-sm text-muted-foreground">Cross-workspace visibility — CoreFlow internal only</p>
          </div>
          <div className="ml-auto">
            <Link to="/platform/feedback">
              <Button variant="outline" size="sm">Feedback Inbox</Button>
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Total Workspaces</CardDescription>
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
                <p className="text-xs text-muted-foreground">Workspaces exceeding their seat cap</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Needs Follow-up</CardDescription>
                <CardTitle className="text-3xl">
                  {workspaces.filter(w => getFollowUpFlags(w).length > 0).length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Workspaces with commercial or activation flags</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterPlan} onValueChange={setFilterPlan}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="trial_active">Trial Active</SelectItem>
              <SelectItem value="trial_expired">Trial Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterFlag} onValueChange={setFilterFlag}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Flag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              <SelectItem value="needs_followup">Needs Follow-up</SelectItem>
              <SelectItem value="over_limit">Over Seat Limit</SelectItem>
              <SelectItem value="stalled">Stalled (7d+)</SelectItem>
              <SelectItem value="activated">Activated (3+ modules)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Last Activity</SelectItem>
              <SelectItem value="created">Created Date</SelectItem>
              <SelectItem value="seats">Seat Count</SelectItem>
              <SelectItem value="activation">Activation Score</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Workspace Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Workspaces ({filtered.length})</CardTitle>
            <CardDescription>Operational metadata only — no customer business data is shown.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Seats</TableHead>
                    <TableHead className="text-center">Modules</TableHead>
                    <TableHead>Last Activity</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Follow-up Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No workspaces match filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((ws) => {
                      const moduleCount = ws.event_names?.filter(e => MODULE_EVENTS.includes(e as any)).length ?? 0;
                      const flags = getFollowUpFlags(ws);

                      return (
                        <TableRow key={ws.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-foreground">{ws.name}</p>
                              <p className="text-xs text-muted-foreground">{ws.company_count} client{ws.company_count !== 1 ? "s" : ""}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <PlanBadge plan={ws.plan} trialEnd={ws.trial_ends_at} />
                            {ws.trial_ends_at && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {new Date(ws.trial_ends_at) > new Date()
                                  ? `${differenceInDays(new Date(ws.trial_ends_at), new Date())}d left`
                                  : `Expired ${format(new Date(ws.trial_ends_at), "dd MMM")}`
                                }
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={ws.seat_count > ws.seat_limit ? "text-destructive font-semibold" : ""}>
                              {ws.seat_count}/{ws.seat_limit}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-sm font-medium">{moduleCount}/12</span>
                              {moduleCount >= 8 ? <Rocket className="h-3.5 w-3.5 text-primary" /> :
                               moduleCount >= 3 ? <TrendingUp className="h-3.5 w-3.5 text-green-600" /> :
                               <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
                            </div>
                          </TableCell>
                          <TableCell>
                            {ws.last_activity ? (
                              <span className="text-sm text-muted-foreground">
                                {formatDistanceToNow(new Date(ws.last_activity), { addSuffix: true })}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground/50">None</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(ws.created_at), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            {flags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {flags.map((f) => (
                                  <Badge key={f} variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                                    {f}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
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
              Module Adoption Across Workspaces
            </CardTitle>
            <CardDescription>
              First-use adoption per module — not usage volume. Based on product events.
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

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground text-center py-4">
          This dashboard shows operational metadata only. No customer business data (invoices, contacts, financials) is exposed.
          Revenue figures are not shown because billing is not yet automated.
        </p>
      </div>
    </div>
  );
}
