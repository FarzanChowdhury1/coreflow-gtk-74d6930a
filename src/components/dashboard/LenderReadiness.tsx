import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, AlertTriangle, Info, TrendingUp, TrendingDown } from "lucide-react";

interface Driver {
  label: string;
  impact: "positive" | "warning" | "negative" | "neutral";
  value?: number;
}

interface LenderReadinessData {
  band: "ready" | "borderline" | "not_ready" | "insufficient_data";
  score: number;
  caution: "safe_to_expand" | "expand_carefully" | "wait_and_stabilize";
  summary: string;
  drivers: Driver[];
  flags: string[];
}

interface Props {
  workspaceId: string;
  isAdmin: boolean;
}

const BAND_META: Record<string, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-success/15 text-success border-success/30" },
  borderline: { label: "Borderline", tone: "bg-warning/15 text-warning border-warning/30" },
  not_ready: { label: "Not Ready", tone: "bg-destructive/15 text-destructive border-destructive/30" },
  insufficient_data: { label: "Insufficient Data", tone: "bg-muted text-muted-foreground border-border" },
};

const CAUTION_META: Record<string, { label: string; tone: string }> = {
  safe_to_expand: { label: "Safe to expand", tone: "text-success" },
  expand_carefully: { label: "Expand carefully", tone: "text-warning" },
  wait_and_stabilize: { label: "Wait and stabilize", tone: "text-destructive" },
};

export function LenderReadiness({ workspaceId, isAdmin }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lender-readiness", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_lender_readiness" as any, {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return data as unknown as LenderReadinessData;
    },
  });

  if (!isAdmin) return null;

  if (isLoading) {
    return <Skeleton className="h-56" />;
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Could not load lender readiness.
        </CardContent>
      </Card>
    );
  }

  const bandMeta = BAND_META[data.band] || BAND_META.insufficient_data;
  const cautionMeta = CAUTION_META[data.caution] || CAUTION_META.wait_and_stabilize;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Lender Readiness
          </CardTitle>
          <Badge variant="outline" className={`text-[10px] ${bandMeta.tone}`}>
            {bandMeta.label}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Internal decision-support score — not a financial certification
        </p>
      </CardHeader>
      <CardContent>
        {data.band === "insufficient_data" ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Info className="h-5 w-5 mx-auto mb-2 opacity-50" />
            {data.summary}
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3 mb-3">
              <div className="text-3xl font-semibold tabular-nums">{data.score}</div>
              <div className="text-xs text-muted-foreground pb-1">/ 100</div>
              <div className={`ml-auto text-xs font-medium ${cautionMeta.tone}`}>
                {cautionMeta.label}
              </div>
            </div>

            <p className="text-xs text-foreground/90 mb-4 leading-relaxed">
              {data.summary}
            </p>

            {data.drivers.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Key drivers</p>
                {data.drivers.map((d, idx) => {
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
                        <span className="text-muted-foreground tabular-nums">
                          ({d.value}{(d.label.toLowerCase().includes("rate") || d.label.toLowerCase().includes("trending") || d.label.toLowerCase().includes("budget") || d.label.toLowerCase().includes("exposure") || d.label.toLowerCase().includes("revenue")) ? "%" : ""})
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {data.flags.length > 0 && (
              <div className="space-y-1.5 pt-3 border-t">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk flags</p>
                {data.flags.map((f, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{f}</span>
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
