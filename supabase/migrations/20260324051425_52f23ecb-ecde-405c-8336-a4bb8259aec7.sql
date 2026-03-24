-- 1. Add workspace_id to worker_runs (nullable for scheduled global runs)
ALTER TABLE public.worker_runs ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 2. Drop old RLS policy and create workspace-scoped one
DROP POLICY IF EXISTS "admins_read_worker_runs" ON public.worker_runs;

CREATE POLICY "workspace_admins_read_worker_runs"
  ON public.worker_runs FOR SELECT TO authenticated
  USING (
    CASE
      WHEN workspace_id IS NOT NULL THEN
        has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
      ELSE
        EXISTS (
          SELECT 1 FROM workspace_memberships
          WHERE user_id = auth.uid() AND role = 'admin'::app_role
        )
    END
  );

-- 3. Create atomic issue_invoice RPC
CREATE OR REPLACE FUNCTION public.issue_invoice(
  _workspace_id uuid,
  _invoice_id uuid,
  _line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv record;
  _subtotal numeric := 0;
  _tax_total numeric := 0;
  _grand_total numeric := 0;
  _tax_config jsonb;
  _item jsonb;
  _i int := 0;
BEGIN
  -- Auth check
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Lock the invoice row
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

  DELETE FROM invoice_line_items WHERE invoice_id = _invoice_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_line_items)
  LOOP
    INSERT INTO invoice_line_items (invoice_id, workspace_id, description, quantity, unit_price, amount, sort_order)
    VALUES (
      _invoice_id,
      _workspace_id,
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
    updated_at = now()
  WHERE id = _invoice_id;

  RETURN jsonb_build_object('success', true, 'invoice_number', _inv.invoice_number);
END;
$$;

-- 4. Fix invoke URLs to use current project ref
CREATE OR REPLACE FUNCTION public.invoke_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key text;
  _url text;
BEGIN
  SELECT decrypted_secret INTO _key
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_AUTH_KEY';

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'WORKER_AUTH_KEY not found in vault';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _url
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_FUNCTIONS_URL';

  IF _url IS NULL OR _url = '' THEN
    _url := 'https://pizujmmyhhebizxexwvi.supabase.co/functions/v1';
  END IF;

  PERFORM net.http_post(
    url := _url || '/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Worker-Secret', _key
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_asset_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key text;
  _url text;
BEGIN
  SELECT decrypted_secret INTO _key
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_AUTH_KEY';

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'WORKER_AUTH_KEY not found in vault';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _url
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_FUNCTIONS_URL';

  IF _url IS NULL OR _url = '' THEN
    _url := 'https://pizujmmyhhebizxexwvi.supabase.co/functions/v1';
  END IF;

  PERFORM net.http_post(
    url := _url || '/asset-cleanup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Worker-Secret', _key
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;