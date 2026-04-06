
-- Add billing_owner_id to workspaces
ALTER TABLE public.workspaces
ADD COLUMN billing_owner_id uuid REFERENCES auth.users(id) DEFAULT NULL;

-- Backfill: set billing_owner_id to earliest admin per workspace
UPDATE public.workspaces w
SET billing_owner_id = sub.earliest_admin
FROM (
  SELECT DISTINCT ON (wm.workspace_id)
    wm.workspace_id,
    wm.user_id AS earliest_admin
  FROM workspace_memberships wm
  WHERE wm.role = 'admin'
  ORDER BY wm.workspace_id, wm.created_at ASC
) sub
WHERE w.id = sub.workspace_id
  AND w.billing_owner_id IS NULL;

-- Replace platform_workspace_overview to include admin identity
CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _result jsonb;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL OR NOT is_platform_admin(_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH ws AS (
    SELECT
      w.id,
      w.name,
      w.plan,
      w.seat_limit,
      w.trial_ends_at,
      w.created_at,
      w.billing_owner_id,
      (SELECT count(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id) AS seat_count,
      (SELECT max(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT count(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT count(*) FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      -- Admin emails
      (SELECT array_agg(u.email ORDER BY wm2.created_at ASC)
       FROM workspace_memberships wm2
       JOIN auth.users u ON u.id = wm2.user_id
       WHERE wm2.workspace_id = w.id AND wm2.role = 'admin') AS admin_emails,
      -- Admin count
      (SELECT count(*) FROM workspace_memberships wm3 WHERE wm3.workspace_id = w.id AND wm3.role = 'admin') AS admin_count,
      -- Team member count
      (SELECT count(*) FROM workspace_memberships wm4 WHERE wm4.workspace_id = w.id AND wm4.role = 'team_member') AS team_member_count,
      -- Billing owner email
      (SELECT u.email FROM auth.users u WHERE u.id = w.billing_owner_id) AS billing_owner_email
    FROM workspaces w
    WHERE w.deleted_at IS NULL
    ORDER BY w.created_at DESC
  )
  SELECT jsonb_build_object(
    'workspaces', (SELECT jsonb_agg(jsonb_build_object(
      'id', ws.id,
      'name', ws.name,
      'plan', ws.plan,
      'seat_limit', ws.seat_limit,
      'seat_count', ws.seat_count,
      'trial_ends_at', ws.trial_ends_at,
      'created_at', ws.created_at,
      'last_activity', ws.last_activity,
      'event_count', ws.event_count,
      'event_names', ws.event_names,
      'company_count', ws.company_count,
      'admin_emails', ws.admin_emails,
      'admin_count', ws.admin_count,
      'team_member_count', ws.team_member_count,
      'billing_owner_email', ws.billing_owner_email
    )) FROM ws),
    'summary', jsonb_build_object(
      'total', (SELECT count(*) FROM ws),
      'free', (SELECT count(*) FROM ws WHERE ws.plan = 'free'),
      'growth', (SELECT count(*) FROM ws WHERE ws.plan = 'growth'),
      'enterprise', (SELECT count(*) FROM ws WHERE ws.plan = 'enterprise'),
      'active_trials', (SELECT count(*) FROM ws WHERE ws.trial_ends_at IS NOT NULL AND ws.trial_ends_at > now()),
      'expired_trials', (SELECT count(*) FROM ws WHERE ws.trial_ends_at IS NOT NULL AND ws.trial_ends_at <= now()),
      'over_seat_limit', (SELECT count(*) FROM ws WHERE ws.seat_count > ws.seat_limit)
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

-- Create RPC for workspace admins to get/set billing owner
CREATE OR REPLACE FUNCTION public.get_billing_owner(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _result jsonb;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Must be admin of this workspace
  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = _caller_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'billing_owner_id', w.billing_owner_id,
    'billing_owner_email', (SELECT u.email FROM auth.users u WHERE u.id = w.billing_owner_id),
    'billing_owner_name', (SELECT p.full_name FROM profiles p WHERE p.user_id = w.billing_owner_id),
    'admins', (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', wm.user_id,
        'email', u.email,
        'full_name', p.full_name
      ) ORDER BY wm.created_at ASC)
      FROM workspace_memberships wm
      JOIN auth.users u ON u.id = wm.user_id
      LEFT JOIN profiles p ON p.user_id = wm.user_id
      WHERE wm.workspace_id = _workspace_id AND wm.role = 'admin'
    )
  )
  INTO _result
  FROM workspaces w
  WHERE w.id = _workspace_id;

  RETURN _result;
END;
$$;

-- Create RPC to set billing owner (admin-only, must be an existing admin)
CREATE OR REPLACE FUNCTION public.set_billing_owner(_workspace_id uuid, _new_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Caller must be admin
  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = _caller_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only workspace admins can change the billing owner';
  END IF;

  -- New owner must also be admin
  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = _new_owner_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Billing owner must be an existing workspace admin';
  END IF;

  UPDATE workspaces SET billing_owner_id = _new_owner_id, updated_at = now()
  WHERE id = _workspace_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Restrict execution
REVOKE EXECUTE ON FUNCTION public.get_billing_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_owner(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_billing_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_billing_owner(uuid, uuid) TO authenticated;
