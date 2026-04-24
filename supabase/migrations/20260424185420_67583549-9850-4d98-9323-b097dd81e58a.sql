CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid; _workspaces jsonb; _summary jsonb;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL OR NOT is_platform_admin(_caller) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  SELECT jsonb_agg(row_to_json(r)) INTO _workspaces FROM (
    SELECT
      w.id, w.name, w.plan, w.seat_limit,
      workspace_effective_seat_count(w.id) AS seat_count,
      w.trial_started_at, w.trial_ends_at, w.grace_ends_at,
      w.next_renewal_at, w.billing_cycle, w.pending_downgrade_to,
      workspace_billing_state(w.id) AS billing_state,
      w.created_at, w.deleted_at,
      (SELECT MAX(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT COUNT(*) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT COUNT(*) FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      (SELECT array_agg(u.email) FROM workspace_memberships wm
         JOIN auth.users u ON u.id = wm.user_id
        WHERE wm.workspace_id = w.id AND wm.role = 'admin') AS admin_emails,
      (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.role = 'admin') AS admin_count,
      (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.role = 'team_member') AS team_member_count,
      (SELECT u.email FROM auth.users u WHERE u.id = w.billing_owner_id) AS billing_owner_email,
      f.followup_stage, f.next_followup_date, f.last_contacted_at, f.followup_priority,
      (SELECT u.email FROM auth.users u WHERE u.id = f.followup_owner_id) AS followup_owner_email,
      f.last_note, f.note_count
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT wf.stage AS followup_stage,
             wf.next_followup_date,
             wf.last_contacted_at,
             wf.priority AS followup_priority,
             wf.owner_id AS followup_owner_id,
             NULL::text AS last_note,
             0::int AS note_count
      FROM workspace_followups wf WHERE wf.workspace_id = w.id LIMIT 1
    ) f ON true
    ORDER BY w.created_at DESC
  ) r;

  SELECT jsonb_build_object(
    'total',           (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL),
    'starter',         (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND plan = 'starter' AND workspace_billing_state(id) = 'starter'),
    'growth',          (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND plan = 'growth'  AND workspace_billing_state(id) = 'growth'),
    'active_trials',   (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'trial'),
    'in_grace',        (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'grace'),
    'suspended',       (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'suspended'),
    'expired_trials',  (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()),
    'over_seat_limit', (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_effective_seat_count(id) > seat_limit)
  ) INTO _summary;

  RETURN jsonb_build_object('workspaces', COALESCE(_workspaces, '[]'::jsonb), 'summary', _summary);
END;
$function$;