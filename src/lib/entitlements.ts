/**
 * Product entitlement / plan logic.
 *
 * Defines plan shapes and provides helpers to check limits.
 * No billing integration — just product-side awareness.
 *
 * Plan model:
 *  - starter — paid base tier (৳799 / user / month, up to 3 seats, core spine only)
 *  - growth — paid full tier (৳1,799 / user / month, unlimited seats, all modules)
 *  - enterprise — custom commercial lane (same product surface as growth)
 *
 * Internal compat:
 *  - The string "free" is treated as a deprecated alias for "starter" so existing
 *    workspaces.plan = 'free' rows continue to work without a migration. No
 *    user-facing surface should render "Free" any more.
 *  - Every workspace begins on a 14-day Growth trial via trial_ends_at.
 */

export type PlanId = "starter" | "growth" | "enterprise";

export interface PlanConfig {
  id: PlanId;
  name: string;
  seatLimit: number | null; // null = unlimited
  trialDays: number;
  features: {
    approvalWorkflows: boolean;
    expenseTracking: boolean;
    vendorManagement: boolean;
    subscriptionTracking: boolean;
    budgetVsActual: boolean;
    profitability: boolean;
    auditLog: boolean;
    csvExport: boolean;
  };
}

const STARTER_FEATURES: PlanConfig["features"] = {
  approvalWorkflows: false,
  expenseTracking: false,
  vendorManagement: false,
  subscriptionTracking: false,
  budgetVsActual: false,
  profitability: false,
  auditLog: false,
  csvExport: false,
};

const GROWTH_FEATURES: PlanConfig["features"] = {
  approvalWorkflows: true,
  expenseTracking: true,
  vendorManagement: true,
  subscriptionTracking: true,
  budgetVsActual: true,
  profitability: true,
  auditLog: true,
  csvExport: true,
};

export const PLANS: Record<PlanId, PlanConfig> = {
  starter: {
    id: "starter",
    name: "Starter",
    seatLimit: 3,
    trialDays: 0,
    features: STARTER_FEATURES,
  },
  growth: {
    id: "growth",
    name: "Growth",
    seatLimit: null,
    trialDays: 14,
    features: GROWTH_FEATURES,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    seatLimit: null,
    trialDays: 0,
    features: GROWTH_FEATURES,
  },
};

export interface WorkspaceEntitlement {
  plan: PlanId;
  seatLimit: number | null;
  seatCount: number;
  isOverSeatLimit: boolean;
  isTrialing: boolean;
  trialDaysLeft: number;
  trialExpired: boolean;
  canAddSeat: boolean;
  features: PlanConfig["features"];
  upgradeCta: string | null;
}

/**
 * Normalize a stored plan string into a real PlanId.
 * Accepts the deprecated "free" alias and maps it to "starter".
 */
function normalizePlan(plan: string | undefined): PlanId {
  if (plan === "growth" || plan === "enterprise") return plan;
  // "free" (legacy) and anything unknown collapse to starter (the paid base tier).
  return "starter";
}

/**
 * Derive the entitlement state for a workspace.
 */
export function resolveEntitlement(
  plan: string | undefined,
  trialEndsAt: string | null | undefined,
  seatLimit: number | undefined,
  currentSeatCount: number,
): WorkspaceEntitlement {
  const planId = normalizePlan(plan);
  const config = PLANS[planId];

  // Trial logic — only meaningful while the workspace is still on the base/starter
  // tier OR explicitly on growth. Enterprise is treated as already-active.
  const now = new Date();
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const trialingPlan = planId === "growth" || planId === "starter";
  const isTrialing = trialingPlan && !!trialEnd && trialEnd > now;
  const trialExpired = trialingPlan && !!trialEnd && trialEnd <= now;
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // While trialing, every workspace gets the full Growth feature set regardless
  // of its stored plan. After trial ends, fall back to the workspace's actual
  // plan config (starter / growth / enterprise).
  const effectiveConfig = isTrialing ? PLANS.growth : config;
  const effectiveSeatLimit = isTrialing
    ? PLANS.growth.seatLimit
    : (seatLimit ?? config.seatLimit);

  const isOverSeatLimit = effectiveSeatLimit !== null && currentSeatCount > effectiveSeatLimit;
  const canAddSeat = effectiveSeatLimit === null || currentSeatCount < effectiveSeatLimit;

  let upgradeCta: string | null = null;
  if (trialExpired) {
    upgradeCta = "Your Growth trial has ended. Choose Starter, Growth, or Enterprise to continue.";
  } else if (planId === "starter" && isOverSeatLimit) {
    upgradeCta = "You've exceeded the 3-seat Starter limit. Upgrade to Growth for unlimited seats.";
  } else if (planId === "starter" && !canAddSeat) {
    upgradeCta = "You're at the Starter seat limit. Upgrade to Growth for unlimited seats.";
  }

  return {
    plan: planId,
    seatLimit: effectiveSeatLimit,
    seatCount: currentSeatCount,
    isOverSeatLimit,
    isTrialing,
    trialDaysLeft,
    trialExpired,
    canAddSeat,
    features: effectiveConfig.features,
    upgradeCta,
  };
}
