CREATE OR REPLACE FUNCTION public.issue_invoice(
  _workspace_id uuid,
  _invoice_id uuid,
  _line_items jsonb,
  _mushak_6_3 jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inv record;
  _subtotal numeric := 0;
  _tax_total numeric := 0;
  _grand_total numeric := 0;
  _tax_config jsonb;
  _item jsonb;
  _i int := 0;
  _mushak jsonb;
BEGIN
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  SELECT * INTO _inv FROM invoices
    WHERE id = _invoice_id AND workspace_id = _workspace_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF _inv.status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only draft invoices can be issued');
  END IF;

  IF _line_items IS NULL OR jsonb_array_length(_line_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least one line item is required');
  END IF;

  _mushak := COALESCE(_mushak_6_3, _inv.mushak_6_3, '{}'::jsonb);
  IF jsonb_typeof(_mushak) <> 'object' THEN
    _mushak := '{}'::jsonb;
  END IF;

  IF _mushak <> '{}'::jsonb THEN
    IF COALESCE(_mushak->>'vat_reg_no', '') = '' OR length(_mushak->>'vat_reg_no') <> 13 THEN
      RETURN jsonb_build_object('success', false, 'error', 'VAT Registration No (BIN) must be exactly 13 alphanumeric characters');
    END IF;
    IF (_mushak->>'vat_reg_no') !~ '^[0-9A-Za-z]{13}$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'VAT Registration No (BIN) must be 13 alphanumeric characters');
    END IF;
    IF COALESCE(_mushak->>'challan_no', '') = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Challan No is required when Mushak 6.3 is enabled');
    END IF;
  END IF;

  DELETE FROM invoice_line_items WHERE invoice_id = _invoice_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_line_items)
  LOOP
    INSERT INTO invoice_line_items (invoice_id, workspace_id, description, quantity, unit_price, amount, sort_order)
    VALUES (
      _invoice_id, _workspace_id,
      _item->>'description',
      (_item->>'quantity')::numeric,
      (_item->>'unit_price')::numeric,
      (_item->>'amount')::numeric,
      _i
    );
    _subtotal := _subtotal + (_item->>'amount')::numeric;
    _i := _i + 1;
  END LOOP;

  _tax_config := _inv.tax_config;
  IF _tax_config IS NOT NULL AND jsonb_typeof(_tax_config) = 'array' THEN
    FOR _item IN SELECT * FROM jsonb_array_elements(_tax_config)
    LOOP
      _tax_total := _tax_total + (_subtotal * COALESCE((_item->>'bps')::numeric, 0) / 10000);
    END LOOP;
  END IF;

  _grand_total := _subtotal + _tax_total;

  UPDATE invoices SET
    status = 'issued',
    issue_date = CURRENT_DATE,
    subtotal = _subtotal,
    tax_total = _tax_total,
    grand_total = _grand_total,
    mushak_6_3 = _mushak,
    updated_at = now()
  WHERE id = _invoice_id;

  RETURN jsonb_build_object('success', true, 'invoice_number', _inv.invoice_number);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.issue_invoice(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;