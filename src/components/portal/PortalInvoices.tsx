import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface Props {
  session: PortalSessionInfo;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  void: "bg-destructive/10 text-destructive",
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
  if (invoices.length === 0) return <p className="text-center py-8 text-muted-foreground">No invoices found.</p>;

  return (
    <div className="mt-4 rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Issue Date</TableHead>
            <TableHead>Due Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => {
            const balance = Number(inv.grand_total) - Number(inv.amount_paid);
            return (
              <TableRow key={inv.id}>
                <TableCell className="font-medium text-foreground">{inv.invoice_number}</TableCell>
                <TableCell>
                  <Badge className={STATUS_COLORS[inv.status]}>{inv.status.replace("_", " ")}</Badge>
                </TableCell>
                <TableCell className="text-right">৳{Number(inv.grand_total).toLocaleString("en-BD")}</TableCell>
                <TableCell className="text-right">৳{Number(inv.amount_paid).toLocaleString("en-BD")}</TableCell>
                <TableCell className={`text-right font-medium ${balance > 0 ? "text-destructive" : "text-green-600"}`}>
                  ৳{balance.toLocaleString("en-BD")}
                </TableCell>
                <TableCell>{inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : "—"}</TableCell>
                <TableCell>{inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
