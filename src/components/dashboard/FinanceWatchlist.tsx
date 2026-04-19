import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface WatchlistItem {
  id: string;
  trigger_key: string;
  source: string;
  severity: "critical" | "warning" | "info";
  title: string;
  what_changed: string;
  why_it_matters: string;
  recommended_action: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface Props {
  workspaceId: string;
  isAdmin: boolean;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_META: Record<
  WatchlistItem["severity"],
  { tone: string; chip: string; Icon: typeof AlertTriangle; label: string }
> = {
  critical: {
    tone: "border-destructive/40 bg-destructive/5",
    chip: "bg-destructive/15 text-destructive border-destructive/30",
    Icon: AlertOctagon,
    label: "Critical",
  },
  warning: {
    tone: "border-warning/40 bg-warning/5",
    chip: "bg-warning/15 text-warning border-warning/30",
    Icon: AlertTriangle,
    label: "Warning",
  },
  info: {
    tone: "border-primary/30 bg-primary/5",
    chip: "bg-primary/15 text-primary border-primary/30",
    Icon: Info,
    label: "Info",
  },
};

const SOURCE_LABEL: Record<string, string> = {
  finance_analytics: "Finance",
  lender_readiness: "Lender Readiness",
  burden_analytics: "Burden",
  runway_forecast: "Runway",
};

export function FinanceWatchlist({ workspaceId, isAdmin }: Props) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["finance-watchlist", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_watchlist_items" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_dismissed", false);
      if (error) throw error;
      return (data || []) as unknown as WatchlistItem[];
    },
  });

  if (!isAdmin) return null;

  const items = (data ?? [])
    .slice()
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 9;
      const sb = SEVERITY_RANK[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  async function handleRefresh() {
    if (!workspaceId) return;
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc("refresh_finance_watchlist" as any, {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["finance-watchlist", workspaceId] });
      toast.success("Finance watchlist refreshed");
    } catch (e: any) {
      toast.error(e?.message || "Could not refresh watchlist");
    } finally {
      setRefreshing(false);
    }
  }

  async function dismiss(id: string) {
    try {
      const { error } = await supabase.rpc("dismiss_finance_watchlist_item" as any, {
        _item_id: id,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["finance-watchlist", workspaceId] });
    } catch (e: any) {
      toast.error(e?.message || "Could not dismiss item");
    }
  }

  const counts = items.reduce(
    (acc, it) => {
      acc[it.severity] = (acc[it.severity] ?? 0) + 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 } as Record<WatchlistItem["severity"], number>,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Finance Watchlist
          {items.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {items.length}
            </Badge>
          )}
          {counts.critical > 0 && (
            <Badge variant="outline" className={SEVERITY_META.critical.chip}>
              {counts.critical} critical
            </Badge>
          )}
          {counts.warning > 0 && (
            <Badge variant="outline" className={SEVERITY_META.warning.chip}>
              {counts.warning} warning
            </Badge>
          )}
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">Admin only</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Action items derived from snapshots of your finance, lender readiness, burden, and runway signals.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-foreground/90">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Could not load the watchlist right now.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border bg-muted/20 px-3 py-8 text-center">
            <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-success/70" />
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              No finance risks above threshold. Click Refresh after major changes (large invoices, payments,
              expense bursts) to recompute immediately.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((it) => {
              const meta = SEVERITY_META[it.severity];
              const Icon = meta.Icon;
              return (
                <div
                  key={it.id}
                  className={`rounded-md border p-3 ${meta.tone}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/80" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{it.title}</span>
                        <Badge variant="outline" className={`text-[10px] ${meta.chip}`}>
                          {meta.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {SOURCE_LABEL[it.source] ?? it.source}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground/90 leading-relaxed">
                        <span className="text-muted-foreground">What changed: </span>
                        {it.what_changed}
                      </p>
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        <span className="text-muted-foreground">Why it matters: </span>
                        {it.why_it_matters}
                      </p>
                      <p className="text-xs font-medium text-foreground leading-relaxed">
                        <span className="text-muted-foreground font-normal">Next action: </span>
                        {it.recommended_action}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 p-0"
                      onClick={() => dismiss(it.id)}
                      aria-label={`Dismiss ${it.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
