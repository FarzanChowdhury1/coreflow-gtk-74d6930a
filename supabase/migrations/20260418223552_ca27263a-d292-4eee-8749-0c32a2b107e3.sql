
DO $$
DECLARE
  _ws uuid;
  _admin uuid;
  _v1 uuid; _v2 uuid;
  _co uuid;
  _inv uuid;
  _result jsonb;
BEGIN
  SELECT user_id INTO _admin FROM workspace_memberships WHERE role='admin' LIMIT 1;
  IF _admin IS NULL THEN RAISE NOTICE 'no admin available'; RETURN; END IF;

  -- ===== A: insufficient_data =====
  _ws := gen_random_uuid();
  INSERT INTO workspaces(id, name, currency) VALUES (_ws, 'burden-A', 'BDT');
  INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _result := public.get_burden_analytics(_ws, 90);
  INSERT INTO lender_readiness_verification_runs(scenario, expected_band, actual_band, score, summary, flags, drivers, inputs, pass)
  VALUES ('burden_insufficient', 'insufficient_data', _result->>'band', 0,
          _result->>'summary', _result->'flags', _result->'drivers',
          jsonb_build_object('subs',0,'vendors',0), _result->>'band' = 'insufficient_data');
  DELETE FROM audit_logs WHERE workspace_id=_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=_ws;
  DELETE FROM workspaces WHERE id=_ws;

  -- ===== B: low =====
  _ws := gen_random_uuid();
  INSERT INTO workspaces(id, name, currency) VALUES (_ws, 'burden-B', 'BDT');
  INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  _v1 := gen_random_uuid();
  INSERT INTO vendors(id, workspace_id, name) VALUES (_v1, _ws, 'AcmeCloud');
  INSERT INTO subscriptions(workspace_id, name, vendor_id, amount, currency, interval_months, next_billing_date, is_active)
  VALUES (_ws, 'AcmeCloud Pro', _v1, 5000, 'BDT', 1, CURRENT_DATE+15, true);
  _co := gen_random_uuid();
  INSERT INTO companies(id, workspace_id, legal_name) VALUES (_co, _ws, 'CustB');
  _inv := gen_random_uuid();
  INSERT INTO invoices(id, workspace_id, invoice_number, company_id, status, currency, grand_total)
  VALUES (_inv, _ws, 'INV-B-1', _co, 'paid'::invoice_status, 'BDT', 1500000);
  INSERT INTO payments(workspace_id, invoice_id, amount, recorded_by, paid_at)
  VALUES (_ws, _inv, 1500000, _admin, now() - interval '20 days');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _result := public.get_burden_analytics(_ws, 90);
  INSERT INTO lender_readiness_verification_runs(scenario, expected_band, actual_band, score, summary, flags, drivers, inputs, pass)
  VALUES ('burden_low', 'low', _result->>'band',
          ROUND(((_result->'subscription'->>'vs_inflow_pct')::numeric * 100))::int,
          _result->>'summary', _result->'flags', _result->'drivers',
          jsonb_build_object('sub_burn', _result->'subscription'->>'monthly_burn',
                             'cash', _result->>'cash_in_window',
                             'vs_inflow_pct', _result->'subscription'->>'vs_inflow_pct'),
          _result->>'band' = 'low');
  DELETE FROM payments WHERE workspace_id=_ws;
  DELETE FROM invoices WHERE workspace_id=_ws;
  DELETE FROM companies WHERE workspace_id=_ws;
  DELETE FROM subscriptions WHERE workspace_id=_ws;
  DELETE FROM vendors WHERE workspace_id=_ws;
  DELETE FROM audit_logs WHERE workspace_id=_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=_ws;
  DELETE FROM workspaces WHERE id=_ws;

  -- ===== C: moderate + vendor concentration =====
  _ws := gen_random_uuid();
  INSERT INTO workspaces(id, name, currency) VALUES (_ws, 'burden-C', 'BDT');
  INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  _v1 := gen_random_uuid(); _v2 := gen_random_uuid();
  INSERT INTO vendors(id, workspace_id, name) VALUES (_v1, _ws, 'BigVendor'), (_v2, _ws, 'SmallVendor');
  INSERT INTO subscriptions(workspace_id, name, vendor_id, amount, currency, interval_months, next_billing_date, is_active)
  VALUES (_ws, 'Tool A', _v1, 30000, 'BDT', 1, CURRENT_DATE+10, true),
         (_ws, 'Tool B', _v2, 20000, 'BDT', 1, CURRENT_DATE+10, true);
  INSERT INTO expenses(workspace_id, description, amount, vendor_id, payment_status, paid_date, expense_date, recorded_by)
  VALUES (_ws, 'Hosting', 90000, _v1, 'paid', CURRENT_DATE-5, CURRENT_DATE-5, _admin),
         (_ws, 'Misc', 10000, _v2, 'paid', CURRENT_DATE-5, CURRENT_DATE-5, _admin);
  _co := gen_random_uuid();
  INSERT INTO companies(id, workspace_id, legal_name) VALUES (_co, _ws, 'CustC');
  _inv := gen_random_uuid();
  -- 600k inflow over 90d => ~200k/mo monthly inflow; sub burn 50k => 25% => moderate
  INSERT INTO invoices(id, workspace_id, invoice_number, company_id, status, currency, grand_total)
  VALUES (_inv, _ws, 'INV-C-1', _co, 'paid'::invoice_status, 'BDT', 600000);
  INSERT INTO payments(workspace_id, invoice_id, amount, recorded_by, paid_at)
  VALUES (_ws, _inv, 600000, _admin, now() - interval '30 days');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _result := public.get_burden_analytics(_ws, 90);
  INSERT INTO lender_readiness_verification_runs(scenario, expected_band, actual_band, score, summary, flags, drivers, inputs, pass)
  VALUES ('burden_moderate_vendor_concentrated', 'moderate', _result->>'band',
          ROUND(((_result->'subscription'->>'vs_inflow_pct')::numeric * 100))::int,
          _result->>'summary', _result->'flags', _result->'drivers',
          jsonb_build_object('sub_burn', _result->'subscription'->>'monthly_burn',
                             'vendor_top1', _result->'vendor'->>'top1_share',
                             'cash', _result->>'cash_in_window',
                             'vs_inflow_pct', _result->'subscription'->>'vs_inflow_pct'),
          _result->>'band' = 'moderate' AND jsonb_array_length(_result->'flags') >= 1);
  DELETE FROM payments WHERE workspace_id=_ws;
  DELETE FROM invoices WHERE workspace_id=_ws;
  DELETE FROM companies WHERE workspace_id=_ws;
  DELETE FROM expenses WHERE workspace_id=_ws;
  DELETE FROM subscriptions WHERE workspace_id=_ws;
  DELETE FROM vendors WHERE workspace_id=_ws;
  DELETE FROM audit_logs WHERE workspace_id=_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=_ws;
  DELETE FROM workspaces WHERE id=_ws;

  -- ===== D: heavy (subs but zero inflow) =====
  _ws := gen_random_uuid();
  INSERT INTO workspaces(id, name, currency) VALUES (_ws, 'burden-D', 'BDT');
  INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  _v1 := gen_random_uuid();
  INSERT INTO vendors(id, workspace_id, name) VALUES (_v1, _ws, 'OnlyVendor');
  INSERT INTO subscriptions(workspace_id, name, vendor_id, amount, currency, interval_months, next_billing_date, is_active)
  VALUES (_ws, 'Mega Tool', _v1, 100000, 'BDT', 1, CURRENT_DATE+10, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _result := public.get_burden_analytics(_ws, 90);
  INSERT INTO lender_readiness_verification_runs(scenario, expected_band, actual_band, score, summary, flags, drivers, inputs, pass)
  VALUES ('burden_heavy_no_inflow', 'heavy', _result->>'band', 0,
          _result->>'summary', _result->'flags', _result->'drivers',
          jsonb_build_object('sub_burn', _result->'subscription'->>'monthly_burn',
                             'cash', _result->>'cash_in_window'),
          _result->>'band' = 'heavy' AND jsonb_array_length(_result->'flags') >= 1);
  DELETE FROM subscriptions WHERE workspace_id=_ws;
  DELETE FROM vendors WHERE workspace_id=_ws;
  DELETE FROM audit_logs WHERE workspace_id=_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=_ws;
  DELETE FROM workspaces WHERE id=_ws;
END $$;
