
CREATE OR REPLACE FUNCTION public.purge_workspace_data(_workspace_id uuid, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req record;
  _storage_paths text[];
  _path text;
  _storage_deleted int := 0;
  _storage_failed int := 0;
  _result jsonb;
BEGIN
  -- Validate request exists and is in correct state
  SELECT * INTO _req
  FROM data_erasure_requests
  WHERE id = _request_id AND workspace_id = _workspace_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF _req.status NOT IN ('pending_purge') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request must be in pending_purge state. Current: ' || _req.status);
  END IF;

  -- Transition to purging_storage immediately
  UPDATE data_erasure_requests
  SET status = 'purging_storage', updated_at = now()
  WHERE id = _request_id;

  -- Collect all storage paths BEFORE deleting file rows
  SELECT array_agg(storage_path)
  INTO _storage_paths
  FROM files
  WHERE workspace_id = _workspace_id AND storage_path IS NOT NULL AND storage_path != '';

  -- Delete storage objects server-side using service role privileges
  IF _storage_paths IS NOT NULL THEN
    FOREACH _path IN ARRAY _storage_paths LOOP
      BEGIN
        -- We delete via direct table manipulation since we're SECURITY DEFINER
        -- The actual blob deletion happens via storage.objects cleanup
        DELETE FROM storage.objects
        WHERE bucket_id = 'workspace-files'
          AND name = _path;
        _storage_deleted := _storage_deleted + 1;
      EXCEPTION WHEN OTHERS THEN
        _storage_failed := _storage_failed + 1;
      END;
    END LOOP;
  END IF;

  -- Hard-delete all tenant data (order matters for FK constraints)
  DELETE FROM meeting_actions WHERE workspace_id = _workspace_id;
  DELETE FROM meeting_requests WHERE workspace_id = _workspace_id;
  DELETE FROM meetings WHERE workspace_id = _workspace_id;
  DELETE FROM lead_tasks WHERE workspace_id = _workspace_id;
  DELETE FROM approval_actions WHERE workspace_id = _workspace_id;
  DELETE FROM approval_requests WHERE workspace_id = _workspace_id;
  DELETE FROM approval_steps WHERE workspace_id = _workspace_id;
  DELETE FROM approval_workflows WHERE workspace_id = _workspace_id;
  DELETE FROM client_tasks WHERE workspace_id = _workspace_id;
  DELETE FROM client_updates WHERE workspace_id = _workspace_id;
  DELETE FROM payments WHERE workspace_id = _workspace_id;
  DELETE FROM invoice_line_items WHERE workspace_id = _workspace_id;
  DELETE FROM invoices WHERE workspace_id = _workspace_id;
  DELETE FROM invoice_sequences WHERE workspace_id = _workspace_id;
  DELETE FROM proposal_line_items WHERE workspace_id = _workspace_id;
  DELETE FROM proposal_versions WHERE workspace_id = _workspace_id;
  DELETE FROM proposals WHERE workspace_id = _workspace_id;
  DELETE FROM project_members WHERE workspace_id = _workspace_id;
  DELETE FROM projects WHERE workspace_id = _workspace_id;
  DELETE FROM renewals WHERE workspace_id = _workspace_id;
  DELETE FROM subscriptions WHERE workspace_id = _workspace_id;
  DELETE FROM expenses WHERE workspace_id = _workspace_id;
  DELETE FROM vendors WHERE workspace_id = _workspace_id;
  DELETE FROM budgets WHERE workspace_id = _workspace_id;
  DELETE FROM files WHERE workspace_id = _workspace_id;
  DELETE FROM company_access WHERE workspace_id = _workspace_id;
  DELETE FROM contacts WHERE workspace_id = _workspace_id;
  DELETE FROM companies WHERE workspace_id = _workspace_id;
  DELETE FROM leads WHERE workspace_id = _workspace_id;
  DELETE FROM portal_tokens WHERE workspace_id = _workspace_id;
  DELETE FROM notifications WHERE workspace_id = _workspace_id;
  DELETE FROM notification_preferences WHERE workspace_id = _workspace_id;
  DELETE FROM beta_feedback WHERE workspace_id = _workspace_id;
  DELETE FROM product_events WHERE workspace_id = _workspace_id;
  DELETE FROM digest_runs WHERE workspace_id = _workspace_id;
  DELETE FROM email_logs WHERE workspace_id = _workspace_id;
  DELETE FROM worker_runs WHERE workspace_id = _workspace_id;
  DELETE FROM client_errors WHERE workspace_id = _workspace_id;
  DELETE FROM departments WHERE workspace_id = _workspace_id;
  DELETE FROM team_pods WHERE workspace_id = _workspace_id;
  DELETE FROM workspace_members WHERE workspace_id = _workspace_id;

  -- Mark request as purged ONLY now that everything is complete
  UPDATE data_erasure_requests
  SET status = 'purged',
      completed_at = now(),
      updated_at = now(),
      notes = coalesce(notes, '') || ' | purge_complete: records_deleted=true, storage_deleted=' || _storage_deleted || ', storage_failed=' || _storage_failed
  WHERE id = _request_id;

  -- Audit the completed purge (audit_logs preserved intentionally)
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, action, metadata)
  VALUES (_workspace_id, 'data_erasure_request', _request_id, 'purge_completed',
    jsonb_build_object(
      'storage_objects_deleted', _storage_deleted,
      'storage_objects_failed', _storage_failed,
      'total_storage_paths', coalesce(array_length(_storage_paths, 1), 0)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'storage_deleted', _storage_deleted,
    'storage_failed', _storage_failed,
    'total_storage_paths', coalesce(array_length(_storage_paths, 1), 0)
  );
END;
$$;
