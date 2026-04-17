import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Receipt, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface Props {
  session: PortalSessionInfo;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  void: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  partially_paid: "Partially Paid",
  void: "Voided",
};

export function PortalInvoices({ session: _session }: Props) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const { data } = await portalGetResource<any[]>("invoices");
    setInvoices(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading invoices…</p>;

  if (invoices.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No invoices yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Invoices from your service provider will appear here once they are issued. You'll be able to track amounts, due dates, and payment status.
          </p>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const overdueIds = new Set(
    invoices
      .filter((inv) => inv.due_date && new Date(inv.due_date) < now && inv.status !== "paid" && inv.status !== "void")
      .map((inv) => inv.id)
  );

  const totalOutstanding = invoices
    .filter((inv) => inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + (Number(inv.grand_total) - Number(inv.amount_paid)), 0);

  return (
    <div className="mt-4 space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="text-xs">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
        </Badge>
        {totalOutstanding > 0 && (
          <Badge variant="outline" className="text-xs font-mono">
            Outstanding: {formatCurrency(totalOutstanding)}
          </Badge>
        )}
        {overdueIds.size > 0 && (
          <Badge variant="destructive" className="text-xs gap-1">
            <AlertTriangle className="h-3 w-3" />
            {overdueIds.size} overdue
          </Badge>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table className="min-w-[650px]">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const balance = Number(inv.grand_total) - Number(inv.amount_paid);
              const isOverdue = overdueIds.has(inv.id);
              return (
                <TableRow key={inv.id} className={isOverdue ? "bg-destructive/5" : ""}>
                  <TableCell className="font-medium text-foreground">{inv.invoice_number}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge className={STATUS_COLORS[inv.status]}>
                        {STATUS_LABELS[inv.status] || inv.status.replace("_", " ")}
                      </Badge>
                      {isOverdue && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                          Overdue
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(Number(inv.grand_total))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {formatCurrency(Number(inv.amount_paid))}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-medium ${balance > 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {formatCurrency(balance)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className={isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
