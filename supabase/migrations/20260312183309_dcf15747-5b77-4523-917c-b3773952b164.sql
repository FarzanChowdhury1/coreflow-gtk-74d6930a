
-- =============================================================
-- Round B3: system_alerts table + sweep functions + retention
-- =============================================================

-- 1. system_alerts table for surfacing sweep results
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  alert_type text NOT NULL,            -- 'overdue_invoice','lead_followup','renewal_reminder'
  entity_type text NOT NULL,           -- 'invoice','lead','project'
  entity_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',  -- 'info','warning','critical'
  is_dismissed boolean NOT NULL DEFAULT false,
  sweep_key text NOT NULL,             -- idempotency key e.g. 'overdue_invoice::<invoice_id>'
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE(sweep_key)
);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

-- Admins see all alerts for workspace
CREATE POLICY "Admins can manage system alerts"
  ON public.system_alerts FOR ALL TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

-- Team members see alerts for their assigned projects
CREATE POLICY "Team members can view relevant alerts"
  ON public.system_alerts FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND (
      (entity_type = 'project' AND is_project_member((SELECT auth.uid()), entity_id))
      OR (entity_type = 'invoice' AND EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = entity_id AND (i.project_id IS NULL OR is_project_member((SELECT auth.uid()), i.project_id))
      ))
      OR (entity_type = 'lead' AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = entity_id AND (l.owner_id = (SELECT auth.uid()) OR l.owner_id IS NULL)
      ))
    )
  );

-- 2. Overdue invoice sweep (idempotent)
CREATE OR REPLACE FUNCTION public.sweep_overdue_invoices()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int := 0;
  _inv record;
BEGIN
  FOR _inv IN
    SELECT i.id, i.workspace_id, i.invoice_number, i.due_date, i.grand_total, i.amount_paid, i.status,
           c.legal_name as company_name
    FROM public.invoices i
    JOIN public.companies c ON c.id = i.company_id
    WHERE i.deleted_at IS NULL
      AND i.status IN ('issued', 'partially_paid')
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (
      _inv.workspace_id,
      'overdue_invoice',
      'invoice',
      _inv.id,
      'Overdue: ' || _inv.invoice_number,
      _inv.company_name || ' — due ' || _inv.due_date::text || ', outstanding ৳' || (_inv.grand_total - _inv.amount_paid)::text,
      CASE WHEN (CURRENT_DATE - _inv.due_date) > 30 THEN 'critical' WHEN (CURRENT_DATE - _inv.due_date) > 7 THEN 'warning' ELSE 'info' END,
      'overdue_invoice::' || _inv.id::text
    )
    ON CONFLICT (sweep_key) DO UPDATE SET
      body = EXCLUDED.body,
      severity = EXCLUDED.severity,
      is_dismissed = false;
    _count := _count + 1;
  END LOOP;

  -- Clear stale alerts for invoices no longer overdue
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type = 'overdue_invoice' AND is_dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = system_alerts.entity_id
        AND i.deleted_at IS NULL
        AND i.status IN ('issued', 'partially_paid')
        AND i.due_date < CURRENT_DATE
    );

  RETURN json_build_object('swept', _count);
END;
$$;

-- 3. Lead follow-up flagging (idempotent)
CREATE OR REPLACE FUNCTION public.sweep_lead_followups()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int := 0;
  _lead record;
BEGIN
  FOR _lead IN
    SELECT l.id, l.workspace_id, l.title, l.next_follow_up, l.status,
           COALESCE(c.legal_name, '—') as company_name
    FROM public.leads l
    LEFT JOIN public.companies c ON c.id = l.company_id
    WHERE l.deleted_at IS NULL
      AND l.status IN ('new', 'contacted', 'qualified')
      AND l.next_follow_up IS NOT NULL
      AND l.next_follow_up <= now()
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (
      _lead.workspace_id,
      'lead_followup',
      'lead',
      _lead.id,
      'Follow-up due: ' || _lead.title,
      _lead.company_name || ' — was due ' || _lead.next_follow_up::date::text,
      CASE WHEN (now() - _lead.next_follow_up) > interval '7 days' THEN 'critical'
           WHEN (now() - _lead.next_follow_up) > interval '2 days' THEN 'warning'
           ELSE 'info' END,
      'lead_followup::' || _lead.id::text
    )
    ON CONFLICT (sweep_key) DO UPDATE SET
      body = EXCLUDED.body,
      severity = EXCLUDED.severity,
      is_dismissed = false;
    _count := _count + 1;
  END LOOP;

  -- Clear stale alerts for leads no longer overdue
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type = 'lead_followup' AND is_dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = system_alerts.entity_id
        AND l.deleted_at IS NULL
        AND l.status IN ('new', 'contacted', 'qualified')
        AND l.next_follow_up <= now()
    );

  RETURN json_build_object('swept', _count);
END;
$$;

-- 4. Renewal reminder polling (idempotent) - based on project target_end_date
CREATE OR REPLACE FUNCTION public.sweep_renewal_reminders()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int := 0;
  _proj record;
BEGIN
  FOR _proj IN
    SELECT p.id, p.workspace_id, p.name, p.target_end_date,
           c.legal_name as company_name
    FROM public.projects p
    JOIN public.companies c ON c.id = p.company_id
    WHERE p.deleted_at IS NULL
      AND p.status = 'active'
      AND p.target_end_date IS NOT NULL
      AND p.target_end_date <= (CURRENT_DATE + interval '30 days')
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (
      _proj.workspace_id,
      'renewal_reminder',
      'project',
      _proj.id,
      CASE WHEN _proj.target_end_date < CURRENT_DATE THEN 'Expired: ' ELSE 'Ending soon: ' END || _proj.name,
      _proj.company_name || ' — target end ' || _proj.target_end_date::text,
      CASE WHEN _proj.target_end_date < CURRENT_DATE THEN 'critical'
           WHEN _proj.target_end_date <= (CURRENT_DATE + interval '7 days') THEN 'warning'
           ELSE 'info' END,
      'renewal_reminder::' || _proj.id::text
    )
    ON CONFLICT (sweep_key) DO UPDATE SET
      body = EXCLUDED.body,
      severity = EXCLUDED.severity,
      is_dismissed = false;
    _count := _count + 1;
  END LOOP;

  -- Clear stale alerts for projects no longer approaching end
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type = 'renewal_reminder' AND is_dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = system_alerts.entity_id
        AND p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.target_end_date <= (CURRENT_DATE + interval '30 days')
    );

  RETURN json_build_object('swept', _count);
END;
$$;

-- 5. Retention selection logic (returns candidates, does not delete)
CREATE OR REPLACE FUNCTION public.select_retention_candidates()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _stale_files json;
  _expired_tokens json;
BEGIN
  -- Files with deleted_at > 30 days ago
  SELECT COALESCE(json_agg(json_build_object(
    'id', f.id, 'storage_path', f.storage_path, 'workspace_id', f.workspace_id,
    'deleted_at', f.deleted_at
  )), '[]'::json) INTO _stale_files
  FROM public.files f
  WHERE f.deleted_at IS NOT NULL
    AND f.deleted_at < (now() - interval '30 days');

  -- Expired portal tokens
  SELECT COALESCE(json_agg(json_build_object(
    'id', pt.id, 'workspace_id', pt.workspace_id, 'expires_at', pt.expires_at
  )), '[]'::json) INTO _expired_tokens
  FROM public.portal_tokens pt
  WHERE pt.expires_at < now();

  RETURN json_build_object(
    'stale_files', _stale_files,
    'expired_portal_tokens', _expired_tokens
  );
END;
$$;

-- 6. Purge function for retention (actually deletes)
CREATE OR REPLACE FUNCTION public.purge_expired_portal_tokens()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int;
BEGIN
  DELETE FROM public.portal_tokens WHERE expires_at < now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN json_build_object('purged_tokens', _count);
END;
$$;

-- 7. Hard-delete stale file rows (storage cleanup done by edge function)
CREATE OR REPLACE FUNCTION public.purge_stale_file_rows()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int;
  _paths json;
BEGIN
  -- Return paths first for storage cleanup
  SELECT COALESCE(json_agg(storage_path), '[]'::json) INTO _paths
  FROM public.files
  WHERE deleted_at IS NOT NULL AND deleted_at < (now() - interval '30 days');

  DELETE FROM public.files
  WHERE deleted_at IS NOT NULL AND deleted_at < (now() - interval '30 days');
  GET DIAGNOSTICS _count = ROW_COUNT;

  RETURN json_build_object('purged_files', _count, 'storage_paths', _paths);
END;
$$;

-- 8. Daily digest aggregation (returns per-workspace digest payload)
CREATE OR REPLACE FUNCTION public.aggregate_daily_digest()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _result json;
BEGIN
  SELECT COALESCE(json_agg(ws_digest), '[]'::json) INTO _result
  FROM (
    SELECT w.id as workspace_id, w.name as workspace_name,
      (SELECT COALESCE(json_agg(json_build_object(
        'invoice_number', i.invoice_number,
        'company', c.legal_name,
        'due_date', i.due_date,
        'outstanding', i.grand_total - i.amount_paid
      )), '[]'::json)
      FROM public.invoices i
      JOIN public.companies c ON c.id = i.company_id
      WHERE i.workspace_id = w.id AND i.deleted_at IS NULL
        AND i.status IN ('issued','partially_paid')
        AND i.due_date < CURRENT_DATE
      ) as overdue_invoices,
      (SELECT COALESCE(json_agg(json_build_object(
        'title', l.title,
        'company', COALESCE(lc.legal_name, '—'),
        'next_follow_up', l.next_follow_up
      )), '[]'::json)
      FROM public.leads l
      LEFT JOIN public.companies lc ON lc.id = l.company_id
      WHERE l.workspace_id = w.id AND l.deleted_at IS NULL
        AND l.status IN ('new','contacted','qualified')
        AND l.next_follow_up IS NOT NULL AND l.next_follow_up <= now()
      ) as overdue_followups,
      (SELECT COALESCE(json_agg(json_build_object(
        'project', p.name,
        'company', pc.legal_name,
        'target_end_date', p.target_end_date
      )), '[]'::json)
      FROM public.projects p
      JOIN public.companies pc ON pc.id = p.company_id
      WHERE p.workspace_id = w.id AND p.deleted_at IS NULL
        AND p.status = 'active' AND p.target_end_date IS NOT NULL
        AND p.target_end_date <= (CURRENT_DATE + interval '7 days')
      ) as upcoming_renewals
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
  ) ws_digest;

  RETURN _result;
END;
$$;
