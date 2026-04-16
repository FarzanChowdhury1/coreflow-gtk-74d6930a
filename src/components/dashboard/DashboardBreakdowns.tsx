import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { subDays, subMonths, startOfDay, endOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
  DollarSign,
} from "lucide-react";

/* ── Time range helpers ── */

type TimeRange = "7d" | "30d" | "90d" | "12m" | "all" | "custom";
const TIME_LABELS: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  all: "All time",
  custom: "Custom range",
};

function getRangeStart(range: TimeRange): string | null {
  const now = new Date();
  switch (range) {
    case "7d": return startOfDay(subDays(now, 7)).toISOString();
    case "30d": return startOfDay(subDays(now, 30)).toISOString();
    case "90d": return startOfDay(subDays(now, 90)).toISOString();
    case "12m": return startOfDay(subMonths(now, 12)).toISOString();
    case "all": return null;
    case "custom": return null; // handled separately
  }
}

/**
 * Returns month boundaries for financial snapshot queries.
 *
 * - `tsStart` / `tsEnd`: UTC ISO-8601 strings via `.toISOString()`.
 *   These represent the UTC instant corresponding to the local month
 *   start/end and are used for **timestamp** columns (e.g. `payments.paid_at`).
 *
 * - `dateStart` / `dateEnd`: Local `yyyy-MM-dd` strings via `date-fns/format`
 *   (no UTC shift). Used for **date-only** columns
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
    <Card className="overflow-hidden">
      <CardContent className="pt-4 pb-4 px-4 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
        </div>
        <p className="text-lg font-semibold text-foreground tabular-nums truncate" title={String(value)}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
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
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);

  const effectiveStart = useMemo(() => {
    if (range === "custom") {
      return customFrom ? startOfDay(customFrom).toISOString() : null;
    }
    return getRangeStart(range);
  }, [range, customFrom]);

  const effectiveEnd = useMemo(() => {
    if (range === "custom" && customTo) {
      return endOfDay(customTo).toISOString();
    }
    return null;
  }, [range, customTo]);

  const rangeLabel = useMemo(() => {
    if (range === "custom" && customFrom && customTo) {
      return `${format(customFrom, "dd MMM yyyy")} – ${format(customTo, "dd MMM yyyy")}`;
    }
    return TIME_LABELS[range];
  }, [range, customFrom, customTo]);
  const { currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  // Recalculates on every render — lightweight and never stale across month boundaries
  const month = getLocalMonthBounds();

  const fmtCur = (n: number, cur: string = currency) =>
    new Intl.NumberFormat("en-BD", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  const fmt = (n: number) => fmtCur(n, currency);

  /* ══════════════ PIPELINE QUERIES (range-based) ══════════════ */

  const { data: leads = [], isLoading: ll } = useQuery({
    queryKey: ["dash-leads", workspaceId, effectiveStart, effectiveEnd],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from("leads").select("status").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (effectiveStart) q = q.gte("created_at", effectiveStart);
      if (effectiveEnd) q = q.lte("created_at", effectiveEnd);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: proposalVersions = [], isLoading: pl } = useQuery({
    queryKey: ["dash-proposals", workspaceId, effectiveStart, effectiveEnd],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from("proposal_versions").select("status, proposal_id, version_number").eq("workspace_id", workspaceId);
      if (effectiveStart) q = q.gte("created_at", effectiveStart);
      if (effectiveEnd) q = q.lte("created_at", effectiveEnd);
      q = q.order("version_number", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
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
    queryKey: ["dash-projects", workspaceId, effectiveStart, effectiveEnd],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from("projects").select("status").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (effectiveStart) q = q.gte("created_at", effectiveStart);
      if (effectiveEnd) q = q.lte("created_at", effectiveEnd);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: invoices = [], isLoading: il } = useQuery({
    queryKey: ["dash-invoices", workspaceId, effectiveStart, effectiveEnd],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from("invoices").select("status, grand_total, amount_paid, currency").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (effectiveStart) q = q.gte("created_at", effectiveStart);
      if (effectiveEnd) q = q.lte("created_at", effectiveEnd);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  /* ══════════════ FINANCIAL QUERIES (current month — admin only) ══════════════ */

  /* Single RPC replaces 10 sequential sub-queries (revenue + spend) */
  const { data: financials, isLoading: financialsLoading, isError: financialsError } = useQuery({
    queryKey: ["dash-financials", workspaceId, month.key],
    enabled: !!workspaceId && isAdmin,
    staleTime: 120_000,
    refetchOnMount: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dashboard_financials", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      const d = data as unknown as Record<string, number>;
      return {
        collectedThisMonth: d.collected_this_month ?? 0,
        invoicedThisMonth: d.invoiced_this_month ?? 0,
        outstandingReceivable: d.outstanding_receivable ?? 0,
        overdueCount: d.overdue_count ?? 0,
        renewalsCount: d.renewals_count ?? 0,
        expenseThisMonth: d.expense_this_month ?? 0,
        subBurn: d.sub_burn ?? 0,
        activeSubsCount: d.active_subs_count ?? 0,
        vendorsCount: d.vendors_count ?? 0,
        totalBudget: d.total_budget ?? 0,
      };
    },
  });

  // Aliases for template compatibility
  const revenueData = financials;
  const revenueLoading = financialsLoading;
  const revenueError = financialsError;
  const spendData = financials;
  const spendLoading = financialsLoading;
  const spendError = financialsError;

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Pipeline</h2>
        <div className="flex items-center gap-2 flex-wrap">
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

          {range === "custom" && (
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-8 text-xs gap-1.5 w-[130px] justify-start", !customFrom && "text-muted-foreground")}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {customFrom ? format(customFrom, "dd MMM yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customFrom}
                    onSelect={setCustomFrom}
                    disabled={(d) => (customTo ? d > customTo : false) || d > new Date()}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">–</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-8 text-xs gap-1.5 w-[130px] justify-start", !customTo && "text-muted-foreground")}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {customTo ? format(customTo, "dd MMM yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customTo}
                    onSelect={setCustomTo}
                    disabled={(d) => (customFrom ? d < customFrom : false) || d > new Date()}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
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
            <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} icon={Receipt} iconColor="text-primary" sub={rangeLabel} />
            <KpiCard label="Total Collected" value={fmt(totalCollected)} icon={CreditCard} iconColor="text-success" sub={rangeLabel} />
            <KpiCard label="Outstanding Receivable" value={fmt(totalReceivable)} icon={TrendingUp} iconColor="text-warning" sub={rangeLabel} />
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
              <FinanceSkeletonRow count={5} />
            ) : revenueError ? (
              <FinanceErrorBanner message="Could not load revenue metrics. Try refreshing the page." />
            ) : (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KpiCard label="Total Invoiced" value={fmt(revenueData?.invoicedThisMonth ?? 0)} icon={DollarSign} iconColor="text-primary" sub="This month" />
                <KpiCard label="Total Collected" value={fmt(revenueData?.collectedThisMonth ?? 0)} icon={CreditCard} iconColor="text-success" sub="This month" />
                <KpiCard label="Outstanding Receivable" value={fmt(revenueData?.outstandingReceivable ?? 0)} icon={Receipt} iconColor="text-warning" sub="All open invoices" />
                <Card className="overflow-hidden">
                  <CardContent className="pt-4 pb-4 px-4 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs text-muted-foreground truncate">Overdue Invoices</p>
                      {(revenueData?.overdueCount ?? 0) > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0 whitespace-nowrap">Action needed</Badge>}
                    </div>
                    <p className="text-lg font-semibold text-foreground tabular-nums">{revenueData?.overdueCount ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">All time</p>
                  </CardContent>
                </Card>
                <KpiCard label="Active Renewals" value={revenueData?.renewalsCount ?? "—"} icon={RefreshCw} iconColor="text-primary" />
              </div>
            )}
          </div>

          {/* ── Cash Conversion ── */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Cash Conversion
            </h3>
            {revenueLoading ? (
              <FinanceSkeletonRow count={3} />
            ) : revenueError ? (
              <FinanceErrorBanner message="Could not load cash conversion metrics." />
            ) : (() => {
              const invoiced = revenueData?.invoicedThisMonth ?? 0;
              const collected = revenueData?.collectedThisMonth ?? 0;
              const outstanding = revenueData?.outstandingReceivable ?? 0;
              const monthRate = invoiced > 0 ? Math.round((collected / invoiced) * 100) : null;
              const allTimeRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : null;
              const receivableRatio = totalInvoiced > 0 ? Math.round((outstanding / totalInvoiced) * 100) : null;

              return (
                <div className="grid gap-3 md:grid-cols-3">
                  <Card className="overflow-hidden">
                    <CardContent className="pt-4 pb-4 px-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted-foreground truncate">Collection Rate</p>
                        <CreditCard className={`h-4 w-4 shrink-0 ${monthRate !== null && monthRate >= 70 ? "text-success" : "text-warning"}`} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums ${monthRate !== null && monthRate >= 70 ? "text-success" : monthRate !== null ? "text-warning" : "text-muted-foreground"}`}>
                        {monthRate !== null ? `${monthRate}%` : "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">This month (collected / invoiced)</p>
                    </CardContent>
                  </Card>
                  <Card className="overflow-hidden">
                    <CardContent className="pt-4 pb-4 px-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted-foreground truncate">Overall Collection Rate</p>
                        <TrendingUp className={`h-4 w-4 shrink-0 ${allTimeRate !== null && allTimeRate >= 70 ? "text-success" : "text-warning"}`} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums ${allTimeRate !== null && allTimeRate >= 70 ? "text-success" : allTimeRate !== null ? "text-warning" : "text-muted-foreground"}`}>
                        {allTimeRate !== null ? `${allTimeRate}%` : "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{rangeLabel}</p>
                    </CardContent>
                  </Card>
                  <Card className="overflow-hidden">
                    <CardContent className="pt-4 pb-4 px-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted-foreground truncate">Receivable Ratio</p>
                        <Receipt className={`h-4 w-4 shrink-0 ${receivableRatio !== null && receivableRatio <= 30 ? "text-success" : "text-warning"}`} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums ${receivableRatio !== null && receivableRatio <= 30 ? "text-success" : receivableRatio !== null ? "text-warning" : "text-muted-foreground"}`}>
                        {receivableRatio !== null ? `${receivableRatio}%` : "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Outstanding / total invoiced</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
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
                  <Card className="overflow-hidden">
                    <CardContent className="pt-4 pb-4 px-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted-foreground truncate">Budget vs Actual</p>
                        <PieChart className="h-4 w-4 shrink-0 text-primary" />
                      </div>
                      <p className="text-lg font-semibold text-foreground tabular-nums truncate" title={fmt(spendData?.expenseThisMonth ?? 0)}>{fmt(spendData?.expenseThisMonth ?? 0)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">of {fmt(spendData!.totalBudget)} budgeted</p>
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
                  <Card className="overflow-hidden">
                    <CardContent className="pt-4 pb-4 px-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted-foreground truncate">Net Position</p>
                        <ArrowUpDown className={`h-4 w-4 shrink-0 ${net >= 0 ? "text-success" : "text-destructive"}`} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums truncate ${net >= 0 ? "text-success" : "text-destructive"}`} title={fmt(net)}>
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
