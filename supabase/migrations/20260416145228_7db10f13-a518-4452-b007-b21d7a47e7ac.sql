
CREATE OR REPLACE FUNCTION public.execute_data_erasure(
  _workspace_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid := auth.uid();
  _req record;
  _revoked_tokens int;
  _expired_invites int;
BEGIN
  -- 1. Verify caller is admin of this workspace
  IF NOT has_workspace_role(_caller_id, _workspace_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only workspace admins can execute erasure');
  END IF;

  -- 2. Verify the erasure request exists, belongs to this workspace, and is approved
  SELECT * INTO _req FROM data_erasure_requests
  WHERE id = _request_id AND workspace_id = _workspace_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No approved erasure request found');
  END IF;

  -- 3. Revoke all active portal tokens
  UPDATE portal_tokens
  SET revoked_at = now()
  WHERE workspace_id = _workspace_id
    AND revoked_at IS NULL
    AND consumed_at IS NULL;
  GET DIAGNOSTICS _revoked_tokens = ROW_COUNT;

  -- 4. Expire all pending workspace invites
  UPDATE workspace_invites
  SET status = 'expired', expires_at = now()
  WHERE workspace_id = _workspace_id
    AND status = 'pending';
  GET DIAGNOSTICS _expired_invites = ROW_COUNT;

  -- 5. Soft-delete the workspace (triggers has_workspace_access/has_workspace_role cutoff)
  UPDATE workspaces
  SET deleted_at = now()
  WHERE id = _workspace_id
    AND deleted_at IS NULL;

  -- 6. Soft-delete all files (mark for storage cleanup)
  UPDATE files
  SET deleted_at = now()
  WHERE workspace_id = _workspace_id
    AND deleted_at IS NULL;

  -- 7. Mark the erasure request as completed
  UPDATE data_erasure_requests
  SET status = 'completed',
      completed_at = now(),
      notes = COALESCE(notes, '') || ' | Executed: tokens revoked=' || _revoked_tokens || ', invites expired=' || _expired_invites || ', workspace soft-deleted, files marked for cleanup'
  WHERE id = _request_id;

  -- 8. Audit log for each stage
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, action, actor_id, metadata)
  VALUES
    (_workspace_id, 'data_erasure_request', _request_id, 'erasure_executed', _caller_id,
     jsonb_build_object(
       'portal_tokens_revoked', _revoked_tokens,
       'invites_expired', _expired_invites,
       'workspace_soft_deleted', true,
       'files_marked_deleted', true,
       'storage_cleanup', 'pending_manual_verification'
     ));

  RETURN jsonb_build_object(
    'success', true,
    'portal_tokens_revoked', _revoked_tokens,
    'invites_expired', _expired_invites
  );
END;
$$;
