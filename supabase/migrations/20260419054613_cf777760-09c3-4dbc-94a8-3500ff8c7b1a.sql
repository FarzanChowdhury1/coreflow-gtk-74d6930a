CREATE OR REPLACE FUNCTION public.run_runway_verification_as(_admin_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ws uuid; _company uuid; _inv uuid; _seq integer;
  _scenarios jsonb := '[
    {"name":"insufficient_data","expected_band":"insufficient_data","expected_dq":"insufficient_data","payments":[],"expenses":[],"subs":[]},
    {"name":"healthy_buffer","expected_band":"healthy_buffer","expected_dq":"good","payments":[200000,180000,220000,210000,205000,195000,200000,190000,210000,205000,200000,200000],"expenses":[80000,90000,85000,75000,80000,82000,78000,85000,80000,79000,81000,83000],"subs":[5000,3000]},
    {"name":"moderate","expected_band":"moderate","expected_dq":"good","payments":[15000,16000,14000,15000,16000,15000,14000,16000,15000,14000,15000,16000],"expenses":[3000,3500,3000,4000,3000,3500,3000,4000,3000,3500,3000,3000],"subs":[100000]},
    {"name":"tight","expected_band":"tight","expected_dq":"good","payments":[7000,8000,7000,8000,7000,8000,7000,8000,7000,8000,7000,8000],"expenses":[2000,1500,2000,1500,2000,1500,2000,1500,2000,1500,2000,1500],"subs":[70000]},
    {"name":"critical","expected_band":"critical","expected_dq":"good","payments":[2000,3000,2000,3000,2000,3000,2000,3000,2000,3000],"expenses":[5500,5800,5200,5600,5400,5700,5300,5500,5800,5400],"subs":[40000]}
  ]'::jsonb;
  _s jsonb; _result jsonb; _i integer; _amount numeric;
  _band text; _dq text; _runway numeric; _summary text;
  _drivers jsonb; _flags jsonb; _pass boolean;
  _output jsonb := '[]'::jsonb;
  _today date := CURRENT_DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _admin_user_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR _s IN SELECT * FROM jsonb_array_elements(_scenarios) LOOP
    INSERT INTO public.workspaces (name, billing_owner_id)
    VALUES ('runway_verify_' || (_s->>'name') || '_' || substr(gen_random_uuid()::text,1,6), _admin_user_id)
    RETURNING id INTO _ws;
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES (_ws, _admin_user_id, 'admin');
    INSERT INTO public.companies (workspace_id, legal_name) VALUES (_ws, 'Verify Co') RETURNING id INTO _company;

    _i := 0; _seq := 1;
    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'payments'))::numeric LOOP
      INSERT INTO public.invoices (workspace_id, company_id, invoice_number, status, grand_total, amount_paid, issue_date)
      VALUES (_ws, _company, 'V-' || _seq::text, 'paid', _amount, _amount, (_today - ((_i * 8) || ' days')::interval)::date)
      RETURNING id INTO _inv;
      INSERT INTO public.payments (workspace_id, invoice_id, amount, paid_at, recorded_by, method)
      VALUES (_ws, _inv, _amount, (_today - ((_i * 8) || ' days')::interval)::timestamptz, _admin_user_id, 'bank_transfer'::payment_method);
      _i := _i + 1; _seq := _seq + 1;
    END LOOP;

    _i := 0;
    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'expenses'))::numeric LOOP
      INSERT INTO public.expenses (workspace_id, description, amount, expense_date, paid_date, payment_status, recorded_by)
      VALUES (_ws, 'verify expense', _amount,
              (_today - ((_i * 8) || ' days')::interval)::date,
              (_today - ((_i * 8) || ' days')::interval)::date,
              'paid', _admin_user_id);
      _i := _i + 1;
    END LOOP;

    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'subs'))::numeric LOOP
      INSERT INTO public.subscriptions (workspace_id, name, amount, interval_months, next_billing_date, is_active)
      VALUES (_ws, 'verify sub', _amount, 1, _today + INTERVAL '15 days', true);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin_user_id::text, 'role','authenticated')::text, true);
    _result := public.get_runway_forecast(_ws);

    _band := _result->>'band'; _dq := _result->>'data_quality';
    _runway := NULLIF(_result->>'runway_months','')::numeric;
    _summary := _result->>'summary'; _drivers := _result->'drivers'; _flags := _result->'flags';
    _pass := (_band = (_s->>'expected_band')) AND (_dq = (_s->>'expected_dq'));

    INSERT INTO public.runway_forecast_verification_runs
      (scenario, expected_band, expected_data_quality, actual_band, actual_data_quality, runway_months, summary, drivers, flags, pass, inputs)
    VALUES (_s->>'name', _s->>'expected_band', _s->>'expected_dq', _band, _dq, _runway, _summary, _drivers, _flags, _pass, _result);

    _output := _output || jsonb_build_array(jsonb_build_object(
      'scenario', _s->>'name', 'expected_band', _s->>'expected_band', 'actual_band', _band,
      'expected_dq', _s->>'expected_dq', 'actual_dq', _dq,
      'runway_months', _runway, 'cash_proxy', _result->'cash_proxy',
      'avg_in', _result->'avg_monthly_inflow', 'avg_out', _result->'avg_monthly_outflow',
      'sub_burden', _result->'recurring_monthly_burden', 'pass', _pass
    ));
  END LOOP;

  RETURN _output;
END;
$function$;