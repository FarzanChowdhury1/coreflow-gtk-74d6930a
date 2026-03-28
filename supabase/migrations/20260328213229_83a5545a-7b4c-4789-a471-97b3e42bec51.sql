
CREATE OR REPLACE FUNCTION public.get_dashboard_financials(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _month_start date;
  _month_end date;
  _today date;
  _result jsonb;
  _collected numeric;
  _invoiced numeric;
  _outstanding numeric;
  _overdue_count bigint;
  _renewals_count bigint;
  _expense numeric;
  _sub_burn numeric;
  _active_subs bigint;
  _vendors_count bigint;
  _total_budget numeric;
BEGIN
  -- Verify caller is a member of the workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  _today := current_date;
  _month_start := date_trunc('month', _today)::date;
  _month_end := (date_trunc('month', _today) + interval '1 month' - interval '1 day')::date;

  -- Revenue: collected this month
  SELECT COALESCE(SUM(amount), 0) INTO _collected
  FROM payments
  WHERE workspace_id = _workspace_id
    AND paid_at >= _month_start::timestamp
    AND paid_at < (_month_end + 1)::timestamp;

  -- Revenue: invoiced this month
  SELECT COALESCE(SUM(grand_total), 0) INTO _invoiced
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND issue_date >= _month_start
    AND issue_date <= _month_end;

  -- Revenue: outstanding receivable
  SELECT COALESCE(SUM(grand_total - amount_paid), 0) INTO _outstanding
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND status NOT IN ('paid', 'void');

  -- Revenue: overdue invoices
  SELECT COUNT(*) INTO _overdue_count
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND due_date < _today
    AND status NOT IN ('paid', 'void');

  -- Revenue: active renewals
  SELECT COUNT(*) INTO _renewals_count
  FROM renewals
  WHERE workspace_id = _workspace_id
    AND is_active = true;

  -- Spend: expenses this month
  SELECT COALESCE(SUM(amount), 0) INTO _expense
  FROM expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND expense_date >= _month_start
    AND expense_date <= _month_end;

  -- Spend: subscription burn (monthly equivalent)
  SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) INTO _sub_burn
  FROM subscriptions
  WHERE workspace_id = _workspace_id
    AND is_active = true;

  -- Spend: active subscriptions count
  SELECT COUNT(*) INTO _active_subs
  FROM subscriptions
  WHERE workspace_id = _workspace_id
    AND is_active = true;

  -- Spend: vendors count
  SELECT COUNT(*) INTO _vendors_count
  FROM vendors
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL;

  -- Spend: budget this month
  SELECT COALESCE(SUM(target_amount), 0) INTO _total_budget
  FROM budgets
  WHERE workspace_id = _workspace_id
    AND period_start >= _month_start
    AND period_start <= _month_end;

  _result := jsonb_build_object(
    'collected_this_month', _collected,
    'invoiced_this_month', _invoiced,
    'outstanding_receivable', _outstanding,
    'overdue_count', _overdue_count,
    'renewals_count', _renewals_count,
    'expense_this_month', _expense,
    'sub_burn', round(_sub_burn),
    'active_subs_count', _active_subs,
    'vendors_count', _vendors_count,
    'total_budget', _total_budget
  );

  RETURN _result;
END;
$$;

-- Restrict to authenticated users only
REVOKE EXECUTE ON FUNCTION public.get_dashboard_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_financials(uuid) TO authenticated, service_role;
