
CREATE OR REPLACE FUNCTION public.assert_export_allowed(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN json_build_object('allowed', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_access(_uid, _workspace_id) THEN
    RETURN json_build_object('allowed', false, 'error', 'Access denied');
  END IF;

  IF NOT workspace_has_active_feature(_workspace_id, 'csvExport') THEN
    RETURN json_build_object('allowed', false, 'error', 'Data export requires a Growth plan. Upgrade to unlock exports.');
  END IF;

  RETURN json_build_object('allowed', true);
END;
$$;
