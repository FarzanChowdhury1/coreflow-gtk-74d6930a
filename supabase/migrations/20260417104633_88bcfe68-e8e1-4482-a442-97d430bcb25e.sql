
-- Observability columns on extraction jobs
ALTER TABLE public.expense_extraction_jobs
  ADD COLUMN IF NOT EXISTS doc_type text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS layout text,
  ADD COLUMN IF NOT EXISTS raw_text text,
  ADD COLUMN IF NOT EXISTS validator_output jsonb,
  ADD COLUMN IF NOT EXISTS user_edited_before_approval boolean NOT NULL DEFAULT false;

-- Workspace-scoped correction log (no learning yet, just structured storage)
CREATE TABLE IF NOT EXISTS public.expense_extraction_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.expense_extraction_jobs(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  extracted_value text,
  corrected_value text,
  field_confidence numeric,
  vendor_name text,
  doc_type text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eec_workspace_vendor ON public.expense_extraction_corrections(workspace_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_eec_workspace_doctype ON public.expense_extraction_corrections(workspace_id, doc_type);

ALTER TABLE public.expense_extraction_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eec admins read" ON public.expense_extraction_corrections;
CREATE POLICY "eec admins read"
  ON public.expense_extraction_corrections
  FOR SELECT
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "eec admins insert" ON public.expense_extraction_corrections;
CREATE POLICY "eec admins insert"
  ON public.expense_extraction_corrections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND created_by = auth.uid()
  );
