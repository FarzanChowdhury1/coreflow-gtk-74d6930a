
DO $$
DECLARE
  _ws uuid := '3f9c83f5-ae12-4fa8-8fa0-105f0d9e06f6';
  _inv uuid := '507e17dd-0ba1-4a32-9694-af2b64bc9c64';
  _id_a uuid;
  _id_b uuid;
  _alert_count int;
  _retry_count int;
  _sev_a text;
  _sev_b text;
  _body_a text;
  _dismissed_a boolean;
  _dismissed_b boolean;
  _cross_ws_count int;
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

  SELECT COUNT(*),
         MAX(CASE WHEN entity_id=_id_a THEN severity END),
         MAX(CASE WHEN entity_id=_id_b THEN severity END),
         MAX(CASE WHEN entity_id=_id_a THEN body END)
    INTO _alert_count, _sev_a, _sev_b, _body_a
  FROM public.system_alerts WHERE entity_id IN (_id_a, _id_b);
  RAISE NOTICE 'After insert: alerts=% (expect 2), sev_a=% (expect warning), sev_b=% (expect info)',
    _alert_count, _sev_a, _sev_b;
  RAISE NOTICE 'Body A: %', _body_a;

  -- Dedupe: re-insert with same sweep_key should be no-op
  INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id,
    title, body, severity, sweep_key)
  VALUES (_ws, 'payment_proof_pending', 'payment_proof_submission', _id_a,
    'dup','dup','info','payment_proof_pending::' || _id_a::text)
  ON CONFLICT (workspace_id, sweep_key) DO NOTHING;
  SELECT COUNT(*) INTO _retry_count FROM public.system_alerts WHERE entity_id=_id_a;
  RAISE NOTICE 'Dedupe: alerts for A = % (expect 1)', _retry_count;

  -- Cross-workspace check
  SELECT COUNT(*) INTO _cross_ws_count FROM public.system_alerts
    WHERE entity_id IN (_id_a, _id_b) AND workspace_id <> _ws;
  RAISE NOTICE 'Cross-workspace leak: % (expect 0)', _cross_ws_count;

  -- Resolve
  UPDATE public.payment_proof_submissions SET status='accepted', reviewed_at=now() WHERE id=_id_a;
  UPDATE public.payment_proof_submissions SET status='rejected', reviewed_at=now(), rejection_reason='smoke' WHERE id=_id_b;

  SELECT is_dismissed INTO _dismissed_a FROM public.system_alerts WHERE entity_id=_id_a;
  SELECT is_dismissed INTO _dismissed_b FROM public.system_alerts WHERE entity_id=_id_b;
  RAISE NOTICE 'Resolve: dismissed_a=%, dismissed_b=% (both expect true)', _dismissed_a, _dismissed_b;

  -- Cleanup
  DELETE FROM public.system_alerts WHERE entity_id IN (_id_a, _id_b);
  DELETE FROM public.payment_proof_submissions WHERE id IN (_id_a, _id_b);
  RAISE NOTICE 'Cleanup complete.';
END$$;
