import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";

/**
 * Shows a banner when the workspace is over its seat limit or trial has expired.
 */
export function EntitlementBanner() {
  const ent = useEntitlement();

  if (!ent.upgradeCta) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
      <p className="text-sm text-foreground flex-1">{ent.upgradeCta}</p>
      <a
        href="mailto:hello@coreflow.app?subject=Upgrade%20Inquiry"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline shrink-0"
      >
        Contact Sales <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  );
}
