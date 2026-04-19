-- Fix get_finance_analytics: use real invoice_status values
CREATE OR REPLACE FUNCTION public.get_finance_analytics(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _ttm_revenue numeric := 0;
  _ttm_paid numeric := 0;
  _open_receivables numeric := 0;
  _overdue_amount numeric := 0;
  _overdue_count int := 0;
  _open_payables numeric := 0;
  _ttm_expenses numeric := 0;
  _net_margin_pct numeric;
  _data_points int := 0;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NOT NULL THEN
    IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
      RAISE EXCEPTION 'Admins only';
    END IF;
  END IF;

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
    SELECT date_trunc('month', expense_date)::date AS m, SUM(amount) AS amt
    FROM expenses
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND expense_date >= _trend_start AND payment_status = 'paid'
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'month', to_char(m.m, 'YYYY-MM'),
    'invoiced', COALESCE(inv.amt, 0),
    'collected', COALESCE(pay.amt, 0),
    'expenses', COALESCE(exp.amt, 0)
  ) ORDER BY m.m)
  INTO _trends
  FROM months m
  LEFT JOIN inv ON inv.m = m.m
  LEFT JOIN pay ON pay.m = m.m
  LEFT JOIN exp ON exp.m = m.m;

  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_revenue
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status <> 'void' AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_paid
  FROM payments
  WHERE workspace_id = _workspace_id AND paid_at >= _ttm_start::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_expenses
  FROM expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND expense_date >= _ttm_start AND payment_status = 'paid';

  SELECT COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0) INTO _open_receivables
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('issued','partially_paid');

  SELECT
    COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0),
    COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('issued','partially_paid')
    AND due_date IS NOT NULL AND due_date < _today;

  SELECT COALESCE(SUM(amount), 0) INTO _open_payables
  FROM expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  WITH paid_inv AS (
    SELECT i.id, i.issue_date, MAX(p.paid_at)::date AS first_pay
    FROM invoices i
    JOIN payments p ON p.invoice_id = i.id
    WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
      AND i.issue_date IS NOT NULL
      AND p.paid_at >= (_today - INTERVAL '90 days')::timestamptz
    GROUP BY i.id, i.issue_date
  )
  SELECT COALESCE(AVG(GREATEST((first_pay - issue_date)::int, 0)), 0)::numeric, COUNT(*)
  INTO _dso, _dso_count FROM paid_inv;
  _can_compute_dso := _dso_count >= 3;
  IF NOT _can_compute_dso THEN _dso := NULL; END IF;

  WITH dpo_paid AS (
    SELECT GREATEST((paid_date - expense_date)::int, 0) AS days
    FROM expenses
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND payment_status = 'paid' AND paid_date IS NOT NULL
      AND expense_date IS NOT NULL
      AND paid_date >= (_today - INTERVAL '90 days')
  )
  SELECT COALESCE(AVG(days), 0)::numeric, COUNT(*) INTO _dpo, _dpo_count FROM dpo_paid;

  IF _dpo_count >= 3 THEN
    _dpo_basis := 'paid_expenses';
  ELSE
    WITH dpo_due AS (
      SELECT GREATEST((due_date - expense_date)::int, 0) AS days
      FROM expenses
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND payment_status = 'unpaid' AND due_date IS NOT NULL
        AND expense_date IS NOT NULL
    )
    SELECT COALESCE(AVG(days), 0)::numeric, COUNT(*) INTO _dpo, _dpo_due_count FROM dpo_due;
    IF _dpo_due_count >= 3 THEN
      _dpo_basis := 'unpaid_due_dates';
      _dpo_fallback_count := _dpo_due_count;
    ELSE
      _dpo := NULL;
      _dpo_basis := 'insufficient_data';
    END IF;
  END IF;

  IF _ttm_revenue > 0 THEN
    _net_margin_pct := ((_ttm_revenue - _ttm_expenses) / _ttm_revenue) * 100;
  END IF;

  _data_points := COALESCE(jsonb_array_length(_trends), 0);

  RETURN jsonb_build_object(
    'trends', COALESCE(_trends, '[]'::jsonb),
    'ttm_revenue', _ttm_revenue,
    'ttm_collected', _ttm_paid,
    'ttm_expenses', _ttm_expenses,
    'open_receivables', _open_receivables,
    'overdue_amount', _overdue_amount,
    'overdue_count', _overdue_count,
    'open_payables', _open_payables,
    'collection_rate', CASE WHEN _ttm_revenue > 0 THEN LEAST(_ttm_paid / _ttm_revenue, 1.5) ELSE NULL END,
    'net_margin_pct', _net_margin_pct,
    'dso', _dso,
    'dso_sample_size', _dso_count,
    'dpo', _dpo,
    'dpo_basis', _dpo_basis,
    'dpo_sample_size', GREATEST(_dpo_count, _dpo_fallback_count),
    'data_points', _data_points,
    'summary', NULL,
    'score', NULL
  );
END;
$function$;

-- Fix get_lender_readiness: use real invoice_status values
CREATE OR REPLACE FUNCTION public.get_lender_readiness(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid;
  _today date := current_date;
  _ttm_start date := (_today - interval '12 months')::date;
  _ttm_invoiced numeric := 0;
  _ttm_collected numeric := 0;
  _collection_rate numeric;
  _receivables numeric := 0;
  _overdue_amount numeric := 0;
  _overdue_count int := 0;
  _overdue_ratio numeric;
  _payables numeric := 0;
  _cash_in_30 numeric := 0;
  _cash_out_30 numeric := 0;
  _cash_in_90 numeric := 0;
  _cash_out_90 numeric := 0;
  _net_30 numeric;
  _net_90 numeric;
  _score int := 0;
  _band text;
  _summary text;
  _drivers jsonb := '[]'::jsonb;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NOT NULL THEN
    IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
      RAISE EXCEPTION 'Admins only';
    END IF;
  END IF;

  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status <> 'void' AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_collected
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _ttm_start::timestamptz;

  _collection_rate := CASE WHEN _ttm_invoiced > 0
    THEN LEAST(_ttm_collected / _ttm_invoiced, 1.5) ELSE NULL END;

  SELECT COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0) INTO _receivables
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('issued','partially_paid');

  SELECT
    COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0),
    COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('issued','partially_paid')
    AND due_date IS NOT NULL AND due_date < _today;

  _overdue_ratio := CASE WHEN _receivables > 0 THEN _overdue_amount / _receivables ELSE NULL END;

  SELECT COALESCE(SUM(amount), 0) INTO _payables
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  SELECT
    COALESCE(SUM(CASE WHEN due_date <= _today + INTERVAL '30 days' THEN GREATEST(grand_total - amount_paid, 0) END), 0),
    COALESCE(SUM(CASE WHEN due_date <= _today + INTERVAL '90 days' THEN GREATEST(grand_total - amount_paid, 0) END), 0)
  INTO _cash_in_30, _cash_in_90
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('issued','partially_paid') AND due_date IS NOT NULL;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(due_date, expense_date) <= _today + INTERVAL '30 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(due_date, expense_date) <= _today + INTERVAL '90 days' THEN amount END), 0)
  INTO _cash_out_30, _cash_out_90
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  _net_30 := _cash_in_30 - _cash_out_30;
  _net_90 := _cash_in_90 - _cash_out_90;

  IF _collection_rate IS NOT NULL THEN
    _score := _score + LEAST(GREATEST(((_collection_rate - 0.5) * 80)::int, 0), 40);
  END IF;
  IF _overdue_ratio IS NOT NULL THEN
    _score := _score + GREATEST(20 - (_overdue_ratio * 80)::int, 0);
  END IF;
  IF _net_90 IS NOT NULL THEN
    IF _net_90 > 0 THEN _score := _score + 25;
    ELSIF _net_90 = 0 THEN _score := _score + 10;
    END IF;
  END IF;
  IF _ttm_invoiced > 0 THEN _score := _score + 15; END IF;
  _score := LEAST(_score, 100);

  _band := CASE
    WHEN _ttm_invoiced = 0 AND _receivables = 0 AND _payables = 0 THEN 'insufficient_data'
    WHEN _score >= 70 THEN 'ready'
    WHEN _score >= 45 THEN 'borderline'
    ELSE 'not_ready'
  END;

  _summary := CASE _band
    WHEN 'insufficient_data' THEN 'Not enough financial activity yet to assess lender readiness.'
    WHEN 'ready' THEN 'Healthy collections and cash position — readiness is strong.'
    WHEN 'borderline' THEN 'Mixed signals — improve collections or reduce overdue exposure.'
    ELSE 'Significant gaps — strengthen collections, reduce overdue, build cash buffer before applying.'
  END;

  RETURN jsonb_build_object(
    'score', _score,
    'band', _band,
    'summary', _summary,
    'collection_rate', _collection_rate,
    'overdue_amount', _overdue_amount,
    'overdue_count', _overdue_count,
    'overdue_ratio', _overdue_ratio,
    'open_receivables', _receivables,
    'open_payables', _payables,
    'cash_in_30', _cash_in_30,
    'cash_out_30', _cash_out_30,
    'cash_in_90', _cash_in_90,
    'cash_out_90', _cash_out_90,
    'net_30', _net_30,
    'net_90', _net_90,
    'ttm_invoiced', _ttm_invoiced,
    'ttm_collected', _ttm_collected,
    'drivers', _drivers
  );
END;
$function$;