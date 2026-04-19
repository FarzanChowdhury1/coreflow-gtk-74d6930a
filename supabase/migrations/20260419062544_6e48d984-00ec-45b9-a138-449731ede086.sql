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

  -- SUBSCRIPTIONS (use is_active; no deleted_at on subscriptions)
  SELECT
    COALESCE(SUM(CASE WHEN interval_months <= 0 THEN amount ELSE amount / interval_months END), 0),
    COUNT(*)
  INTO _sub_monthly_total, _sub_active_count
  FROM public.subscriptions
  WHERE workspace_id = _workspace_id
    AND is_active = true;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.monthly_cost DESC), '[]'::jsonb)
  INTO _sub_top
  FROM (
    SELECT s.name, v.name AS vendor_name,
           CASE WHEN s.interval_months <= 0 THEN s.amount ELSE s.amount / s.interval_months END AS monthly_cost
    FROM public.subscriptions s
    LEFT JOIN public.vendors v ON v.id = s.vendor_id
    WHERE s.workspace_id = _workspace_id AND s.is_active = true
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

  -- VENDOR SPEND in window
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