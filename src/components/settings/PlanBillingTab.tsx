import { useState } from "react";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { BillingOwnerSection } from "@/components/settings/BillingOwnerSection";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Crown, Info, Loader2, Rocket, Users,
} from "lucide-react";

export function PlanBillingTab() {
  const ent = useEntitlement();
  const { memberships, currentWorkspace, refreshWorkspaces } = useWorkspace();
  const seatCount = memberships.filter((m) => m.workspace_id === currentWorkspace?.id).length;
  const [startingTrial, setStartingTrial] = useState(false);

  const planLabel =
    ent.plan === "enterprise" ? "Enterprise" :
    ent.plan === "growth" ? "Growth" : "Starter";

  const seatPct = ent.seatLimit ? Math.min(100, Math.round((seatCount / ent.seatLimit) * 100)) : 0;

  const trialAlreadyUsed = !!(currentWorkspace as any)?.trial_ends_at;

  const handleStartTrial = async () => {
    if (!currentWorkspace) return;
    setStartingTrial(true);

    const { data, error } = await supabase.rpc("start_growth_trial", {
      _workspace_id: currentWorkspace.id,
    });

    setStartingTrial(false);

    if (error) {
      toast.error("Failed to start trial. Please try again.");
      return;
    }

    const result = data as Record<string, unknown> | null;
    if (result?.error) {
      toast.error(String(result.error));
      return;
    }

    toast.success("Growth trial activated — 14 days of full access, no card required.");
    refreshWorkspaces();
  };

  return (
    <div className="space-y-6">
      {/* Plan overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Current Plan
          </CardTitle>
          <CardDescription>Your workspace plan, seat usage, and trial status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={ent.plan === "free" ? "secondary" : "default"} className="text-sm px-3 py-1">
              {planLabel}
            </Badge>
            {ent.isTrialing && (
              <Badge variant="outline" className="gap-1 text-sm">
                <Clock className="h-3 w-3" />
                Trial — {ent.trialDaysLeft} day{ent.trialDaysLeft !== 1 ? "s" : ""} left
              </Badge>
            )}
            {ent.trialExpired && (
              <Badge variant="destructive" className="gap-1 text-sm">
                <AlertTriangle className="h-3 w-3" />
                Trial expired
              </Badge>
            )}
          </div>

          {/* Seat usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" /> Seats used
              </span>
              <span className="font-medium text-foreground">
                {seatCount}{ent.seatLimit && ent.seatLimit < 900 ? ` / ${ent.seatLimit}` : " (unlimited)"}
              </span>
            </div>
            {ent.seatLimit && ent.seatLimit < 900 && (
              <Progress value={seatPct} className="h-2" />
            )}
            {ent.isOverSeatLimit && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Over seat limit — new invites are blocked until you upgrade.
              </p>
            )}
            {!ent.canAddSeat && !ent.isOverSeatLimit && (
              <p className="text-sm text-warning flex items-center gap-1">
                <Info className="h-3.5 w-3.5" />
                At seat limit — upgrade to add more team members.
              </p>
            )}
          </div>

          {/* Plan-specific messaging */}
          {ent.plan === "free" && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Starter — ৳799 / user / month (free up to 3 seats)</p>
              <p className="text-sm text-muted-foreground">
                Includes core CRM features: leads, proposals, projects, invoices, and payments.
                Move to Growth (৳1,799 / user / month) for advanced modules like expense tracking, approvals, audit logs, and unlimited seats.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleStartTrial} disabled={startingTrial || trialAlreadyUsed}>
                  {startingTrial ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Start 14-Day Growth Trial
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Enterprise%20Inquiry">
                    Talk to Sales <ArrowUpRight className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">No payment details required during trial. One trial per workspace.</p>
            </div>
          )}

          {ent.plan === "growth" && !ent.trialExpired && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Growth — ৳1,799 / user / month</p>
              <p className="text-sm text-muted-foreground">
                All features unlocked. Unlimited seats. Priority support.
                {ent.isTrialing && ` Your trial ends in ${ent.trialDaysLeft} day${ent.trialDaysLeft !== 1 ? "s" : ""}. No payment details required during trial.`}
              </p>
              {!ent.isTrialing && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Active subscription
                </p>
              )}
            </div>
          )}

          {ent.trialExpired && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Growth trial has ended</p>
              <p className="text-sm text-muted-foreground">
                Contact us to activate Growth (৳1,799 / user / month) and keep advanced modules available to your team.
              </p>
              <Button size="sm" variant="default" asChild>
                <a href="mailto:hello@coreflow.app?subject=Activate%20Growth%20Plan">
                  Contact Us to Activate <ArrowUpRight className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </div>
          )}

          {ent.plan === "enterprise" && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Enterprise</p>
              <p className="text-sm text-muted-foreground">
                Custom plan for larger Bangladeshi organisations. Contact your account manager for any plan changes or commercial discussions.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How billing works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Per user, per workspace.</strong> Each team member in this workspace counts as one seat, billed in BDT.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Workspaces are billed independently.</strong> If a person belongs to two workspaces, they are counted as a seat in each.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Growth trial.</strong> 14 days, no payment details required. Full access to all features during the trial.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Manual billing.</strong> Activations and Enterprise plans are handled directly with our team — contact us and we'll set it up.</p>
          </div>
        </CardContent>
      </Card>
      {/* Billing owner */}
      <BillingOwnerSection />
    </div>
  );
}
