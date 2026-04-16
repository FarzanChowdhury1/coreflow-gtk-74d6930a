import { useState, useMemo } from "react";
import { BarChart3, Download, AlertTriangle } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, subDays, subMonths, startOfDay, endOfDay } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { guardedExportToCSV } from "@/lib/guarded-export";

type TimeRange = "7d" | "30d" | "90d" | "12m" | "custom";

function getDateRange(range: TimeRange, customStart?: Date, customEnd?: Date) {
  const now = new Date();
  switch (range) {
    case "7d": return { from: subDays(now, 7), to: now };
    case "30d": return { from: subDays(now, 30), to: now };
    case "90d": return { from: subDays(now, 90), to: now };
    case "12m": return { from: subMonths(now, 12), to: now };
    case "custom": return { from: customStart || subDays(now, 30), to: customEnd || now };
  }
}

interface ReportRow {
  category: string;
  metric: string;
  value: number;
  currency: string;
  count: number;
}

export default function Reports() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [range, setRange] = useState<TimeRange>("30d");
  const [customStart, setCustomStart] = useState<Date>();
  const [customEnd, setCustomEnd] = useState<Date>();

  const { from, to } = getDateRange(range, customStart, customEnd);
  const fromISO = startOfDay(from).toISOString();
  const toISO = endOfDay(to).toISOString();

  // Revenue data
  const { data: invoices = [], isError: invErr } = useQuery({
    queryKey: ["report-invoices", wsId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id, status, grand_total, amount_paid, currency, issue_date, due_date")
        .eq("workspace_id", wsId!)
        .is("deleted_at", null)
        .gte("created_at", fromISO)
        .lte("created_at", toISO);
      return data || [];
    },
    enabled: !!wsId,
  });

  // Fetch ALL workspace invoices (no date filter) solely for payment→currency lookup
  const { data: allInvoices = [] } = useQuery({
    queryKey: ["report-all-invoices-currency", wsId],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id, currency")
        .eq("workspace_id", wsId!)
        .is("deleted_at", null);
      return data || [];
    },
    enabled: !!wsId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["report-payments", wsId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("id, amount, method, paid_at, invoice_id")
        .eq("workspace_id", wsId!)
        .gte("paid_at", fromISO)
        .lte("paid_at", toISO);
      return data || [];
    },
    enabled: !!wsId,
  });

  // Spend data
  const { data: expenses = [] } = useQuery({
    queryKey: ["report-expenses", wsId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("id, amount, currency, category, expense_date, payment_status")
        .eq("workspace_id", wsId!)
        .is("deleted_at", null)
        .gte("expense_date", format(from, "yyyy-MM-dd"))
        .lte("expense_date", format(to, "yyyy-MM-dd"));
      return data || [];
    },
    enabled: !!wsId,
  });

  // Pipeline data
  const { data: leads = [] } = useQuery({
    queryKey: ["report-leads", wsId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, status, estimated_value, currency")
        .eq("workspace_id", wsId!)
        .is("deleted_at", null)
        .gte("created_at", fromISO)
        .lte("created_at", toISO);
      return data || [];
    },
    enabled: !!wsId,
  });

  const { data: proposals = [] } = useQuery({
    queryKey: ["report-proposals", wsId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("proposals")
        .select("id, status")
        .eq("workspace_id", wsId!)
        .is("deleted_at", null)
        .gte("created_at", fromISO)
        .lte("created_at", toISO);
      return data || [];
    },
    enabled: !!wsId,
  });

  // Build an invoice-id → currency map for payment currency resolution
  // Currency map from ALL invoices (not date-filtered) so payments always resolve correctly
  const invoiceCurrencyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of allInvoices) {
      m.set((inv as any).id, (inv as any).currency || "BDT");
    }
    return m;
  }, [allInvoices]);

  // Compute report rows grouped by currency
  const report = useMemo(() => {
    const rows: ReportRow[] = [];

    // Revenue by currency
    const invByCurrency = new Map<string, { total: number; paid: number; count: number; paidCount: number }>();
    for (const inv of invoices) {
      const cur = (inv as any).currency || "BDT";
      const entry = invByCurrency.get(cur) || { total: 0, paid: 0, count: 0, paidCount: 0 };
      entry.total += Number((inv as any).grand_total || 0);
      entry.paid += Number((inv as any).amount_paid || 0);
      entry.count++;
      if ((inv as any).status === "paid") entry.paidCount++;
      invByCurrency.set(cur, entry);
    }
    for (const [cur, v] of invByCurrency) {
      rows.push({ category: "Revenue", metric: "Total Invoiced", value: v.total, currency: cur, count: v.count });
      rows.push({ category: "Revenue", metric: "Collected", value: v.paid, currency: cur, count: v.paidCount });
      rows.push({ category: "Revenue", metric: "Outstanding", value: v.total - v.paid, currency: cur, count: v.count - v.paidCount });
    }

    // Payments — group by currency derived from their invoice
    // Payment currency: resolved from ALL invoices (not date-filtered).
    // If invoice is missing from map (e.g. deleted), skip the payment rather than false-label it.
    const payByCurrency = new Map<string, { total: number; count: number }>();
    let unmappedPayments = 0;
    for (const p of payments) {
      const invId = (p as any).invoice_id as string;
      const cur = invoiceCurrencyMap.get(invId);
      if (!cur) { unmappedPayments++; continue; }
      const entry = payByCurrency.get(cur) || { total: 0, count: 0 };
      entry.total += Number((p as any).amount || 0);
      entry.count++;
      payByCurrency.set(cur, entry);
    }
    for (const [cur, v] of payByCurrency) {
      rows.push({ category: "Revenue", metric: "Payment Transactions", value: v.total, currency: cur, count: v.count });
    }
    if (unmappedPayments > 0) {
      rows.push({ category: "Revenue", metric: "Payments (unknown currency)", value: 0, currency: "?", count: unmappedPayments });
    }

    // Spend by currency
    const expByCurrency = new Map<string, { total: number; count: number }>();
    for (const exp of expenses) {
      const cur = (exp as any).currency || "BDT";
      const entry = expByCurrency.get(cur) || { total: 0, count: 0 };
      entry.total += Number((exp as any).amount || 0);
      entry.count++;
      expByCurrency.set(cur, entry);
    }
    for (const [cur, v] of expByCurrency) {
      rows.push({ category: "Spend", metric: "Total Expenses", value: v.total, currency: cur, count: v.count });
    }

    // Expense by category+currency — no false cross-currency grouping
    const catCurMap = new Map<string, { amount: number; currency: string }>();
    for (const exp of expenses) {
      const cat = (exp as any).category || "general";
      const cur = (exp as any).currency || "BDT";
      const key = `${cat}|${cur}`;
      const entry = catCurMap.get(key) || { amount: 0, currency: cur };
      entry.amount += Number((exp as any).amount || 0);
      catCurMap.set(key, entry);
    }
    for (const [key, v] of catCurMap) {
      const cat = key.split("|")[0];
      rows.push({ category: "Spend Breakdown", metric: cat.charAt(0).toUpperCase() + cat.slice(1), value: v.amount, currency: v.currency, count: 0 });
    }

    // Pipeline — uses real enum statuses
    rows.push({ category: "Pipeline", metric: "Leads Created", value: 0, currency: "", count: leads.length });
    const convertedLeads = leads.filter((l) => (l as any).status === "converted");
    rows.push({ category: "Pipeline", metric: "Leads Converted", value: 0, currency: "", count: convertedLeads.length });
    const qualifiedLeads = leads.filter((l) => (l as any).status === "qualified");
    rows.push({ category: "Pipeline", metric: "Leads Qualified", value: 0, currency: "", count: qualifiedLeads.length });
    rows.push({ category: "Pipeline", metric: "Proposals Created", value: 0, currency: "", count: proposals.length });

    return rows;
  }, [invoices, payments, expenses, leads, proposals, invoiceCurrencyMap, allInvoices]);

  const exportRows = report.map((r) => ({
    category: r.category,
    metric: r.metric,
    value: r.value > 0 ? r.value.toLocaleString() : "",
    currency: r.currency,
    count: r.count,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Reports</h1>
            <PageInfoButton
              title="Reports"
              description="Summarized business metrics across revenue, spend, and pipeline for any date range."
              actions={["Select a date range to slice metrics", "Export the report as CSV", "Review revenue, spend, and pipeline breakdowns"]}
              audience="Admins reviewing business performance."
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Revenue, spend, and pipeline metrics for the selected period.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => wsId && guardedExportToCSV(wsId, exportRows, [
              { key: "category", label: "Category" },
              { key: "metric", label: "Metric" },
              { key: "count", label: "Count" },
              { key: "value", label: "Amount" },
              { key: "currency", label: "Currency" },
            ], `report-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}`)}
          >
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Date range controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={range} onValueChange={(v) => setRange(v as TimeRange)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="12m">Last 12 months</SelectItem>
            <SelectItem value="custom">Custom range</SelectItem>
          </SelectContent>
        </Select>
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("w-[130px] text-left font-normal", !customStart && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customStart ? format(customStart, "dd MMM yyyy") : "Start"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={customStart} onSelect={setCustomStart} /></PopoverContent>
            </Popover>
            <span className="text-muted-foreground text-sm">–</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("w-[130px] text-left font-normal", !customEnd && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customEnd ? format(customEnd, "dd MMM yyyy") : "End"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} /></PopoverContent>
            </Popover>
          </div>
        )}
        <Badge variant="secondary" className="text-xs">
          {format(from, "dd MMM yyyy")} – {format(to, "dd MMM yyyy")}
        </Badge>
      </div>

      {invErr && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load some report data.</p>
        </div>
      )}

      {/* Report sections */}
      {["Revenue", "Spend", "Spend Breakdown", "Pipeline"].map((category) => {
        const catRows = report.filter((r) => r.category === category);
        if (catRows.length === 0) return null;
        return (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {catRows.map((row, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {row.metric}
                        {row.currency && <span className="ml-1.5 text-xs text-muted-foreground">({row.currency})</span>}
                      </p>
                      {row.count > 0 && <p className="text-xs text-muted-foreground">{row.count} record{row.count !== 1 ? "s" : ""}</p>}
                    </div>
                    <div className="text-right">
                      {row.value > 0 ? (
                        <p className="text-sm font-semibold tabular-nums">
                          {row.currency} {row.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </p>
                      ) : row.count > 0 ? (
                        <p className="text-sm font-semibold tabular-nums">{row.count}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">—</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {report.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <h2 className="text-sm font-medium text-foreground mb-1">No data for this period</h2>
            <p className="text-sm text-muted-foreground">Try selecting a wider date range.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
