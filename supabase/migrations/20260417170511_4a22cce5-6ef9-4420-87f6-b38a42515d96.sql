-- BDT-only currency lock + dashboard financials cleanup
-- Safety verified: 0 non-BDT rows in any currency-bearing table

-- 1) Forward-only BDT-only CHECK constraints (idempotent: drop if exists, then add)
ALTER TABLE public.workspaces        DROP CONSTRAINT IF EXISTS workspaces_currency_bdt_only;
ALTER TABLE public.workspaces        ADD  CONSTRAINT workspaces_currency_bdt_only        CHECK (currency = 'BDT');

ALTER TABLE public.leads             DROP CONSTRAINT IF EXISTS leads_currency_bdt_only;
ALTER TABLE public.leads             ADD  CONSTRAINT leads_currency_bdt_only             CHECK (currency = 'BDT');

ALTER TABLE public.invoices          DROP CONSTRAINT IF EXISTS invoices_currency_bdt_only;
ALTER TABLE public.invoices          ADD  CONSTRAINT invoices_currency_bdt_only          CHECK (currency = 'BDT');

ALTER TABLE public.expenses          DROP CONSTRAINT IF EXISTS expenses_currency_bdt_only;
ALTER TABLE public.expenses          ADD  CONSTRAINT expenses_currency_bdt_only          CHECK (currency = 'BDT');

ALTER TABLE public.subscriptions     DROP CONSTRAINT IF EXISTS subscriptions_currency_bdt_only;
ALTER TABLE public.subscriptions     ADD  CONSTRAINT subscriptions_currency_bdt_only     CHECK (currency = 'BDT');

ALTER TABLE public.budgets           DROP CONSTRAINT IF EXISTS budgets_currency_bdt_only;
ALTER TABLE public.budgets           ADD  CONSTRAINT budgets_currency_bdt_only           CHECK (currency = 'BDT');

ALTER TABLE public.renewals          DROP CONSTRAINT IF EXISTS renewals_currency_bdt_only;
ALTER TABLE public.renewals          ADD  CONSTRAINT renewals_currency_bdt_only          CHECK (currency = 'BDT');

ALTER TABLE public.proposal_versions DROP CONSTRAINT IF EXISTS proposal_versions_currency_bdt_only;
ALTER TABLE public.proposal_versions ADD  CONSTRAINT proposal_versions_currency_bdt_only CHECK (currency = 'BDT');

-- 2) Strip multi-currency fields from get_dashboard_financials RPC.
-- Preserves the flat single-currency contract used by DashboardBreakdowns (BDT only).
CREATE OR REPLACE FUNCTION public.get_dashboard_financials(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id UUID;
  _today date;
  _month_start date;
  _month_end date;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  _today := current_date;
  _month_start := date_trunc('month', _today)::date;
  _month_end := (date_trunc('month', _today) + interval '1 month' - interval '1 day')::date;

  RETURN jsonb_build_object(
    'renewals_count',          (SELECT COUNT(*) FROM renewals      WHERE workspace_id = _workspace_id AND is_active = true),
    'active_subs_count',       (SELECT COUNT(*) FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true),
    'sub_burn',                (SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true),
    'vendors_count',           (SELECT COUNT(*) FROM vendors       WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
    'collected_this_month',    (SELECT COALESCE(SUM(amount), 0)            FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _month_start::timestamp AND paid_at < (_month_end + 1)::timestamp),
    'invoiced_this_month',     (SELECT COALESCE(SUM(grand_total), 0)       FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND issue_date >= _month_start AND issue_date <= _month_end),
    'outstanding_receivable',  (SELECT COALESCE(SUM(grand_total - amount_paid), 0) FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status NOT IN ('paid', 'void')),
    'overdue_count',           (SELECT COUNT(*)                            FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND due_date < _today AND status NOT IN ('paid', 'void')),
    'expense_this_month',      (SELECT COALESCE(SUM(amount), 0)            FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND expense_date >= _month_start AND expense_date <= _month_end),
    'cash_out_this_month',     (SELECT COALESCE(SUM(amount), 0)            FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'paid' AND paid_date >= _month_start AND paid_date <= _month_end),
    'unpaid_payables',         (SELECT COALESCE(SUM(amount), 0)            FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'unpaid'),
    'unpaid_payables_count',   (SELECT COUNT(*)                            FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'unpaid'),
    'total_budget',            (SELECT COALESCE(SUM(target_amount), 0)     FROM budgets  WHERE workspace_id = _workspace_id AND period_start >= _month_start AND period_start <= _month_end)
  );
END;
$function$;