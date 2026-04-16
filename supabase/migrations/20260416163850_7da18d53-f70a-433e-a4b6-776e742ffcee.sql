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
  _req record;
  _ws record;
  _deleted_counts jsonb := '{}'::jsonb;
  _cnt integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the backend purge runner can finalize destructive purge');
  END IF;

  SELECT * INTO _req
  FROM public.data_erasure_requests
  WHERE id = _request_id
    AND workspace_id = _workspace_id
    AND status = 'purging_storage';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request must be in purging_storage state');
  END IF;

  SELECT * INTO _ws
  FROM public.workspaces
  WHERE id = _workspace_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace not found');
  END IF;

  IF _ws.deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace must be deactivated before purge');
  END IF;

  DELETE FROM public.approval_actions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_actions', _cnt);

  DELETE FROM public.approval_requests WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_requests', _cnt);

  DELETE FROM public.approval_steps WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_steps', _cnt);

  DELETE FROM public.approval_workflows WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('approval_workflows', _cnt);

  DELETE FROM public.meeting_actions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meeting_actions', _cnt);

  DELETE FROM public.meeting_requests WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meeting_requests', _cnt);

  DELETE FROM public.meetings WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('meetings', _cnt);

  DELETE FROM public.payments WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('payments', _cnt);

  DELETE FROM public.invoice_line_items WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoice_line_items', _cnt);

  DELETE FROM public.invoice_sequences WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoice_sequences', _cnt);

  DELETE FROM public.invoices WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('invoices', _cnt);

  DELETE FROM public.proposal_line_items WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposal_line_items', _cnt);

  DELETE FROM public.proposal_versions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposal_versions', _cnt);

  DELETE FROM public.proposals WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('proposals', _cnt);

  DELETE FROM public.project_members WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('project_members', _cnt);

  DELETE FROM public.tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('tasks', _cnt);

  DELETE FROM public.client_tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('client_tasks', _cnt);

  DELETE FROM public.client_updates WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('client_updates', _cnt);

  DELETE FROM public.projects WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('projects', _cnt);

  DELETE FROM public.lead_tasks WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('lead_tasks', _cnt);

  DELETE FROM public.leads WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('leads', _cnt);

  DELETE FROM public.expenses WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('expenses', _cnt);

  DELETE FROM public.renewals WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('renewals', _cnt);

  DELETE FROM public.subscriptions WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('subscriptions', _cnt);

  DELETE FROM public.budgets WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('budgets', _cnt);

  DELETE FROM public.vendors WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('vendors', _cnt);

  DELETE FROM public.company_access WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('company_access', _cnt);

  DELETE FROM public.contacts WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('contacts', _cnt);

  DELETE FROM public.companies WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('companies', _cnt);

  DELETE FROM public.files WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('files', _cnt);

  DELETE FROM public.notifications WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('notifications', _cnt);

  DELETE FROM public.notification_preferences WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('notification_preferences', _cnt);

  DELETE FROM public.beta_feedback WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('beta_feedback', _cnt);

  DELETE FROM public.product_events WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('product_events', _cnt);

  DELETE FROM public.client_errors WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('client_errors', _cnt);

  DELETE FROM public.email_logs WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('email_logs', _cnt);

  DELETE FROM public.digest_runs WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('digest_runs', _cnt);

  DELETE FROM public.short_links WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('short_links', _cnt);

  DELETE FROM public.system_alerts WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('system_alerts', _cnt);

  DELETE FROM public.worker_runs WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('worker_runs', _cnt);

  DELETE FROM public.workspace_followups WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('workspace_followups', _cnt);

  DELETE FROM public.portal_tokens WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('portal_tokens', _cnt);

  DELETE FROM public.departments WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('departments', _cnt);

  DELETE FROM public.team_members WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('team_members', _cnt);

  DELETE FROM public.teams WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('teams', _cnt);

  DELETE FROM public.workspace_invites WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('workspace_invites', _cnt);

  DELETE FROM public.workspace_memberships WHERE workspace_id = _workspace_id;
  GET DIAGNOSTICS _cnt = ROW_COUNT; _deleted_counts := _deleted_counts || jsonb_build_object('workspace_memberships', _cnt);

  UPDATE public.data_erasure_requests
  SET status = 'purged',
      completed_at = now(),
      updated_at = now(),
      notes = trim(both ' ' from concat_ws(' | ', nullif(notes, ''), 'records_purged=true'))
  WHERE id = _request_id;

  INSERT INTO public.audit_logs (
    workspace_id,
    entity_type,
    entity_id,
    action,
    actor_id,
    metadata
  )
  VALUES (
    _workspace_id,
    'data_erasure_request',
    _request_id,
    'workspace_purged',
    null,
    jsonb_build_object(
      'stage', 'purged',
      'deleted_counts', _deleted_counts,
      'completed_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'purged',
    'deleted_counts', _deleted_counts
  );
END;
$$;