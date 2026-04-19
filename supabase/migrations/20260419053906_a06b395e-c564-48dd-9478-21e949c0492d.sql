CREATE OR REPLACE FUNCTION public.run_runway_verification_as(_admin_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ws uuid;
  _scenarios jsonb := '[
    {"name":"insufficient_data","expected_band":"insufficient_data","expected_dq":"insufficient_data","payments":[],"expenses":[],"subs":[]},
    {"name":"healthy_buffer","expected_band":"healthy_buffer","expected_dq":"good","payments":[200000,180000,220000,210000,205000,195000,200000,190000,210000,205000,200000,200000],"expenses":[80000,90000,85000,75000,80000,82000,78000,85000,80000,79000,81000,83000],"subs":[5000,3000]},
    {"name":"moderate","expected_band":"moderate","expected_dq":"good","payments":[60000,55000,50000,58000,62000,55000,60000,57000,55000,58000],"expenses":[80000,85000,90000,82000,88000,84000,86000,83000,85000,87000],"subs":[8000]},
    {"name":"tight","expected_band":"tight","expected_dq":"good","payments":[20000,18000,15000,22000,19000,17000,18000,21000,20000,19000],"expenses":[50000,55000,52000,48000,53000,51000,49000,54000,52000,50000],"subs":[6000]},
    {"name":"critical","expected_band":"critical","expected_dq":"good","payments":[3000,2500,2000,3500,3000,2800,2600,3200,2900,2700],"expenses":[45000,48000,50000,46000,49000,47000,48000,46000,49000,47000],"subs":[12000]}
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

    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    VALUES (_ws, _admin_user_id, 'admin');

    _i := 0;
    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'payments'))::numeric LOOP
      INSERT INTO public.payments (workspace_id, invoice_id, amount, paid_at, recorded_by, method)
      VALUES (_ws, gen_random_uuid(), _amount,
              (_today - ((_i * 9) || ' days')::interval)::timestamptz,
              _admin_user_id, 'bank_transfer'::payment_method);
      _i := _i + 1;
    END LOOP;

    _i := 0;
    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'expenses'))::numeric LOOP
      INSERT INTO public.expenses (workspace_id, description, amount, expense_date, paid_date, payment_status, recorded_by)
      VALUES (_ws, 'verify expense', _amount,
              (_today - ((_i * 9) || ' days')::interval)::date,
              (_today - ((_i * 9) || ' days')::interval)::date,
              'paid', _admin_user_id);
      _i := _i + 1;
    END LOOP;

    FOR _amount IN SELECT (jsonb_array_elements_text(_s->'subs'))::numeric LOOP
      INSERT INTO public.subscriptions (workspace_id, name, amount, interval_months, next_billing_date, is_active)
      VALUES (_ws, 'verify sub', _amount, 1, _today + INTERVAL '15 days', true);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin_user_id::text, 'role','authenticated')::text, true);
    _result := public.get_runway_forecast(_ws);

    _band := _result->>'band';
    _dq := _result->>'data_quality';
    _runway := NULLIF(_result->>'runway_months','')::numeric;
    _summary := _result->>'summary';
    _drivers := _result->'drivers';
    _flags := _result->'flags';
    _pass := (_band = (_s->>'expected_band')) AND (_dq = (_s->>'expected_dq'));

    INSERT INTO public.runway_forecast_verification_runs
      (scenario, expected_band, actual_band, expected_data_quality, actual_data_quality,
       runway_months, summary, drivers, flags, inputs, pass)
    VALUES
      (_s->>'name', _s->>'expected_band', _band, _s->>'expected_dq', _dq,
       _runway, _summary, _drivers, _flags, _s, _pass);

    _output := _output || jsonb_build_array(jsonb_build_object(
      'scenario', _s->>'name',
      'expected_band', _s->>'expected_band',
      'actual_band', _band,
      'expected_dq', _s->>'expected_dq',
      'actual_dq', _dq,
      'runway_months', _runway,
      'pass', _pass,
      'raw', _result
    ));

    DELETE FROM public.payments WHERE workspace_id = _ws;
    DELETE FROM public.expenses WHERE workspace_id = _ws;
    DELETE FROM public.subscriptions WHERE workspace_id = _ws;
    DELETE FROM public.workspace_memberships WHERE workspace_id = _ws;
    DELETE FROM public.workspaces WHERE id = _ws;
  END LOOP;

  RETURN _output;
END;
$function$;