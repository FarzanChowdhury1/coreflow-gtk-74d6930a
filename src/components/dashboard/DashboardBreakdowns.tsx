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
import { subDays, subMonths, startOfDay } from "date-fns";
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
} from "lucide-react";

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

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  return { start, end };
}

export function DashboardBreakdowns({ workspaceId, currency }: Props) {
  const [range, setRange] = useState<TimeRange>("30d");
  const rangeStart = useMemo(() => getRangeStart(range), [range]);
  const { currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  // ── Pipeline data ──
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
      let q = supabase.from("invoices").select("status, grand_total, amount_paid, due_date").eq("workspace_id", workspaceId).is("deleted_at", null);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      const { data } = await q;
      return data || [];
    },
  });

  // ── Revenue data (admin) ──
  const { data: renewalsCount = 0 } = useQuery({
    queryKey: ["dash-renewals-count", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { count } = await supabase
        .from("renewals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);
      return count || 0;
    },
  });

  const { start: monthStart, end: monthEnd } = useMemo(getMonthRange, []);

  const { data: collectedThisMonth = 0 } = useQuery({
    queryKey: ["dash-collected-month", workspaceId, monthStart],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("amount")
        .eq("workspace_id", workspaceId)
        .gte("paid_at", monthStart + "T00:00:00")
        .lte("paid_at", monthEnd + "T23:59:59");
      return (data || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    },
  });

  // ── Spend data (admin) ──
  const { data: expenseThisMonth = 0 } = useQuery({
    queryKey: ["dashboard-expense-total", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("amount")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .gte("expense_date", monthStart)
        .lte("expense_date", monthEnd);
      return (data || []).reduce((s: number, e: any) => s + Number(e.amount), 0);
    },
  });

  const { data: subBurn = 0 } = useQuery({
    queryKey: ["dashboard-sub-burn", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("amount, interval_months")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);
      return (data || []).reduce((s: number, sub: any) => s + Number(sub.amount) / sub.interval_months, 0);
    },
  });

  const { data: activeSubsCount = 0 } = useQuery({
    queryKey: ["dash-active-subs", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { count } = await supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);
      return count || 0;
    },
  });

  const { data: vendorsCount = 0 } = useQuery({
    queryKey: ["dash-vendors-count", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { count } = await supabase
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      return count || 0;
    },
  });

  const { data: budgetSummary } = useQuery({
    queryKey: ["dash-budget-summary", workspaceId, monthStart],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("budgets")
        .select("target_amount")
        .eq("workspace_id", workspaceId)
        .lte("period_start", monthEnd)
        .gte("period_end", monthStart);
      const totalBudget = (data || []).reduce((s: number, b: any) => s + Number(b.target_amount), 0);
      return { totalBudget };
    },
  });

  // ── Computed pipeline metrics ──
  const leadCounts = useMemo(() => {
    const map: Record<string, number> = {};
    leads.forEach((l: any) => { map[l.status] = (map[l.status] || 0) + 1; });
    return map;
  }, [leads]);

  const proposalCounts = useMemo(() => {
    const map: Record<string, number> = {};
    proposalVersions.forEach((p: any) => { map[p.status] = (map[p.status] || 0) + 1; });
    return map;
  }, [proposalVersions]);

  const projectCounts = useMemo(() => {
    const map: Record<string, number> = {};
    projects.forEach((p: any) => { map[p.status] = (map[p.status] || 0) + 1; });
    return map;
  }, [projects]);

  const invoiceCounts = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.forEach((i: any) => { map[i.status] = (map[i.status] || 0) + 1; });
    return map;
  }, [invoices]);

  const overdueInvoices = useMemo(() => {
    const today = startOfDay(new Date());
    return invoices.filter((i: any) => i.due_date && new Date(i.due_date) < today && i.status !== "paid" && i.status !== "void");
  }, [invoices]);

  const totalInvoiced = invoices.reduce((s: number, i: any) => s + Number(i.grand_total), 0);
  const totalCollected = invoices.reduce((s: number, i: any) => s + Number(i.amount_paid), 0);
  const totalReceivable = invoices.reduce((s: number, i: any) => {
    if (i.status === "void" || i.status === "paid") return s;
    return s + (Number(i.grand_total) - Number(i.amount_paid));
  }, 0);

  const loading = ll || pl || prl || il;
  const netThisMonth = collectedThisMonth - expenseThisMonth;

  return (
    <div className="mt-6 space-y-6">
      {/* Time range selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Pipeline Breakdown</h2>
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

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          {/* Pipeline status bars */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Leads by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar
                  total={leads.length}
                  items={[
                    { label: "New", count: leadCounts.new || 0, color: "bg-muted-foreground/40" },
                    { label: "Contacted", count: leadCounts.contacted || 0, color: "bg-primary/60" },
                    { label: "Qualified", count: leadCounts.qualified || 0, color: "bg-emerald-500" },
                    { label: "Unqualified", count: leadCounts.unqualified || 0, color: "bg-destructive/60" },
                    { label: "Converted", count: leadCounts.converted || 0, color: "bg-accent" },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Proposals by Status (latest version)</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar
                  total={proposalVersions.length}
                  items={[
                    { label: "Draft", count: proposalCounts.draft || 0, color: "bg-muted-foreground/40" },
                    { label: "Sent", count: proposalCounts.sent || 0, color: "bg-primary/60" },
                    { label: "Approved", count: proposalCounts.approved || 0, color: "bg-emerald-500" },
                    { label: "Rejected", count: proposalCounts.rejected || 0, color: "bg-destructive/60" },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Projects by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar
                  total={projects.length}
                  items={[
                    { label: "Active", count: projectCounts.active || 0, color: "bg-emerald-500" },
                    { label: "On Hold", count: projectCounts.on_hold || 0, color: "bg-amber-500" },
                    { label: "Completed", count: projectCounts.completed || 0, color: "bg-primary/60" },
                    { label: "Cancelled", count: projectCounts.cancelled || 0, color: "bg-muted-foreground/40" },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Invoices by Status</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <StatusBar
                  total={invoices.length}
                  items={[
                    { label: "Draft", count: invoiceCounts.draft || 0, color: "bg-muted-foreground/40" },
                    { label: "Issued", count: invoiceCounts.issued || 0, color: "bg-primary/60" },
                    { label: "Partially Paid", count: invoiceCounts.partially_paid || 0, color: "bg-amber-500" },
                    { label: "Paid", count: invoiceCounts.paid || 0, color: "bg-emerald-500" },
                    { label: "Void", count: invoiceCounts.void || 0, color: "bg-destructive/60" },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          {/* ════════════════════════ REVENUE ════════════════════════ */}
          {isAdmin && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Revenue
              </h3>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} icon={Receipt} iconColor="text-primary" sub={TIME_LABELS[range]} />
                <KpiCard label="Total Collected" value={fmt(totalCollected)} icon={CreditCard} iconColor="text-emerald-500" sub={TIME_LABELS[range]} />
                <KpiCard label="Outstanding Receivable" value={fmt(totalReceivable)} icon={TrendingUp} iconColor="text-amber-500" />
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground">Overdue Invoices</p>
                      {overdueInvoices.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Action needed</Badge>}
                    </div>
                    <p className="text-lg font-semibold text-foreground tabular-nums">{overdueInvoices.length}</p>
                  </CardContent>
                </Card>
                <KpiCard label="Active Renewals" value={renewalsCount} icon={RefreshCw} iconColor="text-primary" />
              </div>
            </div>
          )}

          {/* ════════════════════════ SPEND ════════════════════════ */}
          {isAdmin && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-rose-500" />
                Spend
              </h3>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KpiCard label="Expenses This Month" value={fmt(expenseThisMonth)} icon={Wallet} iconColor="text-rose-500" />
                <KpiCard label="Monthly Subscription Burn" value={fmt(Math.round(subBurn))} icon={RefreshCw} iconColor="text-amber-500" />
                <KpiCard label="Active Subscriptions" value={activeSubsCount} icon={CreditCard} iconColor="text-primary" />
                <KpiCard label="Vendors" value={vendorsCount} icon={Store} iconColor="text-muted-foreground" />
                {budgetSummary && budgetSummary.totalBudget > 0 ? (
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground">Budget vs Actual</p>
                        <PieChart className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-lg font-semibold text-foreground tabular-nums">{fmt(expenseThisMonth)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">of {fmt(budgetSummary.totalBudget)} budgeted</p>
                    </CardContent>
                  </Card>
                ) : (
                  <KpiCard label="Budget vs Actual" value="—" icon={PieChart} iconColor="text-muted-foreground" sub="No budget set" />
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════ NET THIS MONTH ════════════════════════ */}
          {isAdmin && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-primary" />
                Net This Month
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                <KpiCard label="Revenue Collected" value={fmt(collectedThisMonth)} icon={TrendingUp} iconColor="text-emerald-500" sub="This month" />
                <KpiCard label="Total Spend" value={fmt(expenseThisMonth)} icon={TrendingDown} iconColor="text-rose-500" sub="This month" />
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground">Net Position</p>
                      <ArrowUpDown className={`h-4 w-4 ${netThisMonth >= 0 ? "text-emerald-500" : "text-rose-500"}`} />
                    </div>
                    <p className={`text-lg font-semibold tabular-nums ${netThisMonth >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {fmt(netThisMonth)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">This month</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
