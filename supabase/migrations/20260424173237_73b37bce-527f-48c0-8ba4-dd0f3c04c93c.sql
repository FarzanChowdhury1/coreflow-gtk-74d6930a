-- 1) Harden sweeps to exclude soft-deleted workspaces
CREATE OR REPLACE FUNCTION public.sweep_overdue_invoices()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _count int := 0; _inv record;
BEGIN
  FOR _inv IN
    SELECT i.id, i.workspace_id, i.invoice_number, i.due_date, i.grand_total, i.amount_paid, i.status,
           c.legal_name as company_name
    FROM public.invoices i
    JOIN public.companies c ON c.id = i.company_id
    JOIN public.workspaces w ON w.id = i.workspace_id
    WHERE i.deleted_at IS NULL
      AND w.deleted_at IS NULL
      AND i.status IN ('issued', 'partially_paid')
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (_inv.workspace_id,'overdue_invoice','invoice',_inv.id,
      'Overdue: ' || _inv.invoice_number,
      _inv.company_name || ' — due ' || _inv.due_date::text || ', outstanding ৳' || (_inv.grand_total - _inv.amount_paid)::text,
      CASE WHEN (CURRENT_DATE - _inv.due_date) > 30 THEN 'critical' WHEN (CURRENT_DATE - _inv.due_date) > 7 THEN 'warning' ELSE 'info' END,
      'overdue_invoice::' || _inv.id::text)
    ON CONFLICT (sweep_key) DO UPDATE SET body = EXCLUDED.body, severity = EXCLUDED.severity, is_dismissed = false;
    _count := _count + 1;
  END LOOP;
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type = 'overdue_invoice' AND is_dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i JOIN public.workspaces w ON w.id=i.workspace_id
      WHERE i.id = system_alerts.entity_id AND i.deleted_at IS NULL AND w.deleted_at IS NULL
        AND i.status IN ('issued','partially_paid') AND i.due_date < CURRENT_DATE);
  RETURN json_build_object('swept', _count);
END; $function$;

CREATE OR REPLACE FUNCTION public.sweep_lead_followups()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _count int := 0; _lead record;
BEGIN
  FOR _lead IN
    SELECT l.id, l.workspace_id, l.title, l.next_follow_up, l.status,
           COALESCE(c.legal_name, '—') as company_name
    FROM public.leads l
    LEFT JOIN public.companies c ON c.id = l.company_id
    JOIN public.workspaces w ON w.id = l.workspace_id
    WHERE l.deleted_at IS NULL
      AND w.deleted_at IS NULL
      AND l.status IN ('new','contacted','qualified')
      AND l.next_follow_up IS NOT NULL
      AND l.next_follow_up <= now()
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (_lead.workspace_id,'lead_followup','lead',_lead.id,
      'Follow-up due: ' || _lead.title,
      _lead.company_name || ' — was due ' || _lead.next_follow_up::date::text,
      CASE WHEN (now() - _lead.next_follow_up) > interval '7 days' THEN 'critical'
           WHEN (now() - _lead.next_follow_up) > interval '2 days' THEN 'warning' ELSE 'info' END,
      'lead_followup::' || _lead.id::text)
    ON CONFLICT (sweep_key) DO UPDATE SET body = EXCLUDED.body, severity = EXCLUDED.severity, is_dismissed = false;
    _count := _count + 1;
  END LOOP;
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type='lead_followup' AND is_dismissed=false
    AND NOT EXISTS (
      SELECT 1 FROM public.leads l JOIN public.workspaces w ON w.id=l.workspace_id
      WHERE l.id=system_alerts.entity_id AND l.deleted_at IS NULL AND w.deleted_at IS NULL
        AND l.status IN ('new','contacted','qualified') AND l.next_follow_up <= now());
  RETURN json_build_object('swept', _count);
END; $function$;

CREATE OR REPLACE FUNCTION public.sweep_renewal_reminders()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _count int := 0; _r record;
BEGIN
  FOR _r IN
    SELECT r.id, r.workspace_id, r.label, r.next_billing_date, r.amount, r.currency,
           c.legal_name as company_name
    FROM public.renewals r
    JOIN public.companies c ON c.id = r.company_id
    JOIN public.workspaces w ON w.id = r.workspace_id
    WHERE r.is_active = true
      AND w.deleted_at IS NULL
      AND r.next_billing_date <= (CURRENT_DATE + interval '30 days')
  LOOP
    INSERT INTO public.system_alerts (workspace_id, alert_type, entity_type, entity_id, title, body, severity, sweep_key)
    VALUES (_r.workspace_id,'renewal_reminder','renewal',_r.id,
      CASE WHEN _r.next_billing_date < CURRENT_DATE THEN 'Overdue renewal: ' ELSE 'Upcoming renewal: ' END || _r.label,
      _r.company_name || ' — ' || _r.currency || ' ' || _r.amount::text || ' due ' || _r.next_billing_date::text,
      CASE WHEN _r.next_billing_date < CURRENT_DATE THEN 'critical'
           WHEN _r.next_billing_date <= (CURRENT_DATE + interval '7 days') THEN 'warning' ELSE 'info' END,
      'renewal_reminder::' || _r.id::text)
    ON CONFLICT (sweep_key) DO UPDATE SET body = EXCLUDED.body, severity = EXCLUDED.severity, is_dismissed = false;
    _count := _count + 1;
  END LOOP;
  UPDATE public.system_alerts SET is_dismissed = true, dismissed_at = now()
  WHERE alert_type='renewal_reminder' AND is_dismissed=false
    AND NOT EXISTS (
      SELECT 1 FROM public.renewals r JOIN public.workspaces w ON w.id=r.workspace_id
      WHERE r.id=system_alerts.entity_id AND r.is_active AND w.deleted_at IS NULL
        AND r.next_billing_date <= (CURRENT_DATE + interval '30 days'));
  RETURN json_build_object('swept', _count);
END; $function$;

-- 2) Audit trigger on paid_plan_activations (release-critical financial surface)
DROP TRIGGER IF EXISTS trg_audit_paid_plan_activations ON public.paid_plan_activations;
CREATE TRIGGER trg_audit_paid_plan_activations
AFTER INSERT OR UPDATE OR DELETE ON public.paid_plan_activations
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- 3) Audit trigger on workspaces (catch deactivation/reactivation)
DROP TRIGGER IF EXISTS trg_audit_workspaces ON public.workspaces;
CREATE TRIGGER trg_audit_workspaces
AFTER INSERT OR UPDATE OR DELETE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();