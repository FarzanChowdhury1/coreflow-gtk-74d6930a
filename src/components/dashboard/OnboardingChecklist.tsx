import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/events";
import { useState } from "react";
import {
  Building2, User, Inbox, FileText, Link2, Receipt, Users, FolderKanban, CalendarDays, Store,
  Check, ChevronDown, ChevronUp, Rocket, Database, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  path: string;
  check: (counts: Record<string, number>) => boolean;
}

const items: ChecklistItem[] = [
  {
    key: "company",
    label: "Add your first client company",
    description: "Add a client to your directory — you'll link leads, proposals, invoices, and projects to them.",
    icon: Building2,
    path: "/clients",
    check: (c) => (c.companies ?? 0) > 0,
  },
  {
    key: "contact",
    label: "Add a contact person",
    description: "Create a contact at your client company. Contacts are used for portal access and communication.",
    icon: User,
    path: "/clients",
    check: (c) => (c.contacts ?? 0) > 0,
  },
  {
    key: "lead",
    label: "Capture your first lead",
    description: "Log a new business opportunity. Track its status, follow-up dates, and estimated value.",
    icon: Inbox,
    path: "/leads",
    check: (c) => (c.leads ?? 0) > 0,
  },
  {
    key: "proposal",
    label: "Create a proposal",
    description: "Build a proposal with line items, pricing, and tax. Send it to your client for review.",
    icon: FileText,
    path: "/proposals",
    check: (c) => (c.proposals ?? 0) > 0,
  },
  {
    key: "project",
    label: "Start a project",
    description: "Create a project to track deliverables, tasks, and milestones — for clients or internal work.",
    icon: FolderKanban,
    path: "/projects",
    check: (c) => (c.projects ?? 0) > 0,
  },
  {
    key: "invoice",
    label: "Issue your first invoice",
    description: "Create an invoice for a client. CoreFlow tracks payments and outstanding balances automatically.",
    icon: Receipt,
    path: "/invoices",
    check: (c) => (c.invoices ?? 0) > 0,
  },
  {
    key: "portal",
    label: "Send a portal link",
    description: "Generate a secure link so your client can view proposals, invoices, onboarding tasks, and updates.",
    icon: Link2,
    path: "/clients",
    check: (c) => (c.portal_tokens ?? 0) > 0,
  },
  {
    key: "meeting",
    label: "Schedule a meeting",
    description: "Log a client or internal meeting with attendees, time, and location. Add minutes afterward.",
    icon: CalendarDays,
    path: "/meetings",
    check: (c) => (c.meetings ?? 0) > 0,
  },
  {
    key: "vendor",
    label: "Add a vendor (optional)",
    description: "Track vendors you pay for services. Link them to expenses and subscriptions for cost tracking.",
    icon: Store,
    path: "/vendors",
    check: (c) => (c.vendors ?? 0) > 0,
  },
  {
    key: "team",
    label: "Invite a team member",
    description: "Add a colleague so they can manage projects, leads, and client work alongside you.",
    icon: Users,
    path: "/team",
    check: (c) => (c.members ?? 0) > 1,
  },
];

export function OnboardingChecklist() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const workspaceId = currentWorkspace?.id;

  // Defer checklist counts: don't fire until 1.5s after mount so primary
  // dashboard cards (LCP) render first. Also use long staleTime to avoid refetch.
  const { data: counts, isLoading } = useQuery({
    queryKey: ["onboarding-counts", workspaceId],
    enabled: !!workspaceId && currentRole === "admin",
    queryFn: async () => {
      if (!workspaceId) return {};
      // Small delay to yield to LCP-critical queries
      await new Promise((r) => setTimeout(r, 1500));
      // Single RPC replaces 10 separate HEAD count queries
      const { data, error } = await supabase.rpc("get_onboarding_counts", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      const counts = data as Record<string, number>;
      return {
        companies: counts.companies ?? 0,
        contacts: counts.contacts ?? 0,
        leads: counts.leads ?? 0,
        proposals: counts.proposals ?? 0,
        portal_tokens: counts.portal_tokens ?? 0,
        invoices: counts.invoices ?? 0,
        members: counts.members ?? 0,
        projects: counts.projects ?? 0,
        meetings: counts.meetings ?? 0,
        vendors: counts.vendors ?? 0,
      };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Don't block LCP: return null while loading (no skeleton, no spinner)
  if (currentRole !== "admin" || isLoading || !counts) return null;

  const completed = items.filter((i) => i.check(counts as Record<string, number>)).length;
  const total = items.length;
  const progress = Math.round((completed / total) * 100);

  // Hide when all done
  if (completed === total) return null;

  return (
    <div className="mt-6 rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Get Started with CoreFlow</h2>
          <span className="text-xs text-muted-foreground">{completed}/{total} complete</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand checklist" : "Collapse checklist"}>
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>

      <Progress value={progress} className="h-2 mb-4" aria-label={`Onboarding progress: ${completed} of ${total} steps complete`} />

      {!collapsed && completed === 0 && (
        <div className="mb-4 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Want to explore with sample data?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Load realistic example data — clients, proposals, invoices, and more — so you can see how CoreFlow works before adding your own.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={seeding}
              onClick={async () => {
                if (!workspaceId) return;
                setSeeding(true);
                try {
                  const { data, error } = await supabase.functions.invoke("seed-demo-workspace", {
                    body: { workspace_id: workspaceId },
                  });
                  if (error) throw error;
                  if (data?.error) throw new Error(data.error);
                  toast({ title: "Sample data loaded", description: "Your workspace now has example data to explore." });
                  trackEvent("workspace.sample_data_loaded", workspaceId, user?.id ?? "", {});
                  queryClient.invalidateQueries();
                } catch (err: any) {
                  toast({ title: "Could not load sample data", description: err?.message || "Please try again.", variant: "destructive" });
                } finally {
                  setSeeding(false);
                }
              }}
            >
              {seeding ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Loading…</> : "Load Sample Data"}
            </Button>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="space-y-1">
          {items.map((item) => {
            const done = item.check(counts as Record<string, number>);
            return (
              <button
                key={item.key}
                onClick={() => !done && navigate(item.path)}
                disabled={done}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  done
                    ? "opacity-60"
                    : "hover:bg-muted/50 cursor-pointer"
                )}
              >
                <div className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  done
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/40"
                )}>
                  {done && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium", done ? "text-muted-foreground line-through" : "text-foreground")}>
                    {item.label}
                  </p>
                  {!done && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  )}
                </div>
                <item.icon className={cn("ml-auto h-4 w-4 shrink-0 mt-0.5", done ? "text-muted-foreground/40" : "text-muted-foreground")} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
