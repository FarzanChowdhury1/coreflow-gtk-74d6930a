
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS paid_date date;

-- Backfill: all existing expenses are considered paid on their expense_date
UPDATE public.expenses SET paid_date = expense_date WHERE paid_date IS NULL;

COMMENT ON COLUMN public.expenses.payment_status IS 'paid or unpaid — tracks whether the expense has been settled';
COMMENT ON COLUMN public.expenses.paid_date IS 'Date the expense was actually paid (null if still unpaid)';
