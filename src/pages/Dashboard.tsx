import { LayoutDashboard, TrendingUp, FileText, FolderKanban, Receipt, DollarSign, Users } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface DashboardMetrics {
  activeLeads: number;
  openProposals: number;
  runningProjects: number;
  pendingInvoices: number;
  totalReceivable: number;
  totalCollected: number;
}

function useDashboardMetrics(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard-metrics", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<DashboardMetrics> => {
      if (!workspaceId) throw new Error("No workspace");

      const [leadsRes, proposalsRes, projectsRes, invoicesRes] = await Promise.all([
        // Active leads: not converted/unqualified, not deleted
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .in("status", ["new", "contacted", "qualified"]),

        // Open proposals: have at least one version in draft/sent status
        supabase
          .from("proposal_versions")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("status", ["draft", "sent"]),

        // Running projects: active status, not deleted
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .eq("status", "active"),

        // Pending invoices: draft/issued/partially_paid, not deleted
        supabase
          .from("invoices")
          .select("id, grand_total, amount_paid, status")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .in("status", ["draft", "issued", "partially_paid"]),
      ]);

      // Calculate financial rollups from invoices
      const invoices = invoicesRes.data || [];
      const totalReceivable = invoices.reduce(
        (sum, inv) => sum + (Number(inv.grand_total) - Number(inv.amount_paid)),
        0
      );

      // Get total collected (paid invoices)
      const { data: paidInvoices } = await supabase
        .from("invoices")
        .select("amount_paid")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .in("status", ["paid", "partially_paid"]);

      const totalCollected = (paidInvoices || []).reduce(
        (sum, inv) => sum + Number(inv.amount_paid),
        0
      );

      return {
        activeLeads: leadsRes.count ?? 0,
        openProposals: proposalsRes.count ?? 0,
        runningProjects: projectsRes.count ?? 0,
        pendingInvoices: invoices.length,
        totalReceivable,
        totalCollected,
      };
    },
    refetchInterval: 30000, // refresh every 30s
  });
}

const cards = [
  { key: "activeLeads" as const, label: "Active Leads", icon: Users, color: "text-blue-500" },
  { key: "openProposals" as const, label: "Open Proposals", icon: FileText, color: "text-amber-500" },
  { key: "runningProjects" as const, label: "Running Projects", icon: FolderKanban, color: "text-emerald-500" },
  { key: "pendingInvoices" as const, label: "Pending Invoices", icon: Receipt, color: "text-rose-500" },
];

const financialCards = [
  { key: "totalReceivable" as const, label: "Total Receivable", icon: TrendingUp, color: "text-orange-500", isCurrency: true },
  { key: "totalCollected" as const, label: "Total Collected", icon: DollarSign, color: "text-green-500", isCurrency: true },
];

function formatCurrency(value: number, currency: string = "BDT") {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Dashboard() {
  const { currentWorkspace } = useWorkspace();
  const { data: metrics, isLoading } = useDashboardMetrics(currentWorkspace?.id);
  const currency = currentWorkspace?.currency || "BDT";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
      </div>

      {/* Count cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <p className="mt-2 text-2xl font-semibold text-card-foreground">
              {isLoading ? "—" : metrics?.[key] ?? 0}
            </p>
          </div>
        ))}
      </div>

      {/* Financial rollups */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {financialCards.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <p className="mt-2 text-2xl font-semibold text-card-foreground">
              {isLoading ? "—" : formatCurrency(metrics?.[key] ?? 0, currency)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
