-- ============================================================
-- Findings 14 + 16 hardening
-- ============================================================

-- Finding 14: notification RPC must enforce auth.uid() = _user_id
-- and workspace membership; otherwise return no rows.
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
  WITH caller_check AS (
    SELECT 1
    WHERE auth.uid() IS NOT NULL
      AND _user_id = auth.uid()
      AND (
        _workspace_id IS NULL
        OR public.has_workspace_access(auth.uid(), _workspace_id)
      )
  ),
  user_notifs AS (
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
    WHERE EXISTS (SELECT 1 FROM caller_check)
      AND n.user_id = auth.uid()
      AND w.deleted_at IS NULL
      AND (_workspace_id IS NULL OR n.workspace_id = _workspace_id)
      AND COALESCE(np.in_app_enabled, true) = true
  ),
  alert_rows AS (
    SELECT
      sa.id,
      sa.workspace_id,
      auth.uid() AS user_id,
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
    WHERE EXISTS (SELECT 1 FROM caller_check)
      AND w.deleted_at IS NULL
      AND sa.is_dismissed = false
      AND (_workspace_id IS NULL OR sa.workspace_id = _workspace_id)
      AND (
        public.has_workspace_role(auth.uid(), sa.workspace_id, 'admin'::app_role)
        OR (
          public.has_workspace_access(auth.uid(), sa.workspace_id)
          AND (
            (sa.entity_type = 'project' AND public.is_project_member(auth.uid(), sa.entity_id))
            OR (sa.entity_type = 'invoice' AND EXISTS (
              SELECT 1 FROM public.invoices i
              WHERE i.id = sa.entity_id
                AND (i.project_id IS NULL OR public.is_project_member(auth.uid(), i.project_id))
            ))
            OR (sa.entity_type = 'lead' AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = sa.entity_id
                AND (l.owner_id = auth.uid() OR l.owner_id IS NULL)
            ))
            OR (sa.entity_type = 'renewal' AND EXISTS (
              SELECT 1 FROM public.renewals r
              WHERE r.id = sa.entity_id
                AND (r.project_id IS NULL OR public.is_project_member(auth.uid(), r.project_id))
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

REVOKE EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer, uuid) TO authenticated, service_role;

-- ============================================================
-- Finding 16: storage.objects direct member read/update bypass
-- ============================================================

-- Remove broad member SELECT/UPDATE policies on workspace-files.
-- Sensitive downloads must route through the service-role file-gateway.
DROP POLICY IF EXISTS "workspace members can read own files"   ON storage.objects;
DROP POLICY IF EXISTS "workspace members can update own files" ON storage.objects;

-- Defensive: drop any historical aliases that allowed the same bypass.
DROP POLICY IF EXISTS "Authenticated users can read workspace-files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update workspace-files" ON storage.objects;
