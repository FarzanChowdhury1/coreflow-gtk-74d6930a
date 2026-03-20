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
import { subDays, subMonths, startOfDay, format } from "date-fns";

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

export function DashboardBreakdowns({ workspaceId, currency }: Props) {
  const [range, setRange] = useState<TimeRange>("30d");
  const rangeStart = useMemo(() => getRangeStart(range), [range]);

  // Leads breakdown
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

  // Proposals breakdown — use latest version per proposal to avoid overcounting
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
      // Deduplicate: keep only the latest version per proposal
      const seen = new Set<string>();
      return data.filter((v: any) => {
        if (seen.has(v.proposal_id)) return false;
        seen.add(v.proposal_id);
        return true;
      });
    },
  });

  // Projects breakdown
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

  // Invoices breakdown
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

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  const totalReceivable = invoices.reduce((s: number, i: any) => {
    if (i.status === "void" || i.status === "paid") return s;
    return s + (Number(i.grand_total) - Number(i.amount_paid));
  }, 0);

  const loading = ll || pl || prl || il;

  return (
    <div className="mt-6 space-y-4">
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
                <CardTitle className="text-xs font-medium text-muted-foreground">Proposals by Status</CardTitle>
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

          {/* Financial summary row */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-4 pb-4 px-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding Receivable</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{fmt(totalReceivable)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 px-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Overdue Invoices</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{overdueInvoices.length}</p>
                </div>
                {overdueInvoices.length > 0 && <Badge variant="destructive" className="text-xs">Needs attention</Badge>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 px-4">
                <p className="text-xs text-muted-foreground">Total Invoices</p>
                <p className="text-lg font-semibold text-foreground tabular-nums">{invoices.length}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{TIME_LABELS[range]}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
