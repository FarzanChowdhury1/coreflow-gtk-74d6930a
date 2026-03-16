import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useState } from "react";
import {
  Building2, User, Inbox, FileText, Link2, Receipt, Users, Check, ChevronDown, ChevronUp, Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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
    label: "Add your first company",
    description: "Add a client company to your directory so you can link leads, proposals, and invoices to them.",
    icon: Building2,
    path: "/clients",
    check: (c) => (c.companies ?? 0) > 0,
  },
  {
    key: "contact",
    label: "Add your first contact",
    description: "Create a contact person at your client company. You'll use contacts for portal links and communication.",
    icon: User,
    path: "/clients",
    check: (c) => (c.contacts ?? 0) > 0,
  },
  {
    key: "lead",
    label: "Create your first lead",
    description: "Capture a new business opportunity. Track its status and follow-up dates in the Lead Inbox.",
    icon: Inbox,
    path: "/leads",
    check: (c) => (c.leads ?? 0) > 0,
  },
  {
    key: "proposal",
    label: "Create your first proposal",
    description: "Build a proposal with line items, pricing, and tax. Send it to your client for approval.",
    icon: FileText,
    path: "/proposals",
    check: (c) => (c.proposals ?? 0) > 0,
  },
  {
    key: "portal",
    label: "Send a portal link",
    description: "Generate a secure portal link so your client can view proposals, invoices, and updates online.",
    icon: Link2,
    path: "/clients",
    check: (c) => (c.portal_tokens ?? 0) > 0,
  },
  {
    key: "invoice",
    label: "Create your first invoice",
    description: "Issue an invoice to a client. CoreFlow tracks payments and calculates outstanding balances automatically.",
    icon: Receipt,
    path: "/invoices",
    check: (c) => (c.invoices ?? 0) > 0,
  },
  {
    key: "team",
    label: "Invite your first team member",
    description: "Add a colleague to your workspace so they can manage projects, leads, and more alongside you.",
    icon: Users,
    path: "/team",
    check: (c) => (c.members ?? 0) > 1,
  },
];

export function OnboardingChecklist() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const workspaceId = currentWorkspace?.id;

  const { data: counts, isLoading } = useQuery({
    queryKey: ["onboarding-counts", workspaceId],
    enabled: !!workspaceId && currentRole === "admin",
    queryFn: async () => {
      if (!workspaceId) return {};
      const [companies, contacts, leads, proposals, portal_tokens, invoices, members] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("proposals").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.rpc("count_portal_tokens", { _workspace_id: workspaceId }),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("workspace_memberships").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      ]);
      return {
        companies: companies.count ?? 0,
        contacts: contacts.count ?? 0,
        leads: leads.count ?? 0,
        proposals: proposals.count ?? 0,
        portal_tokens: (portal_tokens.data as number) ?? 0,
        invoices: invoices.count ?? 0,
        members: members.count ?? 0,
      };
    },
    staleTime: 60000,
  });

  if (currentRole !== "admin" || isLoading || !counts) return null;

  const completed = items.filter((i) => i.check(counts)).length;
  const total = items.length;
  const progress = Math.round((completed / total) * 100);

  // Hide when all done
  if (completed === total) return null;

  return (
    <div className="mt-6 rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Get Started</h2>
          <span className="text-xs text-muted-foreground">{completed}/{total} complete</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand checklist" : "Collapse checklist"}>
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>

      <Progress value={progress} className="h-2 mb-4" aria-label={`Onboarding progress: ${completed} of ${total} steps complete`} />

      {!collapsed && (
        <div className="space-y-1">
          {items.map((item) => {
            const done = item.check(counts);
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
