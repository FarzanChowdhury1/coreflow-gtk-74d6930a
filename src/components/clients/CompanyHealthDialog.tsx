import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, HelpCircle, Activity } from "lucide-react";
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
  overdue_count: number;
  total_invoiced: number;
  total_collected: number;
  outstanding: number;
  overdue_amount: number;
  avg_days_to_pay: number | null;
  attributed_expenses: number;
  collection_rate_pct: number | null;
  gross_margin: number;
  gross_margin_pct: number | null;
  health_band: "healthy" | "stable" | "watchlist" | "at_risk" | "unknown";
};

const BAND_META: Record<CurrencyRow["health_band"], { label: string; cls: string; icon: React.ElementType }> = {
  healthy:   { label: "Healthy",   cls: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  stable:    { label: "Stable",    cls: "bg-primary/10 text-primary border-primary/30", icon: Activity },
  watchlist: { label: "Watchlist", cls: "bg-warning/10 text-warning border-warning/30", icon: Clock },
  at_risk:   { label: "At Risk",   cls: "bg-destructive/10 text-destructive border-destructive/30", icon: ShieldAlert },
  unknown:   { label: "Insufficient data", cls: "bg-muted text-muted-foreground border-border", icon: HelpCircle },
};

function fmtCur(n: number, cur: string) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function CompanyHealthDialog({ open, onOpenChange, companyId, companyName }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-financial-health", companyId],
    enabled: open && !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_financial_health" as any, { _company_id: companyId! });
      if (error) throw error;
      return data as unknown as {
        per_currency: CurrencyRow[];
        attribution: { linked_projects: number; expense_attribution_path: string; note: string | null };
        rules: Record<string, any>;
        as_of: string;
      };
    },
  });

  const rows = data?.per_currency || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Financial Health{companyName ? ` — ${companyName}` : ""}</DialogTitle>
          <DialogDescription>
            Per-client revenue, collection, and attributed expense view. Per-currency only — no FX conversion.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Failed to load health"}</p>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No issued invoices for this client yet. Health cannot be measured.
          </p>
        )}

        <div className="space-y-3">
          {rows.map((r) => {
            const meta = BAND_META[r.health_band] || BAND_META.unknown;
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
                    <Metric label="Invoiced" value={fmtCur(r.total_invoiced, r.currency)} />
                    <Metric label="Collected" value={fmtCur(r.total_collected, r.currency)} />
                    <Metric label="Outstanding" value={fmtCur(r.outstanding, r.currency)} accent={r.outstanding > 0 ? "warning" : undefined} />
                    <Metric label="Overdue" value={fmtCur(r.overdue_amount, r.currency)} sub={r.overdue_count > 0 ? `${r.overdue_count} invoice${r.overdue_count === 1 ? "" : "s"}` : undefined} accent={r.overdue_count > 0 ? "destructive" : undefined} />
                    <Metric label="Collection rate" value={r.collection_rate_pct != null ? `${r.collection_rate_pct}%` : "—"} />
                    <Metric label="Avg days to pay" value={r.avg_days_to_pay != null ? `${r.avg_days_to_pay}d` : "—"} />
                    <Metric label="Attributed expenses" value={fmtCur(r.attributed_expenses, r.currency)} sub="from linked projects" />
                    <Metric
                      label="Gross margin"
                      value={fmtCur(r.gross_margin, r.currency)}
                      sub={r.gross_margin_pct != null ? `${r.gross_margin_pct}% of collected` : undefined}
                      accent={r.gross_margin < 0 ? "destructive" : undefined}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {data?.attribution?.note && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">{data.attribution.note}</p>
          </div>
        )}

        {data && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">Attribution.</strong> Revenue/collection from this client&apos;s invoices only.
              Attributed expenses come strictly from expenses on projects linked to this client ({data.attribution.linked_projects} linked project{data.attribution.linked_projects === 1 ? "" : "s"}).
              Workspace overhead is never allocated.
            </p>
            <p>
              <strong className="text-foreground">Bands.</strong>{" "}
              Healthy: ≥90% collection, no overdue, gross margin ≥20% ·
              Stable: ≥75% collection, ≤1 overdue ·
              Watchlist: 50–75% collection or has overdue ·
              At Risk: &lt;50% collection AND overdue &gt;50% of collected revenue.
            </p>
            <p>As of {format(new Date(data.as_of), "dd MMM yyyy")}.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "destructive" | "warning" }) {
  const colorCls =
    accent === "destructive" ? "text-destructive" :
    accent === "warning" ? "text-warning" :
    "text-foreground";
  return (
    <div className="rounded-md border bg-card px-2.5 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className={`text-sm font-semibold tabular-nums truncate ${colorCls}`} title={value}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate" title={sub}>{sub}</p>}
    </div>
  );
}
