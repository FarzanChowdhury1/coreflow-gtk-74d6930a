import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";


interface ProjectProfit {
  id: string;
  name: string;
  company: string;
  status: string;
  revenue: number;
  expenses: number;
  margin: number;
  marginPct: number | null;
}

export function ProjectProfitability() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["profitability-projects", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, status, company_id, companies(legal_name)")
        .eq("workspace_id", wsId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });

  // Get all payments for project-linked invoices (revenue)
  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["profitability-invoices", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("id, project_id, amount_paid")
        .eq("workspace_id", wsId)
        .is("deleted_at", null)
        .not("project_id", "is", null)
        .neq("status", "void");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });

  // Get all project-linked expenses
  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ["profitability-expenses", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data, error } = await supabase
        .from("expenses")
        .select("id, project_id, amount")
        .eq("workspace_id", wsId)
        .is("deleted_at", null)
        .not("project_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });

  const isLoading = loadingProjects || loadingInv || loadingExp;

  // Build profitability per project
  const profitData: ProjectProfit[] = projects.map((p: any) => {
    const rev = invoices
      .filter((i) => i.project_id === p.id)
      .reduce((s, i) => s + Number(i.amount_paid), 0);
    const exp = expenses
      .filter((e) => e.project_id === p.id)
      .reduce((s, e) => s + Number(e.amount), 0);
    const margin = rev - exp;
    const marginPct = rev > 0 ? (margin / rev) * 100 : null;

    return {
      id: p.id,
      name: p.name,
      company: (p.companies as any)?.legal_name || "Internal",
      status: p.status,
      revenue: rev,
      expenses: exp,
      margin,
      marginPct,
    };
  });

  // Only show projects that have at least some financial activity
  const active = profitData.filter((p) => p.revenue > 0 || p.expenses > 0);
  const totals = active.reduce(
    (acc, p) => ({ rev: acc.rev + p.revenue, exp: acc.exp + p.expenses }),
    { rev: 0, exp: 0 }
  );
  const totalMargin = totals.rev - totals.exp;
  const totalPct = totals.rev > 0 ? (totalMargin / totals.rev) * 100 : null;

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading profitability data…</div>;
  }

  if (active.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            No project financial data yet. Link invoices and expenses to projects to see profitability.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Revenue (Collected)</p>
            <p className="text-lg font-semibold text-foreground">৳{totals.rev.toLocaleString("en-BD")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Direct Expenses</p>
            <p className="text-lg font-semibold text-foreground">৳{totals.exp.toLocaleString("en-BD")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Net Margin</p>
            <p className={`text-lg font-semibold ${totalMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              ৳{totalMargin.toLocaleString("en-BD")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Margin %</p>
            <p className={`text-lg font-semibold ${(totalPct ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {totalPct !== null ? `${totalPct.toFixed(1)}%` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Revenue = collected payments on project-linked invoices. Expenses = direct project-linked expenses only. 
        Shared costs (subscriptions, unlinked expenses) are excluded.
      </p>

      {/* Per-project table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Per-Project Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active
                  .sort((a, b) => b.margin - a.margin)
                  .map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                      <TableCell className="text-sm">{p.company}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{p.status.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">৳{p.revenue.toLocaleString("en-BD")}</TableCell>
                      <TableCell className="text-right text-sm">৳{p.expenses.toLocaleString("en-BD")}</TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-medium ${p.margin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {p.margin >= 0 ? "" : "-"}৳{Math.abs(p.margin).toLocaleString("en-BD")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.marginPct !== null ? (
                            <>
                              {p.marginPct >= 20 ? <TrendingUp className="h-3.5 w-3.5 text-green-500" /> :
                               p.marginPct >= 0 ? <Minus className="h-3.5 w-3.5 text-yellow-500" /> :
                               <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                              <span className="text-sm">{p.marginPct.toFixed(1)}%</span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
