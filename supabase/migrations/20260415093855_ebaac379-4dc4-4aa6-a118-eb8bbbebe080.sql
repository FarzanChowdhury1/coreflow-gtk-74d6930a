
CREATE OR REPLACE FUNCTION public.reactivate_workspace(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid;
  _ws record;
  _actor_name text;
BEGIN
  -- 1. Auth
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 2. Platform admin only
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = _uid) THEN
    RETURN json_build_object('success', false, 'error', 'Only platform admins can reactivate workspaces');
  END IF;

  -- 3. Fetch workspace
  SELECT * INTO _ws FROM workspaces WHERE id = _workspace_id;
  IF _ws IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Workspace not found');
  END IF;

  -- 4. Must be deactivated
  IF _ws.deleted_at IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Workspace is not deactivated');
  END IF;

  -- 5. Reactivate: clear soft-delete and offboarding export state
  UPDATE workspaces
  SET deleted_at = NULL,
      offboarding_export_used_at = NULL,
      offboarding_export_claimed_by = NULL,
      updated_at = now()
  WHERE id = _workspace_id;

  -- 6. Audit log
  SELECT full_name INTO _actor_name FROM profiles WHERE user_id = _uid LIMIT 1;

  INSERT INTO audit_logs (workspace_id, actor_id, actor_name, entity_type, entity_id, action, metadata)
  VALUES (
    _workspace_id, _uid, _actor_name, 'workspace', _workspace_id, 'workspace_reactivated',
    jsonb_build_object(
      'workspace_name', _ws.name,
      'deactivated_at', _ws.deleted_at::text,
      'reactivated_by', _uid::text
    )
  );

  RETURN json_build_object('success', true, 'workspace_name', _ws.name);
END;
$$;
