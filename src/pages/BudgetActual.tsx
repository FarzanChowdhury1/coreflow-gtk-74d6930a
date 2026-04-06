import { useState, useMemo, useEffect } from "react";
import { PieChart, Plus, Pencil, Trash2, Download, AlertTriangle } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx-export";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { trackFirstEvent } from "@/lib/events";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns";
import { EXPENSE_CATEGORIES } from "@/pages/Expenses";

interface Budget {
  id: string;
  category: string;
  period_start: string;
  period_end: string;
  target_amount: number;
  currency: string;
  notes: string | null;
}

interface ExpenseRow {
  category: string | null;
  amount: number;
  expense_date: string;
}

type PeriodType = "month" | "quarter" | "year";

const budgetExportCols = [
  { key: "category", label: "Category" },
  { key: "target", label: "Budget" },
  { key: "actual", label: "Actual" },
  { key: "pct", label: "% Used" },
];

function getPeriodDates(type: PeriodType, refDate: Date) {
  switch (type) {
    case "month": return { start: startOfMonth(refDate), end: endOfMonth(refDate) };
    case "quarter": return { start: startOfQuarter(refDate), end: endOfQuarter(refDate) };
    case "year": return { start: startOfYear(refDate), end: endOfYear(refDate) };
  }
}

function formatCurrency(value: number, currency: string = "BDT") {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function BudgetActual() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = currentRole === "admin";
  const currency = currentWorkspace?.currency || "BDT";
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const { start, end } = getPeriodDates(periodType, new Date());
  const periodStartStr = format(start, "yyyy-MM-dd");
  const periodEndStr = format(end, "yyyy-MM-dd");

  const { data: budgets = [], isError: budgetError } = useQuery({
    queryKey: ["budgets", currentWorkspace?.id, periodStartStr],
    enabled: !!currentWorkspace?.id && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("*")
        .eq("workspace_id", currentWorkspace!.id)
        .eq("period_start", periodStartStr);
      if (error) throw error;
      return data as Budget[];
    },
  });

  const { data: expenses = [], isError: expenseError } = useQuery({
    queryKey: ["expenses-rollup", currentWorkspace?.id, periodStartStr, periodEndStr],
    enabled: !!currentWorkspace?.id && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("category, amount, expense_date")
        .eq("workspace_id", currentWorkspace!.id)
        .is("deleted_at", null)
        .gte("expense_date", periodStartStr)
        .lte("expense_date", periodEndStr);
      if (error) throw error;
      return data as ExpenseRow[];
    },
  });

  const actualByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      const cat = e.category || "general";
      map[cat] = (map[cat] || 0) + Number(e.amount);
    });
    return map;
  }, [expenses]);

  const totalActual = Object.values(actualByCategory).reduce((s, v) => s + v, 0);
  const totalBudget = budgets.reduce((s, b) => s + Number(b.target_amount), 0);

  const allCategories = useMemo(() => {
    const cats = new Set([...budgets.map((b) => b.category), ...Object.keys(actualByCategory)]);
    return Array.from(cats).sort();
  }, [budgets, actualByCategory]);

  const rows = allCategories.map((cat) => {
    const budget = budgets.find((b) => b.category === cat);
    const actual = actualByCategory[cat] || 0;
    const target = budget ? Number(budget.target_amount) : 0;
    const pct = target > 0 ? Math.min(100, (actual / target) * 100) : actual > 0 ? 100 : 0;
    return { category: cat, actual, target, pct, budgetId: budget?.id };
  });

  const deleteBudget = async (id: string) => {
    const { error } = await supabase.from("budgets").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Budget target removed");
    queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  if (!isAdmin) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3">
          <PieChart className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Budget vs Actual</h1>
        </div>
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Budget tracking is available to workspace admins only.</CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <PieChart className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Budget vs Actual</h1>
        <PageInfoButton
          title="Budget vs Actual"
          description="Compare planned budgets against real expenses by category and period. Set targets per category, then track actual spend against them."
          actions={["Set budget targets by category", "Compare actual spend vs budget", "Switch between monthly, quarterly, and yearly views"]}
          audience="Admins tracking financial performance."
        />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Compare planned spend against real expenses for the current period.</p>

      {(budgetError || expenseError) && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load budget data. Try refreshing the page.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="quarter">This Quarter</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{format(start, "dd MMM yyyy")} – {format(end, "dd MMM yyyy")}</span>
        <Button size="sm" onClick={() => { setEditingBudget(null); setFormOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Set Budget Target
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToCSV(rows, budgetExportCols, "budget-vs-actual")} disabled={rows.length === 0}>
          <Download className="mr-1 h-4 w-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToXLSX(rows, budgetExportCols, "budget-vs-actual")} disabled={rows.length === 0}>
          <Download className="mr-1 h-4 w-4" /> XLSX
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Budget</p>
            <p className="text-xl font-semibold text-card-foreground">{formatCurrency(totalBudget, currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Actual Spend</p>
            <p className="text-xl font-semibold text-card-foreground">{formatCurrency(totalActual, currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className={`text-xl font-semibold ${totalBudget - totalActual < 0 ? "text-destructive" : "text-primary"}`}>
              {formatCurrency(totalBudget - totalActual, currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <PieChart className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">No budget data yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Budget vs Actual helps you compare planned spending against what has actually been spent. Set a budget and start recording expenses to see how your business is performing.
          </p>
          <Button size="sm" onClick={() => { setEditingBudget(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Set First Budget
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.category}>
                  <TableCell className="font-medium capitalize">{r.category.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{r.target > 0 ? formatCurrency(r.target, currency) : <span className="text-muted-foreground text-xs">No target</span>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap font-medium">{formatCurrency(r.actual, currency)}</TableCell>
                  <TableCell className="w-40">
                    <div className="flex items-center gap-2">
                      <Progress value={r.pct} className="h-2 flex-1" />
                      <span className={`text-xs font-medium ${r.pct > 100 ? "text-destructive" : "text-muted-foreground"}`}>{Math.round(r.pct)}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.budgetId && (
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditingBudget(budgets.find((b) => b.id === r.budgetId) || null); setFormOpen(true); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => deleteBudget(r.budgetId!)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {formOpen && (
        <BudgetFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          budget={editingBudget}
          workspaceId={currentWorkspace!.id}
          currency={currency}
          periodStart={periodStartStr}
          periodEnd={periodEndStr}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["budgets"] }); setFormOpen(false); setEditingBudget(null); }}
        />
      )}
    </div>
  );
}

function BudgetFormDialog({ open, onOpenChange, budget, workspaceId, currency, periodStart, periodEnd, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; budget: Budget | null; workspaceId: string; currency: string; periodStart: string; periodEnd: string; onSaved: () => void;
}) {
  const { user } = useAuth();
  const [category, setCategory] = useState("general");
  const [targetAmount, setTargetAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory(budget?.category || "general");
      setTargetAmount(budget?.target_amount?.toString() || "");
      setNotes(budget?.notes || "");
      setSaving(false);
    }
  }, [open, budget]);

  const handleSubmit = async () => {
    if (!targetAmount || Number(targetAmount) <= 0) { toast.error("Valid target amount required"); return; }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      category,
      period_start: periodStart,
      period_end: periodEnd,
      target_amount: Number(targetAmount),
      currency,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = budget
      ? await supabase.from("budgets").update(payload).eq("id", budget.id)
      : await supabase.from("budgets").insert(payload);
    setSaving(false);
    if (error) {
      if (error.message?.includes("duplicate")) toast.error("Budget target for this category already exists in this period");
      else toast.error("Failed to save budget");
      return;
    }
    toast.success(budget ? "Budget updated" : "Budget target set");
    if (!budget && workspaceId && user?.id) {
      trackFirstEvent("budget.first_created", workspaceId, user.id);
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{budget ? "Edit Budget Target" : "Set Budget Target"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={!!budget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Target Amount ({currency})</Label><Input type="number" min="0" step="1" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} /></div>
          <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Period: {periodStart} to {periodEnd}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
