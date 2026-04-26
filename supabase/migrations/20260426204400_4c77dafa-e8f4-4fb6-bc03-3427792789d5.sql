-- Drop old signature (return type changes)
DROP FUNCTION IF EXISTS public.fetch_prioritized_notifications(uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.fetch_prioritized_notifications(
  _user_id uuid,
  _limit integer DEFAULT 20,
  _workspace_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  user_id uuid,
  title text,
  body text,
  link text,
  is_read boolean,
  created_at timestamptz,
  severity text,
  category text,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH user_notifs AS (
    SELECT
      n.id,
      n.workspace_id,
      n.user_id,
      n.title,
      n.body,
      n.link,
      n.is_read,
      n.created_at,
      n.severity,
      n.category,
      'notification'::text AS source
    FROM public.notifications n
    JOIN public.workspaces w ON w.id = n.workspace_id
    LEFT JOIN public.notification_preferences np
      ON np.user_id = n.user_id
     AND np.workspace_id = n.workspace_id
     AND np.category::text = n.category
    WHERE n.user_id = _user_id
      AND w.deleted_at IS NULL
      AND (_workspace_id IS NULL OR n.workspace_id = _workspace_id)
      AND COALESCE(np.in_app_enabled, true) = true
  ),
  alert_rows AS (
    SELECT
      sa.id,
      sa.workspace_id,
      _user_id AS user_id,
      sa.title,
      sa.body,
      CASE sa.alert_type
        WHEN 'payment_proof_pending' THEN '/payments'
        WHEN 'overdue_invoice'        THEN '/invoices'
        WHEN 'lead_followup'          THEN '/leads'
        WHEN 'renewal_reminder'       THEN '/renewals'
        ELSE '/dashboard'
      END AS link,
      sa.is_dismissed AS is_read,
      sa.created_at,
      sa.severity,
      ('system_alert:' || sa.alert_type) AS category,
      'system_alert'::text AS source
    FROM public.system_alerts sa
    JOIN public.workspaces w ON w.id = sa.workspace_id
    WHERE w.deleted_at IS NULL
      AND sa.is_dismissed = false
      AND (_workspace_id IS NULL OR sa.workspace_id = _workspace_id)
      AND (
        -- admins see all alerts in their workspace
        public.has_workspace_role(_user_id, sa.workspace_id, 'admin'::app_role)
        OR (
          public.has_workspace_access(_user_id, sa.workspace_id)
          AND (
            (sa.entity_type = 'project' AND public.is_project_member(_user_id, sa.entity_id))
            OR (sa.entity_type = 'invoice' AND EXISTS (
              SELECT 1 FROM public.invoices i
              WHERE i.id = sa.entity_id
                AND (i.project_id IS NULL OR public.is_project_member(_user_id, i.project_id))
            ))
            OR (sa.entity_type = 'lead' AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = sa.entity_id
                AND (l.owner_id = _user_id OR l.owner_id IS NULL)
            ))
            OR (sa.entity_type = 'renewal' AND EXISTS (
              SELECT 1 FROM public.renewals r
              WHERE r.id = sa.entity_id
                AND (r.project_id IS NULL OR public.is_project_member(_user_id, r.project_id))
            ))
          )
        )
      )
  )
  SELECT * FROM (
    SELECT * FROM user_notifs
    UNION ALL
    SELECT * FROM alert_rows
  ) combined
  ORDER BY
    is_read ASC,
    CASE severity
      WHEN 'critical' THEN 0
      WHEN 'warning'  THEN 1
      ELSE 2
    END ASC,
    created_at DESC
  LIMIT _limit;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer, uuid) TO authenticated;