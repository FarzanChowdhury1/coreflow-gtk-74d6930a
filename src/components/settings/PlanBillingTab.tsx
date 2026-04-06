import { useState } from "react";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useWorkspace } from "@/contexts/WorkspaceContext";
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
    ent.plan === "growth" ? "Growth" : "Free";

  const seatPct = ent.seatLimit ? Math.min(100, Math.round((seatCount / ent.seatLimit) * 100)) : 0;

  const handleStartTrial = async () => {
    if (!currentWorkspace) return;
    setStartingTrial(true);
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { error } = await supabase
      .from("workspaces")
      .update({
        plan: "growth",
        trial_ends_at: trialEnd.toISOString(),
        seat_limit: 999,
      })
      .eq("id", currentWorkspace.id);

    setStartingTrial(false);
    if (error) {
      toast.error("Failed to start trial. Please try again.");
    } else {
      toast.success("Growth trial activated — 14 days of full access, no card required.");
      refreshWorkspaces();
    }
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
              <p className="text-sm font-medium text-foreground">Free plan — up to 3 seats</p>
              <p className="text-sm text-muted-foreground">
                Includes core CRM features: leads, proposals, projects, invoices, and payments.
                Upgrade to Growth for advanced modules like expense tracking, approvals, audit logs, and unlimited seats.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleStartTrial} disabled={startingTrial}>
                  {startingTrial ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Start 14-Day Growth Trial
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Enterprise%20Inquiry">
                    Contact Sales <ArrowUpRight className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">No credit card required. One trial per workspace.</p>
            </div>
          )}

          {ent.plan === "growth" && !ent.trialExpired && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Growth — $4.99 / seat / month</p>
              <p className="text-sm text-muted-foreground">
                All features unlocked. Unlimited seats. Priority support.
                {ent.isTrialing && ` Your trial ends in ${ent.trialDaysLeft} day${ent.trialDaysLeft !== 1 ? "s" : ""}. No card required during trial.`}
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
                Subscribe to keep Growth features active and avoid losing access to advanced modules.
              </p>
              <Button size="sm" variant="default" asChild>
                <a href="mailto:hello@coreflow.app?subject=Subscribe%20to%20Growth">
                  Subscribe Now <ArrowUpRight className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </div>
          )}

          {ent.plan === "enterprise" && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Enterprise</p>
              <p className="text-sm text-muted-foreground">
                Custom plan with unlimited seats and dedicated support. Contact your account manager for plan changes.
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
            <p><strong className="text-foreground">Per seat, per workspace.</strong> Each team member in this workspace counts as one seat.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Workspaces are billed independently.</strong> If a person belongs to two workspaces, they are counted as a seat in each.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Growth trial.</strong> 14 days, no card required. Full access to all features during the trial.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">No self-serve billing yet.</strong> To subscribe after trial or discuss Enterprise, contact us and we'll set it up.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
