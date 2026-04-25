import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Receipt, AlertTriangle, Upload } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { PortalSubmitPaymentProof } from "./PortalSubmitPaymentProof";

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
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [proofTarget, setProofTarget] = useState<any | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: subs }] = await Promise.all([
      portalGetResource<any[]>("invoices"),
      portalAction<any[]>("list_my_proof_submissions"),
    ]);
    setInvoices(data || []);
    setSubmissions(((subs as any)?.data) || []);
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
            Invoices from your service provider will appear here once they are issued.
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

  const pendingByInvoice = new Map<string, number>();
  for (const s of submissions) {
    if (s.status === "pending") pendingByInvoice.set(s.invoice_id, (pendingByInvoice.get(s.invoice_id) || 0) + 1);
  }

  return (
    <div className="mt-4 space-y-4">
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
        <Table className="min-w-[750px]">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const balance = Number(inv.grand_total) - Number(inv.amount_paid);
              const isOverdue = overdueIds.has(inv.id);
              const canSubmit = balance > 0 && inv.status !== "void" && inv.status !== "draft";
              const pending = pendingByInvoice.get(inv.id) || 0;
              return (
                <TableRow key={inv.id} className={isOverdue ? "bg-destructive/5" : ""}>
                  <TableCell className="font-medium text-foreground">{inv.invoice_number}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge className={STATUS_COLORS[inv.status]}>
                        {STATUS_LABELS[inv.status] || inv.status.replace("_", " ")}
                      </Badge>
                      {isOverdue && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Overdue</Badge>
                      )}
                      {pending > 0 && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{pending} pending proof</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(Number(inv.grand_total))}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(Number(inv.amount_paid))}</TableCell>
                  <TableCell className={`text-right font-mono font-medium ${balance > 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {formatCurrency(balance)}
                  </TableCell>
                  <TableCell className={isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canSubmit && (
                      <Button size="sm" variant="outline" onClick={() => setProofTarget(inv)}>
                        <Upload className="h-3.5 w-3.5 mr-1" /> Submit Proof
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {proofTarget && (
        <PortalSubmitPaymentProof
          open={!!proofTarget}
          onOpenChange={(o) => { if (!o) setProofTarget(null); }}
          invoiceId={proofTarget.id}
          invoiceNumber={proofTarget.invoice_number}
          outstandingBalance={Number(proofTarget.grand_total) - Number(proofTarget.amount_paid)}
          onSubmitted={fetchInvoices}
        />
      )}
    </div>
  );
}
