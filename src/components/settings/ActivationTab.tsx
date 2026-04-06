import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  CheckCircle2, Circle, Inbox, FileText, FolderKanban, Receipt, Banknote,
  RefreshCw, Link2, Store, PieChart, CreditCard, Calendar, Users, Database, Rocket,
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

const GROUP_LABELS: Record<string, string> = {
  setup: "Setup & Team",
  core: "Core Business Spine",
  finance: "Finance & Operations",
  ops: "Meetings & Portal",
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
        .select("event_name, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }) as any;
      return (data ?? []) as { event_name: string; created_at: string }[];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const eventMap = new Map<string, string>();
  (events ?? []).forEach((e) => {
    if (!eventMap.has(e.event_name)) {
      eventMap.set(e.event_name, e.created_at);
    }
  });

  const completedCount = MILESTONES.filter((m) => eventMap.has(m.event)).length;
  const totalCount = MILESTONES.length;
  const pct = Math.round((completedCount / totalCount) * 100);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Activation Progress</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const groups = ["setup", "core", "finance", "ops"] as const;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Activation Progress
          </CardTitle>
          <CardDescription>
            Track which product milestones this workspace has reached. {completedCount} of {totalCount} milestones completed ({pct}%).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-muted rounded-full h-2.5 mb-1">
            <div
              className="bg-primary h-2.5 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{completedCount}/{totalCount} milestones</p>
        </CardContent>
      </Card>

      {/* Grouped milestones */}
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
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
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

      {/* Module usage summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Milestones track the <strong className="text-foreground">first time</strong> each action happens in this workspace.
            They show adoption progress, not ongoing usage volume.
          </p>
          <p>
            Modules not yet started suggest areas where the workspace hasn't explored CoreFlow's capabilities.
            This data is only visible to workspace admins.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
