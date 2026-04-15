import { ReactNode } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { PlanConfig } from "@/lib/entitlements";

interface FeatureGateProps {
  feature: keyof PlanConfig["features"];
  children: ReactNode;
  label?: string;
}

/**
 * Renders children only when the workspace has the required feature enabled,
 * or when a one-time offboarding export window is active (csvExport only).
 */
export function FeatureGate({ feature, children, label }: FeatureGateProps) {
  const ent = useEntitlement();
  const { currentWorkspace } = useWorkspace();

  // Normal entitlement pass
  if (ent.features[feature]) {
    return <>{children}</>;
  }

  // Narrow offboarding exception: csvExport only, 1-hour window
  if (feature === "csvExport") {
    const ws = currentWorkspace as any;
    const claimedAt = ws?.offboarding_export_used_at;
    if (claimedAt) {
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
            ? "Your Growth trial has ended. Subscribe to Growth to continue using this feature."
            : "This feature is available on the Growth plan. Upgrade to unlock it."}
        </p>
      </div>
      <a
        href="mailto:hello@coreflow.app?subject=Upgrade%20Inquiry"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Contact Sales <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  );
}
