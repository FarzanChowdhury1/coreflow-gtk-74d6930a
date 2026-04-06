import { LayoutDashboard, Users, FileText, FolderKanban, Receipt, AlertTriangle, X, ArrowRight, CreditCard, RefreshCw, Inbox } from "lucide-react";

import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { DashboardBreakdowns } from "@/components/dashboard/DashboardBreakdowns";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
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
    staleTime: 30_000,
    refetchOnMount: false,
    refetchInterval: 120_000,
  });
}

const cards = [
  { key: "active_leads" as const, label: "Active Leads", icon: Users, color: "text-primary", href: "/leads" },
  { key: "open_proposals" as const, label: "Open Proposals", icon: FileText, color: "text-warning", href: "/proposals" },
  { key: "running_projects" as const, label: "Running Projects", icon: FolderKanban, color: "text-success", href: "/projects" },
  { key: "pending_invoices" as const, label: "Pending Invoices", icon: Receipt, color: "text-destructive", href: "/invoices" },
];

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
  const { user } = useAuth();
  const { data: metrics, isLoading, isError: metricsError } = useDashboardMetrics(currentWorkspace?.id);
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
      {metricsError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load dashboard metrics. Try refreshing the page.</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? cards.map(({ key }) => <MetricCardSkeleton key={key} />)
          : cards.map(({ key, label, icon: Icon, color, href }) => (
              <button
                key={key}
                onClick={() => navigate(href)}
                className="rounded-lg border bg-card p-5 text-left hover:border-primary/50 hover:shadow-sm transition-all group overflow-hidden min-w-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors truncate">{label}</p>
                  <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                </div>
                <p className="mt-2 text-2xl font-semibold text-card-foreground tabular-nums truncate">
                  {metrics?.[key] ?? 0}
                </p>
              </button>
            ))}
      </div>

      {/* Pipeline breakdowns + Current Month Financial Snapshot */}
      {currentWorkspace?.id && (
        <DashboardBreakdowns workspaceId={currentWorkspace.id} currency={currency} />
      )}

      {/* Onboarding checklist for new admins */}
      <OnboardingChecklist userId={user?.id} />

      {/* Workflow spine — lightweight explainer */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">How CoreFlow works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {[
              { icon: Inbox, label: "Lead" },
              { icon: FileText, label: "Proposal" },
              { icon: FolderKanban, label: "Project" },
              { icon: Receipt, label: "Invoice" },
              { icon: CreditCard, label: "Payment" },
              { icon: RefreshCw, label: "Renewal" },
            ].map((step, i, arr) => (
              <span key={step.label} className="flex items-center gap-1">
                <step.icon className="h-3.5 w-3.5 text-primary/70" />
                <span className="font-medium text-foreground/80">{step.label}</span>
                {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 mx-0.5" />}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Capture a lead, send a proposal, deliver the project, invoice the client, record payment, and set up renewals for repeat billing.
          </p>
        </CardContent>
      </Card>

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
  warning: "bg-warning/10 text-warning border-warning/30",
  info: "bg-primary/5 text-primary border-primary/20",
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
    staleTime: 60_000,
    refetchOnMount: false,
    refetchInterval: 60_000,
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
          <AlertTriangle className="h-4 w-4 text-warning" />
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
