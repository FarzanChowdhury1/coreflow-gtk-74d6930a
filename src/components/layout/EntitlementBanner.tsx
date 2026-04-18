import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";

/**
 * Banner shown when the workspace is in grace, suspended, or at the Starter seat ceiling.
 */
export function EntitlementBanner() {
  const ent = useEntitlement();

  if (!ent.upgradeCta) return null;

  const tone = ent.suspended
    ? "border-destructive/40 bg-destructive/5"
    : "border-warning/30 bg-warning/5";

  return (
    <div className={`mb-4 flex items-center gap-2 rounded-md border ${tone} px-4 py-3`}>
      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
      <p className="text-sm text-foreground flex-1">{ent.upgradeCta}</p>
      <a
        href="mailto:hello@coreflow.app?subject=Plan%20Activation"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline shrink-0"
      >
        Activate plan <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  );
}
