
-- =============================================================
-- 1) Internal helper: generate one renewal invoice (shared logic)
-- =============================================================
CREATE OR REPLACE FUNCTION public._generate_renewal_invoice_internal(
  _renewal_id uuid,
  _actor_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r RECORD;
  _inv_number text;
  _inv_id uuid;
  _actor_name text;
BEGIN
  -- Caller must have already locked the row; we re-fetch for safety
  SELECT * INTO _r
  FROM public.renewals
  WHERE id = _renewal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Renewal not found');
  END IF;

  IF NOT _r.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Renewal is paused');
  END IF;

  IF _r.amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Renewal has no billable amount');
  END IF;

  -- Idempotency: skip if already generated for this billing cycle
  IF _r.last_generated_billing_date IS NOT NULL
     AND _r.last_generated_billing_date >= _r.next_billing_date THEN
    RETURN json_build_object('success', false, 'error', 'Invoice already generated for this cycle');
  END IF;

  -- Generate gapless invoice number
  _inv_number := next_invoice_number(_r.workspace_id);

  -- Create the invoice
  INSERT INTO public.invoices (
    workspace_id, company_id, project_id, invoice_number,
    status, subtotal, tax_config, tax_total, grand_total,
    currency, issue_date, due_date, notes
  ) VALUES (
    _r.workspace_id, _r.company_id, _r.project_id, _inv_number,
    'draft', _r.amount, '[]'::jsonb, 0, _r.amount,
    _r.currency, CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days',
    'Auto-generated from renewal: ' || _r.label
  ) RETURNING id INTO _inv_id;

  -- Create a single line item
  INSERT INTO public.invoice_line_items (
    workspace_id, invoice_id, description, quantity, unit_price, amount, sort_order
  ) VALUES (
    _r.workspace_id, _inv_id, _r.label, 1, _r.amount, _r.amount, 0
  );

  -- Link invoice to renewal, mark cycle generated, advance schedule
  UPDATE public.renewals SET
    invoice_id = _inv_id,
    last_generated_billing_date = _r.next_billing_date,
    next_billing_date = _r.next_billing_date + (_r.interval_months || ' months')::interval,
    updated_at = now()
  WHERE id = _renewal_id;

  -- Audit log
  IF _actor_id IS NOT NULL THEN
    SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _actor_id LIMIT 1;
  END IF;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, entity_type, entity_id, action, metadata)
  VALUES (
    _r.workspace_id, _actor_id, _actor_name, 'renewal', _renewal_id, 'invoice_generated',
    json_build_object(
      'invoice_id', _inv_id,
      'invoice_number', _inv_number,
      'billing_date', _r.next_billing_date,
      'amount', _r.amount
    )::jsonb
  );

  RETURN json_build_object(
    'success', true,
    'invoice_id', _inv_id,
    'invoice_number', _inv_number
  );
END;
$$;

-- =============================================================
-- 2) Manual RPC: now delegates to internal helper
-- =============================================================
CREATE OR REPLACE FUNCTION public.generate_renewal_invoice(
  _workspace_id uuid,
  _renewal_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _exists boolean;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Verify renewal belongs to workspace
  SELECT EXISTS(
    SELECT 1 FROM public.renewals WHERE id = _renewal_id AND workspace_id = _workspace_id
  ) INTO _exists;

  IF NOT _exists THEN
    RETURN json_build_object('success', false, 'error', 'Renewal not found in workspace');
  END IF;

  RETURN _generate_renewal_invoice_internal(_renewal_id, _user_id);
END;
$$;

-- =============================================================
-- 3) Batch RPC: now delegates to internal helper per renewal
-- =============================================================
CREATE OR REPLACE FUNCTION public.generate_due_renewal_invoices()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r RECORD;
  _result json;
  _generated int := 0;
  _skipped int := 0;
  _errors int := 0;
BEGIN
  FOR _r IN
    SELECT id
    FROM public.renewals
    WHERE is_active = true
      AND next_billing_date <= CURRENT_DATE
      AND amount > 0
      AND (last_generated_billing_date IS NULL OR last_generated_billing_date < next_billing_date)
    ORDER BY next_billing_date ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _result := _generate_renewal_invoice_internal(_r.id);
      IF (_result->>'success')::boolean THEN
        _generated := _generated + 1;
      ELSE
        _skipped := _skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'generated', _generated,
    'skipped', _skipped,
    'errors', _errors
  );
END;
$$;

-- =============================================================
-- 4) Fix double-advance: skip if renewal was auto-invoiced
--    Guard: if last_generated_billing_date is set AND the invoice
--    being paid is the one linked via invoice_id, the schedule
--    was already advanced at generation time → skip.
-- =============================================================
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
  -- Only act on transition TO 'paid'
  IF OLD.status = 'paid' OR NEW.status != 'paid' THEN
    RETURN NEW;
  END IF;

  FOR _renewal IN
    SELECT id, next_billing_date, interval_months, workspace_id,
           last_generated_billing_date, invoice_id
    FROM public.renewals
    WHERE invoice_id = NEW.id
      AND is_active = true
  LOOP
    -- GUARD: If this invoice was auto-generated by the renewal system,
    -- the schedule was already advanced at generation time. Skip.
    IF _renewal.last_generated_billing_date IS NOT NULL THEN
      -- The invoice_id matches AND last_generated_billing_date is set,
      -- meaning generate_renewal_invoice already advanced next_billing_date.
      -- Do NOT advance again.
      CONTINUE;
    END IF;

    -- Legacy path: manually linked invoice (no auto-generation) → advance
    _new_date := _renewal.next_billing_date + (_renewal.interval_months || ' months')::interval;

    UPDATE public.renewals
    SET next_billing_date = _new_date,
        updated_at = now()
    WHERE id = _renewal.id;

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
