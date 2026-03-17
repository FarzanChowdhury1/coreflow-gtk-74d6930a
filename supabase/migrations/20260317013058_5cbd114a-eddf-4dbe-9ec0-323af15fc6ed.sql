
-- Trigger function: when an invoice status transitions to 'paid',
-- advance any linked active renewal's next_billing_date by its interval_months.
-- Idempotent: only fires on OLD.status != 'paid' AND NEW.status = 'paid'.
-- Safe: skips inactive renewals, skips if no renewal linked.

CREATE OR REPLACE FUNCTION public.advance_renewal_on_invoice_paid()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _renewal RECORD;
  _new_date DATE;
  _actor_id UUID;
  _actor_name TEXT;
BEGIN
  -- Only act on transition TO 'paid' (not already paid)
  IF OLD.status = 'paid' OR NEW.status != 'paid' THEN
    RETURN NEW;
  END IF;

  -- Find active renewal(s) linked to this invoice
  FOR _renewal IN
    SELECT id, next_billing_date, interval_months, workspace_id
    FROM public.renewals
    WHERE invoice_id = NEW.id
      AND is_active = true
  LOOP
    -- Calculate advanced date
    _new_date := _renewal.next_billing_date + (_renewal.interval_months || ' months')::interval;

    -- Advance the renewal
    UPDATE public.renewals
    SET next_billing_date = _new_date,
        updated_at = now()
    WHERE id = _renewal.id;

    -- Audit the auto-advance
    _actor_id := auth.uid();
    IF _actor_id IS NOT NULL THEN
      SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _actor_id LIMIT 1;
    END IF;

    INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
    VALUES (
      _renewal.workspace_id,
      _actor_id,
      _actor_name,
      'renewal_auto_advanced',
      'renewal',
      _renewal.id,
      jsonb_build_object(
        'invoice_id', NEW.id,
        'invoice_number', NEW.invoice_number,
        'previous_billing_date', _renewal.next_billing_date,
        'new_billing_date', _new_date,
        'interval_months', _renewal.interval_months
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Attach trigger to invoices table AFTER UPDATE
-- Fires after update_invoice_on_payment has already set the status
CREATE TRIGGER trg_advance_renewal_on_invoice_paid
  AFTER UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.advance_renewal_on_invoice_paid();
