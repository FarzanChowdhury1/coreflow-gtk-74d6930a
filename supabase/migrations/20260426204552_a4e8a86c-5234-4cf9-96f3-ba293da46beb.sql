CREATE TABLE IF NOT EXISTS public._diag_bell_smoke (id serial primary key, ts timestamptz default now(), msg text);
TRUNCATE public._diag_bell_smoke;

DO $$
DECLARE
  _user uuid := '53298133-37ba-4420-b45a-9dbdf0cf4a01';
  _ws uuid := '5a705487-da8d-4628-9d4a-41cc9570df2e';
  _alert_id uuid;
  _rec record;
  _hits int := 0;
BEGIN
  -- Insert a synthetic active payment_proof_pending alert (admin-visible by default)
  INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
  VALUES (_ws, 'payment_proof_pending', 'payment_proof_submission', gen_random_uuid(),
          'SMOKE: Payment proof submitted', 'Synthetic bell smoke alert', 'warning',
          'bell_smoke::' || gen_random_uuid()::text)
  RETURNING id INTO _alert_id;

  INSERT INTO public._diag_bell_smoke(msg) VALUES ('seeded alert_id=' || _alert_id::text);

  -- Call RPC and capture rows where source=system_alert
  FOR _rec IN
    SELECT id, source, severity, category, link, title, is_read
    FROM public.fetch_prioritized_notifications(_user, 50, _ws)
    WHERE source = 'system_alert'
  LOOP
    _hits := _hits + 1;
    INSERT INTO public._diag_bell_smoke(msg) VALUES (
      'row id=' || _rec.id::text ||
      ' source=' || _rec.source ||
      ' sev=' || _rec.severity ||
      ' cat=' || _rec.category ||
      ' link=' || COALESCE(_rec.link, 'NULL') ||
      ' is_read=' || _rec.is_read::text ||
      ' title=' || _rec.title
    );
  END LOOP;

  INSERT INTO public._diag_bell_smoke(msg) VALUES ('total system_alert rows=' || _hits::text);

  -- Verify the seeded alert appears
  IF EXISTS (
    SELECT 1 FROM public.fetch_prioritized_notifications(_user, 50, _ws)
    WHERE id = _alert_id AND source = 'system_alert'
  ) THEN
    INSERT INTO public._diag_bell_smoke(msg) VALUES ('PASS: seeded alert surfaced via RPC');
  ELSE
    INSERT INTO public._diag_bell_smoke(msg) VALUES ('FAIL: seeded alert NOT in RPC output');
  END IF;

  -- Cleanup synthetic alert
  DELETE FROM public.system_alerts WHERE id = _alert_id;
  INSERT INTO public._diag_bell_smoke(msg) VALUES ('cleanup done');
END $$;