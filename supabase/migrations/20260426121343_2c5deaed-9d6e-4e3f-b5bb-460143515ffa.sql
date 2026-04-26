
-- Payment proof submission notifications via system_alerts
-- Idempotent / Live-safe.

-- 1. Unique sweep_key per workspace to allow ON CONFLICT dedupe
CREATE UNIQUE INDEX IF NOT EXISTS system_alerts_workspace_sweep_key_uq
  ON public.system_alerts (workspace_id, sweep_key);

-- 2. AFTER INSERT trigger fn: create alert when a pending proof is submitted
CREATE OR REPLACE FUNCTION public.notify_payment_proof_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws_deleted boolean;
  _inv record;
  _balance numeric;
  _severity text := 'info';
  _title text := 'Payment proof submitted';
  _body text;
  _amount_str text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Skip if workspace is deleted/offboarded
  SELECT (deleted_at IS NOT NULL) INTO _ws_deleted
  FROM public.workspaces WHERE id = NEW.workspace_id;
  IF COALESCE(_ws_deleted, true) THEN
    RETURN NEW;
  END IF;

  SELECT invoice_number, grand_total, amount_paid, currency
    INTO _inv
  FROM public.invoices WHERE id = NEW.invoice_id;

  IF _inv IS NOT NULL THEN
    _balance := COALESCE(_inv.grand_total, 0) - COALESCE(_inv.amount_paid, 0);
    IF NEW.declared_amount IS NOT NULL AND ABS(NEW.declared_amount - _balance) > 0.01 THEN
      _severity := 'warning';
    END IF;
    _amount_str := COALESCE(_inv.currency, '') || ' ' || to_char(NEW.declared_amount, 'FM999,999,999,990.00');
    _body := 'Invoice ' || COALESCE(_inv.invoice_number, '?')
             || ' — ' || _amount_str
             || ' via ' || COALESCE(NEW.declared_method, 'unknown')
             || CASE WHEN NEW.declared_reference IS NOT NULL AND length(NEW.declared_reference) > 0
                     THEN ' (ref ' || NEW.declared_reference || ')' ELSE '' END;
  ELSE
    _body := 'Declared ' || NEW.declared_amount::text || ' via ' || COALESCE(NEW.declared_method, 'unknown');
  END IF;

  INSERT INTO public.system_alerts (
    workspace_id, alert_type, entity_type, entity_id,
    title, body, severity, sweep_key
  ) VALUES (
    NEW.workspace_id,
    'payment_proof_pending',
    'payment_proof_submission',
    NEW.id,
    _title,
    _body,
    _severity,
    'payment_proof_pending::' || NEW.id::text
  )
  ON CONFLICT (workspace_id, sweep_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_proof_submitted ON public.payment_proof_submissions;
CREATE TRIGGER trg_notify_payment_proof_submitted
AFTER INSERT ON public.payment_proof_submissions
FOR EACH ROW EXECUTE FUNCTION public.notify_payment_proof_submitted();

-- 3. AFTER UPDATE trigger fn: dismiss alert when status leaves 'pending'
CREATE OR REPLACE FUNCTION public.dismiss_payment_proof_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    UPDATE public.system_alerts
       SET is_dismissed = true,
           dismissed_at = COALESCE(dismissed_at, now())
     WHERE workspace_id = NEW.workspace_id
       AND sweep_key = 'payment_proof_pending::' || NEW.id::text
       AND is_dismissed = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dismiss_payment_proof_alert ON public.payment_proof_submissions;
CREATE TRIGGER trg_dismiss_payment_proof_alert
AFTER UPDATE OF status ON public.payment_proof_submissions
FOR EACH ROW EXECUTE FUNCTION public.dismiss_payment_proof_alert();
