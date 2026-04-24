
-- Canonical fix for activate_paid_plan_with_log:
-- 1) Drop dead plan_status reference (column does not exist anywhere)
-- 2) Align plan list with product canon: starter|growth (no 'scale')
-- 3) Align cycle list with rest of system: monthly|annual (not 'yearly')
-- 4) Set coherent state: next_renewal_at, seat_limit, clear grace/pending/trial
-- 5) Write audit_logs entries (function name promises "_with_log")

CREATE OR REPLACE FUNCTION public.activate_paid_plan_with_log(
  _workspace_id uuid,
  _plan text,
  _billing_cycle text,
  _amount numeric,
  _currency text,
  _payment_method payment_method_manual,
  _payment_reference text,
  _notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _prev_plan text;
  _prev_cycle text;
  _seat_count int;
  _activation_id uuid;
  _renewal timestamptz;
  _new_seat_limit int;
  _actor_name text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_platform_admin(_caller) THEN
    RAISE EXCEPTION 'Only platform admins can activate paid plans' USING ERRCODE = '42501';
  END IF;

  IF _plan NOT IN ('starter', 'growth') THEN
    RAISE EXCEPTION 'Invalid plan: % (must be starter or growth)', _plan USING ERRCODE = '22023';
  END IF;

  IF _billing_cycle NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Invalid billing cycle: % (must be monthly or annual)', _billing_cycle USING ERRCODE = '22023';
  END IF;

  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Amount must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- Snapshot previous state with row lock
  SELECT plan, billing_cycle INTO _prev_plan, _prev_cycle
  FROM public.workspaces
  WHERE id = _workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;

  -- Seat enforcement: starter capped at 10
  _seat_count := public.workspace_effective_seat_count(_workspace_id);
  IF _plan = 'starter' AND _seat_count > 10 THEN
    RAISE EXCEPTION 'Workspace has % seats — exceeds Starter 10-seat limit; activate Growth instead', _seat_count
      USING ERRCODE = '22023';
  END IF;

  -- Compute next renewal
  IF _billing_cycle = 'annual' THEN
    _renewal := now() + interval '12 months';
  ELSE
    _renewal := now() + interval '1 month';
  END IF;

  _new_seat_limit := CASE WHEN _plan = 'starter' THEN 10 ELSE 9999 END;

  -- Write activation log first (immutable revenue audit)
  INSERT INTO public.paid_plan_activations (
    workspace_id, plan, billing_cycle, amount, currency,
    payment_method, payment_reference, notes,
    activated_by, previous_plan, previous_billing_cycle
  ) VALUES (
    _workspace_id, _plan, _billing_cycle, _amount, COALESCE(NULLIF(_currency, ''), 'BDT'),
    _payment_method, NULLIF(_payment_reference, ''), NULLIF(_notes, ''),
    _caller, _prev_plan, _prev_cycle
  ) RETURNING id INTO _activation_id;

  -- Update workspace plan to coherent paid state
  UPDATE public.workspaces
  SET
    plan = _plan,
    billing_cycle = _billing_cycle,
    seat_limit = _new_seat_limit,
    next_renewal_at = _renewal,
    trial_ends_at = NULL,
    grace_ends_at = NULL,
    renewal_grace_ends_at = NULL,
    pending_downgrade_to = NULL,
    updated_at = now()
  WHERE id = _workspace_id;

  -- Audit log: activation record + workspace state change
  SELECT email INTO _actor_name FROM auth.users WHERE id = _caller;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (
    _workspace_id, _caller, _actor_name,
    'paid_plan.activated', 'paid_plan_activations', _activation_id,
    jsonb_build_object(
      'plan', _plan, 'billing_cycle', _billing_cycle,
      'amount', _amount, 'currency', COALESCE(NULLIF(_currency, ''), 'BDT'),
      'payment_method', _payment_method,
      'payment_reference', NULLIF(_payment_reference, ''),
      'previous_plan', _prev_plan, 'previous_billing_cycle', _prev_cycle
    )
  );

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (
    _workspace_id, _caller, _actor_name,
    'workspace.plan_changed', 'workspaces', _workspace_id,
    jsonb_build_object(
      'from_plan', _prev_plan, 'to_plan', _plan,
      'from_cycle', _prev_cycle, 'to_cycle', _billing_cycle,
      'next_renewal_at', _renewal, 'seat_limit', _new_seat_limit,
      'activation_id', _activation_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'activation_id', _activation_id,
    'workspace_id', _workspace_id,
    'plan', _plan,
    'billing_cycle', _billing_cycle,
    'next_renewal_at', _renewal,
    'seat_limit', _new_seat_limit,
    'previous_plan', _prev_plan,
    'previous_billing_cycle', _prev_cycle
  );
END;
$function$;
