-- ============================================================
-- A — Bill/Receipt Extraction: closure-pass hardening
-- ============================================================

-- 1) State machine cleanup: remove unreachable 'approved' state.
--    The approval RPC jumps directly to 'expense_created', so 'approved'
--    is decorative and confusing. We migrate any stragglers to 'extracted'
--    (none expected, but safe), drop default refs, then recreate the enum.
DO $$
DECLARE
  _has_approved boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'expense_extraction_status' AND e.enumlabel = 'approved'
  ) INTO _has_approved;

  IF _has_approved THEN
    -- Move any rows currently sitting on 'approved' (transient) back to 'review_required'
    UPDATE public.expense_extraction_jobs
       SET status = 'review_required'
     WHERE status = 'approved'::public.expense_extraction_status;

    -- Recreate the enum without 'approved'
    ALTER TYPE public.expense_extraction_status RENAME TO expense_extraction_status_old;

    CREATE TYPE public.expense_extraction_status AS ENUM (
      'uploaded',
      'processing',
      'extracted',
      'review_required',
      'expense_created',
      'failed',
      'cancelled'
    );

    ALTER TABLE public.expense_extraction_jobs
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE public.expense_extraction_status
        USING status::text::public.expense_extraction_status,
      ALTER COLUMN status SET DEFAULT 'uploaded'::public.expense_extraction_status;

    DROP TYPE public.expense_extraction_status_old;
  END IF;
END $$;

-- 2) Recreate approval RPC without the 'approved' state guard,
--    and write the audit row against the JOB (entity_type=extraction job),
--    plus a second row tying the new expense back to the job.
CREATE OR REPLACE FUNCTION public.approve_extraction_and_create_expense(
  _job_id uuid,
  _description text,
  _amount numeric,
  _currency text,
  _expense_date date,
  _category text,
  _vendor_id uuid,
  _project_id uuid,
  _payment_method text,
  _payment_status text,
  _paid_date date,
  _notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.expense_extraction_jobs%ROWTYPE;
  _new_expense_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _job
  FROM public.expense_extraction_jobs
  WHERE id = _job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extraction job not found';
  END IF;

  IF NOT public.has_workspace_role(auth.uid(), _job.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: workspace admin only';
  END IF;

  -- Idempotency: already created?  Return existing expense id (no-op).
  IF _job.created_expense_id IS NOT NULL THEN
    RETURN _job.created_expense_id;
  END IF;

  -- State guard: only reviewable states may approve
  IF _job.status NOT IN ('extracted', 'review_required') THEN
    RAISE EXCEPTION 'Job is in state % and cannot be approved', _job.status;
  END IF;

  IF _description IS NULL OR length(trim(_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF _currency IS NULL OR length(_currency) <> 3 THEN
    RAISE EXCEPTION 'Currency must be a 3-letter ISO code';
  END IF;
  IF _expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required';
  END IF;
  IF _payment_status NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Invalid payment status';
  END IF;

  IF _vendor_id IS NOT NULL THEN
    PERFORM 1 FROM public.vendors
    WHERE id = _vendor_id AND workspace_id = _job.workspace_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vendor not found in this workspace'; END IF;
  END IF;
  IF _project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects
    WHERE id = _project_id AND workspace_id = _job.workspace_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Project not found in this workspace'; END IF;
  END IF;

  INSERT INTO public.expenses (
    workspace_id, description, amount, currency, expense_date, category,
    vendor_id, project_id, payment_method, payment_status, paid_date, notes,
    recorded_by
  ) VALUES (
    _job.workspace_id, trim(_description), _amount, upper(_currency), _expense_date,
    COALESCE(NULLIF(trim(_category), ''), 'general'),
    _vendor_id, _project_id,
    COALESCE(NULLIF(trim(_payment_method), ''), 'bank_transfer'),
    _payment_status,
    CASE WHEN _payment_status = 'paid' THEN COALESCE(_paid_date, _expense_date) ELSE NULL END,
    NULLIF(trim(_notes), ''),
    auth.uid()
  )
  RETURNING id INTO _new_expense_id;

  IF _job.source_file_id IS NOT NULL THEN
    UPDATE public.files
       SET owner_type = 'expense', owner_id = _new_expense_id, updated_at = now()
     WHERE id = _job.source_file_id
       AND workspace_id = _job.workspace_id;
  END IF;

  UPDATE public.expense_extraction_jobs
     SET status = 'expense_created',
         approved_at = now(),
         approved_by = auth.uid(),
         created_expense_id = _new_expense_id,
         updated_at = now()
   WHERE id = _job_id;

  -- Audit: against the extraction job
  INSERT INTO public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    _job.workspace_id, auth.uid(),
    'expense_extraction_approved', 'expense_extraction_job', _job_id,
    jsonb_build_object(
      'expense_id', _new_expense_id,
      'provider', _job.provider,
      'overall_confidence', _job.overall_confidence
    )
  );

  -- Audit: against the new expense, tying it back to the job
  INSERT INTO public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    _job.workspace_id, auth.uid(),
    'expense_created_from_extraction', 'expense', _new_expense_id,
    jsonb_build_object('extraction_job_id', _job_id, 'provider', _job.provider)
  );

  RETURN _new_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_extraction_and_create_expense(uuid, text, numeric, text, date, text, uuid, uuid, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_extraction_and_create_expense(uuid, text, numeric, text, date, text, uuid, uuid, text, text, date, text) TO authenticated;

-- 3) Audit on job created (insert)
CREATE OR REPLACE FUNCTION public.audit_extraction_job_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.workspace_id, NEW.created_by,
    'expense_extraction_job_created', 'expense_extraction_job', NEW.id,
    jsonb_build_object('provider', NEW.provider)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eej_audit_created ON public.expense_extraction_jobs;
CREATE TRIGGER trg_eej_audit_created
  AFTER INSERT ON public.expense_extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.audit_extraction_job_created();

-- 4) Rate limit RPC: ≤ 10 starts per workspace per rolling 5 minutes,
--    AND ≤ 5 starts per admin per rolling 5 minutes.
--    Counts only INSERTs (job creations), since each insert kicks one extraction.
CREATE OR REPLACE FUNCTION public.rate_limit_extraction_start(_workspace_id uuid, _user_id uuid)
RETURNS TABLE(allowed boolean, retry_after_seconds integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws_count integer;
  _user_count integer;
BEGIN
  SELECT count(*) INTO _ws_count
  FROM public.expense_extraction_jobs
  WHERE workspace_id = _workspace_id
    AND created_at > now() - interval '5 minutes';

  SELECT count(*) INTO _user_count
  FROM public.expense_extraction_jobs
  WHERE workspace_id = _workspace_id
    AND created_by = _user_id
    AND created_at > now() - interval '5 minutes';

  IF _user_count >= 5 THEN
    RETURN QUERY SELECT false, 300, 'You have started too many extractions in the last 5 minutes. Please wait before retrying.';
    RETURN;
  END IF;
  IF _ws_count >= 10 THEN
    RETURN QUERY SELECT false, 300, 'This workspace has started too many extractions in the last 5 minutes. Please wait before retrying.';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_extraction_start(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_extraction_start(uuid, uuid) TO authenticated, service_role;