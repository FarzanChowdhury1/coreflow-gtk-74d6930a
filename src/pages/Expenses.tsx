import { useState, useMemo } from "react";
import { Receipt, Plus, Archive, ArchiveRestore, Pencil, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { ExpenseFormDialog } from "@/components/expenses/ExpenseFormDialog";

export interface Expense {
  id: string;
  workspace_id: string;
  description: string;
  amount: number;
  currency: string;
  expense_date: string;
  category: string | null;
  vendor_id: string | null;
  project_id: string | null;
  payment_method: string | null;
  payment_status: string;
  paid_date: string | null;
  notes: string | null;
  recorded_by: string;
  deleted_at: string | null;
  vendors?: { name: string } | null;
  projects?: { name: string } | null;
}

export const EXPENSE_CATEGORIES = ["general", "salary", "rent", "utilities", "software", "marketing", "travel", "equipment", "consulting", "media_buying", "logistics", "other"];

function formatCurrency(value: number, currency: string = "BDT") {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function Expenses() {
  const { currentWorkspace, currentRole } = useWorkspace();
  
  const queryClient = useQueryClient();
  const isAdmin = currentRole === "admin";
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const currency = currentWorkspace?.currency || "BDT";

  const { data: expenses = [], isLoading, isError: expensesError } = useQuery({
    queryKey: ["expenses", currentWorkspace?.id, showArchived],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      let q = supabase
        .from("expenses")
        .select("*, vendors(name), projects(name)")
        .eq("workspace_id", currentWorkspace!.id)
        .order("expense_date", { ascending: false });
      if (!showArchived) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as Expense[];
    },
  });

  const filtered = useMemo(() => {
    let list = expenses;
    if (catFilter !== "all") list = list.filter((e) => e.category === catFilter);
    if (statusFilter !== "all") list = list.filter((e) => e.payment_status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((e) =>
        e.description.toLowerCase().includes(s) ||
        e.vendors?.name?.toLowerCase().includes(s) ||
        e.projects?.name?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [expenses, search, catFilter, statusFilter]);

  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount), 0);
  const totalUnpaid = filtered.filter((e) => e.payment_status === "unpaid").reduce((s, e) => s + Number(e.amount), 0);

  const markAsPaid = async (exp: Expense) => {
    const { error } = await supabase
      .from("expenses")
      .update({ payment_status: "paid", paid_date: new Date().toISOString().split("T")[0], updated_at: new Date().toISOString() })
      .eq("id", exp.id);
    if (error) { toast.error("Failed to mark as paid"); return; }
    toast.success("Expense marked as paid");
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
  };


  const toggleArchive = async (e: Expense) => {
    const { error } = await supabase
      .from("expenses")
      .update({ deleted_at: e.deleted_at ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", e.id);
    if (error) { toast.error("Failed"); return; }
    toast.success(e.deleted_at ? "Expense restored" : "Expense archived");
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
  };

  const handleExport = () => {
    exportToCSV(filtered.map((e) => ({ ...e, vendor_name: e.vendors?.name || "", project_name: e.projects?.name || "" })), [
      { key: "expense_date", label: "Date" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount" },
      { key: "currency", label: "Currency" },
      { key: "category", label: "Category" },
      { key: "vendor_name", label: "Vendor" },
      { key: "project_name", label: "Project" },
      { key: "payment_method", label: "Payment Method" },
      { key: "notes", label: "Notes" },
    ], "expenses");
  };

  if (!isAdmin) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Receipt className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Expenses</h1>
        </div>
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Expense management is available to workspace admins only.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Receipt className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Expenses</h1>
        <PageInfoButton
          title="Expenses"
          description="Record and track business costs — from project expenses to overhead. Link to vendors and projects for accurate cost attribution."
          actions={["Record one-off and project expenses", "Link expenses to vendors and projects", "Filter by category and export for accounting"]}
          audience="Admins tracking business expenditures."
        />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Track money going out — project costs, overhead, and operational expenses.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input placeholder="Search expenses…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Expense
        </Button>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Switch id="show-archived-exp" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived-exp" className="text-xs">Show archived</Label>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="mb-3 text-sm text-muted-foreground flex flex-wrap gap-x-4">
          <span>{filtered.length} expense{filtered.length !== 1 ? "s" : ""} · Total: <span className="font-medium text-foreground">{formatCurrency(totalFiltered, currency)}</span></span>
          {totalUnpaid > 0 && <span>Outstanding payables: <span className="font-medium text-warning">{formatCurrency(totalUnpaid, currency)}</span></span>}
        </div>
      )}

      {expensesError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load expenses. Try refreshing the page.</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">
            {search || catFilter !== "all" ? "No expenses match your filters" : "No expenses yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {search || catFilter !== "all"
              ? "Try adjusting your search or filter criteria."
              : "Expenses help you track business spending and understand where money is going. Add expenses here to keep your records accurate and easy to review."}
          </p>
          {!(search || catFilter !== "all") && (
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add First Expense
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
             <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id} className={e.deleted_at ? "opacity-50" : ""}>
                  <TableCell className="whitespace-nowrap text-xs">{format(new Date(e.expense_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="font-medium">{e.description}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{e.category || "general"}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={e.payment_status === "unpaid" ? "destructive" : "secondary"} className="text-[10px]">
                      {e.payment_status === "unpaid" ? "Unpaid" : "Paid"}
                    </Badge>
                    {e.paid_date && e.payment_status === "paid" && e.paid_date !== e.expense_date && (
                      <span className="ml-1 text-[10px] text-muted-foreground">{format(new Date(e.paid_date), "dd MMM")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.vendors?.name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.projects?.name || "—"}</TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(Number(e.amount), e.currency)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      {e.payment_status === "unpaid" && !e.deleted_at && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-primary" onClick={() => markAsPaid(e)} title="Mark as paid">
                          <CheckCircle2 className="h-3 w-3" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditing(e); setFormOpen(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggleArchive(e)}>
                        {e.deleted_at ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {formOpen && (
        <ExpenseFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          expense={editing}
          workspaceId={currentWorkspace!.id}
          currency={currency}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
