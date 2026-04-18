
DO $$
DECLARE
  _admin_user uuid := '53298133-37ba-4420-b45a-9dbdf0cf4a01';
  _ws uuid;
  _scn record;
  _result jsonb;
  _co uuid;
  _inv uuid;
  _amt numeric;
  _i integer;
BEGIN
  FOR _scn IN
    SELECT * FROM (VALUES
      ('runway_insufficient_data_v3', 'insufficient_data', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
      ('runway_healthy_positive_v3', 'good',
        jsonb_build_array(100000, 100000, 100000),
        jsonb_build_array(50000, 50000, 50000),
        jsonb_build_array(10000)),
      ('runway_tight_v3', 'good',
        jsonb_build_array(30000, 30000, 30000),
        jsonb_build_array(50000, 50000, 50000),
        jsonb_build_array(5000)),
      ('runway_critical_v3', 'good',
        jsonb_build_array(10000, 10000, 10000),
        jsonb_build_array(80000, 80000, 80000),
        jsonb_build_array(20000))
    ) AS s(scenario, expected, payments, expenses, subs)
  LOOP
    INSERT INTO public.workspaces (id, name, billing_owner_id, currency)
    VALUES (gen_random_uuid(), 'RUNWAY_TEST_' || _scn.scenario, _admin_user, 'BDT')
    RETURNING id INTO _ws;

    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    VALUES (_ws, _admin_user, 'admin') ON CONFLICT DO NOTHING;

    IF jsonb_array_length(_scn.payments) > 0 THEN
      INSERT INTO public.companies (id, workspace_id, legal_name)
      VALUES (gen_random_uuid(), _ws, 'TestCo') RETURNING id INTO _co;
      _i := 0;
      FOR _amt IN SELECT (jsonb_array_elements_text(_scn.payments))::numeric LOOP
        INSERT INTO public.invoices (id, workspace_id, company_id, invoice_number, status, grand_total, amount_paid, currency, issue_date)
        VALUES (gen_random_uuid(), _ws, _co, 'TEST-' || _i, 'paid', _amt, _amt, 'BDT', CURRENT_DATE - (_i * 30))
        RETURNING id INTO _inv;
        INSERT INTO public.payments (workspace_id, invoice_id, amount, paid_at, recorded_by, method)
        VALUES (_ws, _inv, _amt, (CURRENT_DATE - (_i * 30))::timestamptz, _admin_user, 'cash');
        _i := _i + 1;
      END LOOP;
    END IF;

    IF jsonb_array_length(_scn.expenses) > 0 THEN
      _i := 0;
      FOR _amt IN SELECT (jsonb_array_elements_text(_scn.expenses))::numeric LOOP
        INSERT INTO public.expenses (workspace_id, description, amount, currency, payment_status, expense_date, paid_date, recorded_by)
        VALUES (_ws, 'Test ' || _i, _amt, 'BDT', 'paid', CURRENT_DATE - (_i * 30), CURRENT_DATE - (_i * 30), _admin_user);
        _i := _i + 1;
      END LOOP;
    END IF;

    IF jsonb_array_length(_scn.subs) > 0 THEN
      _i := 0;
      FOR _amt IN SELECT (jsonb_array_elements_text(_scn.subs))::numeric LOOP
        INSERT INTO public.subscriptions (workspace_id, name, amount, currency, interval_months, is_active, next_billing_date)
        VALUES (_ws, 'TestSub ' || _i, _amt, 'BDT', 1, true, CURRENT_DATE + 15);
        _i := _i + 1;
      END LOOP;
    END IF;

    PERFORM set_config('request.jwt.claim.sub', _admin_user::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _admin_user, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      _result := public.get_runway_forecast(_ws);
    EXCEPTION WHEN OTHERS THEN
      _result := jsonb_build_object('error', SQLERRM);
    END;
    PERFORM set_config('role', 'postgres', true);

    INSERT INTO public.lender_readiness_verification_runs
      (scenario, expected_band, actual_band, score, summary, caution, drivers, flags, inputs, pass)
    VALUES (
      _scn.scenario, _scn.expected,
      COALESCE(_result->>'data_quality', 'error'),
      COALESCE(ROUND(NULLIF(_result->>'runway_months','')::numeric)::int, -1),
      _result->>'summary',
      _result->>'trend',
      _result->'scenarios',
      _result->'flags',
      jsonb_build_object('cash_proxy', _result->'cash_proxy', 'avg_in', _result->'avg_monthly_inflow', 'avg_out', _result->'avg_monthly_outflow', 'sub', _result->'recurring_monthly_burden', 'burn', _result->'adjusted_monthly_burn'),
      (_result->>'data_quality') = _scn.expected
    );

    DELETE FROM public.payments WHERE workspace_id = _ws;
    DELETE FROM public.invoices WHERE workspace_id = _ws;
    DELETE FROM public.companies WHERE workspace_id = _ws;
    DELETE FROM public.expenses WHERE workspace_id = _ws;
    DELETE FROM public.subscriptions WHERE workspace_id = _ws;
    DELETE FROM public.workspace_memberships WHERE workspace_id = _ws;
    DELETE FROM public.audit_logs WHERE workspace_id = _ws;
    DELETE FROM public.workspaces WHERE id = _ws;
  END LOOP;
END $$;
