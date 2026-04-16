
-- Update execute_data_erasure to use pending_purge instead of completed
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
  IF NOT has_workspace_role(_caller_id, _workspace_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only workspace admins can execute erasure');
  END IF;

  SELECT * INTO _req FROM data_erasure_requests
  WHERE id = _request_id AND workspace_id = _workspace_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No approved erasure request found');
  END IF;

  -- Revoke all active portal tokens
  UPDATE portal_tokens
  SET revoked_at = now()
  WHERE workspace_id = _workspace_id AND revoked_at IS NULL AND consumed_at IS NULL;
  GET DIAGNOSTICS _revoked_tokens = ROW_COUNT;

  -- Expire all pending invites
  UPDATE workspace_invites
  SET status = 'expired', expires_at = now()
  WHERE workspace_id = _workspace_id AND status = 'pending';
  GET DIAGNOSTICS _expired_invites = ROW_COUNT;

  -- Soft-delete workspace (cuts all access via has_workspace_access)
  UPDATE workspaces SET deleted_at = now() WHERE id = _workspace_id AND deleted_at IS NULL;

  -- Mark request as pending_purge (NOT completed — no data erased yet)
  UPDATE data_erasure_requests
  SET status = 'pending_purge',
      notes = COALESCE(notes, '') || ' | Deactivated: tokens=' || _revoked_tokens || ' invites=' || _expired_invites || ' workspace soft-deleted'
  WHERE id = _request_id;

  -- Audit
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, action, actor_id, metadata)
  VALUES (_workspace_id, 'data_erasure_request', _request_id, 'erasure_deactivated', _caller_id,
    jsonb_build_object('portal_tokens_revoked', _revoked_tokens, 'invites_expired', _expired_invites, 'stage', 'pending_purge'));

  RETURN jsonb_build_object('success', true, 'portal_tokens_revoked', _revoked_tokens, 'invites_expired', _expired_invites, 'status', 'pending_purge');
END;
$$;

-- New: destructive purge that actually deletes tenant data
CREATE OR REPLACE FUNCTION public.purge_workspace_data(
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
  _ws record;
  _storage_paths text[];
  _deleted_counts jsonb := '{}'::jsonb;
  _cnt int;
BEGIN
  -- 1. Verify caller is admin
  IF NOT has_workspace_role(_caller_id, _workspace_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only workspace admins can purge data');
  END IF;

  -- 2. Verify request is in pending_purge
  SELECT * INTO _req FROM data_erasure_requests
  WHERE id = _request_id AND workspace_id = _workspace_id AND status = 'pending_purge';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request must be in pending_purge status');
  END IF;

  -- 3. Verify workspace is already deactivated
  SELECT * INTO _ws FROM workspaces WHERE id = _workspace_id;
  IF _ws.deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace must be deactivated before purge');
  END IF;

  -- 4. Collect storage paths before deleting file records
  SELECT COALESCE(array_agg(storage_path), '{}') INTO _storage_paths
  FROM files WHERE workspace_id = _workspace_id;

  -- 5. Delete in safe dependency order (children before parents)

  -- Approval engine
  DELETE FROM approval_actions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_actions', _cnt);
  DELETE FROM approval_requests WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_requests', _cnt);
  DELETE FROM approval_steps WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_steps', _cnt);
  DELETE FROM approval_workflows WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_workflows', _cnt);

  -- Meetings & actions
  DELETE FROM meeting_actions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meeting_actions', _cnt);
  DELETE FROM meeting_requests WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meeting_requests', _cnt);
  DELETE FROM meetings WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meetings', _cnt);

  -- Invoice children
  DELETE FROM payments WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('payments', _cnt);
  DELETE FROM invoice_line_items WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoice_line_items', _cnt);
  DELETE FROM invoice_sequences WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoice_sequences', _cnt);
  DELETE FROM invoices WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoices', _cnt);

  -- Proposals
  DELETE FROM proposal_line_items WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposal_line_items', _cnt);
  DELETE FROM proposal_versions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposal_versions', _cnt);
  DELETE FROM proposals WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposals', _cnt);

  -- Projects & tasks
  DELETE FROM project_members WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('project_members', _cnt);
  DELETE FROM tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('tasks', _cnt);
  DELETE FROM client_tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('client_tasks', _cnt);
  DELETE FROM client_updates WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('client_updates', _cnt);
  DELETE FROM projects WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('projects', _cnt);

  -- Leads
  DELETE FROM lead_tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('lead_tasks', _cnt);
  DELETE FROM leads WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('leads', _cnt);

  -- Finance
  DELETE FROM expenses WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('expenses', _cnt);
  DELETE FROM renewals WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('renewals', _cnt);
  DELETE FROM subscriptions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('subscriptions', _cnt);
  DELETE FROM budgets WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('budgets', _cnt);
  DELETE FROM vendors WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('vendors', _cnt);

  -- Contacts & companies
  DELETE FROM company_access WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('company_access', _cnt);
  DELETE FROM contacts WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('contacts', _cnt);
  DELETE FROM companies WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('companies', _cnt);

  -- Files (DB records — storage objects handled by caller)
  DELETE FROM files WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('files', _cnt);

  -- System / ops
  DELETE FROM notifications WHERE workspace_id = _workspace_id;
  DELETE FROM notification_preferences WHERE workspace_id = _workspace_id;
  DELETE FROM beta_feedback WHERE workspace_id = _workspace_id;
  DELETE FROM product_events WHERE workspace_id = _workspace_id;
  DELETE FROM client_errors WHERE workspace_id = _workspace_id;
  DELETE FROM email_logs WHERE workspace_id = _workspace_id;
  DELETE FROM digest_runs WHERE workspace_id = _workspace_id;
  DELETE FROM short_links WHERE workspace_id = _workspace_id;
  DELETE FROM system_alerts WHERE workspace_id = _workspace_id;
  DELETE FROM worker_runs WHERE workspace_id = _workspace_id;
  DELETE FROM workspace_followups WHERE workspace_id = _workspace_id;
  DELETE FROM portal_tokens WHERE workspace_id = _workspace_id;

  -- Team & org
  DELETE FROM departments WHERE workspace_id = _workspace_id;
  DELETE FROM team_members WHERE workspace_id = _workspace_id;
  DELETE FROM teams WHERE workspace_id = _workspace_id;
  DELETE FROM workspace_invites WHERE workspace_id = _workspace_id;
  DELETE FROM workspace_memberships WHERE workspace_id = _workspace_id;

  -- Audit logs are preserved as evidence of the erasure (compliance requirement)
  -- Do NOT delete audit_logs — they prove the erasure happened

  -- 6. Mark the erasure request as purged
  UPDATE data_erasure_requests
  SET status = 'purged',
      completed_at = now(),
      notes = COALESCE(notes, '') || ' | PURGED: all tenant data hard-deleted, storage_paths returned for cleanup'
  WHERE id = _request_id;

  -- 7. Final audit entry (preserved in audit_logs)
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, action, actor_id, metadata)
  VALUES (_workspace_id, 'data_erasure_request', _request_id, 'workspace_purged', _caller_id,
    jsonb_build_object('deleted_counts', _deleted_counts, 'storage_paths_count', array_length(_storage_paths, 1), 'stage', 'purged'));

  -- 8. Delete the erasure request record itself (the audit log is the permanent record)
  DELETE FROM data_erasure_requests WHERE workspace_id = _workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_counts', _deleted_counts,
    'storage_paths', to_jsonb(_storage_paths)
  );
END;
$$;
