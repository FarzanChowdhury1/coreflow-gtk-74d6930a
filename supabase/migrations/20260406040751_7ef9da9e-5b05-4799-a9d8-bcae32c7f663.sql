
-- Platform admin RPC: returns cross-workspace overview data
-- Only callable by platform admins (checked via is_platform_admin)

CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
      w.deleted_at,
      (SELECT count(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id) AS seat_count,
      (SELECT max(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT count(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT count(*) FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count
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
      'company_count', ws.company_count
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

REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_workspace_overview() TO authenticated;
