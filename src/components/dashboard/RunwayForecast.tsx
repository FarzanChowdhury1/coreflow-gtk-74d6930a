import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, AlertTriangle, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Driver {
  label: string;
  value: number;
  impact: "positive" | "warning" | "negative" | "neutral";
}
interface Scenario {
  monthly_burn: number;
  monthly_net: number;
  runway_months: number | null;
  assumptions: string;
}
interface RunwayData {
  data_quality: "insufficient_data" | "low" | "moderate" | "good";
  cash_proxy: number;
  cash_proxy_basis: string;
  cash_proxy_note: string;
  trailing: {
    in_30: number; in_90: number; in_180: number;
    out_30: number; out_90: number; out_180: number;
    net_30: number; net_90: number; net_180: number;
  };
  avg_monthly_inflow: number;
  avg_monthly_outflow: number;
  recurring_monthly_burden: number;
  adjusted_monthly_burn: number;
  runway_months: number | null;
  trend: "improving" | "stable" | "deteriorating";
  trend_pct: number | null;
  scenarios: { base: Scenario; best: Scenario; worst: Scenario };
  drivers: Driver[];
  flags: string[];
  summary: string;
  error?: string;
}

interface Props {
  workspaceId: string;
  currency: string;
  isAdmin: boolean;
}

const QUALITY_TONE: Record<string, string> = {
  good: "bg-success/15 text-success border-success/30",
  moderate: "bg-primary/15 text-primary border-primary/30",
  low: "bg-warning/15 text-warning border-warning/30",
  insufficient_data: "bg-muted text-muted-foreground border-border",
};

const TREND_META: Record<string, { label: string; tone: string; Icon: typeof TrendingUp }> = {
  improving: { label: "Improving", tone: "text-success", Icon: TrendingUp },
  stable: { label: "Stable", tone: "text-muted-foreground", Icon: Minus },
  deteriorating: { label: "Deteriorating", tone: "text-destructive", Icon: TrendingDown },
};

function fmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`;
  }
}

function runwayLabel(m: number | null): string {
  if (m === null || m === undefined) return "Cash-flow positive";
  if (m >= 24) return `${m.toFixed(1)}+ mo`;
  return `${m.toFixed(1)} mo`;
}

function runwayTone(m: number | null): string {
  if (m === null) return "text-success";
  if (m >= 6) return "text-success";
  if (m >= 3) return "text-warning";
  return "text-destructive";
}

export function RunwayForecast({ workspaceId, currency, isAdmin }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["runway-forecast", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_runway_forecast" as any, {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return data as unknown as RunwayData;
    },
  });

  if (!isAdmin) return null;
  if (isLoading) return <Skeleton className="h-72" />;

  if (isError || !data || data.error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Gauge className="h-4 w-4 text-primary" /> Runway & Cash Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Unable to load runway forecast right now.
          </div>
        </CardContent>
      </Card>
    );
  }

  const isEmpty = data.data_quality === "insufficient_data";
  const qTone = QUALITY_TONE[data.data_quality] || QUALITY_TONE.insufficient_data;
  const trend = TREND_META[data.trend] || TREND_META.stable;
  const TrendIcon = trend.Icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Gauge className="h-4 w-4 text-primary" />
          Runway & Cash Forecast
          <Badge variant="outline" className={`${qTone} text-xs font-medium`}>
            {data.data_quality === "insufficient_data" ? "Insufficient data" : `${data.data_quality} data`}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground font-normal">Admin only</span>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Operating runway proxy based on trailing 90-day net cash. Not a bank balance.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary */}
        <p className="text-sm text-foreground/90 leading-relaxed">{data.summary}</p>

        {isEmpty ? (
          <div className="rounded-md border bg-muted/30 px-3 py-6 text-center">
            <Info className="mx-auto h-5 w-5 text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Record payments, paid expenses, and active subscriptions to enable runway forecasting.
            </p>
          </div>
        ) : (
          <>
            {/* Headline metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Runway (base)</p>
                <p className={`text-xl font-semibold tabular-nums ${runwayTone(data.runway_months)}`}>
                  {runwayLabel(data.runway_months)}
                </p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cash proxy (90d net)</p>
                <p className="text-xl font-semibold tabular-nums">{fmt(data.cash_proxy, currency)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Adj. monthly burn</p>
                <p className="text-xl font-semibold tabular-nums">{fmt(data.adjusted_monthly_burn, currency)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trend</p>
                <p className={`text-xl font-semibold tabular-nums flex items-center gap-1.5 ${trend.tone}`}>
                  <TrendIcon className="h-4 w-4" />
                  {trend.label}
                </p>
              </div>
            </div>

            {/* Trailing windows (actuals) */}
            <div className="rounded-md border bg-card p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Actuals — trailing windows</p>
              <div className="grid grid-cols-3 gap-3 text-xs">
                {(["30", "90", "180"] as const).map((w) => {
                  const inV = data.trailing[`in_${w}` as const];
                  const outV = data.trailing[`out_${w}` as const];
                  const netV = data.trailing[`net_${w}` as const];
                  return (
                    <div key={w} className="space-y-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{w}d</p>
                      <div className="flex justify-between gap-2"><span className="text-muted-foreground">In</span><span className="tabular-nums text-success truncate">{fmt(inV, currency)}</span></div>
                      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Out</span><span className="tabular-nums text-destructive truncate">{fmt(outV, currency)}</span></div>
                      <div className="flex justify-between gap-2 pt-1 border-t"><span className="text-muted-foreground">Net</span><span className={`tabular-nums font-semibold truncate ${netV >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netV, currency)}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scenarios (forecast assumptions) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Forecast scenarios</p>
                <span className="text-[10px] text-muted-foreground italic">Forecast — not actuals</span>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(["best", "base", "worst"] as const).map((key) => {
                  const s = data.scenarios[key];
                  const tone =
                    key === "best" ? "border-success/30 bg-success/5" :
                    key === "worst" ? "border-destructive/30 bg-destructive/5" :
                    "border-primary/20 bg-primary/5";
                  return (
                    <div key={key} className={`rounded-md border p-3 min-w-0 ${tone}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold capitalize">{key} case</span>
                        <span className={`text-sm font-semibold tabular-nums ${runwayTone(s.runway_months)}`}>
                          {runwayLabel(s.runway_months)}
                        </span>
                      </div>
                      <div className="space-y-0.5 text-[11px]">
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Monthly burn</span><span className="tabular-nums truncate">{fmt(s.monthly_burn, currency)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Monthly net</span><span className={`tabular-nums truncate ${s.monthly_net >= 0 ? "text-success" : "text-destructive"}`}>{fmt(s.monthly_net, currency)}</span></div>
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground leading-snug break-words">{s.assumptions}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Drivers */}
            {data.drivers && data.drivers.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {data.drivers.map((d, i) => {
                  const tone =
                    d.impact === "positive" ? "text-success" :
                    d.impact === "negative" ? "text-destructive" :
                    d.impact === "warning" ? "text-warning" : "text-foreground";
                  return (
                    <div key={i} className="rounded-md border bg-muted/20 px-2.5 py-2 min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate" title={d.label}>{d.label}</p>
                      <p className={`text-sm font-semibold tabular-nums truncate ${tone}`}>{fmt(d.value, currency)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Risk flags */}
            {data.flags && data.flags.length > 0 && (
              <div className="space-y-1.5">
                {data.flags.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground/90">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                    <span className="break-words">{f}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground italic leading-relaxed">
              {data.cash_proxy_note}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
