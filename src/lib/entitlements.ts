/**
 * Product entitlement / plan logic.
 *
 * Commercial model (current):
 *  - Starter — ৳999 / user / month, up to 10 seats, ALL features
 *  - Growth  — ৳1,999 / user / month, unlimited seats, ALL features
 *  - No Enterprise tier in active product
 *  - Annual = 11× monthly (1 month free)
 *  - Every eligible new workspace starts on a 28-day full Growth trial
 *  - Then a 7-day INTERNAL grace window
 *  - After grace, access is suspended until paid activation
 *  - Same account cannot trial again, even via a new workspace (enforced in DB)
 *
 * Legacy compat (DB-only, never user-facing):
 *  - 'free' rows were migrated to 'starter'
 *  - 'enterprise' rows were migrated to 'growth'
 *  - The string "enterprise" is still accepted here as a safety alias mapping to growth.
 */

export type PlanId = "starter" | "growth";
export type BillingState = "trial" | "grace" | "starter" | "growth" | "suspended";

export interface PlanConfig {
  id: PlanId;
  name: string;
  monthlyPrice: number;   // BDT per user per month
  annualPrice: number;    // BDT per user per year (11× monthly)
  seatLimit: number | null;
  features: Record<string, boolean>;
}

// Feature parity: both plans get all features. Kept as an object so the
// `feature="..."` API on FeatureGate stays type-compatible during the
// transition. Suspended state is enforced server-side via RLS.
const ALL_FEATURES: Record<string, boolean> = {
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
    monthlyPrice: 999,
    annualPrice: 999 * 11,
    seatLimit: 10,
    features: ALL_FEATURES,
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyPrice: 1999,
    annualPrice: 1999 * 11,
    seatLimit: null,
    features: ALL_FEATURES,
  },
};

export interface WorkspaceEntitlement {
  plan: PlanId;
  state: BillingState;
  seatLimit: number | null;
  seatCount: number;
  isOverSeatLimit: boolean;
  isTrialing: boolean;
  isInGrace: boolean;
  trialDaysLeft: number;
  graceDaysLeft: number;
  trialExpired: boolean;
  suspended: boolean;
  canAddSeat: boolean;
  features: Record<string, boolean>;
  upgradeCta: string | null;
}

function normalizePlan(plan: string | undefined): PlanId {
  if (plan === "growth" || plan === "enterprise") return "growth";
  // 'free' (legacy) and anything unknown collapse to starter.
  return "starter";
}

export function resolveEntitlement(
  plan: string | undefined,
  trialEndsAt: string | null | undefined,
  graceEndsAt: string | null | undefined,
  nextRenewalAt: string | null | undefined,
  seatLimit: number | undefined,
  currentSeatCount: number,
): WorkspaceEntitlement {
  const planId = normalizePlan(plan);
  const config = PLANS[planId];

  const now = new Date();
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const graceEnd = graceEndsAt ? new Date(graceEndsAt) : null;
  const renewalAt = nextRenewalAt ? new Date(nextRenewalAt) : null;
  const hasPaid = !!renewalAt;

  // Paid plans: 7-day post-renewal grace, then suspended.
  const renewalGraceEnd = renewalAt
    ? new Date(renewalAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;

  let state: BillingState;
  if (trialEnd && trialEnd > now && (!graceEnd || graceEnd > now) && !hasPaid) {
    state = "trial";
  } else if (trialEnd && trialEnd <= now && graceEnd && graceEnd > now && !hasPaid) {
    state = "grace";
  } else if (trialEnd && graceEnd && graceEnd <= now && !hasPaid) {
    state = "suspended";
  } else if (renewalAt && renewalGraceEnd && renewalGraceEnd <= now) {
    state = "suspended";
  } else if (renewalAt && renewalAt <= now) {
    state = "grace";
  } else {
    state = planId; // 'starter' or 'growth'
  }

  const isTrialing = state === "trial";
  const isInGrace = state === "grace";
  const trialExpired = !!trialEnd && trialEnd <= now;
  const suspended = state === "suspended";

  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  // Grace days left covers either trial-grace OR renewal-grace
  const activeGraceEnd =
    graceEnd && graceEnd > now ? graceEnd
    : renewalGraceEnd && renewalGraceEnd > now ? renewalGraceEnd
    : null;
  const graceDaysLeft = activeGraceEnd
    ? Math.max(0, Math.ceil((activeGraceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // During trial/grace and growth: unlimited seats. Starter: 10 seats.
  const effectiveSeatLimit =
    state === "growth" || state === "trial" || state === "grace"
      ? null
      : (seatLimit ?? config.seatLimit);

  const isOverSeatLimit = effectiveSeatLimit !== null && currentSeatCount > effectiveSeatLimit;
  // 11th seat is allowed; backend auto-promotes to Growth. Only suspension blocks adds.
  const canAddSeat = !suspended;

  let upgradeCta: string | null = null;
  if (suspended) {
    upgradeCta = "Access is suspended. Activate Starter or Growth to restore your workspace.";
  } else if (isInGrace && hasPaid) {
    upgradeCta = `Renewal overdue — ${graceDaysLeft} day${graceDaysLeft !== 1 ? "s" : ""} left before suspension. Renew to keep working.`;
  } else if (isInGrace) {
    upgradeCta = `Your trial ended. ${graceDaysLeft} day${graceDaysLeft !== 1 ? "s" : ""} of grace left — activate Starter or Growth to keep your team running.`;
  } else if (state === "starter" && currentSeatCount >= 10) {
    upgradeCta = "You're at the 10-seat Starter limit. Adding the 11th seat will move your workspace to Growth automatically.";
  }

  return {
    plan: planId,
    state,
    seatLimit: effectiveSeatLimit,
    seatCount: currentSeatCount,
    isOverSeatLimit,
    isTrialing,
    isInGrace,
    trialDaysLeft,
    graceDaysLeft,
    trialExpired,
    suspended,
    canAddSeat,
    features: suspended ? {} : ALL_FEATURES,
    upgradeCta,
  };
}

/** Annual price = 11× monthly. */
export function annualFromMonthly(monthly: number): number {
  return monthly * 11;
}

/**
 * Mid-cycle upgrade proration (Starter -> Growth).
 * Returns the prorated charge for the remainder of the current billing cycle.
 * Pure function — used for display only; commercial team confirms the actual invoice.
 */
export function prorateUpgrade(
  fromMonthly: number,
  toMonthly: number,
  daysIntoCycle: number,
  cycleDays: number,
  seats: number,
): number {
  const daysRemaining = Math.max(0, cycleDays - daysIntoCycle);
  const dailyDelta = (toMonthly - fromMonthly) / cycleDays;
  return Math.round(dailyDelta * daysRemaining * seats);
}
