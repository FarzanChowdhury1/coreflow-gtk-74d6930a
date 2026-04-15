import { ReactNode } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";
import type { PlanConfig } from "@/lib/entitlements";

interface FeatureGateProps {
  feature: keyof PlanConfig["features"];
  children: ReactNode;
  label?: string;
}

/**
 * Renders children only when the workspace has the required feature enabled.
 * Otherwise shows an upgrade prompt.
 */
export function FeatureGate({ feature, children, label }: FeatureGateProps) {
  const ent = useEntitlement();

  if (ent.features[feature]) {
    return <>{children}</>;
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
