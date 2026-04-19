-- 1. Create dedicated runway verification artifact
CREATE TABLE IF NOT EXISTS public.runway_forecast_verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  scenario text NOT NULL,
  expected_band text NOT NULL,
  actual_band text,
  expected_data_quality text,
  actual_data_quality text,
  runway_months numeric,
  summary text,
  drivers jsonb,
  flags jsonb,
  inputs jsonb,
  pass boolean
);

ALTER TABLE public.runway_forecast_verification_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read runway verification runs" ON public.runway_forecast_verification_runs;
CREATE POLICY "Platform admins read runway verification runs"
  ON public.runway_forecast_verification_runs
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

-- 2. Replace get_runway_forecast with band + data_quality canonical contract
CREATE OR REPLACE FUNCTION public.get_runway_forecast(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_admin boolean;
  _today date := CURRENT_DATE;
  _in_30 numeric := 0; _in_90 numeric := 0; _in_180 numeric := 0;
  _out_30 numeric := 0; _out_90 numeric := 0; _out_180 numeric := 0;
  _payment_count_180 integer := 0;
  _expense_count_180 integer := 0;
  _sub_monthly numeric := 0;
  _avg_in_monthly numeric := 0;
  _avg_out_monthly numeric := 0;
  _adjusted_burn numeric := 0;
  _net_30 numeric := 0; _net_90 numeric := 0; _net_180 numeric := 0;
  _cash_proxy numeric := 0;
  _runway_months numeric := NULL;
  _base_burn numeric := 0; _base_net numeric := 0;
  _best_burn numeric := 0; _best_net numeric := 0;
  _worst_burn numeric := 0; _worst_net numeric := 0;
  _base_runway numeric := NULL;
  _best_runway numeric := NULL;
  _worst_runway numeric := NULL;
  _trend text := 'stable';
  _trend_pct numeric := NULL;
  _data_quality text := 'insufficient_data';
  _band text := 'insufficient_data';
  _summary text := '';
  _flags jsonb := '[]'::jsonb;
  _drivers jsonb := '[]'::jsonb;
BEGIN
  SELECT public.has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN paid_at >= _today - INTERVAL '30 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN paid_at >= _today - INTERVAL '90 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN paid_at >= _today - INTERVAL '180 days' THEN amount END), 0),
    COUNT(*) FILTER (WHERE paid_at >= _today - INTERVAL '180 days')
  INTO _in_30, _in_90, _in_180, _payment_count_180
  FROM public.payments WHERE workspace_id = _workspace_id;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(paid_date, expense_date) >= _today - INTERVAL '30 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(paid_date, expense_date) >= _today - INTERVAL '90 days' THEN amount END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(paid_date, expense_date) >= _today - INTERVAL '180 days' THEN amount END), 0),
    COUNT(*) FILTER (WHERE COALESCE(paid_date, expense_date) >= _today - INTERVAL '180 days')
  INTO _out_30, _out_90, _out_180, _expense_count_180
  FROM public.expenses
  WHERE workspace_id = _workspace_id AND deleted_at IS NULL AND payment_status = 'paid';

  SELECT COALESCE(SUM(
    CASE WHEN COALESCE(interval_months, 0) <= 0 THEN amount ELSE amount / interval_months END
  ), 0) INTO _sub_monthly
  FROM public.subscriptions WHERE workspace_id = _workspace_id AND is_active = true;

  _avg_in_monthly := _in_90 / 3.0;
  _avg_out_monthly := _out_90 / 3.0;
  _net_30 := _in_30 - _out_30;
  _net_90 := _in_90 - _out_90;
  _net_180 := _in_180 - _out_180;
  _cash_proxy := GREATEST(_net_90, 0);
  _adjusted_burn := GREATEST(_avg_out_monthly, _sub_monthly);

  DECLARE _net_prev30 numeric;
  BEGIN
    _net_prev30 := (_net_90 - _net_30) / 2.0;
    IF ABS(COALESCE(_net_prev30, 0)) < 0.01 THEN _trend_pct := NULL;
    ELSE _trend_pct := ((_net_30 - _net_prev30) / ABS(_net_prev30)) * 100.0;
    END IF;
  END;

  IF _trend_pct IS NULL THEN _trend := 'stable';
  ELSIF _trend_pct >= 10 THEN _trend := 'improving';
  ELSIF _trend_pct <= -10 THEN _trend := 'deteriorating';
  ELSE _trend := 'stable';
  END IF;

  -- data_quality: data sufficiency only
  IF _payment_count_180 = 0 AND _expense_count_180 = 0 AND _sub_monthly = 0 THEN
    _data_quality := 'insufficient_data';
  ELSIF _payment_count_180 < 3 OR _expense_count_180 < 3 THEN
    _data_quality := 'low';
  ELSIF _payment_count_180 < 10 OR _expense_count_180 < 10 THEN
    _data_quality := 'moderate';
  ELSE
    _data_quality := 'good';
  END IF;

  _base_burn := _adjusted_burn;
  _base_net := _avg_in_monthly - _base_burn;
  _best_burn := GREATEST(_avg_out_monthly * 0.90, _sub_monthly);
  _best_net := (_avg_in_monthly * 1.15) - _best_burn;
  _worst_burn := GREATEST(_avg_out_monthly * 1.10, _sub_monthly);
  _worst_net := (_avg_in_monthly * 0.80) - _worst_burn;

  IF _data_quality <> 'insufficient_data' THEN
    IF _base_burn > 0 AND _avg_in_monthly < _base_burn THEN
      _base_runway := ROUND((_cash_proxy / NULLIF(_base_burn - _avg_in_monthly, 0))::numeric, 1);
    ELSIF _avg_in_monthly >= _base_burn AND _base_burn > 0 THEN
      _base_runway := NULL;
    END IF;
    IF _best_burn > 0 AND (_avg_in_monthly * 1.15) < _best_burn THEN
      _best_runway := ROUND((_cash_proxy / NULLIF(_best_burn - (_avg_in_monthly * 1.15), 0))::numeric, 1);
    ELSE _best_runway := NULL;
    END IF;
    IF _worst_burn > 0 AND (_avg_in_monthly * 0.80) < _worst_burn THEN
      _worst_runway := ROUND((_cash_proxy / NULLIF(_worst_burn - (_avg_in_monthly * 0.80), 0))::numeric, 1);
    ELSE _worst_runway := NULL;
    END IF;
    _runway_months := _base_runway;
  END IF;

  -- band: runway risk classification (separate from data sufficiency)
  IF _data_quality = 'insufficient_data' THEN
    _band := 'insufficient_data';
  ELSIF _base_net >= 0 THEN
    _band := 'healthy_buffer';                 -- cash-flow positive
  ELSIF _base_runway IS NULL THEN
    _band := 'moderate';                       -- burn detected but uncomputable
  ELSIF _base_runway >= 6 THEN
    _band := 'healthy_buffer';
  ELSIF _base_runway >= 3 THEN
    _band := 'moderate';
  ELSIF _base_runway >= 1.5 THEN
    _band := 'tight';
  ELSE
    _band := 'critical';
  END IF;

  _drivers := jsonb_build_array(
    jsonb_build_object('label', 'Avg monthly inflow',  'value', ROUND(_avg_in_monthly)::int,  'impact', 'positive'),
    jsonb_build_object('label', 'Avg monthly outflow', 'value', ROUND(_avg_out_monthly)::int, 'impact', 'negative'),
    jsonb_build_object('label', 'Recurring subscription burden', 'value', ROUND(_sub_monthly)::int, 'impact', CASE WHEN _sub_monthly > _avg_in_monthly * 0.5 THEN 'warning' ELSE 'neutral' END),
    jsonb_build_object('label', 'Cash proxy (90d net)', 'value', ROUND(_cash_proxy)::int, 'impact', CASE WHEN _cash_proxy <= 0 THEN 'negative' ELSE 'positive' END)
  );

  IF _data_quality = 'insufficient_data' THEN
    _flags := _flags || jsonb_build_array('Not enough payment, expense, or subscription history to forecast runway.');
  ELSE
    IF _avg_in_monthly = 0 THEN
      _flags := _flags || jsonb_build_array('No collections in trailing 90 days — runway depends entirely on existing cash.');
    END IF;
    IF _base_net < 0 AND _cash_proxy <= _base_burn * 2 THEN
      _flags := _flags || jsonb_build_array('Less than ~2 months of operating buffer at current burn.');
    END IF;
    IF _sub_monthly > 0 AND _sub_monthly > _avg_in_monthly * 0.5 AND _avg_in_monthly > 0 THEN
      _flags := _flags || jsonb_build_array('Recurring subscription burden exceeds 50% of monthly inflow.');
    END IF;
    IF _trend = 'deteriorating' THEN
      _flags := _flags || jsonb_build_array('Net cash trend is deteriorating vs prior 60-day baseline.');
    END IF;
    IF _worst_runway IS NOT NULL AND _worst_runway < 2 THEN
      _flags := _flags || jsonb_build_array('Worst-case scenario implies under 2 months of runway.');
    END IF;
  END IF;

  IF _band = 'insufficient_data' THEN
    _summary := 'Not enough cash activity to forecast runway. Record payments, paid expenses, and active subscriptions to enable forecasting.';
  ELSIF _base_net >= 0 THEN
    _summary := 'Cash-flow positive at current pace. Operating runway is not the constraint — focus on growth, not survival.';
  ELSIF _band = 'healthy_buffer' THEN
    _summary := 'Burning cash but with ' || _base_runway::text || ' months of operating buffer at current pace. Manageable, monitor monthly.';
  ELSIF _band = 'moderate' THEN
    _summary := COALESCE('Moderate pressure: ~' || _base_runway::text || ' months of operating buffer. Tighten spend or accelerate collections.', 'Moderate pressure detected; runway not precisely computable.');
  ELSIF _band = 'tight' THEN
    _summary := 'Tight: ~' || _base_runway::text || ' months of operating buffer. Act this quarter — reduce burn or raise cash.';
  ELSIF _band = 'critical' THEN
    _summary := 'Critical: only ' || _base_runway::text || ' months of operating buffer remain at current pace.';
  ELSE
    _summary := 'Burn detected but runway not computable from available signals.';
  END IF;

  RETURN jsonb_build_object(
    'band',                     _band,
    'data_quality',             _data_quality,
    'cash_proxy',               ROUND(_cash_proxy)::int,
    'cash_proxy_basis',         'trailing_90d_net_cash',
    'cash_proxy_note',          'Operating runway proxy based on trailing 90d net cash (payments minus paid expenses). This is not a bank balance.',
    'trailing', jsonb_build_object(
      'in_30', ROUND(_in_30)::int, 'in_90', ROUND(_in_90)::int, 'in_180', ROUND(_in_180)::int,
      'out_30', ROUND(_out_30)::int, 'out_90', ROUND(_out_90)::int, 'out_180', ROUND(_out_180)::int,
      'net_30', ROUND(_net_30)::int, 'net_90', ROUND(_net_90)::int, 'net_180', ROUND(_net_180)::int
    ),
    'avg_monthly_inflow',       ROUND(_avg_in_monthly)::int,
    'avg_monthly_outflow',      ROUND(_avg_out_monthly)::int,
    'recurring_monthly_burden', ROUND(_sub_monthly)::int,
    'adjusted_monthly_burn',    ROUND(_adjusted_burn)::int,
    'runway_months',            _runway_months,
    'trend',                    _trend,
    'trend_pct',                _trend_pct,
    'scenarios', jsonb_build_object(
      'base',  jsonb_build_object('monthly_burn', ROUND(_base_burn)::int,  'monthly_net', ROUND(_base_net)::int,  'runway_months', _base_runway,  'assumptions', 'Trailing-90d behavior continues unchanged.'),
      'best',  jsonb_build_object('monthly_burn', ROUND(_best_burn)::int,  'monthly_net', ROUND(_best_net)::int,  'runway_months', _best_runway,  'assumptions', 'Inflow +15%, controllable outflow -10%, subscriptions unchanged.'),
      'worst', jsonb_build_object('monthly_burn', ROUND(_worst_burn)::int, 'monthly_net', ROUND(_worst_net)::int, 'runway_months', _worst_runway, 'assumptions', 'Inflow -20%, outflow +10%, subscriptions unchanged.')
    ),
    'drivers', _drivers,
    'flags',   _flags,
    'summary', _summary
  );
END;
$function$;