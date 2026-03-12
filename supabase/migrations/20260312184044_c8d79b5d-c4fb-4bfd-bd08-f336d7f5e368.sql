
-- =============================================================
-- Round B3 fix: renewals, short_links, dismiss_system_alert RPC
-- =============================================================

-- 1. Renewals table (recurring billing source of truth)
CREATE TABLE IF NOT EXISTS public.renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  label text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  interval_months int NOT NULL DEFAULT 12,
  next_billing_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage renewals"
  ON public.renewals FOR ALL TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Team members can view assigned project renewals"
  ON public.renewals FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND (project_id IS NULL OR is_project_member((SELECT auth.uid()), project_id))
  );

-- 2. Short links table
CREATE TABLE IF NOT EXISTS public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(6), 'hex'),
  target_url text NOT NULL,
  context_type text,          -- 'portal_invoice','portal_proposal','digest'
  context_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  click_count int NOT NULL DEFAULT 0
);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage short links"
  ON public.short_links FOR ALL TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Members can view short links"
  ON public.short_links FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

-- 3. Replace sweep_renewal_reminders to use renewals table
CREATE OR REPLACE FUNCTION public.sweep_renewal_reminders()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _count int := 0;
  _r record;
BEGIN
  FOR _r IN
    SELECT r.id, r.workspace_id, r.label, r.next_billing_date, r.amount, r.currency,
           c.legal_name as company_name
    FROM public.renewals r
    JOIN public.companies c ON c.id = r.company_id
    WHERE r.is_active = true
      AND r.next_billing_date <= (CURRENT_DATE + interval '30 days')
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (
      _r.workspace_id,
      'renewal_reminder',
      'renewal',
      _r.id,
      CASE WHEN _r.next_billing_date < CURRENT_DATE THEN 'Overdue renewal: ' ELSE 'Upcoming renewal: ' END || _r.label,
      _r.company_name || ' — ' || _r.currency || ' ' || _r.amount::text || ' due ' || _r.next_billing_date::text,
      CASE WHEN _r.next_billing_date < CURRENT_DATE THEN 'critical'
           WHEN _r.next_billing_date <= (CURRENT_DATE + interval '7 days') THEN 'warning'
           ELSE 'info' END,
      'renewal_reminder::' || _r.id::text
    )
    ON CONFLICT (sweep_key) DO UPDATE SET
      body = EXCLUDED.body,
      severity = EXCLUDED.severity,
      is_dismissed = false;
    _count := _count + 1;
  END LOOP;

  -- Clear stale alerts for renewals no longer approaching
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type = 'renewal_reminder' AND is_dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.renewals r
      WHERE r.id = system_alerts.entity_id
        AND r.is_active = true
        AND r.next_billing_date <= (CURRENT_DATE + interval '30 days')
    );

  RETURN json_build_object('swept', _count);
END;
$$;

-- 4. Update select_retention_candidates to include short_links
CREATE OR REPLACE FUNCTION public.select_retention_candidates()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _stale_files json;
  _expired_tokens json;
  _expired_short_links json;
BEGIN
  SELECT COALESCE(json_agg(json_build_object(
    'id', f.id, 'storage_path', f.storage_path, 'workspace_id', f.workspace_id, 'deleted_at', f.deleted_at
  )), '[]'::json) INTO _stale_files
  FROM public.files f
  WHERE f.deleted_at IS NOT NULL AND f.deleted_at < (now() - interval '30 days');

  SELECT COALESCE(json_agg(json_build_object(
    'id', pt.id, 'workspace_id', pt.workspace_id, 'expires_at', pt.expires_at
  )), '[]'::json) INTO _expired_tokens
  FROM public.portal_tokens pt
  WHERE pt.expires_at < now();

  SELECT COALESCE(json_agg(json_build_object(
    'id', sl.id, 'workspace_id', sl.workspace_id, 'code', sl.code, 'expires_at', sl.expires_at
  )), '[]'::json) INTO _expired_short_links
  FROM public.short_links sl
  WHERE sl.expires_at < now();

  RETURN json_build_object(
    'stale_files', _stale_files,
    'expired_portal_tokens', _expired_tokens,
    'expired_short_links', _expired_short_links
  );
END;
$$;

-- 5. Purge expired short_links
CREATE OR REPLACE FUNCTION public.purge_expired_short_links()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _count int;
BEGIN
  DELETE FROM public.short_links WHERE expires_at < now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN json_build_object('purged_short_links', _count);
END;
$$;

-- 6. Dismiss system alert RPC (backend-controlled mutation)
CREATE OR REPLACE FUNCTION public.dismiss_system_alert(_alert_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _user_id uuid;
  _alert record;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO _alert FROM public.system_alerts WHERE id = _alert_id;
  IF _alert IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Alert not found');
  END IF;

  -- Check workspace access
  IF NOT has_workspace_access(_user_id, _alert.workspace_id) THEN
    RETURN json_build_object('success', false, 'error', 'Access denied');
  END IF;

  UPDATE public.system_alerts
  SET is_dismissed = true, dismissed_at = now()
  WHERE id = _alert_id;

  RETURN json_build_object('success', true);
END;
$$;

-- 7. Create short_link helper RPC for digest
CREATE OR REPLACE FUNCTION public.create_short_link(
  _workspace_id uuid,
  _target_url text,
  _context_type text DEFAULT NULL,
  _context_id uuid DEFAULT NULL,
  _ttl_days int DEFAULT 30
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _code text;
  _id uuid;
BEGIN
  _code := encode(extensions.gen_random_bytes(6), 'hex');
  INSERT INTO public.short_links (workspace_id, code, target_url, context_type, context_id, expires_at)
  VALUES (_workspace_id, _code, _target_url, _context_type, _context_id, now() + (_ttl_days || ' days')::interval)
  RETURNING id INTO _id;

  RETURN json_build_object('id', _id, 'code', _code);
END;
$$;

-- 8. Update aggregate_daily_digest to use renewals table
CREATE OR REPLACE FUNCTION public.aggregate_daily_digest()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _result json;
BEGIN
  SELECT COALESCE(json_agg(ws_digest), '[]'::json) INTO _result
  FROM (
    SELECT w.id as workspace_id, w.name as workspace_name,
      (SELECT COALESCE(json_agg(json_build_object(
        'invoice_id', i.id,
        'invoice_number', i.invoice_number,
        'company', c.legal_name,
        'company_id', i.company_id,
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
        'lead_id', l.id,
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
        'renewal_id', r.id,
        'label', r.label,
        'company', rc.legal_name,
        'company_id', r.company_id,
        'amount', r.amount,
        'currency', r.currency,
        'next_billing_date', r.next_billing_date
      )), '[]'::json)
      FROM public.renewals r
      JOIN public.companies rc ON rc.id = r.company_id
      WHERE r.workspace_id = w.id AND r.is_active = true
        AND r.next_billing_date <= (CURRENT_DATE + interval '7 days')
      ) as upcoming_renewals
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
  ) ws_digest;

  RETURN _result;
END;
$$;

-- 9. Update system_alerts RLS: remove direct UPDATE for non-admin authenticated
-- Admins manage via RPC now; keep SELECT policies only for team members
-- (The existing "Admins can manage system alerts" ALL policy is fine since
-- dismiss goes through SECURITY DEFINER RPC which bypasses RLS)
