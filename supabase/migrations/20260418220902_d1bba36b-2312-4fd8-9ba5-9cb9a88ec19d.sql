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

  SELECT COALESCE(SUM(amount_monthly), 0) INTO _sub_burn FROM (
    SELECT (CASE billing_cycle
      WHEN 'monthly' THEN amount
      WHEN 'quarterly' THEN amount/3
      WHEN 'annual' THEN amount/12
      ELSE amount END) AS amount_monthly
    FROM subscriptions
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status = 'active'
  ) s;

  SELECT COALESCE(SUM(grand_total),0) INTO _last3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (_today - interval '90 days');

  SELECT COALESCE(SUM(grand_total),0) INTO _prev3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (_today - interval '180 days') AND issue_date < (_today - interval '90 days');

  _trend_pct := CASE WHEN _prev3_invoiced > 0
    THEN ((_last3_invoiced - _prev3_invoiced) / _prev3_invoiced) * 100 ELSE NULL END;

  SELECT AVG(EXTRACT(EPOCH FROM (p.paid_at - i.issue_date::timestamptz)) / 86400)::numeric, COUNT(*)
  INTO _dso, _dso_count
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.workspace_id = _workspace_id AND i.deleted_at IS NULL
    AND i.issue_date IS NOT NULL AND p.paid_at >= _ttm_start::timestamptz;

  SELECT AVG(GREATEST(0, EXTRACT(EPOCH FROM (
    COALESCE(paid_date, expense_date) - COALESCE(due_date, expense_date)
  )) / 86400))::numeric, COUNT(*)
  INTO _dpo, _dpo_count
  FROM expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND expense_date >= _ttm_start;

  _ccc := CASE WHEN _dso IS NOT NULL AND _dpo IS NOT NULL THEN _dso - _dpo ELSE NULL END;

  SELECT period_start, period_end, SUM(target_amount)
  INTO _budget_period_start, _budget_period_end, _budget_target
  FROM budgets
  WHERE workspace_id = _workspace_id AND period_start <= _today AND period_end >= _today
  GROUP BY period_start, period_end
  ORDER BY period_start DESC LIMIT 1;

  IF _budget_target IS NOT NULL AND _budget_target > 0 THEN
    SELECT COALESCE(SUM(amount),0) INTO _budget_actual
    FROM expenses e
    WHERE e.workspace_id = _workspace_id AND e.deleted_at IS NULL
      AND e.expense_date BETWEEN _budget_period_start AND _budget_period_end
      AND COALESCE(e.category,'general') IN (
        SELECT COALESCE(category,'general') FROM budgets
        WHERE workspace_id = _workspace_id
          AND period_start = _budget_period_start
          AND period_end = _budget_period_end
      );
    _budget_ratio := _budget_actual / _budget_target;
    IF _budget_ratio >= 1.20 THEN _budget_status := 'overspent';
    ELSIF _budget_ratio >= 1.0 THEN _budget_status := 'at_limit';
    ELSE _budget_status := 'within';
    END IF;
  END IF;

  IF _months_with_revenue < 3 OR _ttm_invoiced = 0 OR _ttm_collected = 0 THEN
    _band := 'insufficient_data';
    _score := 0;
    _caution := 'wait_and_stabilize';
    _drivers := _drivers || jsonb_build_object('label','Not enough operating history','impact','neutral');
    _flags := _flags || to_jsonb('Less than 3 months of invoicing or payments — lender review would be premature.'::text);
    _summary := 'Insufficient data: build at least 3 months of consistent invoicing and collections before evaluating debt.';

    RETURN jsonb_build_object(
      'band', _band, 'score', _score, 'caution', _caution, 'summary', _summary,
      'drivers', _drivers, 'flags', _flags,
      'inputs', jsonb_build_object(
        'months_with_revenue', _months_with_revenue, 'ttm_invoiced', _ttm_invoiced,
        'ttm_collected', _ttm_collected, 'collection_rate', _collection_rate,
        'overdue_amount', _overdue_amount, 'overdue_ratio', _overdue_ratio,
        'receivables', _receivables, 'payables', _payables,
        'net_cash_30d', _net_30, 'net_cash_90d', _net_90,
        'avg_monthly_net_90d', _avg_monthly_net, 'sub_burn_monthly', _sub_burn,
        'trend_pct', _trend_pct, 'dso_days', _dso, 'dpo_days', _dpo, 'ccc_days', _ccc,
        'budget_status', _budget_status, 'budget_ratio', _budget_ratio
      )
    );
  END IF;

  -- Scoring (out of 100)
  IF _collection_rate IS NULL THEN
    _drivers := _drivers || jsonb_build_object('label','Collection reliability unknown','impact','neutral');
  ELSIF _collection_rate >= 0.90 THEN
    _score := _score + 25;
    _drivers := _drivers || jsonb_build_object('label','Strong collection reliability','impact','positive','value',round(_collection_rate*100));
  ELSIF _collection_rate >= 0.75 THEN
    _score := _score + 18;
    _drivers := _drivers || jsonb_build_object('label','Acceptable collection reliability','impact','warning','value',round(_collection_rate*100));
  ELSIF _collection_rate >= 0.5 THEN
    _score := _score + 8;
    _drivers := _drivers || jsonb_build_object('label','Weak collection reliability','impact','negative','value',round(_collection_rate*100));
    _flags := _flags || to_jsonb('Collections below 75% — repayment capacity is unstable.'::text);
  ELSE
    _drivers := _drivers || jsonb_build_object('label','Collections critically low','impact','negative','value',round(_collection_rate*100));
    _flags := _flags || to_jsonb('Collection rate under 50% of invoiced revenue.'::text);
  END IF;

  IF _avg_monthly_net IS NULL THEN
    _drivers := _drivers || jsonb_build_object('label','No cashflow signal','impact','neutral');
  ELSIF _avg_monthly_net <= 0 THEN
    _drivers := _drivers || jsonb_build_object('label','Negative average monthly cashflow','impact','negative');
    _flags := _flags || to_jsonb('Last 90 days are net-negative on cash — adding debt would compound the gap.'::text);
  ELSIF _sub_burn > 0 AND _avg_monthly_net < _sub_burn THEN
    _score := _score + 8;
    _drivers := _drivers || jsonb_build_object('label','Cashflow barely covers fixed burn','impact','warning');
    _flags := _flags || to_jsonb('Average monthly net cash is below recurring subscription burn.'::text);
  ELSIF _sub_burn > 0 AND _avg_monthly_net < _sub_burn * 2 THEN
    _score := _score + 16;
    _drivers := _drivers || jsonb_build_object('label','Cashflow covers fixed burn','impact','warning');
  ELSE
    _score := _score + 25;
    _drivers := _drivers || jsonb_build_object('label','Healthy cashflow buffer','impact','positive');
  END IF;

  IF _overdue_ratio IS NULL OR _overdue_amount = 0 THEN
    _score := _score + 15;
    _drivers := _drivers || jsonb_build_object('label','No overdue exposure','impact','positive');
  ELSIF _overdue_ratio <= 0.10 THEN
    _score := _score + 10;
    _drivers := _drivers || jsonb_build_object('label','Low overdue exposure','impact','positive','value',round(_overdue_ratio*100));
  ELSIF _overdue_ratio <= 0.25 THEN
    _score := _score + 5;
    _drivers := _drivers || jsonb_build_object('label','Moderate overdue exposure','impact','warning','value',round(_overdue_ratio*100));
  ELSE
    _drivers := _drivers || jsonb_build_object('label','High overdue exposure','impact','negative','value',round(_overdue_ratio*100));
    _flags := _flags || to_jsonb('Overdue receivables exceed 25% of TTM revenue.'::text);
  END IF;

  IF _trend_pct IS NULL THEN
    _score := _score + 7;
    _drivers := _drivers || jsonb_build_object('label','Trend not yet measurable','impact','neutral');
  ELSIF _trend_pct >= 10 THEN
    _score := _score + 15;
    _drivers := _drivers || jsonb_build_object('label','Revenue trending up','impact','positive','value',round(_trend_pct));
  ELSIF _trend_pct >= -5 THEN
    _score := _score + 10;
    _drivers := _drivers || jsonb_build_object('label','Revenue stable','impact','neutral','value',round(_trend_pct));
  ELSIF _trend_pct >= -20 THEN
    _score := _score + 4;
    _drivers := _drivers || jsonb_build_object('label','Revenue softening','impact','warning','value',round(_trend_pct));
  ELSE
    _drivers := _drivers || jsonb_build_object('label','Revenue declining sharply','impact','negative','value',round(_trend_pct));
    _flags := _flags || to_jsonb('Revenue down more than 20% vs prior quarter.'::text);
  END IF;

  IF _ccc IS NULL THEN
    _score := _score + 5;
    _drivers := _drivers || jsonb_build_object('label','Operating cycle not yet measurable','impact','neutral');
  ELSIF _ccc <= 30 THEN
    _score := _score + 10;
    _drivers := _drivers || jsonb_build_object('label','Tight operating cycle','impact','positive','value',round(_ccc));
  ELSIF _ccc <= 60 THEN
    _score := _score + 6;
    _drivers := _drivers || jsonb_build_object('label','Moderate operating cycle','impact','warning','value',round(_ccc));
  ELSE
    _score := _score + 2;
    _drivers := _drivers || jsonb_build_object('label','Slow operating cycle','impact','negative','value',round(_ccc));
    _flags := _flags || to_jsonb('Cash conversion cycle exceeds 60 days — cash is tied up too long.'::text);
  END IF;

  IF _budget_status = 'within' THEN
    _score := _score + 10;
    _drivers := _drivers || jsonb_build_object('label','Spending within budget','impact','positive','value',round(_budget_ratio*100));
  ELSIF _budget_status = 'at_limit' THEN
    _score := _score + 5;
    _drivers := _drivers || jsonb_build_object('label','Spending at budget limit','impact','warning','value',round(_budget_ratio*100));
  ELSIF _budget_status = 'overspent' THEN
    _drivers := _drivers || jsonb_build_object('label','Spending over budget','impact','negative','value',round(_budget_ratio*100));
    _flags := _flags || to_jsonb('Spending is over budget — discipline gap before adding debt service.'::text);
  ELSE
    _score := _score + 5;
    _drivers := _drivers || jsonb_build_object('label','No budgets configured','impact','neutral');
  END IF;

  IF _payables > 0 AND _cash_in_30 > 0 AND _payables > _cash_in_30 * 2 THEN
    _flags := _flags || to_jsonb('Unpaid payables exceed 2× recent cash inflow — short-term liquidity strain.'::text);
  END IF;

  _score := GREATEST(0, LEAST(100, _score));

  IF _avg_monthly_net IS NOT NULL AND _avg_monthly_net <= 0 THEN
    _band := 'not_ready'; _caution := 'wait_and_stabilize';
  ELSIF _collection_rate IS NOT NULL AND _collection_rate < 0.5 THEN
    _band := 'not_ready'; _caution := 'wait_and_stabilize';
  ELSIF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.40 THEN
    _band := 'not_ready'; _caution := 'wait_and_stabilize';
  ELSE
    _band := CASE WHEN _score >= 75 THEN 'ready' WHEN _score >= 55 THEN 'borderline' ELSE 'not_ready' END;
    _caution := CASE _band WHEN 'ready' THEN 'safe_to_expand' WHEN 'borderline' THEN 'expand_carefully' ELSE 'wait_and_stabilize' END;
  END IF;

  -- Founder summary (clean phrasing — no "but...but")
  DECLARE
    _band_label text := CASE _band WHEN 'ready' THEN 'Ready' WHEN 'borderline' THEN 'Borderline' WHEN 'not_ready' THEN 'Not ready' END;
    _lead text;
    _trail text := NULL;
  BEGIN
    IF _band = 'ready' THEN
      IF _trend_pct IS NOT NULL AND _trend_pct >= 10 THEN
        _lead := 'revenue is growing and cashflow is healthy';
      ELSIF _collection_rate IS NOT NULL AND _collection_rate >= 0.90 THEN
        _lead := 'collections are reliable and cashflow covers fixed burn';
      ELSE
        _lead := 'core finances are stable enough to absorb measured debt';
      END IF;
    ELSIF _band = 'borderline' THEN
      _lead := 'fundamentals are workable but the cushion is thin';
    ELSE
      IF _avg_monthly_net IS NOT NULL AND _avg_monthly_net <= 0 THEN
        _lead := 'cashflow is net-negative';
      ELSIF _collection_rate IS NOT NULL AND _collection_rate < 0.5 THEN
        _lead := 'collections are too low to sustain repayments';
      ELSIF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.40 THEN
        _lead := 'overdue exposure is severe';
      ELSE
        _lead := 'multiple weaknesses outweigh the strengths';
      END IF;
    END IF;

    IF _band <> 'not_ready' THEN
      IF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.25 THEN
        _trail := 'reduce overdue exposure first';
      ELSIF _trend_pct IS NOT NULL AND _trend_pct <= -20 THEN
        _trail := 'reverse the revenue decline before borrowing';
      ELSIF _budget_status = 'overspent' THEN
        _trail := 'tighten spending before adding debt service';
      ELSIF _sub_burn > 0 AND _avg_monthly_net IS NOT NULL AND _avg_monthly_net < _sub_burn THEN
        _trail := 'fixed subscription burn already eats most of net cash';
      END IF;
    END IF;

    IF _trail IS NOT NULL THEN
      -- Use semicolon join to avoid awkward "but...but" cascades
      _summary := _band_label || ': ' || _lead || '; ' || _trail || '.';
    ELSE
      _summary := _band_label || ': ' || _lead || '.';
    END IF;
  END;

  RETURN jsonb_build_object(
    'band', _band, 'score', _score, 'caution', _caution, 'summary', _summary,
    'drivers', _drivers, 'flags', _flags,
    'inputs', jsonb_build_object(
      'months_with_revenue', _months_with_revenue, 'ttm_invoiced', _ttm_invoiced,
      'ttm_collected', _ttm_collected, 'collection_rate', _collection_rate,
      'overdue_amount', _overdue_amount, 'overdue_ratio', _overdue_ratio,
      'receivables', _receivables, 'payables', _payables,
      'cash_in_30d', _cash_in_30, 'cash_out_30d', _cash_out_30,
      'net_cash_30d', _net_30, 'net_cash_90d', _net_90,
      'avg_monthly_net_90d', _avg_monthly_net, 'sub_burn_monthly', _sub_burn,
      'trend_pct', _trend_pct, 'dso_days', _dso, 'dpo_days', _dpo, 'ccc_days', _ccc,
      'budget_status', _budget_status, 'budget_ratio', _budget_ratio
    )
  );
END;
$function$;