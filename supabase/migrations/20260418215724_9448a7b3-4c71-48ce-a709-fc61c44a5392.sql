
DO $cleanup$
DECLARE _ws uuid; _admin uuid;
BEGIN
  FOR _ws IN SELECT id FROM public.workspaces WHERE name = 'lr-verify' LOOP
    DELETE FROM public.payments WHERE workspace_id = _ws;
    DELETE FROM public.invoice_line_items WHERE workspace_id = _ws;
    DELETE FROM public.invoices WHERE workspace_id = _ws;
    DELETE FROM public.expenses WHERE workspace_id = _ws;
    DELETE FROM public.subscriptions WHERE workspace_id = _ws;
    DELETE FROM public.budgets WHERE workspace_id = _ws;
    DELETE FROM public.invoice_sequences WHERE workspace_id = _ws;
    DELETE FROM public.notifications WHERE workspace_id = _ws;
    DELETE FROM public.product_events WHERE workspace_id = _ws;
    DELETE FROM public.system_alerts WHERE workspace_id = _ws;
    DELETE FROM public.workspace_followups WHERE workspace_id = _ws;
    DELETE FROM public.companies WHERE workspace_id = _ws;
    DELETE FROM public.workspace_memberships WHERE workspace_id = _ws;
    -- audit_logs LAST so triggers from prior deletes are absorbed
    DELETE FROM public.audit_logs WHERE workspace_id = _ws;
    DELETE FROM public.workspaces WHERE id = _ws;
  END LOOP;
  FOR _admin IN SELECT id FROM auth.users WHERE email LIKE 'lr-verify-%@test.local' LOOP
    DELETE FROM auth.users WHERE id = _admin;
  END LOOP;
END
$cleanup$;
