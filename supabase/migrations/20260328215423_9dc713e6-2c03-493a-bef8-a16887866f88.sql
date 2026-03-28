
-- Wave 4: Revoke EXECUTE from PUBLIC/anon on user-facing SECURITY DEFINER RPCs
-- These functions all require authenticated context (auth.uid()) internally
-- RLS helper functions (has_workspace_access, etc.) and trigger functions are LEFT ALONE
-- as they are invoked by the DB engine in policy/trigger context

-- User-facing RPCs that must require authentication:
REVOKE EXECUTE ON FUNCTION public.get_dashboard_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.bootstrap_workspace(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.accept_invite_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite_by_token(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_workspace_invite(uuid, text, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_invite(uuid, text, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.decline_workspace_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_workspace_invite(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.revoke_workspace_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invite(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.resolve_invite_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_invite_by_token(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dismiss_system_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_system_alert(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.submit_for_approval(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_for_approval(uuid, text, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.process_approval_decision(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_approval_decision(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_project_from_approved_version(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_from_approved_version(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.issue_invoice(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid, uuid, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.void_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.void_proposal_version(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_proposal_version(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.manage_renewal(text, uuid, uuid, text, uuid, uuid, numeric, text, integer, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_renewal(text, uuid, uuid, text, uuid, uuid, numeric, text, integer, date, text, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.generate_renewal_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_renewal_invoice(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.generate_portal_token(uuid, uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_portal_token(uuid, uuid, uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.count_portal_tokens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_portal_tokens(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_short_link(uuid, text, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_short_link(uuid, text, text, uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.swap_client_task_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_client_task_order(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.next_client_task_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_client_task_order(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.normalize_client_task_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_client_task_order(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.workspace_has_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_has_members(uuid) TO authenticated, service_role;

-- System/worker functions: restrict to service_role only (called from Edge Functions)
REVOKE EXECUTE ON FUNCTION public.aggregate_daily_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_digest() TO service_role;

REVOKE EXECUTE ON FUNCTION public.aggregate_daily_digest_for_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_digest_for_workspace(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_due_renewal_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_due_renewal_invoices() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sweep_lead_followups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_lead_followups() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sweep_overdue_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_overdue_invoices() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sweep_renewal_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_renewal_reminders() TO service_role;

REVOKE EXECUTE ON FUNCTION public.select_retention_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.select_retention_candidates() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_expired_portal_tokens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_portal_tokens() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_expired_short_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_short_links() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_old_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_operational_logs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_operational_logs() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_stale_file_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_stale_file_rows() TO service_role;

REVOKE EXECUTE ON FUNCTION public.count_retention_candidates_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_retention_candidates_notifications() TO service_role;

REVOKE EXECUTE ON FUNCTION public.count_retention_candidates_ops_logs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_retention_candidates_ops_logs() TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_worker_failure_alert(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_worker_failure_alert(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.invoke_asset_cleanup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoke_asset_cleanup() TO service_role;

REVOKE EXECUTE ON FUNCTION public.invoke_daily_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoke_daily_digest() TO service_role;

REVOKE EXECUTE ON FUNCTION public._generate_renewal_invoice_internal(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._generate_renewal_invoice_internal(uuid, uuid) TO service_role;

-- Portal RPCs called from Edge Functions (service_role context, no auth.uid)
REVOKE EXECUTE ON FUNCTION public.validate_portal_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_portal_token(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.portal_respond_proposal(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_respond_proposal(text, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.portal_respond_proposal_internal(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_respond_proposal_internal(uuid, uuid, uuid, text) TO service_role;
