import { useState } from "react";
import { Database, Download, FileSpreadsheet, Loader2, Shield, HelpCircle, ExternalLink } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { exportMultiSheetXLSX } from "@/lib/xlsx-export";
import { toast } from "sonner";
import { format } from "date-fns";

const ENTITY_SETS = [
  { key: "leads", table: "leads", label: "Leads", select: "*", sheet: "Leads" },
  { key: "companies", table: "companies", label: "Companies", select: "*", sheet: "Companies" },
  { key: "contacts", table: "contacts", label: "Contacts", select: "*", sheet: "Contacts" },
  { key: "invoices", table: "invoices", label: "Invoices", select: "*, companies(legal_name)", sheet: "Invoices" },
  { key: "payments", table: "payments", label: "Payments", select: "*, invoices(invoice_number)", sheet: "Payments" },
  { key: "expenses", table: "expenses", label: "Expenses", select: "*, vendors(name), projects(name)", sheet: "Expenses" },
  { key: "renewals", table: "renewals", label: "Renewals", select: "*, companies(legal_name)", sheet: "Renewals" },
  { key: "projects", table: "projects", label: "Projects", select: "*, companies(legal_name)", sheet: "Projects" },
] as const;

const COLUMN_MAPS: Record<string, { key: string; label: string; format?: (v: any, r: any) => string }[]> = {
  leads: [
    { key: "title", label: "Title" },
    { key: "status", label: "Status" },
    { key: "source", label: "Source" },
    { key: "estimated_value", label: "Estimated Value" },
    { key: "currency", label: "Currency" },
    { key: "next_follow_up", label: "Next Follow-Up", format: (v) => v ? format(new Date(v), "dd MMM yyyy") : "" },
    { key: "created_at", label: "Created", format: (v) => format(new Date(v), "dd MMM yyyy") },
  ],
  companies: [
    { key: "legal_name", label: "Company Name" },
    { key: "bin", label: "BIN" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "created_at", label: "Created", format: (v) => format(new Date(v), "dd MMM yyyy") },
  ],
  contacts: [
    { key: "full_name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "designation", label: "Designation" },
    { key: "created_at", label: "Created", format: (v) => format(new Date(v), "dd MMM yyyy") },
  ],
  invoices: [
    { key: "invoice_number", label: "Invoice #" },
    { key: "_company", label: "Company", format: (_v, r) => r.companies?.legal_name || "" },
    { key: "status", label: "Status" },
    { key: "grand_total", label: "Grand Total" },
    { key: "amount_paid", label: "Amount Paid" },
    { key: "currency", label: "Currency" },
    { key: "issue_date", label: "Issue Date" },
    { key: "due_date", label: "Due Date" },
  ],
  payments: [
    { key: "_invoice", label: "Invoice", format: (_v, r) => r.invoices?.invoice_number || "" },
    { key: "amount", label: "Amount" },
    { key: "method", label: "Method" },
    { key: "reference", label: "Reference" },
    { key: "paid_at", label: "Paid At", format: (v) => format(new Date(v), "dd MMM yyyy") },
    { key: "notes", label: "Notes" },
  ],
  expenses: [
    { key: "description", label: "Description" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "category", label: "Category" },
    { key: "_vendor", label: "Vendor", format: (_v, r) => r.vendors?.name || "" },
    { key: "_project", label: "Project", format: (_v, r) => r.projects?.name || "" },
    { key: "expense_date", label: "Date" },
    { key: "payment_status", label: "Payment Status" },
  ],
  renewals: [
    { key: "label", label: "Label" },
    { key: "_company", label: "Company", format: (_v, r) => r.companies?.legal_name || "" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "interval_months", label: "Interval (months)" },
    { key: "next_billing_date", label: "Next Billing" },
    { key: "is_active", label: "Active", format: (v) => v ? "Yes" : "No" },
  ],
  projects: [
    { key: "name", label: "Name" },
    { key: "_company", label: "Company", format: (_v, r) => r.companies?.legal_name || "" },
    { key: "status", label: "Status" },
    { key: "start_date", label: "Start Date" },
    { key: "target_end_date", label: "Target End" },
    { key: "created_at", label: "Created", format: (v) => format(new Date(v), "dd MMM yyyy") },
  ],
};

export default function DataExport() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";
  const [exporting, setExporting] = useState(false);

  const handleFullExport = async () => {
    if (!currentWorkspace) return;
    setExporting(true);
    try {
      const sheets: { name: string; data: Record<string, any>[]; columns: typeof COLUMN_MAPS["leads"] }[] = [];

      for (const entity of ENTITY_SETS) {
        const { data, error } = await (supabase
          .from(entity.table as any)
          .select(entity.select) as any)
          .eq("workspace_id", currentWorkspace.id)
          .order("created_at", { ascending: false })
          .limit(5000);

        if (!error && data) {
          sheets.push({
            name: entity.sheet,
            data: data as Record<string, any>[],
            columns: COLUMN_MAPS[entity.key] || [],
          });
        }
      }

      const dateStr = format(new Date(), "yyyy-MM-dd");
      exportMultiSheetXLSX(sheets, `coreflow-export-${dateStr}`);
      toast.success("Workspace data exported successfully");
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Data & Export</h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Shield className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
            Data export is available to workspace admins only.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Data & Export</h1>
        <PageInfoButton
          title="Data & Export"
          description="Export your workspace data as spreadsheets. Your data belongs to you — download it anytime."
          actions={[
            "Export all workspace data as a multi-sheet XLSX",
            "Individual entity exports are also available on each page",
          ]}
          audience="Workspace admins."
        />
      </div>
      <p className="mb-6 text-sm text-muted-foreground max-w-2xl">
        Your data is always yours. Export everything in your workspace as a single spreadsheet, or use the per-page export buttons for individual modules.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Full Workspace Export
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Download all leads, clients, contacts, invoices, payments, expenses, renewals, and projects in one XLSX file with separate sheets.
            </p>
            <Button
              onClick={handleFullExport}
              disabled={exporting}
              className="w-full"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {exporting ? "Exporting…" : "Export All Data (.xlsx)"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-5 w-5 text-muted-foreground" />
              Per-Page Exports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Each module page has its own CSV and XLSX export button. Use those for filtered or single-module exports.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ENTITY_SETS.map((e) => (
                <Badge key={e.key} variant="secondary" className="text-xs">
                  {e.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              Need Help?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Have questions about your data, need a custom export, or want to discuss migration?
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href="mailto:support@coreflow.app?subject=Data%20Export%20Help">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Contact Support
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Data portability guarantee</p>
        <p>
          CoreFlow believes your data belongs to you. You can export all your records at any time. 
          Exports include up to 5,000 rows per entity. If you need bulk data beyond this limit, 
          contact support for assistance.
        </p>
      </div>
    </div>
  );
}
