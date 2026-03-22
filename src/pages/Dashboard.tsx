import { LayoutDashboard, TrendingUp, FileText, FolderKanban, Receipt, DollarSign, Users, AlertTriangle, X } from "lucide-react";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { DashboardBreakdowns } from "@/components/dashboard/DashboardBreakdowns";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

interface DashboardMetrics {
  active_leads: number;
  open_proposals: number;
  running_projects: number;
  pending_invoices: number;
  total_receivable: number;
  total_collected: number;
  is_admin: boolean;
  error?: string;
}

function useDashboardMetrics(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard-metrics", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<DashboardMetrics> => {
      if (!workspaceId) throw new Error("No workspace");
      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      const result = data as unknown as DashboardMetrics;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });
}

const cards = [
  { key: "active_leads" as const, label: "Active Leads", icon: Users, color: "text-blue-500", href: "/leads" },
  { key: "open_proposals" as const, label: "Open Proposals", icon: FileText, color: "text-amber-500", href: "/proposals" },
  { key: "running_projects" as const, label: "Running Projects", icon: FolderKanban, color: "text-emerald-500", href: "/projects" },
  { key: "pending_invoices" as const, label: "Pending Invoices", icon: Receipt, color: "text-rose-500", href: "/invoices" },
];

const financialCards = [
  { key: "total_receivable" as const, label: "Total Receivable", icon: TrendingUp, color: "text-orange-500", href: "/invoices" },
  { key: "total_collected" as const, label: "Total Collected", icon: DollarSign, color: "text-green-500", href: "/payments" },
];

function formatCurrency(value: number, currency: string = "BDT") {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-5 rounded" />
      </div>
      <Skeleton className="mt-3 h-7 w-16" />
    </div>
  );
}

export default function Dashboard() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const { data: metrics, isLoading } = useDashboardMetrics(currentWorkspace?.id);
  const currency = currentWorkspace?.currency || "BDT";
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <PageInfoButton
          title="Dashboard"
          description="A live overview of your workspace activity — leads, proposals, projects, invoices, and revenue at a glance."
          actions={["View key metrics and pipeline breakdowns", "Click any card to jump to that section", "Use the time-range filter for trend analysis"]}
          audience="Admins and managers reviewing business health."
        />
        {currentRole && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/70">
            {currentRole === "admin" ? "Workspace Admin" : "Team Member"}
          </span>
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Your workspace at a glance. Click any card to see details.
      </p>

      {/* Count cards — clickable */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? cards.map(({ key }) => <MetricCardSkeleton key={key} />)
          : cards.map(({ key, label, icon: Icon, color, href }) => (
              <button
                key={key}
                onClick={() => navigate(href)}
                className="rounded-lg border bg-card p-5 text-left hover:border-primary/50 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</p>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <p className="mt-2 text-2xl font-semibold text-card-foreground">
                  {metrics?.[key] ?? 0}
                </p>
              </button>
            ))}
      </div>


      {/* Pipeline breakdowns */}
      {currentWorkspace?.id && (
        <DashboardBreakdowns workspaceId={currentWorkspace.id} currency={currency} />
      )}

      {/* Onboarding checklist for new admins */}
      <OnboardingChecklist />

      {/* System Alerts — contained card */}
      <SystemAlerts workspaceId={currentWorkspace?.id} />

      {currentRole === "team_member" && (
        <p className="mt-4 text-xs text-muted-foreground">
          Showing metrics scoped to your assigned projects and leads.
        </p>
      )}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800",
};

function SystemAlerts({ workspaceId }: { workspaceId: string | undefined }) {
  const queryClient = useQueryClient();
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["system-alerts", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_alerts")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .eq("is_dismissed", false)
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 60000,
    refetchInterval: 60000,
  });

  const dismiss = async (id: string) => {
    await supabase.rpc("dismiss_system_alert", { _alert_id: id });
    queryClient.invalidateQueries({ queryKey: ["system-alerts"] });
  };

  if (isLoading || alerts.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          System Alerts
          <Badge variant="secondary" className="text-xs">{alerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map((a: any) => (
          <div key={a.id} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.info}`}>
            <div className="space-y-0.5">
              <span className="font-medium">{a.title}</span>
              {a.body && <p className="text-xs opacity-80">{a.body}</p>}
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => dismiss(a.id)} aria-label={`Dismiss alert: ${a.title}`}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
