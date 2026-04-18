
CREATE TABLE IF NOT EXISTS public.lender_readiness_verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  scenario text NOT NULL,
  expected_band text NOT NULL,
  actual_band text,
  score int,
  caution text,
  summary text,
  drivers jsonb,
  flags jsonb,
  inputs jsonb,
  pass boolean
);
ALTER TABLE public.lender_readiness_verification_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins read verification runs" ON public.lender_readiness_verification_runs;
CREATE POLICY "Platform admins read verification runs"
  ON public.lender_readiness_verification_runs FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
TRUNCATE public.lender_readiness_verification_runs;

DO $verify$
DECLARE
  _ws uuid; _admin uuid; _company uuid;
  _today date := current_date;
  _result jsonb; _scenario text; _expected text; _inv uuid; _i int;
  _scenarios text[] := ARRAY['insufficient_data','ready','not_ready_net_negative','not_ready_low_collections','borderline'];
BEGIN
  _admin := gen_random_uuid();
  INSERT INTO auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (_admin, 'lr-verify-' || _admin || '@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','', now(), now(), now());
  INSERT INTO public.workspaces (id, name, currency) VALUES (gen_random_uuid(), 'lr-verify','BDT') RETURNING id INTO _ws;
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES (_ws, _admin, 'admin');
  INSERT INTO public.companies (id, workspace_id, legal_name) VALUES (gen_random_uuid(), _ws,'Test Co') RETURNING id INTO _company;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_admin,'role','authenticated')::text, true);

  FOREACH _scenario IN ARRAY _scenarios LOOP
    DELETE FROM public.payments WHERE workspace_id = _ws;
    DELETE FROM public.invoice_line_items WHERE workspace_id = _ws;
    DELETE FROM public.invoices WHERE workspace_id = _ws;
    DELETE FROM public.expenses WHERE workspace_id = _ws;
    DELETE FROM public.subscriptions WHERE workspace_id = _ws;
    DELETE FROM public.budgets WHERE workspace_id = _ws;

    IF _scenario='insufficient_data' THEN
      _expected:='insufficient_data';
      INSERT INTO public.invoices (workspace_id,company_id,invoice_number,status,issue_date,due_date,subtotal,grand_total,amount_paid)
      VALUES (_ws,_company,'V-1','issued'::invoice_status,_today-10,_today+20,1000,1000,0);
    ELSIF _scenario='ready' THEN
      _expected:='ready';
      FOR _i IN 0..11 LOOP
        INSERT INTO public.invoices (id,workspace_id,company_id,invoice_number,status,issue_date,due_date,subtotal,grand_total,amount_paid)
        VALUES (gen_random_uuid(),_ws,_company,'R-'||_i,'paid'::invoice_status,
          (_today-((11-_i)*30||' days')::interval)::date,
          (_today-((11-_i)*30||' days')::interval+interval '15 days')::date,
          CASE WHEN _i>=9 THEN 15000 ELSE 10000 END,
          CASE WHEN _i>=9 THEN 15000 ELSE 10000 END,
          CASE WHEN _i>=9 THEN 15000 ELSE 10000 END) RETURNING id INTO _inv;
        INSERT INTO public.payments (workspace_id,invoice_id,amount,paid_at,recorded_by)
        VALUES (_ws,_inv,CASE WHEN _i>=9 THEN 15000 ELSE 10000 END,
          (_today-((11-_i)*30||' days')::interval+interval '20 days')::timestamptz,_admin);
      END LOOP;
      INSERT INTO public.expenses (workspace_id,recorded_by,description,amount,expense_date,paid_date,payment_status,category)
      SELECT _ws,_admin,'op-'||g,2000,_today-g,_today-g+5,'paid','general' FROM generate_series(5,90,10) g;
    ELSIF _scenario='not_ready_net_negative' THEN
      _expected:='not_ready';
      FOR _i IN 0..11 LOOP
        INSERT INTO public.invoices (id,workspace_id,company_id,invoice_number,status,issue_date,due_date,subtotal,grand_total,amount_paid)
        VALUES (gen_random_uuid(),_ws,_company,'NN-'||_i,'paid'::invoice_status,
          (_today-((11-_i)*30||' days')::interval)::date,
          (_today-((11-_i)*30||' days')::interval+interval '15 days')::date,5000,5000,5000) RETURNING id INTO _inv;
        INSERT INTO public.payments (workspace_id,invoice_id,amount,paid_at,recorded_by)
        VALUES (_ws,_inv,5000,(_today-((11-_i)*30||' days')::interval+interval '18 days')::timestamptz,_admin);
      END LOOP;
      INSERT INTO public.expenses (workspace_id,recorded_by,description,amount,expense_date,paid_date,payment_status,category)
      SELECT _ws,_admin,'big-'||g,50000,_today-g,_today-g,'paid','general' FROM generate_series(5,88,7) g;
    ELSIF _scenario='not_ready_low_collections' THEN
      _expected:='not_ready';
      FOR _i IN 0..11 LOOP
        INSERT INTO public.invoices (id,workspace_id,company_id,invoice_number,status,issue_date,due_date,subtotal,grand_total,amount_paid)
        VALUES (gen_random_uuid(),_ws,_company,'LC-'||_i,
          (CASE WHEN _i%4=0 THEN 'paid' ELSE 'issued' END)::invoice_status,
          (_today-((11-_i)*30||' days')::interval)::date,
          (_today-((11-_i)*30||' days')::interval+interval '10 days')::date,10000,10000,
          CASE WHEN _i%4=0 THEN 10000 ELSE 0 END) RETURNING id INTO _inv;
        IF _i%4=0 THEN
          INSERT INTO public.payments (workspace_id,invoice_id,amount,paid_at,recorded_by)
          VALUES (_ws,_inv,10000,(_today-((11-_i)*30||' days')::interval+interval '20 days')::timestamptz,_admin);
        END IF;
      END LOOP;
    ELSIF _scenario='borderline' THEN
      _expected:='borderline';
      FOR _i IN 0..11 LOOP
        INSERT INTO public.invoices (id,workspace_id,company_id,invoice_number,status,issue_date,due_date,subtotal,grand_total,amount_paid)
        VALUES (gen_random_uuid(),_ws,_company,'BL-'||_i,
          (CASE WHEN _i=11 THEN 'issued' ELSE 'paid' END)::invoice_status,
          (_today-((11-_i)*30||' days')::interval)::date,
          (_today-((11-_i)*30||' days')::interval+interval '15 days')::date,10000,10000,
          CASE WHEN _i=11 THEN 0 ELSE 8000 END) RETURNING id INTO _inv;
        IF _i<11 THEN
          INSERT INTO public.payments (workspace_id,invoice_id,amount,paid_at,recorded_by)
          VALUES (_ws,_inv,8000,(_today-((11-_i)*30||' days')::interval+interval '25 days')::timestamptz,_admin);
        END IF;
      END LOOP;
      INSERT INTO public.expenses (workspace_id,recorded_by,description,amount,expense_date,paid_date,payment_status,category)
      SELECT _ws,_admin,'op-'||g,5000,_today-g,_today-g+3,'paid','general' FROM generate_series(5,85,10) g;
    END IF;

    SELECT public.get_lender_readiness(_ws) INTO _result;
    INSERT INTO public.lender_readiness_verification_runs
      (scenario,expected_band,actual_band,score,caution,summary,drivers,flags,inputs,pass)
    VALUES (_scenario,_expected,_result->>'band',(_result->>'score')::int,_result->>'caution',
      _result->>'summary',_result->'drivers',_result->'flags',_result->'inputs',
      (_result->>'band')=_expected);
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.payments WHERE workspace_id=_ws;
  DELETE FROM public.invoice_line_items WHERE workspace_id=_ws;
  DELETE FROM public.invoices WHERE workspace_id=_ws;
  DELETE FROM public.expenses WHERE workspace_id=_ws;
  DELETE FROM public.subscriptions WHERE workspace_id=_ws;
  DELETE FROM public.budgets WHERE workspace_id=_ws;
  DELETE FROM public.invoice_sequences WHERE workspace_id=_ws;
  DELETE FROM public.notifications WHERE workspace_id=_ws;
  DELETE FROM public.product_events WHERE workspace_id=_ws;
  DELETE FROM public.system_alerts WHERE workspace_id=_ws;
  DELETE FROM public.workspace_followups WHERE workspace_id=_ws;
  DELETE FROM public.companies WHERE workspace_id=_ws;
  DELETE FROM public.workspace_memberships WHERE workspace_id=_ws;
  DELETE FROM public.audit_logs WHERE workspace_id=_ws;
  DELETE FROM public.workspaces WHERE id=_ws;
  DELETE FROM auth.users WHERE id=_admin;
END
$verify$;
