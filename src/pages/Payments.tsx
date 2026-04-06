import { useEffect, useState, useCallback } from "react";
import { CreditCard, Plus, Download, AlertTriangle, ShieldAlert } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { Card, CardContent } from "@/components/ui/card";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
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
  const { currentWorkspace, currentRole } = useWorkspace();
  const [payments, setPayments] = useState<(Tables<"payments"> & { invoices: { invoice_number: string } | null })[]>([]);
  const [invoices, setInvoices] = useState<Tables<"invoices">[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentRole === "admin";

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

  if (!isAdmin) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Payment Ledger</h1>
        </div>
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          Payment management is available to workspace admins only. Contact your workspace admin if you need access.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Payment Ledger</h1>
          <PageInfoButton
            title="Payments"
            description="Record and track payments received against invoices. Every payment is linked to a specific invoice."
            actions={["Record payments with method and reference details", "Track total collected revenue", "View payment history by invoice"]}
            audience="Finance and admin teams."
          />
          {payments.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              Total: ৳{totalReceived.toLocaleString("en-BD")}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToCSV(
                payments.map((p: any) => ({
                  invoice: p.invoices?.invoice_number || "",
                  amount: Number(p.amount),
                  method: METHOD_LABELS[p.method] || p.method,
                  reference: p.reference || "",
                  paid_at: new Date(p.paid_at).toLocaleDateString(),
                  notes: p.notes || "",
                })),
                [
                  { key: "invoice", label: "Invoice" },
                  { key: "amount", label: "Amount" },
                  { key: "method", label: "Method" },
                  { key: "reference", label: "Reference" },
                  { key: "paid_at", label: "Paid At" },
                  { key: "notes", label: "Notes" },
                ],
                "payments-export"
              )
            }
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> Record Payment
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : payments.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <CreditCard className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">No payments yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Payments help you track money received against invoices and client work. Record payments here so you always know what has been paid, partially paid, or still pending.
          </p>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Record First Payment
          </Button>
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
