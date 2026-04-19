-- Patch get_finance_analytics: allow server-context (no auth.uid) calls
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

  -- TTM revenue & paid & expenses
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

  -- Receivables / overdue
  SELECT COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0) INTO _open_receivables
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('sent','partial','overdue');

  SELECT
    COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0),
    COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('sent','partial','overdue')
    AND due_date IS NOT NULL AND due_date < _today;

  -- Payables (unpaid expenses)
  SELECT COALESCE(SUM(amount), 0) INTO _open_payables
  FROM expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  -- DSO from invoices that have at least one payment in the last 90d window
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

  -- DPO: prefer paid expenses with both expense_date and due_date observed in last 90d
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
    -- fallback to unpaid expenses with due_date set
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

-- Patch get_lender_readiness: allow server-context (no auth.uid) calls
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
    AND status IN ('sent','partial','overdue');

  SELECT
    COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0),
    COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('sent','partial','overdue')
    AND due_date IS NOT NULL AND due_date < _today;

  _overdue_ratio := CASE WHEN _receivables > 0 THEN _overdue_amount / _receivables ELSE NULL END;

  SELECT COALESCE(SUM(amount), 0) INTO _payables
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  -- Forward 30 / 90 day cash projections
  SELECT
    COALESCE(SUM(CASE WHEN due_date <= _today + INTERVAL '30 days' THEN GREATEST(grand_total - amount_paid, 0) END), 0),
    COALESCE(SUM(CASE WHEN due_date <= _today + INTERVAL '90 days' THEN GREATEST(grand_total - amount_paid, 0) END), 0)
  INTO _cash_in_30, _cash_in_90
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status IN ('sent','partial','overdue') AND due_date IS NOT NULL;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(due_date, expense_date) <= _today + INTERVAL '30 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(due_date, expense_date) <= _today + INTERVAL '90 days' THEN amount END), 0)
  INTO _cash_out_30, _cash_out_90
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  _net_30 := _cash_in_30 - _cash_out_30;
  _net_90 := _cash_in_90 - _cash_out_90;

  -- Score (0..100). Heuristic, conservative.
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

-- Patch get_burden_analytics: allow server-context (no auth.uid) calls
-- Same body except admin gate now permits NULL auth.uid
CREATE OR REPLACE FUNCTION public.get_burden_analytics(_workspace_id uuid, _window_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_admin boolean;
  _uid uuid := auth.uid();
  _now date := CURRENT_DATE;
  _window_start date;
  _months_in_window numeric;
  _sub_monthly_total numeric := 0;
  _sub_active_count integer := 0;
  _sub_top jsonb := '[]'::jsonb;
  _sub_top1_share numeric := 0;
  _sub_top3_share numeric := 0;
  _vendor_spend_total numeric := 0;
  _vendor_top jsonb := '[]'::jsonb;
  _vendor_top1_share numeric := 0;
  _vendor_top3_share numeric := 0;
  _category_spend jsonb := '[]'::jsonb;
  _inflow_window numeric := 0;
  _avg_monthly_inflow numeric := 0;
  _burden_vs_inflow_pct numeric := NULL;
  _data_quality text := 'good';
  _summary text;
BEGIN
  IF _workspace_id IS NULL THEN
    RETURN jsonb_build_object('error', 'workspace_id required');
  END IF;
  IF _window_days IS NULL OR _window_days < 7 OR _window_days > 365 THEN
    _window_days := 90;
  END IF;

  IF _uid IS NOT NULL THEN
    SELECT public.has_workspace_role(_uid, _workspace_id, 'admin'::app_role) INTO _is_admin;
    IF NOT COALESCE(_is_admin, false) THEN
      RETURN jsonb_build_object('error', 'forbidden');
    END IF;
  END IF;

  _window_start := _now - (_window_days || ' days')::interval;
  _months_in_window := GREATEST(_window_days::numeric / 30.0, 1);

  -- SUBSCRIPTIONS
  SELECT
    COALESCE(SUM(CASE WHEN interval_months <= 0 THEN amount ELSE amount / interval_months END), 0),
    COUNT(*)
  INTO _sub_monthly_total, _sub_active_count
  FROM public.subscriptions
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND status = 'active';

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.monthly_cost DESC), '[]'::jsonb)
  INTO _sub_top
  FROM (
    SELECT name, vendor_name,
           CASE WHEN interval_months <= 0 THEN amount ELSE amount / interval_months END AS monthly_cost
    FROM public.subscriptions
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status = 'active'
    ORDER BY monthly_cost DESC
    LIMIT 5
  ) t;

  IF _sub_monthly_total > 0 AND jsonb_array_length(_sub_top) > 0 THEN
    _sub_top1_share := ROUND(((_sub_top->0->>'monthly_cost')::numeric / _sub_monthly_total) * 100, 1);
    _sub_top3_share := ROUND((
      (COALESCE((_sub_top->0->>'monthly_cost')::numeric,0)
       + COALESCE((_sub_top->1->>'monthly_cost')::numeric,0)
       + COALESCE((_sub_top->2->>'monthly_cost')::numeric,0)
      ) / _sub_monthly_total) * 100, 1);
  END IF;

  -- VENDOR SPEND in window (paid)
  SELECT COALESCE(SUM(amount), 0) INTO _vendor_spend_total
  FROM public.expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND payment_status = 'paid'
    AND expense_date >= _window_start;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.spend DESC), '[]'::jsonb)
  INTO _vendor_top
  FROM (
    SELECT v.name, COALESCE(SUM(e.amount), 0) AS spend
    FROM public.expenses e
    LEFT JOIN public.vendors v ON v.id = e.vendor_id
    WHERE e.workspace_id = _workspace_id
      AND e.deleted_at IS NULL
      AND e.payment_status = 'paid'
      AND e.expense_date >= _window_start
      AND e.vendor_id IS NOT NULL
    GROUP BY v.name
    ORDER BY spend DESC
    LIMIT 5
  ) t;

  IF _vendor_spend_total > 0 AND jsonb_array_length(_vendor_top) > 0 THEN
    _vendor_top1_share := ROUND(((_vendor_top->0->>'spend')::numeric / _vendor_spend_total) * 100, 1);
    _vendor_top3_share := ROUND((
      (COALESCE((_vendor_top->0->>'spend')::numeric,0)
       + COALESCE((_vendor_top->1->>'spend')::numeric,0)
       + COALESCE((_vendor_top->2->>'spend')::numeric,0)
      ) / _vendor_spend_total) * 100, 1);
  END IF;

  -- CATEGORY SPEND
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.spend DESC), '[]'::jsonb)
  INTO _category_spend
  FROM (
    SELECT COALESCE(NULLIF(category, ''), 'uncategorized') AS category,
           COALESCE(SUM(amount), 0) AS spend
    FROM public.expenses
    WHERE workspace_id = _workspace_id
      AND deleted_at IS NULL
      AND payment_status = 'paid'
      AND expense_date >= _window_start
    GROUP BY 1
    ORDER BY spend DESC
    LIMIT 8
  ) t;

  -- INFLOW (payments received in window)
  SELECT COALESCE(SUM(amount), 0) INTO _inflow_window
  FROM public.payments
  WHERE workspace_id = _workspace_id
    AND paid_at >= _window_start::timestamptz;

  _avg_monthly_inflow := CASE WHEN _months_in_window > 0 THEN _inflow_window / _months_in_window ELSE 0 END;

  IF _avg_monthly_inflow > 0 THEN
    _burden_vs_inflow_pct := ROUND((_sub_monthly_total / _avg_monthly_inflow) * 100, 1);
  END IF;

  IF _avg_monthly_inflow = 0 AND _sub_monthly_total = 0 AND _vendor_spend_total = 0 THEN
    _data_quality := 'insufficient_data';
  ELSIF _avg_monthly_inflow = 0 THEN
    _data_quality := 'low';
  ELSIF _sub_active_count = 0 AND _vendor_spend_total = 0 THEN
    _data_quality := 'low';
  END IF;

  _summary := CASE _data_quality
    WHEN 'insufficient_data' THEN 'Not enough financial activity to assess vendor and subscription burden.'
    WHEN 'low' THEN 'Limited inflow or spend data — directional only.'
    ELSE
      CASE
        WHEN _burden_vs_inflow_pct IS NULL THEN 'Active subscriptions and vendor spend tracked. Inflow not yet observed.'
        WHEN _burden_vs_inflow_pct >= 35 THEN 'Recurring subscription burden is heavy relative to monthly inflow.'
        WHEN _vendor_top1_share >= 50 THEN 'A single vendor concentrates most spend — concentration risk.'
        ELSE 'Subscription and vendor spend look reasonable relative to inflow.'
      END
  END;

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'recurring_monthly_burden', _sub_monthly_total,
    'subscription_count', _sub_active_count,
    'top_subscriptions', _sub_top,
    'subscription_top1_share_pct', _sub_top1_share,
    'subscription_top3_share_pct', _sub_top3_share,
    'vendor_spend_window', _vendor_spend_total,
    'top_vendors', _vendor_top,
    'vendor_concentration_pct', _vendor_top1_share,
    'vendor_top3_share_pct', _vendor_top3_share,
    'category_spend', _category_spend,
    'avg_monthly_inflow', _avg_monthly_inflow,
    'burden_vs_inflow_pct', _burden_vs_inflow_pct,
    'data_quality', _data_quality,
    'summary', _summary
  );
END;
$function$;

-- Patch get_runway_forecast: allow server-context (no auth.uid) calls
-- Only the auth gate changes; rest of body unchanged.
DO $$
DECLARE
  body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO body FROM pg_proc WHERE proname='get_runway_forecast' LIMIT 1;
  -- Replace the gate
  body := replace(body,
'BEGIN
  SELECT public.has_workspace_role(auth.uid(), _workspace_id, ''admin''::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object(''error'', ''forbidden'');
  END IF;',
'BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.has_workspace_role(auth.uid(), _workspace_id, ''admin''::app_role) INTO _is_admin;
    IF NOT COALESCE(_is_admin, false) THEN
      RETURN jsonb_build_object(''error'', ''forbidden'');
    END IF;
  END IF;');
  EXECUTE body;
END $$;