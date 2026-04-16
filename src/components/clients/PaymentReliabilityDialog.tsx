import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Clock, TrendingDown, ShieldAlert, HelpCircle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string | null;
  companyName?: string;
}

type CurrencyRow = {
  currency: string;
  invoice_count: number;
  paid_count: number;
  partial_count: number;
  overdue_count: number;
  overdue_amount: number;
  total_invoiced: number;
  total_collected: number;
  on_time_count: number;
  measurable_paid_count: number;
  avg_days_to_pay: number | null;
  avg_days_late: number | null;
  worst_lateness_days: number | null;
  on_time_rate_pct: number | null;
  reliability_band: "excellent" | "good" | "watchlist" | "high_risk" | "unknown";
};

type RecentPayment = {
  id: string;
  amount: number;
  currency: string;
  paid_at: string;
  invoice_number: string;
  due_date: string | null;
  days_vs_due: number | null;
};

const BAND_META: Record<CurrencyRow["reliability_band"], { label: string; cls: string; icon: React.ElementType }> = {
  excellent: { label: "Excellent", cls: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  good:      { label: "Good",      cls: "bg-primary/10 text-primary border-primary/30", icon: CheckCircle2 },
  watchlist: { label: "Watchlist", cls: "bg-warning/10 text-warning border-warning/30", icon: Clock },
  high_risk: { label: "High Risk", cls: "bg-destructive/10 text-destructive border-destructive/30", icon: ShieldAlert },
  unknown:   { label: "Insufficient data", cls: "bg-muted text-muted-foreground border-border", icon: HelpCircle },
};

function fmtCur(n: number, cur: string) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function PaymentReliabilityDialog({ open, onOpenChange, companyId, companyName }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-payment-reliability", companyId],
    enabled: open && !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_payment_reliability", { _company_id: companyId! });
      if (error) throw error;
      return data as unknown as {
        per_currency: CurrencyRow[];
        recent_payments: RecentPayment[];
        rules: { on_time_definition: string; bands: Record<string, string> };
        as_of: string;
      };
    },
  });

  const rows = data?.per_currency || [];
  const recent = data?.recent_payments || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Reliability{companyName ? ` — ${companyName}` : ""}</DialogTitle>
          <DialogDescription>
            Based on real invoice due dates and payment settlement behavior. Per-currency only — no FX conversion.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Failed to load reliability"}</p>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No issued invoices for this client yet. Reliability cannot be measured.
          </p>
        )}

        <div className="space-y-3">
          {rows.map((r) => {
            const meta = BAND_META[r.reliability_band] || BAND_META.unknown;
            const Icon = meta.icon;
            return (
              <Card key={r.currency}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{r.currency}</span>
                      <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{r.invoice_count} invoice{r.invoice_count === 1 ? "" : "s"}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Metric label="On-time rate" value={r.on_time_rate_pct != null ? `${r.on_time_rate_pct}%` : "—"} sub={`${r.on_time_count}/${r.measurable_paid_count} fully-paid`} />
                    <Metric label="Avg days to pay" value={r.avg_days_to_pay != null ? `${r.avg_days_to_pay}d` : "—"} />
                    <Metric label="Avg days late" value={r.avg_days_late != null ? `${r.avg_days_late}d` : "—"} sub={r.worst_lateness_days != null ? `worst ${r.worst_lateness_days}d` : undefined} />
                    <Metric label="Overdue now" value={`${r.overdue_count}`} sub={r.overdue_count > 0 ? fmtCur(r.overdue_amount, r.currency) : undefined} accent={r.overdue_count > 0 ? "destructive" : undefined} />
                    <Metric label="Paid invoices" value={`${r.paid_count}`} />
                    <Metric label="Partial invoices" value={`${r.partial_count}`} sub={r.partial_count > 0 ? "not credited as on-time" : undefined} />
                    <Metric label="Total invoiced" value={fmtCur(r.total_invoiced, r.currency)} />
                    <Metric label="Total collected" value={fmtCur(r.total_collected, r.currency)} />
                  </div>

                  {r.measurable_paid_count === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">
                      No fully-paid invoices with measurable due dates yet — band shown is based on current overdue status only.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {recent.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-foreground">Recent payments (evidence)</h3>
            <div className="rounded-md border divide-y">
              {recent.map((p) => {
                const late = p.days_vs_due != null && p.days_vs_due > 0;
                const onTime = p.days_vs_due != null && p.days_vs_due <= 0;
                return (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs gap-2">
                    <span className="font-mono text-muted-foreground truncate">{p.invoice_number}</span>
                    <span className="tabular-nums">{fmtCur(Number(p.amount), p.currency)}</span>
                    <span className="text-muted-foreground">{format(new Date(p.paid_at), "dd MMM yyyy")}</span>
                    {p.days_vs_due == null ? (
                      <Badge variant="outline" className="text-[10px]">no due date</Badge>
                    ) : late ? (
                      <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                        +{p.days_vs_due}d late
                      </Badge>
                    ) : onTime ? (
                      <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                        on time
                      </Badge>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <p><strong className="text-foreground">Rules.</strong> {data.rules.on_time_definition}. Partial payments are not credited as on-time.</p>
            <p>
              <strong className="text-foreground">Bands.</strong>{" "}
              Excellent: ≥90% on-time, ≤3d avg late, no current overdue ·
              Good: ≥70% on-time, ≤10d avg late ·
              Watchlist: ≥50% on-time ·
              High Risk: &lt;50% on-time or worst lateness &gt;30d with current overdue.
            </p>
            <p>As of {format(new Date(data.as_of), "dd MMM yyyy")}.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "destructive" }) {
  return (
    <div className="rounded-md border bg-card px-2.5 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className={`text-sm font-semibold tabular-nums truncate ${accent === "destructive" ? "text-destructive" : "text-foreground"}`} title={value}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate" title={sub}>{sub}</p>}
    </div>
  );
}
