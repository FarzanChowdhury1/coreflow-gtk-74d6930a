import { useEffect, useState, useCallback } from "react";
import { CreditCard, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  mobile_banking: "Mobile Banking",
  other: "Other",
};

export default function Payments() {
  const { currentWorkspace } = useWorkspace();
  const [payments, setPayments] = useState<(Tables<"payments"> & { invoices: { invoice_number: string } | null })[]>([]);
  const [invoices, setInvoices] = useState<Tables<"invoices">[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    const [payRes, invRes] = await Promise.all([
      supabase
        .from("payments")
        .select("*, invoices(invoice_number)")
        .eq("workspace_id", currentWorkspace.id)
        .order("paid_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .is("deleted_at", null),
    ]);

    if (payRes.data) setPayments(payRes.data as any);
    if (invRes.data) setInvoices(invRes.data);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calculate total received
  const totalReceived = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Payment Ledger</h1>
          {payments.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              Total: ৳{totalReceived.toLocaleString("en-BD")}
            </Badge>
          )}
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-1 h-4 w-4" /> Record Payment
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : payments.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p>No payments recorded yet. Issue an invoice first, then record payments against it.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table className="min-w-[650px]">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Paid At</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    {p.invoices?.invoice_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    ৳{Number(p.amount).toLocaleString("en-BD")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{METHOD_LABELS[p.method] || p.method}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                  <TableCell>{format(new Date(p.paid_at), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {p.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PaymentFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onCreated={fetchData}
        invoices={invoices}
      />
    </div>
  );
}
