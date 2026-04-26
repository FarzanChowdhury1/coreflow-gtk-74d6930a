
TRUNCATE public._proof_alert_smoke_log;

DO $$
DECLARE
  _ws uuid := '5a705487-da8d-4628-9d4a-41cc9570df2e';
  _inv uuid := 'fc5276a6-6b4f-4f64-9695-a5ff725bfd9c';
  _id_a uuid;
  _id_b uuid;
  _da boolean;
  _db boolean;
  _retry int;
  _xws int;
  _ws_deleted_id uuid := '3f9c83f5-ae12-4fa8-8fa0-105f0d9e06f6';
  _inv_deleted uuid := '507e17dd-0ba1-4a32-9694-af2b64bc9c64';
  _id_c uuid;
  _del_alert_count int;
BEGIN
  -- Mismatch (10000 invoice; declared 5000 → warning)
  INSERT INTO public.payment_proof_submissions
    (workspace_id, invoice_id, submitted_by_name, submitted_by_email,
     declared_amount, declared_method, declared_reference, file_path, status)
  VALUES (_ws, _inv, 'INTERNAL SMOKE','smoke-internal@example.test',
          5000,'bank_transfer','SMOKE-A','internal-smoke/a.pdf','pending')
  RETURNING id INTO _id_a;

  -- Exact (10000)
  INSERT INTO public.payment_proof_submissions
    (workspace_id, invoice_id, submitted_by_name, submitted_by_email,
     declared_amount, declared_method, declared_reference, file_path, status)
  VALUES (_ws, _inv, 'INTERNAL SMOKE','smoke-internal@example.test',
          10000,'bkash',NULL,'internal-smoke/b.pdf','pending')
  RETURNING id INTO _id_b;

  INSERT INTO public._proof_alert_smoke_log(k,v)
  SELECT 'sev_'||CASE WHEN entity_id=_id_a THEN 'mismatch' ELSE 'exact' END, severity||' | '||body
  FROM public.system_alerts WHERE entity_id IN (_id_a,_id_b);

  -- Dedupe
  INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id,
    title, body, severity, sweep_key)
  VALUES (_ws, 'payment_proof_pending', 'payment_proof_submission', _id_a,
    'dup','dup','info','payment_proof_pending::' || _id_a::text)
  ON CONFLICT (workspace_id, sweep_key) DO NOTHING;
  SELECT COUNT(*) INTO _retry FROM public.system_alerts WHERE entity_id=_id_a;
  INSERT INTO public._proof_alert_smoke_log VALUES ('dedupe_count_a', _retry::text);

  SELECT COUNT(*) INTO _xws FROM public.system_alerts
    WHERE entity_id IN (_id_a,_id_b) AND workspace_id <> _ws;
  INSERT INTO public._proof_alert_smoke_log VALUES ('cross_workspace_leak', _xws::text);

  UPDATE public.payment_proof_submissions SET status='accepted', reviewed_at=now() WHERE id=_id_a;
  UPDATE public.payment_proof_submissions SET status='rejected', reviewed_at=now(), rejection_reason='x' WHERE id=_id_b;

  SELECT is_dismissed INTO _da FROM public.system_alerts WHERE entity_id=_id_a;
  SELECT is_dismissed INTO _db FROM public.system_alerts WHERE entity_id=_id_b;
  INSERT INTO public._proof_alert_smoke_log VALUES ('dismissed_a', _da::text);
  INSERT INTO public._proof_alert_smoke_log VALUES ('dismissed_b', _db::text);

  -- Deleted-workspace guard test
  INSERT INTO public.payment_proof_submissions
    (workspace_id, invoice_id, submitted_by_name, submitted_by_email,
     declared_amount, declared_method, declared_reference, file_path, status)
  VALUES (_ws_deleted_id, _inv_deleted, 'INTERNAL SMOKE','smoke-internal@example.test',
          1,'bank_transfer','SMOKE-DEL','internal-smoke/del.pdf','pending')
  RETURNING id INTO _id_c;
  SELECT COUNT(*) INTO _del_alert_count FROM public.system_alerts WHERE entity_id=_id_c;
  INSERT INTO public._proof_alert_smoke_log VALUES ('deleted_ws_alert_count', _del_alert_count::text);

  -- Cleanup all synthetic test data
  DELETE FROM public.system_alerts WHERE entity_id IN (_id_a, _id_b, _id_c);
  DELETE FROM public.payment_proof_submissions WHERE id IN (_id_a, _id_b, _id_c);
END$$;
