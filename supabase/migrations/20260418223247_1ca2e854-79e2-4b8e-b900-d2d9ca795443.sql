
-- Burden Analytics RPC: subscription monthly burn + vendor spend with concentration
CREATE OR REPLACE FUNCTION public.get_burden_analytics(
  _workspace_id uuid,
  _window_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _now date := CURRENT_DATE;
  _window_start date;
  _months_in_window numeric;

  -- subscription metrics
  _sub_monthly_total numeric := 0;
  _sub_active_count integer := 0;
  _sub_top jsonb := '[]'::jsonb;
  _sub_top1_share numeric := 0;
  _sub_top3_share numeric := 0;

  -- vendor metrics (paid expenses in window)
  _vendor_spend_total numeric := 0;
  _vendor_count integer := 0;
  _vendor_top jsonb := '[]'::jsonb;
  _vendor_top1_share numeric := 0;
  _vendor_top3_share numeric := 0;

  -- baseline cash inflow
  _cash_in_window numeric := 0;

  -- band logic
  _sub_vs_inflow_pct numeric;
  _band text;
  _band_label text;
  _summary text;
  _flags jsonb := '[]'::jsonb;
  _drivers jsonb := '[]'::jsonb;
  _has_data boolean;
BEGIN
  IF _workspace_id IS NULL THEN
    RETURN jsonb_build_object('error', 'workspace_id required');
  END IF;
  IF _window_days IS NULL OR _window_days < 7 OR _window_days > 365 THEN
    _window_days := 90;
  END IF;

  SELECT public.has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role)
    INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  _window_start := _now - (_window_days || ' days')::interval;
  _months_in_window := GREATEST(_window_days::numeric / 30.0, 1);

  -- ============ SUBSCRIPTIONS ============
  SELECT
    COALESCE(SUM(CASE WHEN interval_months <= 0 THEN amount ELSE amount / interval_months END), 0),
    COUNT(*)
  INTO _sub_monthly_total, _sub_active_count
  FROM subscriptions
  WHERE workspace_id = _workspace_id AND is_active = true;

  -- top 5 subscriptions by monthly equivalent
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO _sub_top
  FROM (
    SELECT
      s.name,
      COALESCE(v.name, '—') AS vendor_name,
      ROUND((CASE WHEN s.interval_months <= 0 THEN s.amount ELSE s.amount / s.interval_months END)::numeric, 2) AS monthly_amount,
      s.currency,
      s.category
    FROM subscriptions s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    WHERE s.workspace_id = _workspace_id AND s.is_active = true
    ORDER BY (CASE WHEN s.interval_months <= 0 THEN s.amount ELSE s.amount / s.interval_months END) DESC NULLS LAST
    LIMIT 5
  ) t;

  IF _sub_monthly_total > 0 THEN
    SELECT
      COALESCE((_sub_top->0->>'monthly_amount')::numeric, 0) / _sub_monthly_total,
      LEAST(
        (COALESCE((_sub_top->0->>'monthly_amount')::numeric, 0)
         + COALESCE((_sub_top->1->>'monthly_amount')::numeric, 0)
         + COALESCE((_sub_top->2->>'monthly_amount')::numeric, 0)) / _sub_monthly_total,
        1
      )
    INTO _sub_top1_share, _sub_top3_share;
  END IF;

  -- ============ VENDORS (paid expenses in window) ============
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(DISTINCT vendor_id)
  INTO _vendor_spend_total, _vendor_count
  FROM expenses
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL
    AND payment_status = 'paid'
    AND vendor_id IS NOT NULL
    AND COALESCE(paid_date, expense_date) >= _window_start;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO _vendor_top
  FROM (
    SELECT
      v.name AS vendor_name,
      v.category,
      ROUND(SUM(e.amount)::numeric, 2) AS spend_amount,
      COUNT(*)::int AS expense_count
    FROM expenses e
    JOIN vendors v ON v.id = e.vendor_id
    WHERE e.workspace_id = _workspace_id
      AND e.deleted_at IS NULL
      AND e.payment_status = 'paid'
      AND COALESCE(e.paid_date, e.expense_date) >= _window_start
    GROUP BY v.id, v.name, v.category
    ORDER BY SUM(e.amount) DESC
    LIMIT 5
  ) t;

  IF _vendor_spend_total > 0 THEN
    SELECT
      COALESCE((_vendor_top->0->>'spend_amount')::numeric, 0) / _vendor_spend_total,
      LEAST(
        (COALESCE((_vendor_top->0->>'spend_amount')::numeric, 0)
         + COALESCE((_vendor_top->1->>'spend_amount')::numeric, 0)
         + COALESCE((_vendor_top->2->>'spend_amount')::numeric, 0)) / _vendor_spend_total,
        1
      )
    INTO _vendor_top1_share, _vendor_top3_share;
  END IF;

  -- ============ CASH INFLOW BASELINE (collected revenue in window) ============
  SELECT COALESCE(SUM(amount), 0)
  INTO _cash_in_window
  FROM payments
  WHERE workspace_id = _workspace_id
    AND paid_at >= _window_start;

  -- monthly equivalent of cash inflow
  -- _sub_vs_inflow_pct = monthly subscription burn / monthly cash inflow
  IF _cash_in_window > 0 THEN
    _sub_vs_inflow_pct := _sub_monthly_total / (_cash_in_window / _months_in_window);
  ELSE
    _sub_vs_inflow_pct := NULL;
  END IF;

  _has_data := (_sub_active_count > 0 OR _vendor_count > 0);

  -- ============ FLAGS ============
  IF _sub_active_count > 0 AND _sub_top1_share >= 0.6 THEN
    _flags := _flags || to_jsonb('Single subscription dominates >60% of monthly software cost'::text);
  END IF;
  IF _sub_active_count >= 3 AND _sub_top3_share >= 0.85 THEN
    _flags := _flags || to_jsonb('Top 3 subscriptions account for >85% of software burn'::text);
  END IF;
  IF _vendor_count > 0 AND _vendor_top1_share >= 0.6 THEN
    _flags := _flags || to_jsonb('Single vendor accounts for >60% of recent paid spend'::text);
  END IF;
  IF _vendor_count >= 3 AND _vendor_top3_share >= 0.85 THEN
    _flags := _flags || to_jsonb('Top 3 vendors account for >85% of recent paid spend'::text);
  END IF;
  IF _cash_in_window = 0 AND (_sub_monthly_total > 0 OR _vendor_spend_total > 0) THEN
    _flags := _flags || to_jsonb('Fixed costs exist with zero collected revenue in window'::text);
  END IF;

  -- ============ BAND ============
  IF NOT _has_data THEN
    _band := 'insufficient_data';
    _band_label := 'Insufficient data';
    _summary := 'Add subscriptions or vendor-linked paid expenses to see fixed-cost burden analysis.';
  ELSIF _cash_in_window = 0 AND _sub_monthly_total > 0 THEN
    _band := 'heavy';
    _band_label := 'Heavy burden';
    _summary := 'Heavy burden: fixed software costs exist but no recent cash inflow to absorb them.';
  ELSIF _sub_vs_inflow_pct IS NULL THEN
    _band := 'low';
    _band_label := 'Low burden';
    _summary := 'Low burden: minimal recurring software cost relative to current operations.';
  ELSIF _sub_vs_inflow_pct >= 0.5 THEN
    _band := 'heavy';
    _band_label := 'Heavy burden';
    _summary := 'Heavy burden: subscription burn consumes more than half of monthly cash inflow.';
  ELSIF _sub_vs_inflow_pct >= 0.2 THEN
    _band := 'moderate';
    _band_label := 'Moderate burden';
    _summary := 'Moderate burden: recurring software cost is a meaningful share of monthly inflow.';
  ELSE
    _band := 'low';
    _band_label := 'Low burden';
    _summary := 'Low burden: fixed software cost is comfortable relative to monthly inflow.';
  END IF;

  -- ============ DRIVERS ============
  _drivers := jsonb_build_array(
    jsonb_build_object(
      'label', 'Monthly subscription burn',
      'value', ROUND(_sub_monthly_total, 2),
      'impact', CASE WHEN _sub_monthly_total = 0 THEN 'neutral'
                     WHEN _sub_vs_inflow_pct IS NOT NULL AND _sub_vs_inflow_pct >= 0.5 THEN 'negative'
                     WHEN _sub_vs_inflow_pct IS NOT NULL AND _sub_vs_inflow_pct >= 0.2 THEN 'warning'
                     ELSE 'positive' END
    ),
    jsonb_build_object(
      'label', 'Vendor spend in window',
      'value', ROUND(_vendor_spend_total, 2),
      'impact', CASE WHEN _vendor_spend_total = 0 THEN 'neutral'
                     WHEN _vendor_top1_share >= 0.6 THEN 'warning'
                     ELSE 'neutral' END
    ),
    jsonb_build_object(
      'label', 'Top subscription share',
      'value', ROUND(_sub_top1_share * 100, 1),
      'impact', CASE WHEN _sub_active_count = 0 THEN 'neutral'
                     WHEN _sub_top1_share >= 0.6 THEN 'warning'
                     ELSE 'positive' END
    ),
    jsonb_build_object(
      'label', 'Top vendor share',
      'value', ROUND(_vendor_top1_share * 100, 1),
      'impact', CASE WHEN _vendor_count = 0 THEN 'neutral'
                     WHEN _vendor_top1_share >= 0.6 THEN 'warning'
                     ELSE 'positive' END
    )
  );

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'subscription', jsonb_build_object(
      'monthly_burn', ROUND(_sub_monthly_total, 2),
      'active_count', _sub_active_count,
      'top', _sub_top,
      'top1_share', ROUND(_sub_top1_share, 4),
      'top3_share', ROUND(_sub_top3_share, 4),
      'vs_inflow_pct', CASE WHEN _sub_vs_inflow_pct IS NULL THEN NULL ELSE ROUND(_sub_vs_inflow_pct, 4) END
    ),
    'vendor', jsonb_build_object(
      'spend_total', ROUND(_vendor_spend_total, 2),
      'vendor_count', _vendor_count,
      'top', _vendor_top,
      'top1_share', ROUND(_vendor_top1_share, 4),
      'top3_share', ROUND(_vendor_top3_share, 4)
    ),
    'cash_in_window', ROUND(_cash_in_window, 2),
    'band', _band,
    'band_label', _band_label,
    'summary', _summary,
    'drivers', _drivers,
    'flags', _flags
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_burden_analytics(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_burden_analytics(uuid, integer) TO authenticated;
