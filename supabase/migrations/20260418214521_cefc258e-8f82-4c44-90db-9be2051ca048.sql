DO $$
DECLARE
  _admin uuid := '53298133-37ba-4420-b45a-9dbdf0cf4a01';
  _ws uuid; _co uuid; _today date := current_date;
  _r jsonb; _all jsonb := '[]'::jsonb; i int;
BEGIN
  INSERT INTO workspaces(id, name, currency)
  VALUES (gen_random_uuid(), 'lender-test-' || extract(epoch from now())::bigint, 'BDT')
  RETURNING id INTO _ws;
  INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  INSERT INTO companies(workspace_id, legal_name) VALUES (_ws, 'TestCo') RETURNING id INTO _co;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin::text, 'role','authenticated')::text, true);

  _r := public.get_lender_readiness(_ws);
  _all := _all || jsonb_build_array(jsonb_build_object('S','1_insufficient','band',_r->>'band','score',_r->>'score','summary',_r->>'summary'));

  FOR i IN 1..6 LOOP
    INSERT INTO invoices(workspace_id, company_id, invoice_number, status, issue_date, due_date, subtotal, grand_total, amount_paid)
    VALUES (_ws, _co, 'S2-'||i, 'paid'::invoice_status,
            (_today - ((6-i)||' months')::interval)::date,
            (_today - ((6-i)||' months')::interval)::date + 15,
            CASE WHEN i<=3 THEN 50000 ELSE 70000 END, CASE WHEN i<=3 THEN 50000 ELSE 70000 END,
            CASE WHEN i<=3 THEN 50000 ELSE 70000 END);
    INSERT INTO payments(workspace_id, invoice_id, amount, paid_at, recorded_by, method)
    SELECT _ws, id, grand_total, (issue_date + 7)::timestamptz, _admin, 'bank_transfer'::payment_method
    FROM invoices WHERE invoice_number='S2-'||i AND workspace_id=_ws;
    INSERT INTO expenses(workspace_id, recorded_by, description, amount, expense_date, paid_date, payment_status)
    VALUES (_ws, _admin, 'op-'||i, 15000, (_today - ((6-i)||' months')::interval)::date,
            (_today - ((6-i)||' months')::interval)::date + 5, 'paid');
  END LOOP;
  _r := public.get_lender_readiness(_ws);
  _all := _all || jsonb_build_array(jsonb_build_object('S','2_ready','band',_r->>'band','score',_r->>'score','caution',_r->>'caution','summary',_r->>'summary','flags',_r->'flags'));
  DELETE FROM payments WHERE workspace_id=_ws; DELETE FROM invoices WHERE workspace_id=_ws; DELETE FROM expenses WHERE workspace_id=_ws;

  FOR i IN 1..4 LOOP
    INSERT INTO invoices(workspace_id, company_id, invoice_number, status, issue_date, due_date, subtotal, grand_total, amount_paid)
    VALUES (_ws, _co, 'S3-'||i, 'paid'::invoice_status,
            (_today - ((4-i)||' months')::interval)::date,
            (_today - ((4-i)||' months')::interval)::date + 15, 30000, 30000, 30000);
    INSERT INTO payments(workspace_id, invoice_id, amount, paid_at, recorded_by, method)
    SELECT _ws, id, 30000, (issue_date + 10)::timestamptz, _admin, 'bank_transfer'::payment_method
    FROM invoices WHERE invoice_number='S3-'||i AND workspace_id=_ws;
  END LOOP;
  FOR i IN 1..6 LOOP
    INSERT INTO expenses(workspace_id, recorded_by, description, amount, expense_date, paid_date, payment_status)
    VALUES (_ws, _admin, 'big-'||i, 80000, (_today - (i*5||' days')::interval)::date,
            (_today - (i*5||' days')::interval)::date, 'paid');
  END LOOP;
  _r := public.get_lender_readiness(_ws);
  _all := _all || jsonb_build_array(jsonb_build_object('S','3_net_negative','band',_r->>'band','score',_r->>'score','caution',_r->>'caution','summary',_r->>'summary','flags',_r->'flags'));
  DELETE FROM payments WHERE workspace_id=_ws; DELETE FROM invoices WHERE workspace_id=_ws; DELETE FROM expenses WHERE workspace_id=_ws;

  FOR i IN 1..5 LOOP
    INSERT INTO invoices(workspace_id, company_id, invoice_number, status, issue_date, due_date, subtotal, grand_total, amount_paid)
    VALUES (_ws, _co, 'S4-'||i, 'issued'::invoice_status,
            (_today - ((5-i)||' months')::interval)::date,
            (_today - ((5-i)||' months')::interval)::date + 15, 50000, 50000, 0);
  END LOOP;
  INSERT INTO payments(workspace_id, invoice_id, amount, paid_at, recorded_by, method)
  SELECT _ws, id, 20000, now(), _admin, 'bank_transfer'::payment_method
  FROM invoices WHERE invoice_number='S4-1' AND workspace_id=_ws;
  _r := public.get_lender_readiness(_ws);
  _all := _all || jsonb_build_array(jsonb_build_object('S','4_low_collections','band',_r->>'band','score',_r->>'score','caution',_r->>'caution','summary',_r->>'summary','flags',_r->'flags'));
  DELETE FROM payments WHERE workspace_id=_ws; DELETE FROM invoices WHERE workspace_id=_ws; DELETE FROM expenses WHERE workspace_id=_ws;

  FOR i IN 1..6 LOOP
    INSERT INTO invoices(workspace_id, company_id, invoice_number, status, issue_date, due_date, subtotal, grand_total, amount_paid)
    VALUES (_ws, _co, 'S5-'||i, (CASE WHEN i<=4 THEN 'paid' ELSE 'issued' END)::invoice_status,
            (_today - ((6-i)||' months')::interval)::date,
            (_today - ((6-i)||' months')::interval)::date + 15,
            40000, 40000, CASE WHEN i<=4 THEN 40000 ELSE 0 END);
    IF i<=4 THEN
      INSERT INTO payments(workspace_id, invoice_id, amount, paid_at, recorded_by, method)
      SELECT _ws, id, 40000, (issue_date + 12)::timestamptz, _admin, 'bank_transfer'::payment_method
      FROM invoices WHERE invoice_number='S5-'||i AND workspace_id=_ws;
    END IF;
    INSERT INTO expenses(workspace_id, recorded_by, description, amount, expense_date, paid_date, payment_status)
    VALUES (_ws, _admin, 'r-'||i, 18000, (_today - ((6-i)||' months')::interval)::date,
            (_today - ((6-i)||' months')::interval)::date + 3, 'paid');
  END LOOP;
  _r := public.get_lender_readiness(_ws);
  _all := _all || jsonb_build_array(jsonb_build_object('S','5_borderline','band',_r->>'band','score',_r->>'score','caution',_r->>'caution','summary',_r->>'summary','flags',_r->'flags'));

  -- Soft cleanup (audit FKs prevent hard delete)
  DELETE FROM payments WHERE workspace_id=_ws; DELETE FROM invoices WHERE workspace_id=_ws;
  DELETE FROM expenses WHERE workspace_id=_ws; DELETE FROM companies WHERE workspace_id=_ws;
  UPDATE workspaces SET deleted_at = now(), name = 'lender-test-cleaned' WHERE id=_ws;
  DELETE FROM workspace_memberships WHERE workspace_id=_ws;

  RAISE NOTICE 'LENDER_RESULTS=%', _all::text;
END $$;