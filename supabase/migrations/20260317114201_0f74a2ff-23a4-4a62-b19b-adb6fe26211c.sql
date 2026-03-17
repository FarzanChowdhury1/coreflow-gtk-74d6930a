
CREATE OR REPLACE FUNCTION public.aggregate_daily_digest_for_workspace(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result json;
  _ws record;
BEGIN
  SELECT id, name INTO _ws FROM public.workspaces WHERE id = _workspace_id AND deleted_at IS NULL;
  IF _ws IS NULL THEN
    RETURN json_build_object('workspace_id', _workspace_id, 'error', 'Workspace not found');
  END IF;

  SELECT json_build_object(
    'workspace_id', _ws.id,
    'workspace_name', _ws.name,
    'overdue_invoices', (
      SELECT COALESCE(json_agg(json_build_object(
        'invoice_id', i.id,
        'invoice_number', i.invoice_number,
        'company', c.legal_name,
        'company_id', i.company_id,
        'due_date', i.due_date,
        'outstanding', i.grand_total - i.amount_paid
      )), '[]'::json)
      FROM public.invoices i
      JOIN public.companies c ON c.id = i.company_id
      WHERE i.workspace_id = _ws.id AND i.deleted_at IS NULL
        AND i.status IN ('issued','partially_paid')
        AND i.due_date < CURRENT_DATE
    ),
    'overdue_followups', (
      SELECT COALESCE(json_agg(json_build_object(
        'lead_id', l.id,
        'title', l.title,
        'company', COALESCE(lc.legal_name, '—'),
        'next_follow_up', l.next_follow_up
      )), '[]'::json)
      FROM public.leads l
      LEFT JOIN public.companies lc ON lc.id = l.company_id
      WHERE l.workspace_id = _ws.id AND l.deleted_at IS NULL
        AND l.status IN ('new','contacted','qualified')
        AND l.next_follow_up IS NOT NULL AND l.next_follow_up <= now()
    ),
    'upcoming_renewals', (
      SELECT COALESCE(json_agg(json_build_object(
        'renewal_id', r.id,
        'label', r.label,
        'company', rc.legal_name,
        'company_id', r.company_id,
        'amount', r.amount,
        'currency', r.currency,
        'next_billing_date', r.next_billing_date
      )), '[]'::json)
      FROM public.renewals r
      JOIN public.companies rc ON rc.id = r.company_id
      WHERE r.workspace_id = _ws.id AND r.is_active = true
        AND r.next_billing_date <= (CURRENT_DATE + interval '7 days')
    )
  ) INTO _result;

  RETURN _result;
END;
$$;
