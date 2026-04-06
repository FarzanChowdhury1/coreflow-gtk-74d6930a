import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2, Circle, Inbox, FileText, FolderKanban, Receipt, Banknote,
  RefreshCw, Link2, Store, PieChart, CreditCard, Calendar, Users, Database,
  Rocket, Activity, AlertTriangle,
} from "lucide-react";

interface MilestoneItem {
  event: string;
  label: string;
  icon: React.ElementType;
  group: "setup" | "core" | "finance" | "ops";
}

const MILESTONES: MilestoneItem[] = [
  { event: "workspace.sample_data_loaded", label: "Sample data loaded", icon: Database, group: "setup" },
  { event: "invite.sent", label: "Team invite sent", icon: Users, group: "setup" },
  { event: "invite.accepted", label: "Team invite accepted", icon: Users, group: "setup" },
  { event: "lead.first_created", label: "First lead created", icon: Inbox, group: "core" },
  { event: "proposal.first_created", label: "First proposal created", icon: FileText, group: "core" },
  { event: "project.first_created", label: "First project created", icon: FolderKanban, group: "core" },
  { event: "invoice.first_issued", label: "First invoice issued", icon: Receipt, group: "core" },
  { event: "payment.first_recorded", label: "First payment recorded", icon: Banknote, group: "core" },
  { event: "renewal.first_created", label: "First renewal created", icon: RefreshCw, group: "finance" },
  { event: "vendor.first_created", label: "First vendor added", icon: Store, group: "finance" },
  { event: "expense.first_created", label: "First expense recorded", icon: PieChart, group: "finance" },
  { event: "subscription.first_created", label: "First subscription tracked", icon: CreditCard, group: "finance" },
  { event: "budget.first_created", label: "First budget set", icon: PieChart, group: "finance" },
  { event: "meeting.first_created", label: "First meeting logged", icon: Calendar, group: "ops" },
  { event: "portal.first_token_created", label: "First portal link sent", icon: Link2, group: "ops" },
];

const EVENT_LABELS: Record<string, string> = {
  "workspace.sample_data_loaded": "Sample data loaded",
  "workspace.created": "Workspace created",
  "invite.sent": "Team invite sent",
  "invite.accepted": "Invite accepted",
  "lead.first_created": "First lead created",
  "proposal.first_created": "First proposal created",
  "project.first_created": "First project created",
  "invoice.first_issued": "First invoice issued",
  "payment.first_recorded": "First payment recorded",
  "renewal.first_created": "First renewal created",
  "vendor.first_created": "First vendor added",
  "expense.first_created": "First expense recorded",
  "subscription.first_created": "First subscription tracked",
  "budget.first_created": "First budget set",
  "meeting.first_created": "First meeting logged",
  "portal.first_token_created": "First portal link sent",
};

const GROUP_LABELS: Record<string, string> = {
  setup: "Setup & Team",
  core: "Core Business Spine",
  finance: "Finance & Operations",
  ops: "Meetings & Portal",
};

const MODULE_NAMES: Record<string, string> = {
  "lead.first_created": "Leads",
  "proposal.first_created": "Proposals",
  "project.first_created": "Projects",
  "invoice.first_issued": "Invoices",
  "payment.first_recorded": "Payments",
  "renewal.first_created": "Renewals",
  "vendor.first_created": "Vendors",
  "expense.first_created": "Expenses",
  "subscription.first_created": "Subscriptions",
  "budget.first_created": "Budget",
  "meeting.first_created": "Meetings",
  "portal.first_token_created": "Client Portal",
};

export function ActivationTab() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const { data: events, isLoading } = useQuery({
    queryKey: ["activation-events", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase
        .from("product_events")
        .select("event_name, created_at, user_id")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200) as any;
      return (data ?? []) as { event_name: string; created_at: string; user_id: string }[];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  // First-occurrence map (ascending)
  const eventMap = new Map<string, string>();
  const allEvents = events ?? [];
  const ascending = [...allEvents].reverse();
  ascending.forEach((e) => {
    if (!eventMap.has(e.event_name)) {
      eventMap.set(e.event_name, e.created_at);
    }
  });

  const completedCount = MILESTONES.filter((m) => eventMap.has(m.event)).length;
  const totalCount = MILESTONES.length;
  const pct = Math.round((completedCount / totalCount) * 100);

  // Recent activity: latest 10 events
  const recentEvents = allEvents.slice(0, 10);

  // Module usage: used vs untouched
  const moduleEntries = Object.entries(MODULE_NAMES);
  const usedModules = moduleEntries.filter(([ev]) => eventMap.has(ev)).map(([, name]) => name);
  const untouchedModules = moduleEntries.filter(([ev]) => !eventMap.has(ev)).map(([, name]) => name);

  // Stalled signal: most recent event timestamp
  const lastActivityDate = allEvents.length > 0 ? new Date(allEvents[0].created_at) : null;
  const daysSinceActivity = lastActivityDate
    ? Math.floor((Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStalled = daysSinceActivity !== null && daysSinceActivity >= 7;

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Activation & Usage</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const groups = ["setup", "core", "finance", "ops"] as const;

  return (
    <div className="space-y-6">
      {/* Stalled warning */}
      {isStalled && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm text-foreground">
            No product activity in the last {daysSinceActivity} days.
            {lastActivityDate && ` Last activity: ${format(lastActivityDate, "dd MMM yyyy")}.`}
          </p>
        </div>
      )}

      {/* Activation progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Product Adoption
          </CardTitle>
          <CardDescription>
            First-use milestones for this workspace — {completedCount} of {totalCount} reached ({pct}%).
            These track adoption, not ongoing usage volume.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-muted rounded-full h-2.5 mb-1">
            <div className="bg-primary h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{completedCount}/{totalCount} milestones</p>
        </CardContent>
      </Card>

      {/* Module usage summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Module Usage</CardTitle>
          <CardDescription>Which product modules have been used at least once.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {usedModules.map((name) => (
              <Badge key={name} variant="default" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" /> {name}
              </Badge>
            ))}
            {untouchedModules.map((name) => (
              <Badge key={name} variant="secondary" className="text-xs gap-1 text-muted-foreground">
                <Circle className="h-3 w-3" /> {name}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {usedModules.length} of {moduleEntries.length} modules activated.
            {untouchedModules.length > 0 && ` Untouched: ${untouchedModules.join(", ")}.`}
          </p>
        </CardContent>
      </Card>

      {/* Recent activity feed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Recent Activity
          </CardTitle>
          <CardDescription>Latest product events in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {recentEvents.map((ev, i) => (
                <div key={`${ev.event_name}-${i}`} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <span className="text-sm text-foreground">
                    {EVENT_LABELS[ev.event_name] || ev.event_name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3">
                    {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grouped milestone detail */}
      {groups.map((group) => {
        const items = MILESTONES.filter((m) => m.group === group);
        const done = items.filter((m) => eventMap.has(m.event)).length;
        return (
          <Card key={group}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                {GROUP_LABELS[group]}
                <Badge variant={done === items.length ? "default" : "secondary"} className="text-xs">
                  {done}/{items.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {items.map((m) => {
                  const achieved = eventMap.get(m.event);
                  const Icon = m.icon;
                  return (
                    <div key={m.event} className="flex items-center gap-3 py-1">
                      {achieved ? (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      )}
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className={`text-sm flex-1 ${achieved ? "text-foreground" : "text-muted-foreground"}`}>
                        {m.label}
                      </span>
                      {achieved && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(achieved), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
