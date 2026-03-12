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

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  mobile_banking: "Mobile Banking",
  other: "Other",
};

export function PortalPayments({ session }: Props) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    const { data } = await portalGetResource<any[]>("payments");
    setPayments(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading payments…</p>;
  if (payments.length === 0) return <p className="text-center py-8 text-muted-foreground">No payments recorded.</p>;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Total Paid: ৳{totalPaid.toLocaleString("en-BD")}</Badge>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-foreground">{p.invoice_number}</TableCell>
                <TableCell className="text-right font-medium text-green-600">
                  ৳{Number(p.amount).toLocaleString("en-BD")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{METHOD_LABELS[p.method] || p.method}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                <TableCell>{format(new Date(p.paid_at), "dd MMM yyyy")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
