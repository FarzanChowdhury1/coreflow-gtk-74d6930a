
CREATE OR REPLACE FUNCTION public.portal_respond_proposal_internal(
  _company_id uuid,
  _workspace_id uuid,
  _version_id uuid,
  _action text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _version RECORD;
  _proposal RECORD;
BEGIN
  -- Validate action
  IF _action NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid action');
  END IF;

  -- Fetch version
  SELECT * INTO _version FROM public.proposal_versions WHERE id = _version_id;
  IF _version IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Version not found');
  END IF;

  -- Version must be in 'sent' status to respond
  IF _version.status != 'sent' THEN
    RETURN json_build_object('success', false, 'error', 'Proposal is not awaiting response');
  END IF;

  -- Verify proposal belongs to the given company and workspace
  SELECT * INTO _proposal FROM public.proposals
  WHERE id = _version.proposal_id
    AND company_id = _company_id
    AND workspace_id = _workspace_id
    AND deleted_at IS NULL;

  IF _proposal IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Update status
  UPDATE public.proposal_versions
  SET status = _action::proposal_version_status, updated_at = now()
  WHERE id = _version_id;

  RETURN json_build_object('success', true, 'new_status', _action);
END;
$$;
