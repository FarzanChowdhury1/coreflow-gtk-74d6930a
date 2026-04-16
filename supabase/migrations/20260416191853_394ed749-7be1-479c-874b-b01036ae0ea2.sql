-- ============================================================
-- Bill / receipt extraction infrastructure
-- ============================================================

-- 1. State machine enum (truthful states only)
DO $$ BEGIN
  CREATE TYPE public.expense_extraction_status AS ENUM (
    'uploaded',          -- file attached, not yet sent to provider
    'processing',        -- in-flight to provider
    'extracted',         -- provider returned data, low/no review needed
    'review_required',   -- provider returned data, needs human review
    'approved',          -- reviewer approved, expense create in progress
    'expense_created',   -- terminal: real expense row exists
    'failed',            -- terminal: provider/parse error, may retry
    'cancelled'          -- terminal: user cancelled
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Job table
CREATE TABLE IF NOT EXISTS public.expense_extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  source_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  source_storage_path text,
  source_mime_type text,
  source_file_name text,
  provider text NOT NULL DEFAULT 'lovable_ai_gemini',
  provider_model text,
  status public.expense_extraction_status NOT NULL DEFAULT 'uploaded',
  raw_payload_json jsonb,
  normalized_data_json jsonb,
  overall_confidence numeric(4,3),
  review_required boolean NOT NULL DEFAULT true,
  failure_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  extraction_started_at timestamptz,
  extracted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  cancelled_at timestamptz,
  created_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eej_workspace_status_created
  ON public.expense_extraction_jobs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eej_created_by
  ON public.expense_extraction_jobs (created_by);
-- Idempotency: at most one expense per job
CREATE UNIQUE INDEX IF NOT EXISTS uq_eej_created_expense
  ON public.expense_extraction_jobs (created_expense_id)
  WHERE created_expense_id IS NOT NULL;

-- updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS trg_eej_updated_at ON public.expense_extraction_jobs;
CREATE TRIGGER trg_eej_updated_at
  BEFORE UPDATE ON public.expense_extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS — admins only (expenses are admin-only)
ALTER TABLE public.expense_extraction_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eej admins select" ON public.expense_extraction_jobs;
CREATE POLICY "eej admins select"
  ON public.expense_extraction_jobs FOR SELECT
  USING (public.has_workspace_role(auth.uid(), workspace_id, 'admin'));

DROP POLICY IF EXISTS "eej admins insert" ON public.expense_extraction_jobs;
CREATE POLICY "eej admins insert"
  ON public.expense_extraction_jobs FOR INSERT
  WITH CHECK (
    public.has_workspace_role(auth.uid(), workspace_id, 'admin')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "eej admins update" ON public.expense_extraction_jobs;
CREATE POLICY "eej admins update"
  ON public.expense_extraction_jobs FOR UPDATE
  USING (public.has_workspace_role(auth.uid(), workspace_id, 'admin'))
  WITH CHECK (public.has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- No DELETE policy: jobs are audit records. Use cancelled status instead.

-- 4. Allow 'expense_receipt' owner_type for file uploads
-- (file-gateway already validates owner_type via its own allowlist;
--  we also reflect this in the audit trigger if there is a constraint)
-- No DB constraint exists on files.owner_type, so nothing schema-side to change.

-- 5. RPC: approve job and create expense atomically with idempotency
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

  -- Lock the job row to prevent concurrent approval
  SELECT * INTO _job
  FROM public.expense_extraction_jobs
  WHERE id = _job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extraction job not found';
  END IF;

  -- Authorization: workspace admin
  IF NOT public.has_workspace_role(auth.uid(), _job.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: workspace admin only';
  END IF;

  -- Idempotency: already created?
  IF _job.created_expense_id IS NOT NULL THEN
    RETURN _job.created_expense_id;
  END IF;

  -- State guard: must be in extracted/review_required/approved
  IF _job.status NOT IN ('extracted', 'review_required', 'approved') THEN
    RAISE EXCEPTION 'Job is in state % and cannot be approved', _job.status;
  END IF;

  -- Validate inputs
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

  -- Cross-workspace guards on FKs
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

  -- Create the expense
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

  -- Re-link source file to the new expense (move ownership from receipt staging to the expense)
  IF _job.source_file_id IS NOT NULL THEN
    UPDATE public.files
       SET owner_type = 'expense', owner_id = _new_expense_id, updated_at = now()
     WHERE id = _job.source_file_id
       AND workspace_id = _job.workspace_id;
  END IF;

  -- Mark job terminal
  UPDATE public.expense_extraction_jobs
     SET status = 'expense_created',
         approved_at = now(),
         approved_by = auth.uid(),
         created_expense_id = _new_expense_id,
         updated_at = now()
   WHERE id = _job_id;

  -- Audit
  INSERT INTO public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    _job.workspace_id, auth.uid(), 'expense_extraction_approved', 'expense', _new_expense_id,
    jsonb_build_object('extraction_job_id', _job_id, 'provider', _job.provider, 'overall_confidence', _job.overall_confidence)
  );

  RETURN _new_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_extraction_and_create_expense(uuid, text, numeric, text, date, text, uuid, uuid, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_extraction_and_create_expense(uuid, text, numeric, text, date, text, uuid, uuid, text, text, date, text) TO authenticated;

-- 6. RPC: cancel job
CREATE OR REPLACE FUNCTION public.cancel_extraction_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.expense_extraction_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _job FROM public.expense_extraction_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT public.has_workspace_role(auth.uid(), _job.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _job.status IN ('expense_created', 'cancelled') THEN
    RETURN; -- no-op on terminal
  END IF;

  UPDATE public.expense_extraction_jobs
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = _job_id;

  INSERT INTO public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (_job.workspace_id, auth.uid(), 'expense_extraction_cancelled', 'expense_extraction_job', _job_id,
          jsonb_build_object('previous_status', _job.status));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_extraction_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_extraction_job(uuid) TO authenticated;