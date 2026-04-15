
-- Workspace deactivation / offboarding RPC
-- Safe soft-delete: sets deleted_at, revokes tokens, expires invites, logs action.
-- No data is hard-deleted.

CREATE OR REPLACE FUNCTION public.deactivate_workspace(
  _workspace_id uuid,
  _confirm_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid;
  _ws record;
  _actor_name text;
  _revoked_tokens int;
  _expired_invites int;
BEGIN
  -- 1. Auth check
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 2. Admin check
  IF NOT has_workspace_role(_uid, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Only workspace admins can deactivate a workspace');
  END IF;

  -- 3. Fetch workspace
  SELECT * INTO _ws FROM workspaces WHERE id = _workspace_id;
  IF _ws IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Workspace not found');
  END IF;

  -- 4. Already deactivated?
  IF _ws.deleted_at IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Workspace is already deactivated');
  END IF;

  -- 5. Confirmation check — must type exact workspace name
  IF trim(_confirm_name) IS DISTINCT FROM trim(_ws.name) THEN
    RETURN json_build_object('success', false, 'error', 'Workspace name does not match. Please type the exact workspace name to confirm.');
  END IF;

  -- 6. Soft-delete the workspace
  UPDATE workspaces SET deleted_at = now(), updated_at = now()
  WHERE id = _workspace_id;

  -- 7. Revoke all active portal tokens
  UPDATE portal_tokens SET revoked_at = now()
  WHERE workspace_id = _workspace_id
    AND revoked_at IS NULL
    AND consumed_at IS NULL;
  GET DIAGNOSTICS _revoked_tokens = ROW_COUNT;

  -- 8. Expire all pending invites
  UPDATE workspace_invites SET status = 'expired', expires_at = now()
  WHERE workspace_id = _workspace_id
    AND status = 'pending';
  GET DIAGNOSTICS _expired_invites = ROW_COUNT;

  -- 9. Audit log
  SELECT full_name INTO _actor_name FROM profiles WHERE user_id = _uid LIMIT 1;

  INSERT INTO audit_logs (workspace_id, actor_id, actor_name, entity_type, entity_id, action, metadata)
  VALUES (
    _workspace_id, _uid, _actor_name, 'workspace', _workspace_id, 'workspace_deactivated',
    json_build_object(
      'workspace_name', _ws.name,
      'revoked_portal_tokens', _revoked_tokens,
      'expired_invites', _expired_invites
    )::jsonb
  );

  RETURN json_build_object(
    'success', true,
    'revoked_portal_tokens', _revoked_tokens,
    'expired_invites', _expired_invites
  );
END;
$$;
