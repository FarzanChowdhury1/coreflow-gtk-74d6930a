import { ReactNode } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";

interface FeatureGateProps {
  feature: string;
  children: ReactNode;
  label?: string;
}

/**
 * Starter and Growth share all features. The only state that hides modules
 * is post-grace suspension. Trial and grace remain fully accessible.
 */
export function FeatureGate({ feature, children, label }: FeatureGateProps) {
  const ent = useEntitlement();

  if (!ent.suspended) {
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
          Your trial and 7-day grace window have ended. Activate Starter (৳999 / user / month) or Growth (৳1,999 / user / month) to restore access — both plans include every module.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href="mailto:hello@coreflow.app?subject=Activate%20Starter%20Plan"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Activate Starter <ArrowUpRight className="h-3 w-3" />
        </a>
        <a
          href="mailto:hello@coreflow.app?subject=Activate%20Growth%20Plan"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Activate Growth <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
