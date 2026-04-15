/**
 * Product entitlement / plan logic.
 *
 * Defines plan shapes and provides helpers to check limits.
 * No billing integration — just product-side awareness.
 */

export type PlanId = "free" | "growth" | "enterprise";

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
    prioritySupport: boolean;
  };
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    seatLimit: 3,
    trialDays: 0,
    features: {
      approvalWorkflows: false,
      expenseTracking: false,
      vendorManagement: false,
      subscriptionTracking: false,
      budgetVsActual: false,
      profitability: false,
      auditLog: false,
      csvExport: false,
      prioritySupport: false,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    seatLimit: null,
    trialDays: 14,
    features: {
      approvalWorkflows: true,
      expenseTracking: true,
      vendorManagement: true,
      subscriptionTracking: true,
      budgetVsActual: true,
      profitability: true,
      auditLog: true,
      csvExport: true,
      prioritySupport: true,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    seatLimit: null,
    trialDays: 0,
    features: {
      approvalWorkflows: true,
      expenseTracking: true,
      vendorManagement: true,
      subscriptionTracking: true,
      budgetVsActual: true,
      profitability: true,
      auditLog: true,
      csvExport: true,
      prioritySupport: true,
    },
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
 * Derive the entitlement state for a workspace.
 */
export function resolveEntitlement(
  plan: string | undefined,
  trialEndsAt: string | null | undefined,
  seatLimit: number | undefined,
  currentSeatCount: number,
): WorkspaceEntitlement {
  const planId = (plan === "growth" || plan === "enterprise" ? plan : "free") as PlanId;
  const config = PLANS[planId];

  // Trial logic
  const now = new Date();
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const isTrialing = planId === "growth" && !!trialEnd && trialEnd > now;
  const trialExpired = planId === "growth" && !!trialEnd && trialEnd <= now;
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // When trial expired, enforce Free-plan limits and features
  const effectiveConfig = trialExpired ? PLANS.free : config;
  const effectiveSeatLimit = trialExpired
    ? PLANS.free.seatLimit
    : (seatLimit ?? config.seatLimit);

  const isOverSeatLimit = effectiveSeatLimit !== null && currentSeatCount > effectiveSeatLimit;
  const canAddSeat = effectiveSeatLimit === null || currentSeatCount < effectiveSeatLimit;

  let upgradeCta: string | null = null;
  if (planId === "free" && isOverSeatLimit) {
    upgradeCta = "You've exceeded the 3-seat free limit. Upgrade to Growth to add more team members.";
  } else if (planId === "free" && currentSeatCount >= (effectiveSeatLimit ?? 3)) {
    upgradeCta = "You're at the free plan seat limit. Upgrade to Growth for unlimited seats.";
  } else if (trialExpired) {
    upgradeCta = "Your Growth trial has ended. Subscribe to keep Growth features active.";
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
    features: config.features,
    upgradeCta,
  };
}
