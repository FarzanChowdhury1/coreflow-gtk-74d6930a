
CREATE OR REPLACE FUNCTION public.generate_portal_token(
  _workspace_id uuid,
  _company_id uuid,
  _contact_id uuid,
  _expires_in_days integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _token text;
  _contact_ws uuid;
  _company_ws uuid;
BEGIN
  -- 1. Verify authentication
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 2. Verify workspace access
  IF NOT public.has_workspace_access(_user_id, _workspace_id) THEN
    RETURN json_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- 3. Verify admin role (only admins can generate portal links)
  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- 4. Validate company belongs to workspace
  SELECT workspace_id INTO _company_ws FROM public.companies
  WHERE id = _company_id AND deleted_at IS NULL;
  IF _company_ws IS NULL OR _company_ws != _workspace_id THEN
    RETURN json_build_object('success', false, 'error', 'Company not found in workspace');
  END IF;

  -- 5. Validate contact belongs to workspace and company
  SELECT workspace_id INTO _contact_ws FROM public.contacts
  WHERE id = _contact_id AND deleted_at IS NULL AND company_id = _company_id;
  IF _contact_ws IS NULL OR _contact_ws != _workspace_id THEN
    RETURN json_build_object('success', false, 'error', 'Contact not found or does not belong to the selected company');
  END IF;

  -- 6. Validate expiry range (1-365 days)
  IF _expires_in_days < 1 OR _expires_in_days > 365 THEN
    RETURN json_build_object('success', false, 'error', 'Expiry must be between 1 and 365 days');
  END IF;

  -- 7. Create the portal token server-side
  INSERT INTO public.portal_tokens (workspace_id, contact_id, company_id, expires_at)
  VALUES (_workspace_id, _contact_id, _company_id, now() + (_expires_in_days || ' days')::interval)
  RETURNING token INTO _token;

  RETURN json_build_object('success', true, 'token', _token);
END;
$$;
