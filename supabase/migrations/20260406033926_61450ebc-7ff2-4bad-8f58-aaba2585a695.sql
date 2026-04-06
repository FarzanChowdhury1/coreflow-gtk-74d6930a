
-- Server-side Growth trial activation RPC
-- Enforces: admin-only, one trial per workspace, sets plan/trial/seats atomically

CREATE OR REPLACE FUNCTION public.start_growth_trial(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _role app_role;
  _current_plan text;
  _current_trial_ends_at timestamptz;
  _trial_end timestamptz;
BEGIN
  -- 1. Get caller
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- 2. Verify admin role
  SELECT role INTO _role
  FROM workspace_memberships
  WHERE user_id = _caller_id AND workspace_id = _workspace_id
  LIMIT 1;

  IF _role IS NULL OR _role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only workspace admins can start a trial');
  END IF;

  -- 3. Check current workspace state
  SELECT plan, trial_ends_at INTO _current_plan, _current_trial_ends_at
  FROM workspaces
  WHERE id = _workspace_id;

  IF _current_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Workspace not found');
  END IF;

  -- 4. Block if already on growth/enterprise (paid or trialing)
  IF _current_plan = 'enterprise' THEN
    RETURN jsonb_build_object('error', 'Enterprise workspaces cannot start a Growth trial');
  END IF;

  -- 5. Block if trial was ever used (trial_ends_at was ever set)
  IF _current_trial_ends_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This workspace has already used its Growth trial');
  END IF;

  -- 6. Activate trial
  _trial_end := now() + interval '14 days';

  UPDATE workspaces
  SET plan = 'growth',
      trial_ends_at = _trial_end,
      seat_limit = 999
  WHERE id = _workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'trial_ends_at', _trial_end
  );
END;
$$;

-- Restrict execution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.start_growth_trial(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_growth_trial(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_growth_trial(uuid) TO authenticated;
