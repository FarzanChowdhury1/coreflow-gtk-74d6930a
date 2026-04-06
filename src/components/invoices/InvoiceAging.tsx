import { useMemo } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { differenceInDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Clock, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface AgingBucket {
  label: string;
  range: string;
  count: number;
  total: number;
  invoices: any[];
  color: string;
}

export function InvoiceAging() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoice-aging", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("*, companies(legal_name)")
        .eq("workspace_id", wsId)
        .is("deleted_at", null)
        .in("status", ["issued", "partially_paid"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });

  const buckets = useMemo<AgingBucket[]>(() => {
    const today = new Date();
    const b: AgingBucket[] = [
      { label: "Current", range: "Not yet due", count: 0, total: 0, invoices: [], color: "bg-green-500" },
      { label: "1–30 days", range: "1–30 days overdue", count: 0, total: 0, invoices: [], color: "bg-yellow-500" },
      { label: "31–60 days", range: "31–60 days overdue", count: 0, total: 0, invoices: [], color: "bg-orange-500" },
      { label: "61–90 days", range: "61–90 days overdue", count: 0, total: 0, invoices: [], color: "bg-red-500" },
      { label: "90+ days", range: "Over 90 days overdue", count: 0, total: 0, invoices: [], color: "bg-destructive" },
    ];

    for (const inv of invoices) {
      const outstanding = Number(inv.grand_total) - Number(inv.amount_paid);
      if (outstanding <= 0) continue;

      if (!inv.due_date) {
        b[0].count++;
        b[0].total += outstanding;
        b[0].invoices.push({ ...inv, outstanding });
        continue;
      }

      const daysOverdue = differenceInDays(today, new Date(inv.due_date));

      let idx = 0;
      if (daysOverdue <= 0) idx = 0;
      else if (daysOverdue <= 30) idx = 1;
      else if (daysOverdue <= 60) idx = 2;
      else if (daysOverdue <= 90) idx = 3;
      else idx = 4;

      b[idx].count++;
      b[idx].total += outstanding;
      b[idx].invoices.push({ ...inv, outstanding, daysOverdue });
    }

    return b;
  }, [invoices]);

  const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading aging data…</div>;
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Clock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No outstanding invoices to age.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {buckets.map((b) => (
          <Card key={b.label} className={b.total > 0 ? "border-l-4" : ""} style={b.total > 0 ? { borderLeftColor: `var(--${b.color.replace('bg-', '')}, currentColor)` } : {}}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{b.label}</p>
              <p className="text-lg font-semibold text-foreground">৳{b.total.toLocaleString("en-BD")}</p>
              <p className="text-xs text-muted-foreground">{b.count} invoice{b.count !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Visual bar */}
      {grandTotal > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Aging Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-4 w-full rounded-full overflow-hidden bg-muted">
              {buckets.map((b) => {
                const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div
                    key={b.label}
                    className={`${b.color} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${b.label}: ৳${b.total.toLocaleString("en-BD")} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4 mt-3">
              {buckets.filter(b => b.total > 0).map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className={`h-2.5 w-2.5 rounded-full ${b.color}`} />
                  {b.label}: {((b.total / grandTotal) * 100).toFixed(0)}%
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Outstanding Invoices ({invoices.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.flatMap((b) =>
                  b.invoices.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium text-foreground">{inv.invoice_number}</TableCell>
                      <TableCell className="text-sm">{inv.companies?.legal_name ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">৳{Number(inv.grand_total).toLocaleString("en-BD")}</TableCell>
                      <TableCell className="text-right text-sm">৳{Number(inv.amount_paid).toLocaleString("en-BD")}</TableCell>
                      <TableCell className="text-right font-medium text-sm">৳{inv.outstanding.toLocaleString("en-BD")}</TableCell>
                      <TableCell className="text-sm">{inv.due_date ?? "No due date"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`text-xs ${
                          !inv.daysOverdue || inv.daysOverdue <= 0 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : inv.daysOverdue <= 30 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                          : inv.daysOverdue <= 60 ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}>
                          {!inv.daysOverdue || inv.daysOverdue <= 0 ? "Current" : `${inv.daysOverdue}d overdue`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
