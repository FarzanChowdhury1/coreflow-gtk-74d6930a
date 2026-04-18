-- Lender readiness scoring RPC.
-- Workspace-level, admin-only, rule-based, explainable. Internal decision-support.
-- Reuses the same financial primitives as get_finance_analytics so signals stay consistent.

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

  -- Operating signals
  _ttm_invoiced numeric := 0;
  _ttm_collected numeric := 0;
  _collection_rate numeric;            -- 0..1.5 (capped)
  _receivables numeric := 0;
  _overdue_amount numeric := 0;
  _overdue_count int := 0;
  _overdue_ratio numeric;              -- overdue / ttm_invoiced
  _payables numeric := 0;
  _cash_in_30 numeric := 0;
  _cash_out_30 numeric := 0;
  _cash_in_90 numeric := 0;
  _cash_out_90 numeric := 0;
  _net_30 numeric;
  _net_90 numeric;
  _avg_monthly_net numeric;            -- net_90 / 3
  _sub_burn numeric := 0;              -- monthly subscription burden (recurring)
  _last3_invoiced numeric := 0;
  _prev3_invoiced numeric := 0;
  _trend_pct numeric;
  _months_with_revenue int := 0;       -- distinct months with invoicing in last 12

  -- Cycle (DSO / DPO / CCC) — relaxed compute (no min sample gate; we gate readiness separately)
  _dso numeric;
  _dpo numeric;
  _dso_count int := 0;
  _dpo_count int := 0;
  _ccc numeric;

  -- Budget discipline
  _budget_target numeric;
  _budget_actual numeric;
  _budget_period_start date;
  _budget_period_end date;
  _budget_ratio numeric;
  _budget_status text := 'none';

  -- Outputs
  _score int := 0;
  _band text := 'insufficient_data';
  _caution text := 'wait_and_stabilize';
  _drivers jsonb := '[]'::jsonb;
  _flags jsonb := '[]'::jsonb;
  _summary text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  -- ── Core volumes (TTM) ──────────────────────────────────────────────────
  SELECT COALESCE(SUM(grand_total), 0) INTO _ttm_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status <> 'void' AND issue_date >= _ttm_start;

  SELECT COALESCE(SUM(amount), 0) INTO _ttm_collected
  FROM payments WHERE workspace_id = _workspace_id AND paid_at >= _ttm_start::timestamptz;

  _collection_rate := CASE WHEN _ttm_invoiced > 0
    THEN LEAST(_ttm_collected / _ttm_invoiced, 1.5) ELSE NULL END;

  -- Months with invoicing activity (history depth)
  SELECT COUNT(DISTINCT date_trunc('month', issue_date))
  INTO _months_with_revenue
  FROM invoices
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date IS NOT NULL AND issue_date >= _ttm_start;

  -- Receivables / overdue
  SELECT COALESCE(SUM(grand_total - amount_paid), 0) INTO _receivables
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status NOT IN ('paid','void');

  SELECT COALESCE(SUM(grand_total - amount_paid), 0), COUNT(*)
  INTO _overdue_amount, _overdue_count
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND status NOT IN ('paid','void') AND due_date IS NOT NULL AND due_date < _today;

  _overdue_ratio := CASE WHEN _ttm_invoiced > 0 THEN _overdue_amount / _ttm_invoiced ELSE NULL END;

  -- Payables
  SELECT COALESCE(SUM(amount), 0) INTO _payables
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'unpaid';

  -- Cash flow windows
  SELECT COALESCE(SUM(amount), 0) INTO _cash_in_30
  FROM payments WHERE workspace_id = _workspace_id
    AND paid_at >= (_today - interval '30 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out_30
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date >= (_today - interval '30 days');

  SELECT COALESCE(SUM(amount), 0) INTO _cash_in_90
  FROM payments WHERE workspace_id = _workspace_id
    AND paid_at >= (_today - interval '90 days')::timestamptz;

  SELECT COALESCE(SUM(amount), 0) INTO _cash_out_90
  FROM expenses WHERE workspace_id = _workspace_id AND deleted_at IS NULL
    AND payment_status = 'paid' AND paid_date >= (_today - interval '90 days');

  _net_30 := _cash_in_30 - _cash_out_30;
  _net_90 := _cash_in_90 - _cash_out_90;
  _avg_monthly_net := _net_90 / 3.0;

  -- Recurring subscription burden (monthly equivalent)
  SELECT COALESCE(SUM(amount / GREATEST(interval_months, 1)), 0) INTO _sub_burn
  FROM subscriptions WHERE workspace_id = _workspace_id AND is_active = true;

  -- Revenue trend (last 3 months vs prior 3)
  SELECT COALESCE(SUM(grand_total), 0) INTO _last3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '2 months')::date;

  SELECT COALESCE(SUM(grand_total), 0) INTO _prev3_invoiced
  FROM invoices WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND status <> 'void'
    AND issue_date >= (date_trunc('month', _today) - interval '5 months')::date
    AND issue_date <  (date_trunc('month', _today) - interval '2 months')::date;

  _trend_pct := CASE WHEN _prev3_invoiced > 0
    THEN ((_last3_invoiced - _prev3_invoiced) / _prev3_invoiced) * 100 ELSE NULL END;

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
  SELECT AVG(closed_at - issue_date)::numeric, COUNT(*) INTO _dso, _dso_count FROM closed;

  -- DPO (prefer due_date, fallback expense_date; never negative)
  WITH dpo_calc AS (
    SELECT CASE
        WHEN due_date IS NOT NULL THEN GREATEST(paid_date - due_date, 0)
        WHEN expense_date IS NOT NULL THEN GREATEST(paid_date - expense_date, 0)
        ELSE NULL END AS days
    FROM expenses
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND payment_status = 'paid' AND paid_date IS NOT NULL
      AND paid_date >= _ttm_start
  )
  SELECT AVG(days)::numeric, COUNT(*) FILTER (WHERE days IS NOT NULL)
  INTO _dpo, _dpo_count FROM dpo_calc;

  IF _dso_count >= 3 AND _dpo_count >= 3 AND _dso IS NOT NULL AND _dpo IS NOT NULL THEN
    _ccc := _dso - _dpo;
  END IF;

  -- Budget discipline (mirrors finance-analytics aggregation)
  WITH active AS (
    SELECT period_start, period_end, target_amount, category
    FROM budgets WHERE workspace_id = _workspace_id
      AND period_start <= _today AND period_end >= _today
  ),
  recent AS (
    SELECT period_start, period_end, target_amount, category
    FROM budgets WHERE workspace_id = _workspace_id
      AND period_end >= (_today - interval '60 days')::date
      AND NOT EXISTS (SELECT 1 FROM active)
  ),
  scope AS (SELECT * FROM active UNION ALL SELECT * FROM recent),
  bounds AS (
    SELECT MIN(period_start) AS ps, MAX(period_end) AS pe, SUM(target_amount) AS total_target
    FROM scope
    WHERE (period_start, period_end) = (
      SELECT period_start, period_end FROM scope
      ORDER BY period_end DESC, period_start DESC LIMIT 1
    )
  )
  SELECT ps, pe, total_target
  INTO _budget_period_start, _budget_period_end, _budget_target
  FROM bounds;

  IF _budget_target IS NOT NULL AND _budget_target > 0 THEN
    SELECT COALESCE(SUM(e.amount), 0) INTO _budget_actual
    FROM expenses e
    WHERE e.workspace_id = _workspace_id AND e.deleted_at IS NULL
      AND e.payment_status = 'paid' AND e.paid_date IS NOT NULL
      AND e.paid_date BETWEEN _budget_period_start AND _budget_period_end
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

  -- ── Insufficient-data gate ─────────────────────────────────────────────
  -- Need at least 3 months of invoicing AND any payment activity AND TTM revenue.
  IF _months_with_revenue < 3 OR _ttm_invoiced = 0 OR _ttm_collected = 0 THEN
    _band := 'insufficient_data';
    _score := 0;
    _caution := 'wait_and_stabilize';
    _drivers := _drivers || jsonb_build_object('label','Not enough operating history','impact','neutral');
    _flags := _flags || to_jsonb('Less than 3 months of invoicing or payments — lender review would be premature.'::text);
    _summary := 'Insufficient data: build at least 3 months of consistent invoicing and collections before evaluating debt.';

    RETURN jsonb_build_object(
      'band', _band,
      'score', _score,
      'caution', _caution,
      'summary', _summary,
      'drivers', _drivers,
      'flags', _flags,
      'inputs', jsonb_build_object(
        'months_with_revenue', _months_with_revenue,
        'ttm_invoiced', _ttm_invoiced,
        'ttm_collected', _ttm_collected,
        'collection_rate', _collection_rate,
        'overdue_amount', _overdue_amount,
        'overdue_ratio', _overdue_ratio,
        'receivables', _receivables,
        'payables', _payables,
        'net_cash_30d', _net_30,
        'net_cash_90d', _net_90,
        'avg_monthly_net_90d', _avg_monthly_net,
        'sub_burn_monthly', _sub_burn,
        'trend_pct', _trend_pct,
        'dso_days', _dso, 'dpo_days', _dpo, 'ccc_days', _ccc,
        'budget_status', _budget_status,
        'budget_ratio', _budget_ratio
      )
    );
  END IF;

  -- ── Scoring (out of 100) ───────────────────────────────────────────────
  -- Weights:
  --   Collection reliability   25
  --   Cashflow sufficiency     25  (avg_monthly_net vs sub_burn floor)
  --   Overdue exposure         15
  --   Revenue trend            15
  --   Operating cycle (CCC)    10
  --   Budget discipline        10

  -- Collection reliability (25)
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

  -- Cashflow sufficiency (25): avg monthly net vs subscription burn
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

  -- Overdue exposure (15)
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

  -- Revenue trend (15)
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

  -- Operating cycle (10) — CCC
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

  -- Budget discipline (10)
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

  -- Extra hard flags that override softer scoring
  IF _payables > 0 AND _cash_in_30 > 0 AND _payables > _cash_in_30 * 2 THEN
    _flags := _flags || to_jsonb('Unpaid payables exceed 2× recent cash inflow — short-term liquidity strain.'::text);
  END IF;

  _score := GREATEST(0, LEAST(100, _score));

  -- ── Band + caution ─────────────────────────────────────────────────────
  -- Hard downgrade rules: any of these caps band at not_ready regardless of score.
  IF _avg_monthly_net IS NOT NULL AND _avg_monthly_net <= 0 THEN
    _band := 'not_ready';
    _caution := 'wait_and_stabilize';
  ELSIF _collection_rate IS NOT NULL AND _collection_rate < 0.5 THEN
    _band := 'not_ready';
    _caution := 'wait_and_stabilize';
  ELSIF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.40 THEN
    _band := 'not_ready';
    _caution := 'wait_and_stabilize';
  ELSE
    _band := CASE
      WHEN _score >= 75 THEN 'ready'
      WHEN _score >= 55 THEN 'borderline'
      ELSE 'not_ready'
    END;
    _caution := CASE _band
      WHEN 'ready' THEN 'safe_to_expand'
      WHEN 'borderline' THEN 'expand_carefully'
      ELSE 'wait_and_stabilize'
    END;
  END IF;

  -- ── Founder summary ────────────────────────────────────────────────────
  DECLARE
    _band_label text := CASE _band
      WHEN 'ready' THEN 'Ready'
      WHEN 'borderline' THEN 'Borderline'
      WHEN 'not_ready' THEN 'Not ready'
    END;
    _lead text;
    _trail text := NULL;
  BEGIN
    -- Lead clause (positive driver)
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

    -- Trailing clause (top concern, only if not already named)
    IF _band <> 'not_ready' THEN
      IF _overdue_ratio IS NOT NULL AND _overdue_ratio > 0.25 THEN
        _trail := 'overdue exposure should be reduced first';
      ELSIF _trend_pct IS NOT NULL AND _trend_pct <= -20 THEN
        _trail := 'reverse the revenue decline before borrowing';
      ELSIF _budget_status = 'overspent' THEN
        _trail := 'tighten spending before adding debt service';
      ELSIF _sub_burn > 0 AND _avg_monthly_net IS NOT NULL AND _avg_monthly_net < _sub_burn THEN
        _trail := 'fixed subscription burn already eats most of net cash';
      END IF;
    END IF;

    IF _trail IS NOT NULL THEN
      _summary := _band_label || ': ' || _lead || ', but ' || _trail || '.';
    ELSE
      _summary := _band_label || ': ' || _lead || '.';
    END IF;
  END;

  RETURN jsonb_build_object(
    'band', _band,
    'score', _score,
    'caution', _caution,
    'summary', _summary,
    'drivers', _drivers,
    'flags', _flags,
    'inputs', jsonb_build_object(
      'months_with_revenue', _months_with_revenue,
      'ttm_invoiced', _ttm_invoiced,
      'ttm_collected', _ttm_collected,
      'collection_rate', _collection_rate,
      'overdue_amount', _overdue_amount,
      'overdue_ratio', _overdue_ratio,
      'receivables', _receivables,
      'payables', _payables,
      'cash_in_30d', _cash_in_30,
      'cash_out_30d', _cash_out_30,
      'net_cash_30d', _net_30,
      'net_cash_90d', _net_90,
      'avg_monthly_net_90d', _avg_monthly_net,
      'sub_burn_monthly', _sub_burn,
      'trend_pct', _trend_pct,
      'dso_days', _dso, 'dpo_days', _dpo, 'ccc_days', _ccc,
      'budget_status', _budget_status,
      'budget_ratio', _budget_ratio
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_lender_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lender_readiness(uuid) TO authenticated;