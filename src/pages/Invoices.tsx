import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { InvoiceMobileCards } from "@/components/invoices/InvoiceMobileCards";
import { Receipt, Plus, Download, Clock } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { InvoiceAging } from "@/components/invoices/InvoiceAging";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportToCSV } from "@/lib/csv-export";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InvoiceFormDialog } from "@/components/invoices/InvoiceFormDialog";
import { InvoiceDetail } from "@/components/invoices/InvoiceDetail";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationControls } from "@/components/ui/pagination-controls";
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
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Tables<"invoices"> | null>(null);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const workspaceId = currentWorkspace?.id;

  // Deep-link from search: ?open=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (openId) {
      setPendingOpenId(openId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const invoicesPag = usePaginatedQuery<Tables<"invoices"> & { companies: { legal_name: string } | null }>({
    table: "invoices",
    queryKey: ["invoices", workspaceId ?? ""],
    workspaceId,
    select: "*, companies(legal_name)",
    filters: (q: any) => q.is("deleted_at", null),
  });
  const invoices = invoicesPag.rows;
  const loading = invoicesPag.isLoading;
  const invoicesError = invoicesPag.isError;

  const { data: companies = [] } = useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-list", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const fetchData = () => {
    invoicesPag.invalidate();
  };

  // Auto-open invoice from deep-link once data loads
  useEffect(() => {
    if (pendingOpenId && invoices.length > 0) {
      const match = invoices.find((inv) => inv.id === pendingOpenId);
      if (match) setSelectedInvoice(match);
      setPendingOpenId(null);
    }
  }, [pendingOpenId, invoices]);

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
          <PageInfoButton
            title="Invoices"
            description="Create invoices for clients, track payment status, and export as PDF. Invoices can be linked to proposals and projects."
            actions={["Create and issue invoices", "Record payments against invoices", "Export invoice PDFs", "Track paid, partially paid, and overdue invoices"]}
            audience="Finance and admin teams."
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToCSV(
                invoices.map((i: any) => ({
                  invoice_number: i.invoice_number,
                  company: i.companies?.legal_name || "",
                  status: i.status,
                  grand_total: Number(i.grand_total),
                  amount_paid: Number(i.amount_paid),
                  due_date: i.due_date || "",
                  issue_date: i.issue_date || "",
                })),
                [
                  { key: "invoice_number", label: "Invoice #" },
                  { key: "company", label: "Company" },
                  { key: "status", label: "Status" },
                  { key: "grand_total", label: "Total" },
                  { key: "amount_paid", label: "Paid" },
                  { key: "issue_date", label: "Issue Date" },
                  { key: "due_date", label: "Due Date" },
                ],
                "invoices-export"
              )
            }
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Create and track invoices for your clients. Record payments and export PDFs when ready.
      </p>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Invoices</TabsTrigger>
          <TabsTrigger value="aging" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Aging Report
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {invoicesError && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <Receipt className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm text-muted-foreground">Failed to load invoices. Try refreshing the page.</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center">
              <Receipt className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">No invoices yet</h2>
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
          <PaginationControls
            page={invoicesPag.page}
            totalPages={invoicesPag.totalPages}
            totalCount={invoicesPag.totalCount}
            hasNext={invoicesPag.hasNext}
            hasPrev={invoicesPag.hasPrev}
            onNext={invoicesPag.nextPage}
            onPrev={invoicesPag.prevPage}
            isFetching={invoicesPag.isFetching}
            pageSize={invoicesPag.PAGE_SIZE}
          />
        </TabsContent>

        <TabsContent value="aging">
          <InvoiceAging />
        </TabsContent>
      </Tabs>

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
