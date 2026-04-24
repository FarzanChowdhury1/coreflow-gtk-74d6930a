-- Payment method enum for manual collection
DO $$ BEGIN
  CREATE TYPE public.payment_method_manual AS ENUM ('bank_transfer', 'bkash_manual', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Activation log table
CREATE TABLE IF NOT EXISTS public.paid_plan_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan text NOT NULL,
  billing_cycle text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  payment_method public.payment_method_manual NOT NULL,
  payment_reference text,
  notes text,
  activated_by uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  previous_plan text,
  previous_billing_cycle text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paid_plan_activations_workspace ON public.paid_plan_activations(workspace_id, activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_paid_plan_activations_activated_at ON public.paid_plan_activations(activated_at DESC);

ALTER TABLE public.paid_plan_activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read activations" ON public.paid_plan_activations;
CREATE POLICY "Platform admins can read activations"
ON public.paid_plan_activations
FOR SELECT
TO authenticated
USING (public.is_platform_admin((SELECT auth.uid())));

-- No direct INSERT/UPDATE/DELETE policies — writes happen exclusively via the SECURITY DEFINER RPC below.

-- Atomic activation RPC
CREATE OR REPLACE FUNCTION public.activate_paid_plan_with_log(
  _workspace_id uuid,
  _plan text,
  _billing_cycle text,
  _amount numeric,
  _currency text,
  _payment_method public.payment_method_manual,
  _payment_reference text,
  _notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _prev_plan text;
  _prev_cycle text;
  _activation_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_platform_admin(_caller) THEN
    RAISE EXCEPTION 'Only platform admins can activate paid plans' USING ERRCODE = '42501';
  END IF;

  IF _plan NOT IN ('growth', 'scale') THEN
    RAISE EXCEPTION 'Invalid plan: %', _plan USING ERRCODE = '22023';
  END IF;

  IF _billing_cycle NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Invalid billing cycle: %', _billing_cycle USING ERRCODE = '22023';
  END IF;

  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Amount must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- Snapshot previous state
  SELECT plan, billing_cycle INTO _prev_plan, _prev_cycle
  FROM public.workspaces
  WHERE id = _workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;

  -- Write activation log first
  INSERT INTO public.paid_plan_activations (
    workspace_id, plan, billing_cycle, amount, currency,
    payment_method, payment_reference, notes,
    activated_by, previous_plan, previous_billing_cycle
  ) VALUES (
    _workspace_id, _plan, _billing_cycle, _amount, COALESCE(NULLIF(_currency, ''), 'BDT'),
    _payment_method, NULLIF(_payment_reference, ''), NULLIF(_notes, ''),
    _caller, _prev_plan, _prev_cycle
  ) RETURNING id INTO _activation_id;

  -- Update workspace plan
  UPDATE public.workspaces
  SET
    plan = _plan,
    billing_cycle = _billing_cycle,
    plan_status = 'active',
    trial_ends_at = NULL,
    updated_at = now()
  WHERE id = _workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'activation_id', _activation_id,
    'workspace_id', _workspace_id,
    'plan', _plan,
    'billing_cycle', _billing_cycle,
    'previous_plan', _prev_plan,
    'previous_billing_cycle', _prev_cycle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_paid_plan_with_log(uuid, text, text, numeric, text, public.payment_method_manual, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_paid_plan_with_log(uuid, text, text, numeric, text, public.payment_method_manual, text, text) TO authenticated;