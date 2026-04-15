
CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _result jsonb;
BEGIN
  IF NOT is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH ws_data AS (
    SELECT
      w.id, w.name, w.plan, w.seat_limit, w.trial_ends_at, w.created_at, w.billing_owner_id,
      w.deleted_at,
      (SELECT count(*)::int FROM workspace_memberships wm WHERE wm.workspace_id = w.id) AS seat_count,
      (SELECT max(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT count(*)::int FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT count(*)::int FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      (SELECT array_agg(u.email ORDER BY wm2.created_at)
       FROM workspace_memberships wm2 JOIN auth.users u ON u.id = wm2.user_id
       WHERE wm2.workspace_id = w.id AND wm2.role = 'admin') AS admin_emails,
      (SELECT count(*)::int FROM workspace_memberships wm3 WHERE wm3.workspace_id = w.id AND wm3.role = 'admin') AS admin_count,
      (SELECT count(*)::int FROM workspace_memberships wm4 WHERE wm4.workspace_id = w.id AND wm4.role = 'team_member') AS team_member_count,
      (SELECT u2.email FROM auth.users u2 WHERE u2.id = w.billing_owner_id) AS billing_owner_email,
      wf.stage AS followup_stage, wf.next_followup_date, wf.last_contacted_at,
      wf.priority AS followup_priority, wf.owner_id AS followup_owner_id,
      (SELECT u3.email FROM auth.users u3 WHERE u3.id = wf.owner_id) AS followup_owner_email,
      (SELECT wfn.note FROM workspace_followup_notes wfn WHERE wfn.followup_id = wf.id ORDER BY wfn.created_at DESC LIMIT 1) AS last_note,
      (SELECT count(*)::int FROM workspace_followup_notes wfn2 WHERE wfn2.followup_id = wf.id) AS note_count
    FROM workspaces w
    LEFT JOIN workspace_followups wf ON wf.workspace_id = w.id
    ORDER BY w.created_at DESC
  ),
  summary AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'free', count(*) FILTER (WHERE plan = 'free'),
      'growth', count(*) FILTER (WHERE plan = 'growth'),
      'enterprise', count(*) FILTER (WHERE plan = 'enterprise'),
      'active_trials', count(*) FILTER (WHERE trial_ends_at IS NOT NULL AND trial_ends_at > now()),
      'expired_trials', count(*) FILTER (WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now()),
      'over_seat_limit', count(*) FILTER (WHERE seat_count > seat_limit)
    ) AS val FROM ws_data
  )
  SELECT jsonb_build_object(
    'summary', (SELECT val FROM summary),
    'workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'plan', plan, 'seat_limit', seat_limit,
        'seat_count', seat_count, 'trial_ends_at', trial_ends_at,
        'created_at', created_at, 'last_activity', last_activity,
        'event_count', event_count, 'event_names', event_names,
        'company_count', company_count, 'admin_emails', admin_emails,
        'admin_count', admin_count, 'team_member_count', team_member_count,
        'billing_owner_email', billing_owner_email,
        'followup_stage', followup_stage, 'next_followup_date', next_followup_date,
        'last_contacted_at', last_contacted_at, 'followup_priority', followup_priority,
        'followup_owner_email', followup_owner_email,
        'last_note', last_note, 'note_count', note_count,
        'deleted_at', deleted_at
      )) FROM ws_data
    ), '[]'::jsonb)
  ) INTO _result;
  RETURN _result;
END;
$$;
