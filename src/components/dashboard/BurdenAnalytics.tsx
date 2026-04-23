import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, AlertTriangle, Info, Boxes, Store } from "lucide-react";

interface TopSub {
  name: string;
  vendor_name: string;
  monthly_amount: number;
  currency: string;
  category: string | null;
}
interface TopVendor {
  vendor_name: string;
  category: string | null;
  spend_amount: number;
  expense_count: number;
}
interface Driver {
  label: string;
  value: number;
  impact: "positive" | "warning" | "negative" | "neutral";
}

// Normalized UI shape (decoupled from raw RPC keys to absorb future drift safely)
interface BurdenView {
  window_days: number;
  subscription: {
    monthly_burn: number;
    active_count: number;
    top: TopSub[];
    top1_share: number;
    top3_share: number;
    vs_inflow_pct: number | null;
  };
  vendor: {
    spend_total: number;
    vendor_count: number;
    top: TopVendor[];
    top1_share: number;
    top3_share: number;
  };
  cash_in_window: number;
  band: "low" | "moderate" | "heavy" | "insufficient_data";
  band_label: string;
  summary: string;
  drivers: Driver[];
  flags: string[];
}

interface Props {
  workspaceId: string;
  currency: string;
  isAdmin: boolean;
}

const BAND_TONE: Record<string, string> = {
  low: "bg-success/15 text-success border-success/30",
  moderate: "bg-warning/15 text-warning border-warning/30",
  heavy: "bg-destructive/15 text-destructive border-destructive/30",
  insufficient_data: "bg-muted text-muted-foreground border-border",
};

const IMPACT_TONE: Record<string, string> = {
  positive: "text-success",
  warning: "text-warning",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

function fmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return `${currency} ${Math.round(n || 0).toLocaleString()}`;
  }
}

function pct(n: number) {
  return `${((n || 0) * 100).toFixed(1)}%`;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Normalize raw RPC payload into UI view-model.
 * RPC currently returns a flat shape (recurring_monthly_burden, subscription_count, ...).
 * Old UI assumed nested {subscription:{...}, vendor:{...}, band, flags, drivers}.
 * This adapter is the single point of contract translation — keeps UI safe from future drift.
 */
function normalize(raw: any): BurdenView {
  const r = raw && typeof raw === "object" ? raw : {};

  // Quality → band mapping (RPC emits data_quality, UI uses band).
  const dq = r.band || r.data_quality;
  const band: BurdenView["band"] =
    dq === "low" || dq === "moderate" || dq === "heavy" || dq === "insufficient_data"
      ? dq
      : dq === "good"
      ? "low"
      : "insufficient_data";

  const bandLabel =
    r.band_label ||
    (band === "low"
      ? "Low burden"
      : band === "moderate"
      ? "Moderate burden"
      : band === "heavy"
      ? "Heavy burden"
      : "Insufficient data");

  const subTop = arr<any>(r.top_subscriptions ?? r.subscription?.top).map((s) => ({
    name: String(s?.name ?? s?.subscription_name ?? "—"),
    vendor_name: String(s?.vendor_name ?? "—"),
    monthly_amount: num(s?.monthly_amount ?? s?.amount),
    currency: String(s?.currency ?? ""),
    category: s?.category ?? null,
  }));

  const venTop = arr<any>(r.top_vendors ?? r.vendor?.top).map((v) => ({
    vendor_name: String(v?.vendor_name ?? "—"),
    category: v?.category ?? null,
    spend_amount: num(v?.spend_amount ?? v?.amount),
    expense_count: num(v?.expense_count ?? v?.count),
  }));

  return {
    window_days: num(r.window_days, 90),
    subscription: {
      monthly_burn: num(r.subscription?.monthly_burn ?? r.recurring_monthly_burden),
      active_count: num(r.subscription?.active_count ?? r.subscription_count),
      top: subTop,
      top1_share: num(
        r.subscription?.top1_share ?? (r.subscription_top1_share_pct != null ? r.subscription_top1_share_pct / 100 : 0),
      ),
      top3_share: num(
        r.subscription?.top3_share ?? (r.subscription_top3_share_pct != null ? r.subscription_top3_share_pct / 100 : 0),
      ),
      vs_inflow_pct:
        r.subscription?.vs_inflow_pct != null
          ? num(r.subscription.vs_inflow_pct)
          : r.burden_vs_inflow_pct != null
          ? num(r.burden_vs_inflow_pct) / 100
          : null,
    },
    vendor: {
      spend_total: num(r.vendor?.spend_total ?? r.vendor_spend_window),
      vendor_count: num(r.vendor?.vendor_count ?? venTop.length),
      top: venTop,
      top1_share: num(
        r.vendor?.top1_share ?? (r.vendor_concentration_pct != null ? r.vendor_concentration_pct / 100 : 0),
      ),
      top3_share: num(
        r.vendor?.top3_share ?? (r.vendor_top3_share_pct != null ? r.vendor_top3_share_pct / 100 : 0),
      ),
    },
    cash_in_window: num(r.cash_in_window ?? r.avg_monthly_inflow * 3),
    band,
    band_label: bandLabel,
    summary: String(r.summary ?? "No burden summary available."),
    drivers: arr<Driver>(r.drivers),
    flags: arr<string>(r.flags),
  };
}

export function BurdenAnalytics({ workspaceId, currency, isAdmin }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["burden-analytics", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_burden_analytics" as any, {
        _workspace_id: workspaceId,
        _window_days: 90,
      });
      if (error) throw error;
      if (data && typeof data === "object" && (data as any).error) {
        throw new Error(String((data as any).error));
      }
      return normalize(data);
    },
  });

  if (!isAdmin) return null;
  if (isLoading) return <Skeleton className="h-64" />;

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4 text-primary" /> Burden Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Unable to load burden analytics right now.
          </div>
        </CardContent>
      </Card>
    );
  }

  const tone = BAND_TONE[data.band] || BAND_TONE.insufficient_data;
  const isEmpty = data.band === "insufficient_data";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4 text-primary" />
          Burden Analytics
          <Badge variant="outline" className={`${tone} text-xs font-medium`}>{data.band_label}</Badge>
          <span className="text-xs text-muted-foreground font-normal">Last {data.window_days} days</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-foreground/90 leading-relaxed">{data.summary}</p>

        {isEmpty ? (
          <div className="rounded-md border bg-muted/30 px-3 py-6 text-center">
            <Info className="mx-auto h-5 w-5 text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Add active subscriptions or vendor-linked paid expenses to see fixed-cost burden, top items, and concentration risk.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border bg-card p-3 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Boxes className="h-4 w-4 text-primary/80" />
                  <h3 className="text-xs font-semibold text-foreground">Subscription burden</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Monthly burn</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(data.subscription.monthly_burn, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</p>
                    <p className="text-sm font-semibold tabular-nums">{data.subscription.active_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Top 1 share</p>
                    <p className="text-sm font-semibold tabular-nums">{pct(data.subscription.top1_share)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Top 3 share</p>
                    <p className="text-sm font-semibold tabular-nums">{pct(data.subscription.top3_share)}</p>
                  </div>
                </div>
                {data.subscription.top.length > 0 ? (
                  <ul className="space-y-1">
                    {data.subscription.top.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-xs min-w-0">
                        <span className="truncate text-foreground/80" title={`${s.name} · ${s.vendor_name}`}>
                          {s.name}
                          <span className="text-muted-foreground"> · {s.vendor_name}</span>
                        </span>
                        <span className="tabular-nums shrink-0 text-foreground">{fmt(s.monthly_amount, s.currency || currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No active subscriptions.</p>
                )}
                {data.subscription.vs_inflow_pct !== null && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Subscription burn vs monthly cash inflow: <span className="font-medium text-foreground/80">{pct(data.subscription.vs_inflow_pct)}</span>
                  </p>
                )}
              </div>

              <div className="rounded-md border bg-card p-3 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Store className="h-4 w-4 text-primary/80" />
                  <h3 className="text-xs font-semibold text-foreground">Vendor burden</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid spend</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(data.vendor.spend_total, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Vendors</p>
                    <p className="text-sm font-semibold tabular-nums">{data.vendor.vendor_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Top 1 share</p>
                    <p className="text-sm font-semibold tabular-nums">{pct(data.vendor.top1_share)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Top 3 share</p>
                    <p className="text-sm font-semibold tabular-nums">{pct(data.vendor.top3_share)}</p>
                  </div>
                </div>
                {data.vendor.top.length > 0 ? (
                  <ul className="space-y-1">
                    {data.vendor.top.map((v, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-xs min-w-0">
                        <span className="truncate text-foreground/80" title={v.vendor_name}>
                          {v.vendor_name}
                          <span className="text-muted-foreground"> · {v.expense_count} pmt{v.expense_count === 1 ? "" : "s"}</span>
                        </span>
                        <span className="tabular-nums shrink-0 text-foreground">{fmt(v.spend_amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No vendor-linked paid expenses in this window.</p>
                )}
              </div>
            </div>

            {data.drivers.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {data.drivers.map((d, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 px-2.5 py-2 min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate" title={d.label}>{d.label}</p>
                    <p className={`text-sm font-semibold tabular-nums ${IMPACT_TONE[d.impact] || "text-foreground"}`}>
                      {String(d.label).toLowerCase().includes("share")
                        ? `${num(d.value).toFixed(1)}%`
                        : fmt(num(d.value), currency)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {data.flags.length > 0 && (
              <div className="space-y-1.5">
                {data.flags.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground/90">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                    <span className="break-words">{f}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
