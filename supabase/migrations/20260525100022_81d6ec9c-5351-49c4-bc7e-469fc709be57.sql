-- =====================================================================
-- SECURITY HARDENING: billing-self-upgrade lockdown + drop unsafe finance RPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Drop public SECURITY DEFINER finance test RPC that leaked cross-tenant
--    financial aggregates without any auth.uid()/role check.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._fa_test_compute(uuid);

-- ---------------------------------------------------------------------
-- 2) Block workspace admins from mutating billing / entitlement columns
--    directly via PATCH /workspaces. Only public.is_platform_admin(auth.uid())
--    may change these fields. Activation continues to flow through
--    public.activate_paid_plan_with_log (SECURITY DEFINER, platform-admin only).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_workspace_billing_self_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _caller uuid := auth.uid();
  _changed boolean := false;
BEGIN
  -- Detect any change to a protected billing / entitlement column.
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
     OR NEW.next_renewal_at IS DISTINCT FROM OLD.next_renewal_at
     OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.grace_ends_at IS DISTINCT FROM OLD.grace_ends_at
     OR NEW.renewal_grace_ends_at IS DISTINCT FROM OLD.renewal_grace_ends_at
     OR NEW.pending_downgrade_to IS DISTINCT FROM OLD.pending_downgrade_to
     OR NEW.seat_limit IS DISTINCT FROM OLD.seat_limit
  THEN
    _changed := true;
  END IF;

  IF NOT _changed THEN
    RETURN NEW;
  END IF;

  -- A NULL caller means a service-role / definer-context update from a trusted
  -- RPC (e.g. activate_paid_plan_with_log running as definer). Allow it.
  -- If a caller IS present, they must be a platform admin.
  IF _caller IS NOT NULL AND NOT public.is_platform_admin(_caller) THEN
    RAISE EXCEPTION 'Only platform admins can change workspace billing and entitlement fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.prevent_workspace_billing_self_upgrade() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_workspace_billing_self_upgrade ON public.workspaces;
CREATE TRIGGER trg_prevent_workspace_billing_self_upgrade
BEFORE UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.prevent_workspace_billing_self_upgrade();

-- Defense-in-depth column-level grants. Lovable publish pipeline has been
-- known to reset grants, so the trigger above is the authoritative guard.
REVOKE UPDATE (
  plan,
  billing_cycle,
  next_renewal_at,
  trial_ends_at,
  grace_ends_at,
  renewal_grace_ends_at,
  pending_downgrade_to,
  seat_limit
) ON public.workspaces FROM anon, authenticated;
