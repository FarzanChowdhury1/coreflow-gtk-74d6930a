import { useEffect, useState, useCallback } from "react";
import { Receipt, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InvoiceFormDialog } from "@/components/invoices/InvoiceFormDialog";
import { InvoiceDetail } from "@/components/invoices/InvoiceDetail";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  void: "bg-destructive/10 text-destructive",
};

export default function Invoices() {
  const { currentWorkspace } = useWorkspace();
  const [invoices, setInvoices] = useState<(Tables<"invoices"> & { companies: { legal_name: string } | null })[]>([]);
  const [companies, setCompanies] = useState<Tables<"companies">[]>([]);
  const [projects, setProjects] = useState<Tables<"projects">[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Tables<"invoices"> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    const [invRes, compRes, projRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, companies(legal_name)")
        .eq("workspace_id", currentWorkspace.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .is("deleted_at", null),
      supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .is("deleted_at", null),
    ]);

    if (invRes.data) setInvoices(invRes.data as any);
    if (compRes.data) setCompanies(compRes.data);
    if (projRes.data) setProjects(projRes.data);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (selectedInvoice) {
    return (
      <InvoiceDetail
        invoice={selectedInvoice}
        onBack={() => { setSelectedInvoice(null); fetchData(); }}
        onUpdated={fetchData}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Invoice Manager</h1>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-1 h-4 w-4" /> New Invoice
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No invoices yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Invoices let you bill clients and track payments. Create one linked to a company, add line items, and issue it when ready.
          </p>
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Create First Invoice
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Grand Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <TableCell className="font-medium text-foreground">{inv.invoice_number}</TableCell>
                  <TableCell>{inv.companies?.legal_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[inv.status]}>{inv.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ৳{Number(inv.grand_total).toLocaleString("en-BD")}
                  </TableCell>
                  <TableCell className="text-right">
                    ৳{Number(inv.amount_paid).toLocaleString("en-BD")}
                  </TableCell>
                  <TableCell>{inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell>{inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InvoiceFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onCreated={fetchData}
        companies={companies}
        projects={projects}
      />
    </div>
  );
}
