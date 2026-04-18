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
  _dso_count int := 0;
  _dpo_count int := 0;
  _dpo_due_count int := 0;
  _dpo_fallback_count int := 0;
  _dpo_basis text := 'insufficient_data';
  _can_compute_dso boolean := false;
  _can_compute_dpo boolean := false;
  _can_compute_ccc boolean := false;
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
  _budget_target numeric;
  _budget_actual numeric;
  _budget_period_start date;
  _budget_period_end date;
  _budget_ratio numeric;
  _budget_status text := 'none';
  _budget_row_count int := 0;
  _summary text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  -- 12-month trend
  WITH months AS (
    SELECT generate_series(_trend_start, date_trunc('month', _today)::date, '1 month')::date AS m
  ),
  inv AS (
    SELECT date_trunc('month', issue_date)::date AS m, SUM(grand_total) AS amt
    FROM invoices
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
      AND issue_date IS NOT NULL AND issue_date >= _trend_start
    GROUP BY 1
  ),
  pay AS (
    SELECT date_trunc('month', paid_at)::date AS m, SUM(amount) AS amt
    FROM payments
    WHERE workspace_id = _workspace_id AND paid_at >= _trend_start::timestamptz
    GROUP BY 1
  ),
  exp AS (
    SELECT date_trunc('month', paid_date)::date AS m, SUM(amount) AS amt
    FROM expenses
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND payment_status = 'paid' AND paid_date IS NOT NULL AND paid_date >= _trend_start
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

  -- DSO
  WITH closed AS (
    SELECT i.id, i.issue_date, MAX(p.paid_at)::date AS closed_at
    FROM invoices i
    JOIN payments p ON p.invoice_id = i.id AND p.workspace_id = i.workspace_id
    WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
      AND i.status = 'paid' AND i.issue_date IS NOT NULL
      AND p.paid_at >= _ttm_start::timestamptz
    GROUP BY i.id, i.issue_date
    HAVING MAX(p.paid_at)::date >= i.issue_date
  )
  SELECT AVG(closed_at - issue_date)::numeric, COUNT(*)
  INTO _dso, _dso_count FROM closed;

  _can_compute_dso := _dso_count >= 3 AND _dso IS NOT NULL;
  IF NOT _can_compute_dso THEN _dso := NULL; END IF;

  -- DPO
  WITH dpo_calc AS (
    SELECT
      CASE
        WHEN due_date IS NOT NULL THEN GREATEST(paid_date - due_date, 0)
        WHEN expense_date IS NOT NULL THEN GREATEST(paid_date - expense_date, 0)
        ELSE NULL
      END AS days,
      (due_date IS NOT NULL) AS has_due
    FROM expenses
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND payment_status = 'paid' AND paid_date IS NOT NULL
      AND paid_date >= _ttm_start
  )
  SELECT AVG(days)::numeric, COUNT(*) FILTER (WHERE days IS NOT NULL),
         COUNT(*) FILTER (WHERE has_due AND days IS NOT NULL),
         COUNT(*) FILTER (WHERE NOT has_due AND days IS NOT NULL)
  INTO _dpo, _dpo_count, _dpo_due_count, _dpo_fallback_count
  FROM dpo_calc;

  _can_compute_dpo := _dpo_count >= 3 AND _dpo IS NOT NULL;
  -- Honest basis: if both materially used (each >= 20% of samples), report "mixed"
  IF NOT _can_compute_dpo THEN
    _dpo := NULL;
    _dpo_basis := 'insufficient_data';
  ELSIF _dpo_due_count > 0 AND _dpo_fallback_count > 0
        AND _dpo_due_count::numeric / _dpo_count >= 0.20
        AND _dpo_fallback_count::numeric / _dpo_count >= 0.20 THEN
    _dpo_basis := 'mixed';
  ELSIF _dpo_due_count >= _dpo_fallback_count THEN
    _dpo_basis := 'due_date';
  ELSE
    _dpo_basis := 'expense_date_fallback';
  END IF;

  _can_compute_ccc := _can_compute_dso AND _can_compute_dpo;

  -- Outstanding
  SELECT COALESCE(SUM(grand_total - amount_paid), 0) INTO _receivables
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status NOT IN ('paid','void');

  SELECT COALESCE(SUM(grand_total - amount_paid), 0), COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status NOT IN ('paid','void') AND due_date IS NOT NULL AND due_date < _today;

  SELECT COALESCE(SUM(amount), 0) INTO _payables
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  SELECT COALESCE(SUM(amount), 0) INTO _cash_in
  FROM payments WHERE workspace_id = _workspace_id
    AND paid_at >= (_today - interval '30 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date >= (_today - interval '30 days');

  -- Collection (TTM)
  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status <> 'void' AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_collected
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _ttm_start::timestamptz;

  _collection_rate := CASE WHEN _ttm_invoiced > 0
    THEN LEAST(_ttm_collected / _ttm_invoiced, 1.5) ELSE NULL END;

  SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) INTO _sub_burn
  FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true;

  SELECT COALESCE(SUM(grand_total), 0) INTO _last3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '2 months')::date;

  SELECT COALESCE(SUM(grand_total), 0) INTO _prev3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '5 months')::date
    AND issue_date <  (date_trunc('month', _today) - interval '2 months')::date;

  _trend_pct := CASE WHEN _prev3_invoiced > 0
    THEN ((_last3_invoiced - _prev3_invoiced) / _prev3_invoiced) * 100 ELSE NULL END;

  -- Budget discipline (FIXED: budgets are per-category, multi-row per period)
  -- Pick the most relevant period: rows covering today, else most recent within 60 days.
  -- Aggregate ALL rows in that period (sum of category targets) and compare to expenses
  -- in that same period. This avoids picking one arbitrary category row.
  WITH active AS (
    SELECT period_start, period_end, target_amount, category
    FROM budgets
    WHERE workspace_id = _workspace_id
      AND period_start <= _today AND period_end >= _today
  ),
  recent AS (
    SELECT period_start, period_end, target_amount, category
    FROM budgets
    WHERE workspace_id = _workspace_id
      AND period_end >= (_today - interval '60 days')::date
      AND NOT EXISTS (SELECT 1 FROM active)
  ),
  scope AS (
    SELECT * FROM active
    UNION ALL
    SELECT * FROM recent
  ),
  bounds AS (
    SELECT MIN(period_start) AS ps, MAX(period_end) AS pe, SUM(target_amount) AS total_target, COUNT(*) AS n
    FROM scope
    WHERE (period_start, period_end) = (
      SELECT period_start, period_end FROM scope
      ORDER BY period_end DESC, period_start DESC LIMIT 1
    )
  )
  SELECT ps, pe, total_target, n
  INTO _budget_period_start, _budget_period_end, _budget_target, _budget_row_count
  FROM bounds;

  IF _budget_target IS NOT NULL AND _budget_target > 0 THEN
    -- Actual = sum of paid expenses in the same period, restricted to categories that have a budget row
    SELECT COALESCE(SUM(e.amount), 0) INTO _budget_actual
    FROM expenses e
    WHERE e.workspace_id = _workspace_id AND e.deleted_at IS NULL
      AND e.payment_status = 'paid' AND e.paid_date IS NOT NULL
      AND e.paid_date BETWEEN _budget_period_start AND _budget_period_end
      AND COALESCE(e.category, 'general') IN (
        SELECT COALESCE(category, 'general') FROM budgets
        WHERE workspace_id = _workspace_id
          AND period_start = _budget_period_start
          AND period_end = _budget_period_end
      );

    _budget_ratio := _budget_actual / _budget_target;
    IF _budget_ratio >= 1.20 THEN
      _budget_status := 'overspent';
    ELSIF _budget_ratio >= 1.0 THEN
      _budget_status := 'at_limit';
    ELSE
      _budget_status := 'within';
    END IF;
  END IF;

  -- Health scoring
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

  IF _trend_pct IS NULL THEN NULL;
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

  -- Budget driver
  IF _budget_status = 'overspent' THEN
    _score := _score - 15;
    _drivers := _drivers || jsonb_build_object('label','Budget overspent','impact','negative','value',round(_budget_ratio*100));
  ELSIF _budget_status = 'at_limit' THEN
    _score := _score - 5;
    _drivers := _drivers || jsonb_build_object('label','Budget at limit','impact','warning','value',round(_budget_ratio*100));
  ELSIF _budget_status = 'within' THEN
    _drivers := _drivers || jsonb_build_object('label','Spending within budget','impact','positive','value',round(_budget_ratio*100));
  END IF;

  _score := GREATEST(0, LEAST(100, _score));

  _band := CASE
    WHEN _ttm_invoiced = 0 AND _cash_in = 0 AND _payables = 0 THEN 'insufficient_data'
    WHEN _score >= 80 THEN 'healthy'
    WHEN _score >= 65 THEN 'stable'
    WHEN _score >= 45 THEN 'watchlist'
    ELSE 'at_risk'
  END;

  -- Founder-facing summary: pick the strongest positive + strongest concern, joined naturally
  IF _band = 'insufficient_data' THEN
    _summary := 'Insufficient data: more invoicing and payment history is needed.';
  ELSE
    DECLARE
      _positive text := NULL;
      _concern text := NULL;
      _band_label text := CASE _band
        WHEN 'healthy' THEN 'Healthy'
        WHEN 'stable' THEN 'Stable'
        WHEN 'watchlist' THEN 'Watchlist'
        WHEN 'at_risk' THEN 'At risk'
      END;
    BEGIN
      -- Strongest concern wins (in priority order)
      IF _trend_pct IS NOT NULL AND _trend_pct <= -20 THEN
        _concern := 'revenue is declining';
      ELSIF _collection_rate IS NOT NULL AND _collection_rate < 0.6 THEN
        _concern := 'collection rate is low';
      ELSIF _ttm_invoiced > 0 AND _overdue_amount / NULLIF(_ttm_invoiced,0) > 0.25 THEN
        _concern := 'overdue exposure is high';
      ELSIF _budget_status = 'overspent' THEN
        _concern := 'spending is over budget';
      ELSIF _ttm_invoiced > 0 AND _overdue_amount / NULLIF(_ttm_invoiced,0) > 0.10 THEN
        _concern := 'overdue exposure needs attention';
      ELSIF _collection_rate IS NOT NULL AND _collection_rate < 0.85 THEN
        _concern := 'collections could be tighter';
      END IF;

      -- Strongest positive
      IF _trend_pct IS NOT NULL AND _trend_pct >= 10 THEN
        _positive := 'revenue is growing';
      ELSIF _collection_rate IS NOT NULL AND _collection_rate >= 0.85 THEN
        _positive := 'collections are healthy';
      ELSIF _budget_status = 'within' THEN
        _positive := 'spending is within budget';
      END IF;

      IF _positive IS NOT NULL AND _concern IS NOT NULL THEN
        _summary := _band_label || ': ' || _positive || ', but ' || _concern || '.';
      ELSIF _concern IS NOT NULL THEN
        _summary := _band_label || ': ' || _concern || '.';
      ELSIF _positive IS NOT NULL THEN
        _summary := _band_label || ': ' || _positive || '.';
      ELSE
        _summary := _band_label || ': operating within normal ranges.';
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'trends', COALESCE(_trends, '[]'::jsonb),
    'health', jsonb_build_object(
      'band', _band,
      'score', _score,
      'drivers', _drivers,
      'collection_rate', _collection_rate,
      'trend_pct', _trend_pct,
      'budget_status', _budget_status,
      'budget_row_count', _budget_row_count,
      'summary_text', _summary
    ),
    'cash_conversion', jsonb_build_object(
      'dso_days', _dso,
      'dpo_days', _dpo,
      'ccc_days', CASE WHEN _can_compute_ccc THEN _dso - _dpo ELSE NULL END,
      'dpo_basis', _dpo_basis,
      'dpo_due_sample_count', _dpo_due_count,
      'dpo_fallback_sample_count', _dpo_fallback_count,
      'can_compute_dso', _can_compute_dso,
      'can_compute_dpo', _can_compute_dpo,
      'can_compute_ccc', _can_compute_ccc,
      'receivables', _receivables,
      'overdue_amount', _overdue_amount,
      'overdue_count', _overdue_count,
      'payables', _payables,
      'cash_in_30d', _cash_in,
      'cash_out_30d', _cash_out,
      'net_cash_30d', _cash_in - _cash_out
    )
  );
END;
$$;