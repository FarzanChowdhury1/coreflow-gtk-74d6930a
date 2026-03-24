
-- D. Fix bootstrap_workspace identity spoof: enforce _user_id = auth.uid()
CREATE OR REPLACE FUNCTION public.bootstrap_workspace(_user_id uuid, _name text DEFAULT 'My Workspace'::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ws_id uuid;
  _membership_id uuid;
  _caller_id uuid;
BEGIN
  _caller_id := auth.uid();
  
  -- HARDENED: Prevent identity spoofing — caller must be bootstrapping for themselves
  IF _caller_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;
  
  IF _user_id != _caller_id THEN
    RETURN json_build_object('error', 'Cannot create workspace for another user');
  END IF;
  
  -- Create workspace
  INSERT INTO public.workspaces (name) VALUES (_name) RETURNING id INTO _ws_id;
  
  -- Create admin membership
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
  VALUES (_ws_id, _user_id, 'admin')
  RETURNING id INTO _membership_id;
  
  RETURN json_build_object(
    'workspace_id', _ws_id,
    'membership_id', _membership_id
  );
END;
$$;

-- E. Harden purge functions: restrict to service_role only by checking auth.uid() IS NULL
-- (service_role calls have auth.uid() = NULL; authenticated users always have a non-null uid)

-- purge_stale_file_rows: already safe (SECURITY DEFINER, no user input) — but add service-role guard
CREATE OR REPLACE FUNCTION public.purge_stale_file_rows()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count int;
  _paths json;
BEGIN
  -- Guard: only callable by service_role (auth.uid() is NULL for service_role)
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This function can only be called by system workers';
  END IF;

  SELECT COALESCE(json_agg(storage_path), '[]'::json) INTO _paths
  FROM public.files
  WHERE deleted_at IS NOT NULL AND deleted_at < (now() - interval '30 days');

  DELETE FROM public.files
  WHERE deleted_at IS NOT NULL AND deleted_at < (now() - interval '30 days');
  GET DIAGNOSTICS _count = ROW_COUNT;

  RETURN json_build_object('purged_files', _count, 'storage_paths', _paths);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_operational_logs()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _digest_count int;
  _worker_count int;
  _email_count int;
BEGIN
  -- Guard: only callable by service_role
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This function can only be called by system workers';
  END IF;

  DELETE FROM public.digest_runs WHERE executed_at < now() - (retention_days_ops_log('digest_runs') || ' days')::interval;
  GET DIAGNOSTICS _digest_count = ROW_COUNT;

  DELETE FROM public.worker_runs WHERE started_at < now() - (retention_days_ops_log('worker_runs') || ' days')::interval;
  GET DIAGNOSTICS _worker_count = ROW_COUNT;

  DELETE FROM public.email_logs WHERE created_at < now() - (retention_days_ops_log('email_logs') || ' days')::interval;
  GET DIAGNOSTICS _email_count = ROW_COUNT;

  RETURN json_build_object(
    'purged_digest_runs', _digest_count,
    'purged_worker_runs', _worker_count,
    'purged_email_logs', _email_count
  );
END;
$$;

-- aggregate_daily_digest: already safe (read-only, SECURITY DEFINER) — add service-role guard
CREATE OR REPLACE FUNCTION public.aggregate_daily_digest()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result json;
BEGIN
  -- Guard: only callable by service_role (scheduled worker)
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This function can only be called by system workers';
  END IF;

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

-- create_worker_failure_alert: add service-role guard
CREATE OR REPLACE FUNCTION public.create_worker_failure_alert(_worker_name text, _error_summary text DEFAULT 'Unknown error'::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consecutive int;
  _severity text;
  _title text;
  _body text;
  _admin record;
BEGIN
  -- Guard: only callable by service_role
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This function can only be called by system workers';
  END IF;

  SELECT COUNT(*) INTO _consecutive
  FROM (
    SELECT status, ROW_NUMBER() OVER (ORDER BY started_at DESC) as rn
    FROM public.worker_runs
    WHERE worker_name = _worker_name
    ORDER BY started_at DESC
    LIMIT 10
  ) ranked
  WHERE ranked.status = 'failed'
    AND ranked.rn <= (
      SELECT COALESCE(MIN(rn2.rn) - 1, 10)
      FROM (
        SELECT status, ROW_NUMBER() OVER (ORDER BY started_at DESC) as rn
        FROM public.worker_runs
        WHERE worker_name = _worker_name
        ORDER BY started_at DESC
        LIMIT 10
      ) rn2
      WHERE rn2.status != 'failed'
    );

  _severity := CASE WHEN _consecutive >= 3 THEN 'critical'
                     WHEN _consecutive >= 2 THEN 'warning'
                     ELSE 'info' END;

  _title := CASE
    WHEN _consecutive >= 3 THEN '[CRITICAL] Worker failing repeatedly: ' || _worker_name
    WHEN _consecutive >= 2 THEN '[WARNING] Worker failing repeatedly: ' || _worker_name
    ELSE 'Worker failed: ' || _worker_name
  END;

  _body := _error_summary;
  IF _consecutive >= 2 THEN
    _body := _consecutive || ' consecutive failure(s). Latest: ' || _error_summary;
  END IF;

  FOR _admin IN
    SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
    FROM public.workspace_memberships wm
    WHERE wm.role = 'admin'
    ORDER BY wm.user_id, wm.created_at ASC
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = _admin.user_id
        AND is_read = false
        AND title LIKE '%Worker fail%' || _worker_name || '%'
        AND created_at > (now() - interval '1 hour')
    ) THEN
      INSERT INTO public.notifications (workspace_id, user_id, title, body, link, severity)
      VALUES (_admin.workspace_id, _admin.user_id, _title, _body, '/ops', _severity);
    END IF;
  END LOOP;
END;
$$;

-- generate_due_renewal_invoices: add service-role guard (called by scheduled worker only)
CREATE OR REPLACE FUNCTION public.generate_due_renewal_invoices()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r RECORD;
  _result json;
  _generated int := 0;
  _skipped int := 0;
  _errors int := 0;
BEGIN
  -- Guard: only callable by service_role (scheduled sweep)
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This function can only be called by system workers';
  END IF;

  FOR _r IN
    SELECT id
    FROM public.renewals
    WHERE is_active = true
      AND next_billing_date <= CURRENT_DATE
      AND amount > 0
      AND (last_generated_billing_date IS NULL OR last_generated_billing_date < next_billing_date)
    ORDER BY next_billing_date ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _result := _generate_renewal_invoice_internal(_r.id);
      IF (_result->>'success')::boolean THEN
        _generated := _generated + 1;
      ELSE
        _skipped := _skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'generated', _generated,
    'skipped', _skipped,
    'errors', _errors
  );
END;
$$;
