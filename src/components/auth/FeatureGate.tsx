import { ReactNode } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import type { PlanConfig } from "@/lib/entitlements";

interface FeatureGateProps {
  feature: keyof PlanConfig["features"];
  children: ReactNode;
  label?: string;
}

/**
 * Renders children only when the workspace has the required feature enabled,
 * or when a one-time offboarding export window is active (csvExport only, claiming admin only).
 */
export function FeatureGate({ feature, children, label }: FeatureGateProps) {
  const ent = useEntitlement();
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();

  // Normal entitlement pass
  if (ent.features[feature]) {
    return <>{children}</>;
  }

  // Narrow offboarding exception: csvExport only, 1-hour window, claiming admin only
  if (feature === "csvExport") {
    const ws = currentWorkspace as any;
    const claimedAt = ws?.offboarding_export_used_at;
    const claimedBy = ws?.offboarding_export_claimed_by;
    if (claimedAt && claimedBy && user?.id && claimedBy === user.id) {
      const elapsed = Date.now() - new Date(claimedAt).getTime();
      if (elapsed < 60 * 60 * 1000) {
        return <>{children}</>;
      }
    }
  }

  const featureLabel = label ?? feature.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-muted p-4">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">{featureLabel}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {ent.trialExpired
            ? "Your Growth trial has ended. Choose Starter, Growth, or Enterprise to continue. This module is included on Growth and Enterprise."
            : "This module is included on Growth and Enterprise. Starter (৳799 / user / month) covers the core spine; Growth (৳1,799 / user / month) unlocks all modules."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href="mailto:hello@coreflow.app?subject=Activate%20Growth%20Plan"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Activate Growth <ArrowUpRight className="h-3 w-3" />
        </a>
        <a
          href="mailto:hello@coreflow.app?subject=Enterprise%20Inquiry"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Talk to Sales <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}