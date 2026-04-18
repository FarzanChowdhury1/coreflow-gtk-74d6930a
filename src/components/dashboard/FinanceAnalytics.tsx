import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Activity, AlertTriangle, Info } from "lucide-react";
import { useMemo } from "react";

interface TrendPoint {
  month: string; // YYYY-MM
  invoiced: number;
  collected: number;
  expenses_paid: number;
}

interface HealthDriver {
  label: string;
  impact: "positive" | "warning" | "negative" | "neutral";
  value?: number;
}

interface FinanceAnalyticsData {
  trends: TrendPoint[];
  health: {
    band: "healthy" | "stable" | "watchlist" | "at_risk" | "insufficient_data";
    score: number;
    drivers: HealthDriver[];
    collection_rate: number | null;
    trend_pct: number | null;
    budget_status?: "none" | "within" | "at_limit" | "overspent";
    summary_text?: string;
  };
  cash_conversion: {
    dso_days: number | null;
    dpo_days: number | null;
    ccc_days: number | null;
    dpo_basis?: "due_date" | "expense_date_fallback" | "insufficient_data";
    can_compute_dso?: boolean;
    can_compute_dpo?: boolean;
    can_compute_ccc?: boolean;
    receivables: number;
    overdue_amount: number;
    overdue_count: number;
    payables: number;
    cash_in_30d: number;
    cash_out_30d: number;
    net_cash_30d: number;
    sufficient_data: boolean;
  };
}

interface Props {
  workspaceId: string;
  currency: string;
  isAdmin: boolean;
}

const BAND_META: Record<string, { label: string; tone: string }> = {
  healthy: { label: "Healthy", tone: "bg-success/15 text-success border-success/30" },
  stable: { label: "Stable", tone: "bg-primary/15 text-primary border-primary/30" },
  watchlist: { label: "Watchlist", tone: "bg-warning/15 text-warning border-warning/30" },
  at_risk: { label: "At Risk", tone: "bg-destructive/15 text-destructive border-destructive/30" },
  insufficient_data: { label: "Insufficient Data", tone: "bg-muted text-muted-foreground border-border" },
};

export function FinanceAnalytics({ workspaceId, currency, isAdmin }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["finance-analytics", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_finance_analytics" as any, {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return data as unknown as FinanceAnalyticsData;
    },
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  const trendStats = useMemo(() => {
    if (!data?.trends?.length) return null;
    const t = data.trends;
    const cur = t[t.length - 1];
    const prev = t[t.length - 2];
    if (!cur || !prev) return { cur, prev: null, momPct: null as number | null };
    const momPct = prev.invoiced > 0 ? ((cur.invoiced - prev.invoiced) / prev.invoiced) * 100 : null;
    return { cur, prev, momPct };
  }, [data]);

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Could not load finance analytics.
        </CardContent>
      </Card>
    );
  }

  const { trends, health, cash_conversion: cc } = data;
  const bandMeta = BAND_META[health.band] || BAND_META.insufficient_data;
  const hasTrendData = trends.some((t) => t.invoiced > 0 || t.collected > 0);

  // Chart geometry
  const chartH = 120;
  const max = Math.max(
    ...trends.map((t) => Math.max(t.invoiced, t.collected, t.expenses_paid)),
    1
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Finance Analytics
        </h2>
        <span className="text-[10px] text-muted-foreground">Admin only</span>
      </div>

      {/* ── Revenue Trends (12 months) ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Revenue Trends</CardTitle>
            {trendStats?.momPct !== null && trendStats?.momPct !== undefined && (
              <Badge
                variant="outline"
                className={
                  trendStats.momPct >= 0
                    ? "bg-success/10 text-success border-success/30 text-[10px]"
                    : "bg-destructive/10 text-destructive border-destructive/30 text-[10px]"
                }
              >
                {trendStats.momPct >= 0 ? "+" : ""}
                {trendStats.momPct.toFixed(1)}% MoM
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Last 12 months · invoiced vs collected vs expenses paid</p>
        </CardHeader>
        <CardContent>
          {!hasTrendData ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Info className="h-5 w-5 mx-auto mb-2 opacity-50" />
              No invoiced or collected revenue in the last 12 months yet.
            </div>
          ) : (
            <>
              <div className="flex items-end gap-1 h-[120px] mb-2" style={{ height: chartH }}>
                {trends.map((t, idx) => {
                  const invH = (t.invoiced / max) * chartH;
                  const colH = (t.collected / max) * chartH;
                  const expH = (t.expenses_paid / max) * chartH;
                  return (
                    <div key={t.month} className="flex-1 flex items-end justify-center gap-[2px]" title={`${t.month}\nInvoiced: ${fmt(t.invoiced)}\nCollected: ${fmt(t.collected)}\nExpenses: ${fmt(t.expenses_paid)}`}>
                      <div className="w-1.5 bg-primary/70 rounded-sm" style={{ height: `${invH}px` }} />
                      <div className="w-1.5 bg-success/80 rounded-sm" style={{ height: `${colH}px` }} />
                      <div className="w-1.5 bg-destructive/60 rounded-sm" style={{ height: `${expH}px` }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{trends[0]?.month}</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-primary/70 rounded-sm" />Invoiced</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-success/80 rounded-sm" />Collected</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-destructive/60 rounded-sm" />Expenses</span>
                </div>
                <span>{trends[trends.length - 1]?.month}</span>
              </div>
              {trendStats?.cur && (
                <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Invoiced (current)</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(trendStats.cur.invoiced)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Collected (current)</p>
                    <p className="text-sm font-semibold tabular-nums text-success">{fmt(trendStats.cur.collected)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Expenses (current)</p>
                    <p className="text-sm font-semibold tabular-nums text-destructive">{fmt(trendStats.cur.expenses_paid)}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Two-column: Health + Cash Conversion ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Financial Health */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Financial Health</CardTitle>
              <Badge variant="outline" className={`text-[10px] ${bandMeta.tone}`}>
                {bandMeta.label}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Rule-based assessment from your real workspace data
            </p>
          </CardHeader>
          <CardContent>
            {health.band === "insufficient_data" ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Info className="h-5 w-5 mx-auto mb-2 opacity-50" />
                Not enough financial activity yet to score health.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-3xl font-semibold tabular-nums">{health.score}</div>
                  <div className="text-xs text-muted-foreground">/ 100</div>
                </div>
                {health.summary_text && (
                  <p className="text-xs text-foreground/90 mb-4 leading-relaxed">
                    {health.summary_text}
                  </p>
                )}
                <div className="space-y-1.5">
                  {health.drivers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No notable drivers.</p>
                  ) : (
                    health.drivers.map((d, idx) => {
                      const tone =
                        d.impact === "positive" ? "text-success" :
                        d.impact === "negative" ? "text-destructive" :
                        d.impact === "warning" ? "text-warning" : "text-muted-foreground";
                      const Icon =
                        d.impact === "positive" ? TrendingUp :
                        d.impact === "negative" ? TrendingDown :
                        d.impact === "warning" ? AlertTriangle : Info;
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <Icon className={`h-3.5 w-3.5 ${tone}`} />
                          <span className="text-foreground">{d.label}</span>
                          {d.value !== undefined && d.value !== null && (
                            <span className="text-muted-foreground tabular-nums">({d.value}{d.label.toLowerCase().includes("rate") || d.label.toLowerCase().includes("trending") || d.label.toLowerCase().includes("budget") ? "%" : ""})</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Cash Conversion (true CCC) */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Cash Conversion</CardTitle>
              <span className="text-[10px] text-muted-foreground">DSO − DPO = CCC</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Real operating metrics from invoice + expense payment behavior
            </p>
          </CardHeader>
          <CardContent>
            {!cc.sufficient_data ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Info className="h-5 w-5 mx-auto mb-2 opacity-50" />
                Insufficient payment history to compute DSO/DPO.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-muted-foreground">DSO</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {cc.dso_days !== null ? `${Math.round(cc.dso_days)}d` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">DPO</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {cc.dpo_days !== null ? `${Math.round(cc.dpo_days)}d` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">CCC</p>
                  <p className={`text-lg font-semibold tabular-nums ${
                    cc.ccc_days === null ? "" :
                    cc.ccc_days <= 30 ? "text-success" :
                    cc.ccc_days <= 60 ? "text-warning" : "text-destructive"
                  }`}>
                    {cc.ccc_days !== null ? `${Math.round(cc.ccc_days)}d` : "—"}
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Receivables</span>
                <span className="font-medium tabular-nums">{fmt(cc.receivables)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payables</span>
                <span className="font-medium tabular-nums">{fmt(cc.payables)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash in (30d)</span>
                <span className="font-medium tabular-nums text-success">{fmt(cc.cash_in_30d)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash out (30d)</span>
                <span className="font-medium tabular-nums text-destructive">{fmt(cc.cash_out_30d)}</span>
              </div>
              <div className="flex justify-between col-span-2 pt-2 border-t">
                <span className="text-muted-foreground">Net cash flow (30d)</span>
                <span className={`font-semibold tabular-nums ${cc.net_cash_30d >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmt(cc.net_cash_30d)}
                </span>
              </div>
              {cc.overdue_count > 0 && (
                <div className="flex justify-between col-span-2 text-warning">
                  <span>Overdue exposure</span>
                  <span className="font-medium tabular-nums">
                    {fmt(cc.overdue_amount)} · {cc.overdue_count} invoice{cc.overdue_count === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
