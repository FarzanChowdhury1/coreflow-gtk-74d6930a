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
    ent.state === "trial" ? "Growth Trial" :
    ent.state === "grace" ? "Grace period" :
    ent.state === "suspended" ? "Suspended" :
    ent.plan === "growth" ? "Growth" :
    "Starter";

  const seatPct = ent.seatLimit ? Math.min(100, Math.round((seatCount / ent.seatLimit) * 100)) : 0;

  const trialAlreadyUsed = !!(currentWorkspace as any)?.trial_ends_at;
  const isStarterPaid = ent.state === "starter";

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
    toast.success("Growth trial activated — 28 days of full access.");
    refreshWorkspaces();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Current Plan
          </CardTitle>
          <CardDescription>Your workspace plan, seat usage, and billing state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={ent.suspended ? "destructive" : isStarterPaid ? "secondary" : "default"} className="text-sm px-3 py-1">
              {planLabel}
            </Badge>
            {ent.isTrialing && (
              <Badge variant="outline" className="gap-1 text-sm">
                <Clock className="h-3 w-3" />
                {ent.trialDaysLeft} day{ent.trialDaysLeft !== 1 ? "s" : ""} of trial left
              </Badge>
            )}
            {ent.isInGrace && (
              <Badge variant="outline" className="gap-1 text-sm border-warning/40 text-warning">
                <AlertTriangle className="h-3 w-3" />
                Grace — {ent.graceDaysLeft} day{ent.graceDaysLeft !== 1 ? "s" : ""} left
              </Badge>
            )}
          </div>

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
                Over seat limit — workspace will move to Growth on next seat change.
              </p>
            )}
            {!ent.canAddSeat && !ent.isOverSeatLimit && (
              <p className="text-sm text-warning flex items-center gap-1">
                <Info className="h-3.5 w-3.5" />
                At Starter seat limit — adding an 11th seat moves you to Growth automatically.
              </p>
            )}
          </div>

          {/* Pre-trial state (no trial used yet on this workspace) */}
          {!trialAlreadyUsed && ent.state === "starter" && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">28-day Growth trial</p>
              <p className="text-sm text-muted-foreground">
                Full access to every feature for 28 days, plus a 7-day grace window. After grace, choose Starter
                (৳999 / user / month, up to 10 seats) or Growth (৳1,999 / user / month, unlimited seats). One trial per account.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleStartTrial} disabled={startingTrial}>
                  {startingTrial ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Start 28-Day Trial
                </Button>
              </div>
            </div>
          )}

          {/* Active trial */}
          {ent.isTrialing && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Trial active — full Growth access</p>
              <p className="text-sm text-muted-foreground">
                {ent.trialDaysLeft} day{ent.trialDaysLeft !== 1 ? "s" : ""} left. Activate a paid plan any time to lock things in before grace begins.
              </p>
            </div>
          )}

          {/* Grace */}
          {ent.isInGrace && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Grace period — {ent.graceDaysLeft} day{ent.graceDaysLeft !== 1 ? "s" : ""} left</p>
              <p className="text-sm text-muted-foreground">
                Your trial ended. You have a 7-day grace window to activate or export. After it ends, access is suspended.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="sm" variant="outline" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Activate%20Starter%20Plan">
                    Activate Starter <span className="ml-auto text-xs text-muted-foreground">৳999/user</span>
                  </a>
                </Button>
                <Button size="sm" variant="default" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Activate%20Growth%20Plan">
                    Activate Growth <span className="ml-auto text-xs opacity-80">৳1,999/user</span>
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* Suspended */}
          {ent.suspended && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Workspace suspended</p>
              <p className="text-sm text-muted-foreground">
                Trial and grace window have ended. Activate a paid plan to restore access.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="sm" variant="outline" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Activate%20Starter%20Plan">
                    Activate Starter
                  </a>
                </Button>
                <Button size="sm" variant="default" asChild>
                  <a href="mailto:hello@coreflow.app?subject=Activate%20Growth%20Plan">
                    Activate Growth
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* Paid Starter / Growth */}
          {ent.state === "starter" && trialAlreadyUsed && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Starter — ৳999 / user / month</p>
              <p className="text-sm text-muted-foreground">
                All features included. Up to 10 seats per workspace. Adding an 11th seat moves you to Growth automatically.
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Active subscription
              </p>
            </div>
          )}

          {ent.state === "growth" && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Growth — ৳1,999 / user / month</p>
              <p className="text-sm text-muted-foreground">
                All features included. Unlimited seats.
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Active subscription
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
            <p><strong className="text-foreground">Per user, per workspace.</strong> Each team member counts as one seat, billed in BDT.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Same features in both plans.</strong> Starter and Growth differ only by seat capacity (10 vs unlimited).</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Annual = 11× monthly.</strong> Pay for 11 months, get 12. Effectively one month free.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Upgrades are prorated.</strong> Switching Starter → Growth mid-cycle is charged for the remaining term.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Downgrades take effect at renewal.</strong> No mid-cycle pricing reductions.</p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p><strong className="text-foreground">Manual activation.</strong> Plan activations are handled directly with our team — contact us and we'll set it up.</p>
          </div>
        </CardContent>
      </Card>
      <BillingOwnerSection />
    </div>
  );
}
