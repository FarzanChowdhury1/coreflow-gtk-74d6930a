import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subDays, subMonths, startOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Receipt,
  CreditCard,
  RefreshCw,
  Store,
  Wallet,
  PieChart,
  AlertCircle,
} from "lucide-react";

/* ── Time range helpers ── */

type TimeRange = "7d" | "30d" | "90d" | "12m" | "all";
const TIME_LABELS: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  all: "All time",
};

function getRangeStart(range: TimeRange): string | null {
  const now = new Date();
  switch (range) {
    case "7d": return startOfDay(subDays(now, 7)).toISOString();
    case "30d": return startOfDay(subDays(now, 30)).toISOString();
    case "90d": return startOfDay(subDays(now, 90)).toISOString();
    case "12m": return startOfDay(subMonths(now, 12)).toISOString();
    case "all": return null;
  }
}

/**
 * Returns month boundaries for financial snapshot queries.
 *
 * - `tsStart` / `tsEnd`: UTC ISO-8601 strings produced by `.toISOString()`.
 *   They represent the UTC instant corresponding to the local month start/end.
 *   Used for filtering **timestamp** columns (e.g. `payments.paid_at`).
 *
 * - `dateStart` / `dateEnd`: Local `yyyy-MM-dd` strings via `date-fns/format`
 *   (no UTC shift). Used for filtering **date-only** columns
 *   (e.g. `expenses.expense_date`, `budgets.period_start`).
 *
 * - `key`: Year-month cache key so react-query invalidates on month rollover.
 */
function getLocalMonthBounds() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  return {
    tsStart: monthStart.toISOString(),
    tsEnd: monthEnd.toISOString(),
    dateStart: format(monthStart, "yyyy-MM-dd"),
    dateEnd: format(monthEnd, "yyyy-MM-dd"),
    key: format(now, "yyyy-MM"),
  };
}

/* ── Shared sub-components ── */

interface Props {
  workspaceId: string;
  currency: string;
}

function StatusBar({ items, total }: { items: { label: string; count: number; color: string }[]; total: number }) {
  if (total === 0) return <p className="text-xs text-muted-foreground">No records</p>;
  return (
    <div className="space-y-1.5">
      {items.filter(i => i.count > 0).map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2">
            <div className={`h-2 rounded-full ${item.color}`} style={{ width: `${Math.max(6, (item.count / total) * 100)}%` }} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">{item.label}</span>
          </div>
          <span className="text-xs font-medium tabular-nums text-foreground">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, iconColor, sub }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function FinanceSkeletonRow({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-4 pb-4 px-4">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-2.5 w-16 mt-1.5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FinanceErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/* ── Main component ── */

export function DashboardBreakdowns({ workspaceId, currency }: Props) {
  const [range, setRange] = useState<TimeRange>("30d");
  const rangeStart = useMemo(() => getRangeStart(range), [range]);
  const { currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  // Recalculates on every render — lightweight and never stale across month boundaries
  const month = getLocalMonthBounds();

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  /* ══════════════ PIPELINE QUERIES (range-based) ══════════════ */

  const { data: leads = [], isLoading: ll } = useQuery({
    queryKey: ["dash-leads", workspaceId, rangeStart],
    enabled: !!workspaceId,
    staleTime: 30000,
    queryFn: async () => {
      let q = supabase.from("leads").select("status").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: proposalVersions = [], isLoading: pl } = useQuery({
    queryKey: ["dash-proposals", workspaceId, rangeStart],
    enabled: !!workspaceId,
    staleTime: 30000,
    queryFn: async () => {
      let q = supabase.from("proposal_versions").select("status, proposal_id, version_number").eq("workspace_id", workspaceId);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      q = q.order("version_number", { ascending: false });
      const { data } = await q;
      if (!data) return [];
      const seen = new Set<string>();
      return data.filter((v: any) => {
        if (seen.has(v.proposal_id)) return false;
        seen.add(v.proposal_id);
        return true;
      });
    },
  });

  const { data: projects = [], isLoading: prl } = useQuery({
    queryKey: ["dash-projects", workspaceId, rangeStart],
    enabled: !!workspaceId,
    staleTime: 30000,
    queryFn: async () => {
      let q = supabase.from("projects").select("status").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: invoices = [], isLoading: il } = useQuery({
    queryKey: ["dash-invoices", workspaceId, rangeStart],
    enabled: !!workspaceId,
    staleTime: 30000,
    queryFn: async () => {
      let q = supabase.from("invoices").select("status, grand_total, amount_paid").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      const { data } = await q;
      return data || [];
    },
  });

  /* ══════════════ FINANCIAL QUERIES (current month — admin only) ══════════════ */

  const { data: revenueData, isLoading: revenueLoading, isError: revenueError } = useQuery({
    queryKey: ["dash-revenue-month", workspaceId, month.key],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data: payments } = await supabase
        .from("payments")
        .select("amount")
        .eq("workspace_id", workspaceId)
        .gte("paid_at", month.tsStart)
        .lte("paid_at", month.tsEnd);
      const collectedThisMonth = (payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);

      const { count: renewalsCount } = await supabase
        .from("renewals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);

      // Overdue invoices — independent of pipeline range
      const today = format(new Date(), "yyyy-MM-dd");
      const { data: overdueRows } = await supabase
        .from("invoices")
        .select("id")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .lt("due_date", today)
        .not("status", "in", '("paid","void")');

      return {
        collectedThisMonth,
        renewalsCount: renewalsCount || 0,
        overdueCount: overdueRows?.length ?? 0,
      };
    },
  });

  const { data: spendData, isLoading: spendLoading, isError: spendError } = useQuery({
    queryKey: ["dash-spend-month", workspaceId, month.key],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data: expenses } = await supabase
        .from("expenses")
        .select("amount")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .gte("expense_date", month.dateStart)
        .lte("expense_date", month.dateEnd);
      const expenseThisMonth = (expenses || []).reduce((s: number, e: any) => s + Number(e.amount), 0);

      const { data: subs } = await supabase
        .from("subscriptions")
        .select("amount, interval_months")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);
      const subBurn = (subs || []).reduce((s: number, sub: any) => s + Number(sub.amount) / sub.interval_months, 0);

      const { count: activeSubsCount } = await supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);

      const { count: vendorsCount } = await supabase
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);

      /*
       * Budget snapshot — only counts budget rows whose `period_start` falls
       * within the current calendar month. Quarterly or yearly budgets are
       * intentionally excluded unless represented as monthly entries. This
       * prevents double-counting across overlapping budget periods.
       */
      const { data: budgets } = await supabase
        .from("budgets")
        .select("target_amount")
        .eq("workspace_id", workspaceId)
        .gte("period_start", month.dateStart)
        .lte("period_start", month.dateEnd);
      const totalBudget = (budgets || []).reduce((s: number, b: any) => s + Number(b.target_amount), 0);

      return {
        expenseThisMonth,
        subBurn: Math.round(subBurn),
        activeSubsCount: activeSubsCount || 0,
        vendorsCount: vendorsCount || 0,
        totalBudget,
      };
    },
  });

  /* ══════════════ COMPUTED PIPELINE METRICS ══════════════ */

  const countByStatus = (arr: any[]) => {
    const map: Record<string, number> = {};
    arr.forEach((r: any) => { map[r.status] = (map[r.status] || 0) + 1; });
    return map;
  };

  const leadCounts = useMemo(() => countByStatus(leads), [leads]);
  const proposalCounts = useMemo(() => countByStatus(proposalVersions), [proposalVersions]);
  const projectCounts = useMemo(() => countByStatus(projects), [projects]);
  const invoiceCounts = useMemo(() => countByStatus(invoices), [invoices]);

  const totalInvoiced = invoices.reduce((s: number, i: any) => s + Number(i.grand_total), 0);
  const totalCollected = invoices.reduce((s: number, i: any) => s + Number(i.amount_paid), 0);
  const totalReceivable = invoices.reduce((s: number, i: any) => {
    if (i.status === "void" || i.status === "paid") return s;
    return s + (Number(i.grand_total) - Number(i.amount_paid));
  }, 0);

  const pipelineLoading = ll || pl || prl || il;

  return (
    <div className="mt-6 space-y-6">
      {/* ════════════════════════ PIPELINE ════════════════════════ */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Pipeline</h2>
        <Select value={range} onValueChange={(v) => setRange(v as TimeRange)}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIME_LABELS) as TimeRange[]).map((k) => (
              <SelectItem key={k} value={k}>{TIME_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pipelineLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Leads by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar total={leads.length} items={[
                  { label: "New", count: leadCounts.new || 0, color: "bg-muted-foreground/40" },
                  { label: "Contacted", count: leadCounts.contacted || 0, color: "bg-primary/60" },
                  { label: "Qualified", count: leadCounts.qualified || 0, color: "bg-success" },
                  { label: "Unqualified", count: leadCounts.unqualified || 0, color: "bg-destructive/60" },
                  { label: "Converted", count: leadCounts.converted || 0, color: "bg-accent" },
                ]} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Proposals by Status (latest version)</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar total={proposalVersions.length} items={[
                  { label: "Draft", count: proposalCounts.draft || 0, color: "bg-muted-foreground/40" },
                  { label: "Sent", count: proposalCounts.sent || 0, color: "bg-primary/60" },
                  { label: "Approved", count: proposalCounts.approved || 0, color: "bg-success" },
                  { label: "Rejected", count: proposalCounts.rejected || 0, color: "bg-destructive/60" },
                ]} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Projects by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar total={projects.length} items={[
                  { label: "Active", count: projectCounts.active || 0, color: "bg-success" },
                  { label: "On Hold", count: projectCounts.on_hold || 0, color: "bg-warning" },
                  { label: "Completed", count: projectCounts.completed || 0, color: "bg-primary/60" },
                  { label: "Cancelled", count: projectCounts.cancelled || 0, color: "bg-muted-foreground/40" },
                ]} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Invoices by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar total={invoices.length} items={[
                  { label: "Draft", count: invoiceCounts.draft || 0, color: "bg-muted-foreground/40" },
                  { label: "Issued", count: invoiceCounts.issued || 0, color: "bg-primary/60" },
                  { label: "Partially Paid", count: invoiceCounts.partially_paid || 0, color: "bg-warning" },
                  { label: "Paid", count: invoiceCounts.paid || 0, color: "bg-success" },
                  { label: "Void", count: invoiceCounts.void || 0, color: "bg-destructive/60" },
                ]} />
              </CardContent>
            </Card>
          </div>

          {/* Range-based invoice summary — clearly labelled with selected range */}
          <div className="grid gap-3 md:grid-cols-3">
            <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} icon={Receipt} iconColor="text-primary" sub={TIME_LABELS[range]} />
            <KpiCard label="Total Collected" value={fmt(totalCollected)} icon={CreditCard} iconColor="text-success" sub={TIME_LABELS[range]} />
            <KpiCard label="Outstanding Receivable" value={fmt(totalReceivable)} icon={TrendingUp} iconColor="text-warning" sub={TIME_LABELS[range]} />
          </div>
        </>
      )}

      {/* ════════════════════════ CURRENT MONTH FINANCIAL SNAPSHOT (admin) ════════════════════════ */}
      {isAdmin && (
        <>
          <div className="border-t border-border pt-5">
            <h2 className="text-sm font-medium text-foreground mb-1">Current Month Financial Snapshot</h2>
            <p className="text-[11px] text-muted-foreground mb-4">Revenue, spend, and net position for the current calendar month.</p>
          </div>

          {/* ── Revenue ── */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              Revenue
            </h3>
            {revenueLoading ? (
              <FinanceSkeletonRow count={3} />
            ) : revenueError ? (
              <FinanceErrorBanner message="Could not load revenue metrics. Try refreshing the page." />
            ) : (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                <KpiCard label="Revenue Collected" value={fmt(revenueData?.collectedThisMonth ?? 0)} icon={CreditCard} iconColor="text-success" sub="This month" />
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground">Overdue Invoices</p>
                      {(revenueData?.overdueCount ?? 0) > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Action needed</Badge>}
                    </div>
                    <p className="text-lg font-semibold text-foreground tabular-nums">{revenueData?.overdueCount ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">All time</p>
                  </CardContent>
                </Card>
                <KpiCard label="Active Renewals" value={revenueData?.renewalsCount ?? "—"} icon={RefreshCw} iconColor="text-primary" />
              </div>
            )}
          </div>

          {/* ── Spend ── */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Spend
            </h3>
            {spendLoading ? (
              <FinanceSkeletonRow />
            ) : spendError ? (
              <FinanceErrorBanner message="Could not load spend metrics. Try refreshing the page." />
            ) : (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KpiCard label="Expenses This Month" value={fmt(spendData?.expenseThisMonth ?? 0)} icon={Wallet} iconColor="text-destructive" sub="This month" />
                <KpiCard label="Monthly Subscription Burn" value={fmt(spendData?.subBurn ?? 0)} icon={RefreshCw} iconColor="text-warning" />
                <KpiCard label="Active Subscriptions" value={spendData?.activeSubsCount ?? "—"} icon={CreditCard} iconColor="text-primary" />
                <KpiCard label="Vendors" value={spendData?.vendorsCount ?? "—"} icon={Store} iconColor="text-muted-foreground" />
                {(spendData?.totalBudget ?? 0) > 0 ? (
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground">Budget vs Actual</p>
                        <PieChart className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-lg font-semibold text-foreground tabular-nums">{fmt(spendData?.expenseThisMonth ?? 0)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">of {fmt(spendData!.totalBudget)} budgeted</p>
                    </CardContent>
                  </Card>
                ) : (
                  <KpiCard label="Budget vs Actual" value="—" icon={PieChart} iconColor="text-muted-foreground" sub="No monthly budget set" />
                )}
              </div>
            )}
          </div>

          {/* ── Net This Month ── */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-primary" />
              Net This Month
            </h3>
            {(revenueLoading || spendLoading) ? (
              <FinanceSkeletonRow count={3} />
            ) : (revenueError || spendError) ? (
              <FinanceErrorBanner message="Could not load net position. Revenue or spend data is unavailable." />
            ) : (() => {
              const collected = revenueData?.collectedThisMonth ?? 0;
              const spent = spendData?.expenseThisMonth ?? 0;
              const net = collected - spent;
              return (
                <div className="grid gap-3 md:grid-cols-3">
                  <KpiCard label="Revenue Collected" value={fmt(collected)} icon={TrendingUp} iconColor="text-success" sub="This month" />
                  <KpiCard label="Total Spend" value={fmt(spent)} icon={TrendingDown} iconColor="text-destructive" sub="This month" />
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground">Net Position</p>
                        <ArrowUpDown className={`h-4 w-4 ${net >= 0 ? "text-success" : "text-destructive"}`} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums ${net >= 0 ? "text-success" : "text-destructive"}`}>
                        {fmt(net)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">This month</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
