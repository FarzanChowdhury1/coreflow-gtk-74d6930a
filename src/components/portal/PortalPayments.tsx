import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PortalSession } from "@/pages/portal/PortalEntry";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface Props {
  session: PortalSession;
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
    // Get invoice IDs for this company first
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("company_id", session.company_id)
      .eq("workspace_id", session.workspace_id)
      .is("deleted_at", null);

    if (!invoices || invoices.length === 0) {
      setPayments([]);
      setLoading(false);
      return;
    }

    const invoiceIds = invoices.map((i) => i.id);
    const invoiceMap = Object.fromEntries(invoices.map((i) => [i.id, i.invoice_number]));

    const { data } = await supabase
      .from("payments")
      .select("*")
      .in("invoice_id", invoiceIds)
      .eq("workspace_id", session.workspace_id)
      .order("paid_at", { ascending: false });

    setPayments(
      (data || []).map((p) => ({ ...p, invoice_number: invoiceMap[p.invoice_id] || "—" }))
    );
    setLoading(false);
  }, [session]);

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
