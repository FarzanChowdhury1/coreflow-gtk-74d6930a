TRUNCATE public._diag_proof_smoke;

DO $$
DECLARE
  _ws uuid := '5a705487-da8d-4628-9d4a-41cc9570df2e';
  _inv uuid := 'fc5276a6-6b4f-4f64-9695-a5ff725bfd9c';
  _sub_id uuid;
  _alert record;
  _alert_after record;
BEGIN
  -- Phase A: insert pending submission, mismatched amount (balance=10000, declared=999)
  INSERT INTO payment_proof_submissions (workspace_id, invoice_id, declared_amount, declared_method, file_path, status, notes, submitted_by_name, submitted_by_email)
  VALUES (_ws, _inv, 999, 'bank_transfer', 'internal-smoke/none.pdf', 'pending', 'INTERNAL SMOKE', 'Smoke', 'smoke@x.local')
  RETURNING id INTO _sub_id;
  INSERT INTO public._diag_proof_smoke(msg) VALUES ('A: created sub=' || _sub_id::text);

  SELECT id, severity, title, body, dismissed_at INTO _alert
  FROM system_alerts WHERE workspace_id=_ws AND sweep_key='payment_proof_pending::' || _sub_id::text;

  IF _alert.id IS NULL THEN
    INSERT INTO public._diag_proof_smoke(msg) VALUES ('A: FAIL no alert created');
  ELSE
    INSERT INTO public._diag_proof_smoke(msg) VALUES ('A: PASS alert=' || _alert.id::text || ' sev=' || _alert.severity || ' title=' || _alert.title || ' body=' || _alert.body);
  END IF;

  -- Phase B: dedupe — second insert of same sweep_key path (impossible because sub_id differs); test re-trigger on update
  -- Phase C: accept -> dismiss
  UPDATE payment_proof_submissions SET status='accepted', reviewed_at=now() WHERE id=_sub_id;
  SELECT dismissed_at INTO _alert_after FROM system_alerts WHERE id=_alert.id;
  IF _alert_after.dismissed_at IS NULL THEN
    INSERT INTO public._diag_proof_smoke(msg) VALUES ('C: FAIL alert not dismissed');
  ELSE
    INSERT INTO public._diag_proof_smoke(msg) VALUES ('C: PASS dismissed_at=' || _alert_after.dismissed_at::text);
  END IF;

  -- Phase D: cleanup
  DELETE FROM system_alerts WHERE entity_id=_sub_id;
  DELETE FROM payment_proof_submissions WHERE id=_sub_id;
  INSERT INTO public._diag_proof_smoke(msg) VALUES ('D: cleanup done');
END $$;