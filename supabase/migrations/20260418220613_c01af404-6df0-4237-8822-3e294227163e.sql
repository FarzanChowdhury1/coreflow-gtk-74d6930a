DO $$
DECLARE
  v_ws uuid; v_user uuid; v_company uuid; v_inv uuid; v_result jsonb; m int;
BEGIN
  SELECT user_id INTO v_user FROM platform_admins LIMIT 1;
  IF v_user IS NULL THEN SELECT id INTO v_user FROM auth.users LIMIT 1; END IF;

  INSERT INTO workspaces (name, currency, plan)
  VALUES ('lr-verify-borderline-v2', 'BDT', 'growth') RETURNING id INTO v_ws;
  INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (v_ws, v_user, 'admin');
  INSERT INTO companies (workspace_id, legal_name) VALUES (v_ws, 'Borderline Co') RETURNING id INTO v_company;

  FOR m IN 1..6 LOOP
    INSERT INTO invoices (workspace_id, company_id, invoice_number, status, currency, subtotal, grand_total, amount_paid, issue_date, due_date)
    VALUES (v_ws, v_company, 'B2-'||m, 'issued'::invoice_status, 'BDT', 100000, 100000, 70000,
            (CURRENT_DATE - (m*30 || ' days')::interval)::date,
            (CURRENT_DATE - (m*30 - 30 || ' days')::interval)::date)
    RETURNING id INTO v_inv;
    INSERT INTO payments (workspace_id, invoice_id, amount, paid_at, recorded_by, method)
    VALUES (v_ws, v_inv, 70000, (CURRENT_DATE - (m*30 - 5 || ' days')::interval)::timestamptz, v_user, 'bank_transfer'::payment_method);
    INSERT INTO expenses (workspace_id, description, amount, currency, expense_date, payment_status, paid_date, recorded_by, category)
    VALUES (v_ws, 'monthly ops', 55000, 'BDT', (CURRENT_DATE - (m*30 || ' days')::interval)::date, 'paid', (CURRENT_DATE - (m*30 || ' days')::interval)::date, v_user, 'general');
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_result := get_lender_readiness(v_ws);

  INSERT INTO lender_readiness_verification_runs (scenario, expected_band, actual_band, score, caution, summary, flags, drivers, pass, inputs)
  VALUES ('borderline_v2', 'borderline', v_result->>'band', (v_result->>'score')::int, v_result->>'caution',
          v_result->>'summary', v_result->'flags', v_result->'drivers',
          (v_result->>'band')='borderline',
          jsonb_build_object('collection_rate',0.70,'monthly_net_positive',true,'monthly_revenue',100000,'monthly_expense',55000));

  -- Deep cleanup: delete dependent rows, then audit_logs LAST (created by triggers on each delete above)
  DELETE FROM payments WHERE workspace_id=v_ws;
  DELETE FROM invoices WHERE workspace_id=v_ws;
  DELETE FROM expenses WHERE workspace_id=v_ws;
  DELETE FROM companies WHERE workspace_id=v_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=v_ws;
  DELETE FROM audit_logs WHERE workspace_id=v_ws;
  DELETE FROM workspaces WHERE id=v_ws;
END $$;