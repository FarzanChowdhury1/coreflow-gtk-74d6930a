
DROP TABLE IF EXISTS public._proof_alert_smoke_log;
CREATE TABLE public._proof_alert_smoke_log (k text PRIMARY KEY, v text);

DO $$
DECLARE
  _ws uuid := '3f9c83f5-ae12-4fa8-8fa0-105f0d9e06f6';
  _inv uuid := '507e17dd-0ba1-4a32-9694-af2b64bc9c64';
  _id_a uuid;
  _id_b uuid;
  _dismissed_a boolean;
  _dismissed_b boolean;
  _xws int;
  _retry int;
BEGIN
  INSERT INTO public.payment_proof_submissions
    (workspace_id, invoice_id, submitted_by_name, submitted_by_email,
     declared_amount, declared_method, declared_reference, file_path, status)
  VALUES (_ws, _inv, 'INTERNAL SMOKE','smoke-internal@example.test',
          12345.67,'bank_transfer','SMOKE-A','internal-smoke/a.pdf','pending')
  RETURNING id INTO _id_a;

  INSERT INTO public.payment_proof_submissions
    (workspace_id, invoice_id, submitted_by_name, submitted_by_email,
     declared_amount, declared_method, declared_reference, file_path, status)
  VALUES (_ws, _inv, 'INTERNAL SMOKE','smoke-internal@example.test',
          50000,'bkash',NULL,'internal-smoke/b.pdf','pending')
  RETURNING id INTO _id_b;

  INSERT INTO public._proof_alert_smoke_log(k,v)
  SELECT 'sev_'||CASE WHEN entity_id=_id_a THEN 'mismatch' ELSE 'exact' END, severity||' | '||body
  FROM public.system_alerts WHERE entity_id IN (_id_a,_id_b);

  -- Dedupe re-attempt
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

  SELECT is_dismissed INTO _dismissed_a FROM public.system_alerts WHERE entity_id=_id_a;
  SELECT is_dismissed INTO _dismissed_b FROM public.system_alerts WHERE entity_id=_id_b;
  INSERT INTO public._proof_alert_smoke_log VALUES ('dismissed_a', _dismissed_a::text);
  INSERT INTO public._proof_alert_smoke_log VALUES ('dismissed_b', _dismissed_b::text);

  DELETE FROM public.system_alerts WHERE entity_id IN (_id_a, _id_b);
  DELETE FROM public.payment_proof_submissions WHERE id IN (_id_a, _id_b);
END$$;
