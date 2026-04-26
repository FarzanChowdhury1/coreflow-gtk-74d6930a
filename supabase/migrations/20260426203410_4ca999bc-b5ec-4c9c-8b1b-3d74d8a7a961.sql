CREATE TABLE IF NOT EXISTS public._diag_proof_smoke (id serial primary key, ts timestamptz default now(), msg text);
TRUNCATE public._diag_proof_smoke;

DO $$
DECLARE
  _ws uuid := '3f9c83f5-ae12-4fa8-8fa0-105f0d9e06f6';
  _inv uuid := 'c7ed6949-10f7-41d9-9b7b-c1e8e0662709';
  _sub_id uuid;
  _trigger_alert_cnt int;
  _manual_ok boolean := true;
  _manual_err text := '';
BEGIN
  INSERT INTO payment_proof_submissions (workspace_id, invoice_id, declared_amount, declared_method, file_path, status, notes, submitted_by_name, submitted_by_email)
  VALUES (_ws, _inv, 999, 'bank_transfer', 'internal-smoke/none.pdf', 'pending', 'INTERNAL LIVE SMOKE', 'Smoke', 'smoke@x.local')
  RETURNING id INTO _sub_id;

  INSERT INTO public._diag_proof_smoke(msg) VALUES ('inserted sub_id=' || _sub_id::text);

  SELECT count(*) INTO _trigger_alert_cnt FROM system_alerts WHERE sweep_key = 'payment_proof_pending::' || _sub_id::text;
  INSERT INTO public._diag_proof_smoke(msg) VALUES ('trigger_alert_cnt=' || _trigger_alert_cnt::text);

  BEGIN
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (_ws, 'payment_proof_pending', 'payment_proof_submission', _sub_id, 'manual probe', 'manual', 'info', 'manual_probe::' || _sub_id::text);
  EXCEPTION WHEN OTHERS THEN
    _manual_ok := false; _manual_err := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO public._diag_proof_smoke(msg) VALUES ('manual_ok=' || _manual_ok::text || ' err=' || _manual_err);

  -- cleanup the test sub + any alerts (commit so we can inspect diag table)
  DELETE FROM system_alerts WHERE entity_id = _sub_id;
  DELETE FROM payment_proof_submissions WHERE id = _sub_id;
  INSERT INTO public._diag_proof_smoke(msg) VALUES ('cleanup done');
END $$;