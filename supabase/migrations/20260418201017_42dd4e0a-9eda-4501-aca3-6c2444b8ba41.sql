CREATE OR REPLACE FUNCTION public.get_finance_analytics(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _today date := current_date;
  _trend_start date := (date_trunc('month', _today) - interval '11 months')::date;
  _ttm_start date := (_today - interval '12 months')::date;
  _trends jsonb;
  _dso numeric;
  _dpo numeric;
  _receivables numeric;
  _payables numeric;
  _overdue_amount numeric;
  _overdue_count int;
  _cash_in numeric;
  _cash_out numeric;
  _ttm_invoiced numeric;
  _ttm_collected numeric;
  _collection_rate numeric;
  _sub_burn numeric;
  _last3_invoiced numeric;
  _prev3_invoiced numeric;
  _trend_pct numeric;
  _band text;
  _score int;
  _drivers jsonb := '[]'::jsonb;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  -- 12-month trend (rolling)
  WITH months AS (
    SELECT generate_series(_trend_start, date_trunc('month', _today)::date, '1 month')::date AS m
  ),
  inv AS (
    SELECT date_trunc('month', issue_date)::date AS m, SUM(grand_total) AS amt
    FROM invoices
    WHERE workspace_id = _workspace_id
      AND deleted_at IS NULL
      AND status <> 'void'
      AND issue_date IS NOT NULL
      AND issue_date >= _trend_start
    GROUP BY 1
  ),
  pay AS (
    SELECT date_trunc('month', paid_at)::date AS m, SUM(amount) AS amt
    FROM payments
    WHERE workspace_id = _workspace_id
      AND paid_at >= _trend_start::timestamptz
    GROUP BY 1
  ),
  exp AS (
    SELECT date_trunc('month', paid_date)::date AS m, SUM(amount) AS amt
    FROM expenses
    WHERE workspace_id = _workspace_id
      AND deleted_at IS NULL
      AND payment_status = 'paid'
      AND paid_date IS NOT NULL
      AND paid_date >= _trend_start
    GROUP BY 1
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'month', to_char(months.m, 'YYYY-MM'),
      'invoiced', COALESCE(inv.amt, 0),
      'collected', COALESCE(pay.amt, 0),
      'expenses_paid', COALESCE(exp.amt, 0)
    ) ORDER BY months.m
  )
  INTO _trends
  FROM months
  LEFT JOIN inv ON inv.m = months.m
  LEFT JOIN pay ON pay.m = months.m
  LEFT JOIN exp ON exp.m = months.m;

  -- DSO: avg(paid_at - issue_date) over invoices fully paid in last 12 months
  -- Uses the LATEST payment as the closing event.
  WITH closed AS (
    SELECT i.id,
           i.issue_date,
           MAX(p.paid_at)::date AS closed_at
    FROM invoices i
    JOIN payments p ON p.invoice_id = i.id AND p.workspace_id = i.workspace_id
    WHERE i.workspace_id = _workspace_id
      AND i.deleted_at IS NULL
      AND i.status = 'paid'
      AND i.issue_date IS NOT NULL
      AND p.paid_at >= _ttm_start::timestamptz
    GROUP BY i.id, i.issue_date
    HAVING MAX(p.paid_at)::date >= i.issue_date
  )
  SELECT AVG(closed_at - issue_date)::numeric INTO _dso FROM closed;

  -- DPO: avg(paid_date - due_date offset by expense_date if no due) for expenses paid in last 12 months
  -- Anchor: prefer (expense_date) as obligation start; days_to_pay = paid_date - expense_date.
  SELECT AVG(GREATEST(paid_date - expense_date, 0))::numeric INTO _dpo
  FROM expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND payment_status = 'paid'
    AND paid_date IS NOT NULL
    AND expense_date IS NOT NULL
    AND paid_date >= _ttm_start;

  -- Outstanding receivables / payables / overdue
  SELECT COALESCE(SUM(grand_total - amount_paid), 0)
  INTO _receivables
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND status NOT IN ('paid','void');

  SELECT COALESCE(SUM(grand_total - amount_paid), 0), COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND status NOT IN ('paid','void')
    AND due_date IS NOT NULL
    AND due_date < _today;

  SELECT COALESCE(SUM(amount), 0)
  INTO _payables
  FROM expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  -- Cash in/out (last 30 days for snapshot)
  SELECT COALESCE(SUM(amount), 0) INTO _cash_in
  FROM payments
  WHERE workspace_id = _workspace_id
    AND paid_at >= (_today - interval '30 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out
  FROM expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND payment_status = 'paid'
    AND paid_date >= (_today - interval '30 days');

  -- Collection health (TTM)
  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_invoiced
  FROM invoices
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND status <> 'void'
    AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_collected
  FROM payments
  WHERE workspace_id = _workspace_id
    AND paid_at >= _ttm_start::timestamptz;

  _collection_rate := CASE WHEN _ttm_invoiced > 0
                           THEN LEAST(_ttm_collected / _ttm_invoiced, 1.5)
                           ELSE NULL END;

  -- Subscription monthly burn
  SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) INTO _sub_burn
  FROM subscriptions
  WHERE workspace_id = _workspace_id AND is_active = true;

  -- Trend: last 3 months invoiced vs prior 3 months
  SELECT COALESCE(SUM(grand_total), 0) INTO _last3_invoiced
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '2 months')::date;

  SELECT COALESCE(SUM(grand_total), 0) INTO _prev3_invoiced
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '5 months')::date
    AND issue_date <  (date_trunc('month', _today) - interval '2 months')::date;

  _trend_pct := CASE WHEN _prev3_invoiced > 0
                     THEN ((_last3_invoiced - _prev3_invoiced) / _prev3_invoiced) * 100
                     ELSE NULL END;

  -- Health scoring (0-100), rule-based and explicit
  _score := 100;

  IF _collection_rate IS NULL THEN
    _drivers := _drivers || jsonb_build_object('label','Insufficient invoicing history','impact','neutral');
  ELSIF _collection_rate < 0.6 THEN
    _score := _score - 30;
    _drivers := _drivers || jsonb_build_object('label','Low collection rate','impact','negative','value',round(_collection_rate*100));
  ELSIF _collection_rate < 0.85 THEN
    _score := _score - 15;
    _drivers := _drivers || jsonb_build_object('label','Moderate collection rate','impact','warning','value',round(_collection_rate*100));
  ELSE
    _drivers := _drivers || jsonb_build_object('label','Healthy collection rate','impact','positive','value',round(_collection_rate*100));
  END IF;

  IF _overdue_amount > 0 AND _ttm_invoiced > 0 THEN
    IF _overdue_amount / NULLIF(_ttm_invoiced,0) > 0.25 THEN
      _score := _score - 25;
      _drivers := _drivers || jsonb_build_object('label','High overdue exposure','impact','negative','value',_overdue_count);
    ELSIF _overdue_amount / NULLIF(_ttm_invoiced,0) > 0.10 THEN
      _score := _score - 10;
      _drivers := _drivers || jsonb_build_object('label','Some overdue invoices','impact','warning','value',_overdue_count);
    END IF;
  END IF;

  IF _payables > 0 AND _cash_in > 0 AND _payables > _cash_in * 2 THEN
    _score := _score - 15;
    _drivers := _drivers || jsonb_build_object('label','Payables exceed recent cash in','impact','negative');
  END IF;

  IF _trend_pct IS NULL THEN
    -- ignored
    NULL;
  ELSIF _trend_pct <= -20 THEN
    _score := _score - 20;
    _drivers := _drivers || jsonb_build_object('label','Revenue trending down','impact','negative','value',round(_trend_pct));
  ELSIF _trend_pct >= 10 THEN
    _drivers := _drivers || jsonb_build_object('label','Revenue trending up','impact','positive','value',round(_trend_pct));
  END IF;

  IF _sub_burn > 0 AND _cash_in > 0 AND _sub_burn > _cash_in * 0.5 THEN
    _score := _score - 10;
    _drivers := _drivers || jsonb_build_object('label','Heavy subscription burden','impact','warning');
  END IF;

  _score := GREATEST(0, LEAST(100, _score));

  _band := CASE
    WHEN _ttm_invoiced = 0 AND _cash_in = 0 AND _payables = 0 THEN 'insufficient_data'
    WHEN _score >= 80 THEN 'healthy'
    WHEN _score >= 65 THEN 'stable'
    WHEN _score >= 45 THEN 'watchlist'
    ELSE 'at_risk'
  END;

  RETURN jsonb_build_object(
    'trends', COALESCE(_trends, '[]'::jsonb),
    'health', jsonb_build_object(
      'band', _band,
      'score', _score,
      'drivers', _drivers,
      'collection_rate', _collection_rate,
      'trend_pct', _trend_pct
    ),
    'cash_conversion', jsonb_build_object(
      'dso_days', _dso,
      'dpo_days', _dpo,
      'ccc_days', CASE WHEN _dso IS NOT NULL AND _dpo IS NOT NULL THEN _dso - _dpo ELSE NULL END,
      'receivables', _receivables,
      'overdue_amount', _overdue_amount,
      'overdue_count', _overdue_count,
      'payables', _payables,
      'cash_in_30d', _cash_in,
      'cash_out_30d', _cash_out,
      'net_cash_30d', _cash_in - _cash_out,
      'sufficient_data', (_dso IS NOT NULL OR _dpo IS NOT NULL)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_finance_analytics(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_finance_analytics(uuid) TO authenticated;