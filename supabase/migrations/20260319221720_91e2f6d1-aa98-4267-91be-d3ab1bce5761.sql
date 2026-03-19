
-- =============================================================
-- 1) Add last_generated_billing_date to renewals for idempotency
-- =============================================================
ALTER TABLE public.renewals
  ADD COLUMN IF NOT EXISTS last_generated_billing_date date;

-- =============================================================
-- 2) RPC: Generate a single invoice from a renewal (idempotent)
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
  _r RECORD;
  _inv_number text;
  _inv_id uuid;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Fetch and lock the renewal row
  SELECT * INTO _r
  FROM public.renewals
  WHERE id = _renewal_id
    AND workspace_id = _workspace_id
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

  -- Idempotency: skip if we already generated for this billing cycle
  IF _r.last_generated_billing_date IS NOT NULL
     AND _r.last_generated_billing_date >= _r.next_billing_date THEN
    RETURN json_build_object('success', false, 'error', 'Invoice already generated for this cycle');
  END IF;

  -- Generate gapless invoice number
  _inv_number := next_invoice_number(_workspace_id);

  -- Create the invoice
  INSERT INTO public.invoices (
    workspace_id, company_id, project_id, invoice_number,
    status, subtotal, tax_config, tax_total, grand_total,
    currency, issue_date, due_date, notes
  ) VALUES (
    _workspace_id, _r.company_id, _r.project_id, _inv_number,
    'draft', _r.amount, '[]'::jsonb, 0, _r.amount,
    _r.currency, CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days',
    'Auto-generated from renewal: ' || _r.label
  ) RETURNING id INTO _inv_id;

  -- Create a single line item
  INSERT INTO public.invoice_line_items (
    workspace_id, invoice_id, description, quantity, unit_price, amount, sort_order
  ) VALUES (
    _workspace_id, _inv_id, _r.label, 1, _r.amount, _r.amount, 0
  );

  -- Link invoice to renewal and mark cycle as generated
  UPDATE public.renewals SET
    invoice_id = _inv_id,
    last_generated_billing_date = _r.next_billing_date,
    next_billing_date = _r.next_billing_date + (_r.interval_months || ' months')::interval,
    updated_at = now()
  WHERE id = _renewal_id;

  -- Audit log
  INSERT INTO public.audit_logs (workspace_id, actor_id, entity_type, entity_id, action, metadata)
  VALUES (
    _workspace_id, _user_id, 'renewal', _renewal_id, 'invoice_generated',
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
-- 3) Batch RPC: Generate invoices for all due renewals (worker)
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
  _inv_number text;
  _inv_id uuid;
BEGIN
  FOR _r IN
    SELECT *
    FROM public.renewals
    WHERE is_active = true
      AND next_billing_date <= CURRENT_DATE
      AND amount > 0
      AND (last_generated_billing_date IS NULL OR last_generated_billing_date < next_billing_date)
    ORDER BY next_billing_date ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _inv_number := next_invoice_number(_r.workspace_id);

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

      INSERT INTO public.invoice_line_items (
        workspace_id, invoice_id, description, quantity, unit_price, amount, sort_order
      ) VALUES (
        _r.workspace_id, _inv_id, _r.label, 1, _r.amount, _r.amount, 0
      );

      UPDATE public.renewals SET
        invoice_id = _inv_id,
        last_generated_billing_date = _r.next_billing_date,
        next_billing_date = _r.next_billing_date + (_r.interval_months || ' months')::interval,
        updated_at = now()
      WHERE id = _r.id;

      INSERT INTO public.audit_logs (workspace_id, entity_type, entity_id, action, metadata)
      VALUES (
        _r.workspace_id, 'renewal', _r.id, 'invoice_auto_generated',
        json_build_object(
          'invoice_id', _inv_id,
          'invoice_number', _inv_number,
          'billing_date', _r.next_billing_date,
          'amount', _r.amount
        )::jsonb
      );

      _generated := _generated + 1;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'generated', _generated,
    'errors', _errors
  );
END;
$$;
