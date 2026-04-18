DO $$
DECLARE
  _admin_user_id uuid := '14d273f5-f20a-4e28-834f-e3f6d975771e';
  _ws uuid;
  _co uuid;
  _vendor uuid;
  _today date := current_date;
  _result jsonb;
  _results jsonb := '[]'::jsonb;
  _inv_id uuid;
  i int;
BEGIN
  INSERT INTO workspaces (id, name, currency, deleted_at)
  VALUES (gen_random_uuid(), 'fa-exact-path-' || extract(epoch from now())::bigint, 'BDT', NULL)
  RETURNING id INTO _ws;

  INSERT INTO workspace_memberships (workspace_id, user_id, role)
  VALUES (_ws, _admin_user_id, 'admin');

  INSERT INTO companies (workspace_id, legal_name) VALUES (_ws, 'TestCo') RETURNING id INTO _co;
  INSERT INTO vendors (workspace_id, name) VALUES (_ws, 'TestVendor') RETURNING id INTO _vendor;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin_user_id::text, 'role', 'authenticated')::text, true);

  -- A: empty
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','A_empty_insufficient_data','output',_result));

  -- B: multi-row budget within
  INSERT INTO budgets (workspace_id, category, period_start, period_end, target_amount) VALUES
    (_ws, 'marketing', date_trunc('month', _today)::date, (date_trunc('month', _today) + interval '1 month - 1 day')::date, 5000),
    (_ws, 'tools',     date_trunc('month', _today)::date, (date_trunc('month', _today) + interval '1 month - 1 day')::date, 3000);
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, paid_date) VALUES
    (_ws, _admin_user_id, 'mkt-1',   2000, 'marketing', 'paid', _today - 5, _today - 3),
    (_ws, _admin_user_id, 'tools-1', 1000, 'tools',     'paid', _today - 4, _today - 2);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','B_multi_row_budget_within',
    'expected', jsonb_build_object('budget_target',8000,'budget_actual',3000,'budget_status','within','budget_row_count',2),
    'health', _result->'health'));

  -- C: uncategorized excluded (no 'general' row)
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, paid_date)
  VALUES (_ws, _admin_user_id, 'unc-1', 999999, NULL, 'paid', _today - 3, _today - 1);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','C_uncategorized_excluded',
    'expected', 'budget_actual stays ~3000 (uncategorized 999999 excluded since no general row)',
    'health', _result->'health'));

  -- D: uncategorized included with general row
  INSERT INTO budgets (workspace_id, category, period_start, period_end, target_amount)
  VALUES (_ws, 'general', date_trunc('month', _today)::date, (date_trunc('month', _today) + interval '1 month - 1 day')::date, 2000);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','D_uncategorized_included_general',
    'expected', 'budget_target=10000, actual includes 999999 → overspent',
    'health', _result->'health'));

  -- Reset for DPO scenarios
  DELETE FROM expenses WHERE workspace_id = _ws;
  DELETE FROM budgets  WHERE workspace_id = _ws;

  -- E: DPO due-only
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  SELECT _ws, _admin_user_id, 'due-' || g, 100, 'tools', 'paid',
    _today - 30 + g, _today - 20 + g, _today - 15 + g
  FROM generate_series(1,5) g;
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','E_dpo_due_only',
    'expected_basis','due_date', 'cash_conversion', _result->'cash_conversion'));

  -- F: DPO fallback-only
  DELETE FROM expenses WHERE workspace_id = _ws;
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  SELECT _ws, _admin_user_id, 'fb-' || g, 100, 'tools', 'paid',
    _today - 30 + g, NULL, _today - 15 + g
  FROM generate_series(1,5) g;
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','F_dpo_fallback_only',
    'expected_basis','expense_date_fallback', 'cash_conversion', _result->'cash_conversion'));

  -- G: DPO mixed
  DELETE FROM expenses WHERE workspace_id = _ws;
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  SELECT _ws, _admin_user_id, 'mix-d-' || g, 100, 'tools', 'paid', _today - 30 + g, _today - 20 + g, _today - 15 + g
  FROM generate_series(1,5) g;
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  SELECT _ws, _admin_user_id, 'mix-f-' || g, 100, 'tools', 'paid', _today - 30 + g, NULL, _today - 15 + g
  FROM generate_series(1,5) g;
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','G_dpo_mixed',
    'expected_basis','mixed', 'cash_conversion', _result->'cash_conversion'));

  -- H: DSO-only (DPO insufficient)
  DELETE FROM expenses WHERE workspace_id = _ws;
  FOR i IN 1..4 LOOP
    INSERT INTO invoices (workspace_id, company_id, invoice_number, status, issue_date, due_date,
                          subtotal, grand_total, amount_paid, currency)
    VALUES (_ws, _co, 'INV-H-' || i, 'paid', _today - 20, _today - 10, 1000, 1000, 1000, 'BDT')
    RETURNING id INTO _inv_id;
    INSERT INTO payments (workspace_id, invoice_id, amount, paid_at, recorded_by)
    VALUES (_ws, _inv_id, 1000, (_today - 10)::timestamptz, _admin_user_id);
  END LOOP;
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  VALUES (_ws, _admin_user_id, 'lonely', 100, 'tools', 'paid', _today - 20, _today - 10, _today - 5);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','H_dso_only',
    'expected', jsonb_build_object('can_compute_dso',true,'can_compute_dpo',false,'can_compute_ccc',false),
    'cash_conversion', _result->'cash_conversion'));

  -- I: DSO + DPO → CCC
  INSERT INTO expenses (workspace_id, recorded_by, description, amount, category, payment_status, expense_date, due_date, paid_date)
  SELECT _ws, _admin_user_id, 'ccc-' || g, 100, 'tools', 'paid', _today - 30 + g, _today - 20 + g, _today - 12 + g
  FROM generate_series(1,5) g;
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','I_dso_dpo_ccc',
    'expected', jsonb_build_object('can_compute_ccc',true),
    'cash_conversion', _result->'cash_conversion'));

  -- J: healthy summary (add growth + within-budget tools)
  FOR i IN 1..3 LOOP
    INSERT INTO invoices (workspace_id, company_id, invoice_number, status, issue_date, due_date,
                          subtotal, grand_total, amount_paid, currency)
    VALUES (_ws, _co, 'INV-J-' || i, 'paid', _today - 5, _today + 5, 5000, 5000, 5000, 'BDT')
    RETURNING id INTO _inv_id;
    INSERT INTO payments (workspace_id, invoice_id, amount, paid_at, recorded_by)
    VALUES (_ws, _inv_id, 5000, _today::timestamptz, _admin_user_id);
  END LOOP;
  INSERT INTO budgets (workspace_id, category, period_start, period_end, target_amount)
  VALUES (_ws, 'tools', date_trunc('month', _today)::date, (date_trunc('month', _today) + interval '1 month - 1 day')::date, 100000);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','J_healthy', 'health', _result->'health'));

  -- K: overspent summary (tighten budget)
  DELETE FROM budgets WHERE workspace_id = _ws;
  INSERT INTO budgets (workspace_id, category, period_start, period_end, target_amount)
  VALUES (_ws, 'tools', date_trunc('month', _today)::date, (date_trunc('month', _today) + interval '1 month - 1 day')::date, 50);
  _result := public.get_finance_analytics(_ws);
  _results := _results || jsonb_build_array(jsonb_build_object('scenario','K_overspent', 'health', _result->'health'));

  -- Stash results in audit_logs for retrieval
  INSERT INTO public.audit_logs (workspace_id, action, entity_type, entity_id, actor_id, actor_name, metadata)
  VALUES (_ws, '_fa_exact_path_results', 'verification', _ws, _admin_user_id, 'verification',
          jsonb_build_object('results', _results, 'workspace_id', _ws));

  RAISE NOTICE 'Test workspace ID: %', _ws;
END $$;