-- Patch only the subscription burn block; everything else preserved
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
  _avg_monthly_net numeric;
  _sub_burn numeric := 0;
  _last3_invoiced numeric := 0;
  _prev3_invoiced numeric := 0;
  _trend_pct numeric;
  _months_with_revenue int := 0;
  _dso numeric;
  _dpo numeric;
  _dso_count int := 0;
  _dpo_count int := 0;
  _ccc numeric;
  _budget_target numeric;
  _budget_actual numeric;
  _budget_period_start date;
  _budget_period_end date;
  _budget_ratio numeric;
  _budget_status text := 'none';
  _score int := 0;
  _band text := 'insufficient_data';
  _caution text := 'wait_and_stabilize';
  _drivers jsonb := '[]'::jsonb;
  _flags jsonb := '[]'::jsonb;
  _summary text;
  _band_label text;
  _lead text;
  _trail text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status <> 'void' AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_collected
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _ttm_start::timestamptz;

  _collection_rate := CASE WHEN _ttm_invoiced > 0
    THEN LEAST(_ttm_collected / _ttm_invoiced, 1.5) ELSE NULL END;

  SELECT COUNT(DISTINCT date_trunc('month', issue_date))
  INTO _months_with_revenue
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date IS NOT NULL AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(grand_total - amount_paid), 0) INTO _receivables
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status NOT IN ('paid','void');

  SELECT COALESCE(SUM(grand_total - amount_paid), 0), COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status NOT IN ('paid','void') AND due_date IS NOT NULL AND due_date < _today;

  _overdue_ratio := CASE WHEN _ttm_invoiced > 0 THEN _overdue_amount / _ttm_invoiced ELSE NULL END;

  SELECT COALESCE(SUM(amount), 0) INTO _payables
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'unpaid';

  SELECT COALESCE(SUM(amount), 0) INTO _cash_in_30
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= (_today - interval '30 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out_30
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date >= (_today - interval '30 days');

  SELECT COALESCE(SUM(amount), 0) INTO _cash_in_90
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= (_today - interval '90 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out_90
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date >= (_today - interval '90 days');

  _net_30 := _cash_in_30 - _cash_out_30;
  _net_90 := _cash_in_90 - _cash_out_90;
  _avg_monthly_net := _net_90 / 3.0;

  -- FIX: subscriptions table uses (amount, interval_months, is_active) — no billing_cycle/status/deleted_at
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(interval_months, 1) <= 0 THEN amount
      ELSE amount / interval_months::numeric
    END
  ), 0)
  INTO _sub_burn
  FROM subscriptions
  WHERE workspace_id = _workspace_id AND COALESCE(is_active, true) = true;

  SELECT COALESCE(SUM(grand_total),0) INTO _last3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (_today - interval '90 days');

  SELECT COALESCE(SUM(grand_total),0) INTO _prev3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (_today - interval '180 days') AND issue_date < (_today - interval '90 days');

  _trend_pct := CASE WHEN _prev3_invoiced > 0
    THEN ((_last3_invoiced - _prev3_invoiced) / _prev3_invoiced) * 100 ELSE NULL END;

  -- DSO
  SELECT AVG(EXTRACT(epoch FROM (p.paid_at - i.issue_date::timestamptz))/86400.0), COUNT(*)
  INTO _dso, _dso_count
  FROM invoices i
  JOIN payments p ON p.invoice_id = i.id
  WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
    AND i.issue_date IS NOT NULL AND p.paid_at >= (_today - interval '180 days')::timestamptz;

  -- DPO from expenses (paid - expense_date)
  SELECT AVG(EXTRACT(epoch FROM (paid_date::timestamptz - expense_date::timestamptz))/86400.0), COUNT(*)
  INTO _dpo, _dpo_count
  FROM expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date IS NOT NULL AND expense_date IS NOT NULL
    AND paid_date >= (_today - interval '180 days');

  IF _dso IS NOT NULL AND _dpo IS NOT NULL THEN
    _ccc := _dso - _dpo;
  END IF;

  -- Budget current period
  SELECT target_amount, period_start, period_end
  INTO _budget_target, _budget_period_start, _budget_period_end
  FROM budgets
  WHERE workspace_id = _workspace_id AND _today BETWEEN period_start AND period_end
  ORDER BY period_start DESC LIMIT 1;

  IF _budget_target IS NOT NULL AND _budget_target > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO _budget_actual
    FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND expense_date BETWEEN _budget_period_start AND _budget_period_end;
    _budget_ratio := _budget_actual / _budget_target;
    _budget_status := CASE
      WHEN _budget_ratio <= 0.85 THEN 'healthy'
      WHEN _budget_ratio <= 1.0 THEN 'tight'
      ELSE 'over'
    END;
  END IF;

  -- INSUFFICIENT DATA gate
  IF _months_with_revenue < 3 THEN
    RETURN jsonb_build_object(
      'band', 'insufficient_data',
      'score', 0,
      'caution', 'wait_and_stabilize',
      'summary', 'Not enough invoicing history yet to assess lender readiness. Capture at least three months of invoiced revenue first.',
      'drivers', '[]'::jsonb,
      'flags', '[]'::jsonb
    );
  END IF;

  -- SCORING (0-100)
  -- Collection reliability (25)
  IF _collection_rate IS NOT NULL THEN
    _score := _score + LEAST(25, GREATEST(0, FLOOR(_collection_rate * 25))::int);
    _drivers := _drivers || jsonb_build_array(jsonb_build_object(
      'label', 'Collection rate',
      'impact', CASE WHEN _collection_rate >= 0.85 THEN 'positive'
                     WHEN _collection_rate >= 0.6 THEN 'warning' ELSE 'negative' END,
      'value', ROUND(_collection_rate * 100)::int
    ));
  END IF;

  -- Cashflow sufficiency vs subscription burn (25)
  IF _avg_monthly_net IS NOT NULL THEN
    IF _sub_burn > 0 THEN
      IF _avg_monthly_net >= _sub_burn * 2 THEN _score := _score + 25;
      ELSIF _avg_monthly_net >= _sub_burn THEN _score := _score + 18;
      ELSIF _avg_monthly_net >= 0 THEN _score := _score + 10;
      ELSE _score := _score + 0;
      END IF;
    ELSE
      IF _avg_monthly_net >= 0 THEN _score := _score + 20;
      ELSE _score := _score + 0;
      END IF;
    END IF;
    _drivers := _drivers || jsonb_build_array(jsonb_build_object(
      'label', 'Avg monthly net cashflow',
      'impact', CASE WHEN _avg_monthly_net >= 0 THEN 'positive' ELSE 'negative' END,
      'value', ROUND(_avg_monthly_net)::int
    ));
  END IF;

  -- Overdue exposure (15)
  IF _overdue_ratio IS NOT NULL THEN
    IF _overdue_ratio <= 0.05 THEN _score := _score + 15;
    ELSIF _overdue_ratio <= 0.15 THEN _score := _score + 10;
    ELSIF _overdue_ratio <= 0.30 THEN _score := _score + 5;
    ELSE _score := _score + 0;
    END IF;
    _drivers := _drivers || jsonb_build_array(jsonb_build_object(
      'label', 'Overdue exposure',
      'impact', CASE WHEN _overdue_ratio <= 0.15 THEN 'positive'
                     WHEN _overdue_ratio <= 0.30 THEN 'warning' ELSE 'negative' END,
      'value', ROUND(_overdue_ratio * 100)::int
    ));
  END IF;

  -- Revenue trend (15)
  IF _trend_pct IS NOT NULL THEN
    IF _trend_pct >= 10 THEN _score := _score + 15;
    ELSIF _trend_pct >= 0 THEN _score := _score + 10;
    ELSIF _trend_pct >= -15 THEN _score := _score + 5;
    ELSE _score := _score + 0;
    END IF;
    _drivers := _drivers || jsonb_build_array(jsonb_build_object(
      'label', 'Revenue trending',
      'impact', CASE WHEN _trend_pct >= 0 THEN 'positive'
                     WHEN _trend_pct >= -15 THEN 'warning' ELSE 'negative' END,
      'value', ROUND(_trend_pct)::int
    ));
  END IF;

  -- Operating cycle (10)
  IF _ccc IS NOT NULL THEN
    IF _ccc <= 30 THEN _score := _score + 10;
    ELSIF _ccc <= 60 THEN _score := _score + 6;
    ELSIF _ccc <= 90 THEN _score := _score + 3;
    ELSE _score := _score + 0;
    END IF;
  END IF;

  -- Budget discipline (10)
  IF _budget_status = 'healthy' THEN _score := _score + 10;
  ELSIF _budget_status = 'tight' THEN _score := _score + 6;
  ELSIF _budget_status = 'over' THEN _score := _score + 0;
  END IF;

  -- Hard downgrades & flags
  IF _avg_monthly_net IS NOT NULL AND _avg_monthly_net < 0 THEN
    _flags := _flags || jsonb_build_array('Net cashflow has been negative over the last 90 days.');
    _band := 'not_ready';
  END IF;
  IF _collection_rate IS NOT NULL AND _collection_rate < 0.5 THEN
    _flags := _flags || jsonb_build_array('Collection rate below 50% — receivables conversion is weak.');
    _band := 'not_ready';
  END IF;
  IF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.4 THEN
    _flags := _flags || jsonb_build_array('Overdue invoices exceed 40% of trailing revenue.');
    _band := 'not_ready';
  END IF;
  IF _budget_status = 'over' THEN
    _flags := _flags || jsonb_build_array('Spending has exceeded the active budget for this period.');
  END IF;

  -- Final band from score (only if not already forced not_ready)
  IF _band <> 'not_ready' THEN
    IF _score >= 75 THEN _band := 'ready';
    ELSIF _score >= 55 THEN _band := 'borderline';
    ELSE _band := 'not_ready';
    END IF;
  END IF;

  _caution := CASE _band
    WHEN 'ready' THEN 'safe_to_expand'
    WHEN 'borderline' THEN 'expand_carefully'
    ELSE 'wait_and_stabilize'
  END;

  _band_label := CASE _band
    WHEN 'ready' THEN 'Ready'
    WHEN 'borderline' THEN 'Borderline'
    ELSE 'Not ready'
  END;

  _lead := CASE _band
    WHEN 'ready' THEN 'Finances look stable enough to support a measured next-phase commitment'
    WHEN 'borderline' THEN 'Mixed signals — proceed only with conservative debt'
    ELSE 'Not financially positioned to take on new debt right now'
  END;

  IF jsonb_array_length(_flags) > 0 THEN
    _trail := 'address the flagged risks before lender conversations';
    _summary := _band_label || ': ' || _lead || '; ' || _trail || '.';
  ELSE
    _summary := _band_label || ': ' || _lead || '.';
  END IF;

  RETURN jsonb_build_object(
    'band', _band,
    'score', _score,
    'caution', _caution,
    'summary', _summary,
    'drivers', _drivers,
    'flags', _flags
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_lender_readiness(uuid) TO authenticated;