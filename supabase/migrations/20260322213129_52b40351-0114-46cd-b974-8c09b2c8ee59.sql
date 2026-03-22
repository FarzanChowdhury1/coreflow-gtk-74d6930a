
-- RPC to void an invoice (admin-only, server-side enforcement)
CREATE OR REPLACE FUNCTION public.void_invoice(_workspace_id uuid, _invoice_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _inv record;
  _actor_name text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  SELECT * INTO _inv FROM public.invoices
  WHERE id = _invoice_id AND workspace_id = _workspace_id AND deleted_at IS NULL;

  IF _inv IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF _inv.status = 'void' THEN
    RETURN json_build_object('success', false, 'error', 'Invoice is already voided');
  END IF;

  UPDATE public.invoices SET status = 'void' WHERE id = _invoice_id;

  SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _user_id LIMIT 1;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (_workspace_id, _user_id, _actor_name, 'invoice_voided', 'invoice', _invoice_id,
    json_build_object('invoice_number', _inv.invoice_number, 'previous_status', _inv.status)::jsonb);

  RETURN json_build_object('success', true);
END;
$$;

-- RPC to void a proposal version (admin-only, server-side enforcement)
CREATE OR REPLACE FUNCTION public.void_proposal_version(_workspace_id uuid, _version_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _version record;
  _actor_name text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  SELECT * INTO _version FROM public.proposal_versions
  WHERE id = _version_id AND workspace_id = _workspace_id;

  IF _version IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Version not found');
  END IF;

  IF _version.status = 'voided' THEN
    RETURN json_build_object('success', false, 'error', 'Version is already voided');
  END IF;

  UPDATE public.proposal_versions SET status = 'voided' WHERE id = _version_id;

  SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _user_id LIMIT 1;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (_workspace_id, _user_id, _actor_name, 'proposal_version_voided', 'proposal_version', _version_id,
    json_build_object('proposal_id', _version.proposal_id, 'version_number', _version.version_number, 'previous_status', _version.status)::jsonb);

  RETURN json_build_object('success', true);
END;
$$;
