import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CreditCard, Clock, CheckCircle2, XCircle } from "lucide-react";
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

// CoreFlow is Bangladesh-only — all amounts are BDT.
function formatCurrency(amount: number): string {
  return `৳${amount.toLocaleString()}`;
}

export function PortalPayments({ session: _session }: Props) {
  const [payments, setPayments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    const [{ data }, subRes] = await Promise.all([
      portalGetResource<any[]>("payments"),
      portalAction<any>("list_my_proof_submissions"),
    ]);
    setPayments(data || []);
    setSubmissions(((subRes.data as any)?.data) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading payment history…</p>;

  if (payments.length === 0 && submissions.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <CreditCard className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No payments recorded</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Once payments are recorded against your invoices, they will appear here as a complete payment history.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-xs">
          {payments.length} payment{payments.length !== 1 ? "s" : ""}
        </Badge>
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs font-mono">
          Total Paid: {formatCurrency(totalPaid)}
        </Badge>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table className="min-w-[500px]">
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
                <TableCell className="text-right font-medium font-mono text-emerald-600">
                  {formatCurrency(Number(p.amount))}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {METHOD_LABELS[p.method] || p.method}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{p.reference || "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(p.paid_at), "dd MMM yyyy")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
