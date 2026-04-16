CREATE OR REPLACE FUNCTION public.get_dashboard_financials(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _today date;
  _month_start date;
  _month_end date;
  _result jsonb;
  _revenue_by_currency jsonb;
  _spend_by_currency jsonb;
  _currencies text[];
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

  -- Collect distinct currencies
  SELECT array_agg(DISTINCT c) INTO _currencies
  FROM (
    SELECT currency AS c FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    UNION
    SELECT currency AS c FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    UNION
    SELECT currency AS c FROM budgets WHERE workspace_id = _workspace_id
    UNION
    SELECT currency AS c FROM leads WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND estimated_value IS NOT NULL
    UNION
    SELECT currency AS c FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true
  ) currencies;

  IF _currencies IS NULL THEN
    _currencies := ARRAY[(SELECT COALESCE(currency, 'BDT') FROM workspaces WHERE id = _workspace_id)];
  END IF;

  -- Revenue breakdown by currency
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO _revenue_by_currency
  FROM (
    SELECT
      cur AS currency,
      (SELECT COALESCE(SUM(p.amount), 0)
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.workspace_id = _workspace_id
         AND i.currency = cur
         AND p.paid_at >= _month_start::timestamp
         AND p.paid_at < (_month_end + 1)::timestamp
      ) AS collected_this_month,
      (SELECT COALESCE(SUM(grand_total), 0)
       FROM invoices
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND issue_date >= _month_start AND issue_date <= _month_end
      ) AS invoiced_this_month,
      (SELECT COALESCE(SUM(grand_total - amount_paid), 0)
       FROM invoices
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND status NOT IN ('paid', 'void')
      ) AS outstanding_receivable,
      (SELECT COUNT(*)
       FROM invoices
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND due_date < _today AND status NOT IN ('paid', 'void')
      ) AS overdue_count
    FROM unnest(_currencies) AS cur
    WHERE cur IN (SELECT DISTINCT currency FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL)
       OR cur IN (SELECT DISTINCT i2.currency FROM payments p2 JOIN invoices i2 ON i2.id = p2.invoice_id WHERE p2.workspace_id = _workspace_id AND i2.currency = cur)
  ) r;

  -- Spend breakdown by currency (now includes cash_out and unpaid_payables)
  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO _spend_by_currency
  FROM (
    SELECT
      cur AS currency,
      -- Accrual: expense_date in this month (existing)
      (SELECT COALESCE(SUM(amount), 0)
       FROM expenses
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND expense_date >= _month_start AND expense_date <= _month_end
      ) AS expense_this_month,
      -- Cash basis: paid_date in this month AND payment_status = 'paid'
      (SELECT COALESCE(SUM(amount), 0)
       FROM expenses
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND payment_status = 'paid'
         AND paid_date >= _month_start AND paid_date <= _month_end
      ) AS cash_out_this_month,
      -- Unpaid payables: all unpaid expenses (all time)
      (SELECT COALESCE(SUM(amount), 0)
       FROM expenses
       WHERE workspace_id = _workspace_id AND deleted_at IS NULL
         AND currency = cur
         AND payment_status = 'unpaid'
      ) AS unpaid_payables,
      (SELECT COALESCE(SUM(target_amount), 0)
       FROM budgets
       WHERE workspace_id = _workspace_id
         AND currency = cur
         AND period_start >= _month_start AND period_start <= _month_end
      ) AS total_budget,
      (SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0)
       FROM subscriptions
       WHERE workspace_id = _workspace_id AND is_active = true
         AND currency = cur
      ) AS sub_burn
    FROM unnest(_currencies) AS cur
    WHERE cur IN (SELECT DISTINCT currency FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL)
       OR cur IN (SELECT DISTINCT currency FROM budgets WHERE workspace_id = _workspace_id)
       OR cur IN (SELECT DISTINCT currency FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true)
  ) s;

  -- Non-currency-specific counts
  _result := jsonb_build_object(
    'revenue_by_currency', _revenue_by_currency,
    'spend_by_currency', _spend_by_currency,
    'renewals_count', (SELECT COUNT(*) FROM renewals WHERE workspace_id = _workspace_id AND is_active = true),
    'active_subs_count', (SELECT COUNT(*) FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true),
    'sub_burn', (SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true),
    'vendors_count', (SELECT COUNT(*) FROM vendors WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
    -- Legacy flat fields for backward compat
    'collected_this_month', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _month_start::timestamp AND paid_at < (_month_end + 1)::timestamp),
    'invoiced_this_month', (SELECT COALESCE(SUM(grand_total), 0) FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND issue_date >= _month_start AND issue_date <= _month_end),
    'outstanding_receivable', (SELECT COALESCE(SUM(grand_total - amount_paid), 0) FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status NOT IN ('paid', 'void')),
    'overdue_count', (SELECT COUNT(*) FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND due_date < _today AND status NOT IN ('paid', 'void')),
    'expense_this_month', (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND expense_date >= _month_start AND expense_date <= _month_end),
    -- NEW: cash-basis flat fields
    'cash_out_this_month', (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'paid' AND paid_date >= _month_start AND paid_date <= _month_end),
    'unpaid_payables', (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'unpaid'),
    'unpaid_payables_count', (SELECT COUNT(*) FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'unpaid'),
    'total_budget', (SELECT COALESCE(SUM(target_amount), 0) FROM budgets WHERE workspace_id = _workspace_id AND period_start >= _month_start AND period_start <= _month_end),
    'currencies', to_jsonb(_currencies),
    'is_multi_currency', array_length(_currencies, 1) > 1
  );

  RETURN _result;
END;
$$;

-- Restrict access
REVOKE EXECUTE ON FUNCTION public.get_dashboard_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_financials(uuid) TO authenticated, service_role;