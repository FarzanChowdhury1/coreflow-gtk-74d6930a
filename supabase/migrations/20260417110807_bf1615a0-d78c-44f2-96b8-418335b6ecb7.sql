ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS external_account_number text,
  ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS idx_expenses_due_date
  ON public.expenses (workspace_id, due_date)
  WHERE due_date IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_external_account_number
  ON public.expenses (workspace_id, external_account_number)
  WHERE external_account_number IS NOT NULL AND deleted_at IS NULL;