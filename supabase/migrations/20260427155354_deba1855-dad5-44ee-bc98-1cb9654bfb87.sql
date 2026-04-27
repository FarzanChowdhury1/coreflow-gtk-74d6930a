DROP TRIGGER IF EXISTS trg_audit_workspaces ON public.workspaces;

DO $$
DECLARE
  target_ids uuid[] := ARRAY[
    '23860f1b-546a-498e-afcc-f47c03502b4d','2209da37-85da-4417-9828-cba778827831','cbfc44b2-b46b-4231-9652-795db32a4539',
    'f494d8fa-481f-495a-b3e1-885b3f5fe6c9','36e30026-e12b-45ca-b525-8b3ff495d0c3','a02d35aa-8fa2-48d3-b984-c00f273716dc',
    '14587c93-b0cc-4027-a8a4-d999d2e2bfaa','8ac4f523-7877-426f-afc0-8ce0e42c7408','4c381f4f-c77f-436f-8a12-241f32a1b07c',
    '1cb7105b-5a20-47f7-81e7-fcf94fa1eae6','ad1e59f4-7e55-4d4e-ae07-807128023e0a'
  ]::uuid[];
BEGIN
  DELETE FROM approval_actions WHERE workspace_id = ANY(target_ids);
  DELETE FROM approval_requests WHERE workspace_id = ANY(target_ids);
  DELETE FROM approval_steps WHERE workspace_id = ANY(target_ids);
  DELETE FROM approval_workflows WHERE workspace_id = ANY(target_ids);
  DELETE FROM lead_tasks WHERE workspace_id = ANY(target_ids);
  DELETE FROM leads WHERE workspace_id = ANY(target_ids);
  DELETE FROM client_tasks WHERE workspace_id = ANY(target_ids);
  DELETE FROM client_updates WHERE workspace_id = ANY(target_ids);
  DELETE FROM invoice_line_items WHERE workspace_id = ANY(target_ids);
  DELETE FROM payments WHERE workspace_id = ANY(target_ids);
  DELETE FROM payment_proof_submissions WHERE workspace_id = ANY(target_ids);
  DELETE FROM invoices WHERE workspace_id = ANY(target_ids);
  DELETE FROM invoice_sequences WHERE workspace_id = ANY(target_ids);
  DELETE FROM proposal_line_items WHERE workspace_id = ANY(target_ids);
  DELETE FROM proposal_versions WHERE workspace_id = ANY(target_ids);
  DELETE FROM proposals WHERE workspace_id = ANY(target_ids);
  DELETE FROM tasks WHERE workspace_id = ANY(target_ids);
  DELETE FROM project_members WHERE workspace_id = ANY(target_ids);
  DELETE FROM meeting_actions WHERE workspace_id = ANY(target_ids);
  DELETE FROM meeting_requests WHERE workspace_id = ANY(target_ids);
  DELETE FROM meetings WHERE workspace_id = ANY(target_ids);
  DELETE FROM projects WHERE workspace_id = ANY(target_ids);
  DELETE FROM expenses WHERE workspace_id = ANY(target_ids);
  DELETE FROM vendors WHERE workspace_id = ANY(target_ids);
  DELETE FROM subscriptions WHERE workspace_id = ANY(target_ids);
  DELETE FROM budgets WHERE workspace_id = ANY(target_ids);
  DELETE FROM renewals WHERE workspace_id = ANY(target_ids);
  DELETE FROM finance_snapshots WHERE workspace_id = ANY(target_ids);
  DELETE FROM finance_watchlist_items WHERE workspace_id = ANY(target_ids);
  DELETE FROM collections_cases WHERE workspace_id = ANY(target_ids);
  DELETE FROM company_access WHERE workspace_id = ANY(target_ids);
  DELETE FROM contacts WHERE workspace_id = ANY(target_ids);
  DELETE FROM companies WHERE workspace_id = ANY(target_ids);
  DELETE FROM portal_tokens WHERE workspace_id = ANY(target_ids);
  DELETE FROM workspace_invites WHERE workspace_id = ANY(target_ids);
  DELETE FROM system_alerts WHERE workspace_id = ANY(target_ids);
  DELETE FROM notifications WHERE workspace_id = ANY(target_ids);
  DELETE FROM notification_preferences WHERE workspace_id = ANY(target_ids);
  DELETE FROM audit_logs WHERE workspace_id = ANY(target_ids);
  DELETE FROM email_logs WHERE workspace_id = ANY(target_ids);
  DELETE FROM digest_runs WHERE workspace_id = ANY(target_ids);
  DELETE FROM worker_runs WHERE workspace_id = ANY(target_ids);
  DELETE FROM client_errors WHERE workspace_id = ANY(target_ids);
  DELETE FROM product_events WHERE workspace_id = ANY(target_ids);
  DELETE FROM beta_feedback WHERE workspace_id = ANY(target_ids);
  DELETE FROM data_erasure_requests WHERE workspace_id = ANY(target_ids);
  DELETE FROM paid_plan_activations WHERE workspace_id = ANY(target_ids);
  DELETE FROM workspace_followups WHERE workspace_id = ANY(target_ids);
  DELETE FROM workspace_module_access WHERE workspace_id = ANY(target_ids);
  DELETE FROM team_members WHERE workspace_id = ANY(target_ids);
  DELETE FROM teams WHERE workspace_id = ANY(target_ids);
  DELETE FROM departments WHERE workspace_id = ANY(target_ids);
  DELETE FROM short_links WHERE workspace_id = ANY(target_ids);
  DELETE FROM files WHERE workspace_id = ANY(target_ids);
  DELETE FROM workspace_memberships WHERE workspace_id = ANY(target_ids);
  DELETE FROM workspaces WHERE id = ANY(target_ids);
END $$;

CREATE TRIGGER trg_audit_workspaces
  AFTER INSERT OR DELETE OR UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();