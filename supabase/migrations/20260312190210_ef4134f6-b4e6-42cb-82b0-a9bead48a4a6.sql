-- 1) Fix system_alerts RLS: add 'renewal' entity_type for team members
DROP POLICY IF EXISTS "Team members can view relevant alerts" ON public.system_alerts;

CREATE POLICY "Team members can view relevant alerts"
ON public.system_alerts FOR SELECT
TO authenticated
USING (
  has_workspace_access((SELECT auth.uid()), workspace_id)
  AND (
    (entity_type = 'project' AND is_project_member((SELECT auth.uid()), entity_id))
    OR (entity_type = 'invoice' AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = system_alerts.entity_id
        AND (i.project_id IS NULL OR is_project_member((SELECT auth.uid()), i.project_id))
    ))
    OR (entity_type = 'lead' AND EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = system_alerts.entity_id
        AND (l.owner_id = (SELECT auth.uid()) OR l.owner_id IS NULL)
    ))
    OR (entity_type = 'renewal' AND EXISTS (
      SELECT 1 FROM renewals r
      WHERE r.id = system_alerts.entity_id
        AND (r.project_id IS NULL OR is_project_member((SELECT auth.uid()), r.project_id))
    ))
  )
);

-- 2) Create backend-controlled renewals mutation RPC
CREATE OR REPLACE FUNCTION public.manage_renewal(
  _action text,
  _workspace_id uuid,
  _renewal_id uuid DEFAULT NULL,
  _label text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _currency text DEFAULT 'BDT',
  _interval_months int DEFAULT 12,
  _next_billing_date date DEFAULT NULL,
  _notes text DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _result_id uuid;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  IF _action = 'create' THEN
    IF _label IS NULL OR _company_id IS NULL OR _next_billing_date IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Missing required fields');
    END IF;
    INSERT INTO public.renewals (workspace_id, company_id, project_id, label, amount, currency, interval_months, next_billing_date, notes, is_active)
    VALUES (_workspace_id, _company_id, _project_id, _label, COALESCE(_amount, 0), _currency, _interval_months, _next_billing_date, _notes, _is_active)
    RETURNING id INTO _result_id;
    RETURN json_build_object('success', true, 'id', _result_id);

  ELSIF _action = 'update' THEN
    IF _renewal_id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'renewal_id required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.renewals WHERE id = _renewal_id AND workspace_id = _workspace_id) THEN
      RETURN json_build_object('success', false, 'error', 'Not found');
    END IF;
    UPDATE public.renewals SET
      label = COALESCE(_label, label),
      company_id = COALESCE(_company_id, company_id),
      project_id = _project_id,
      amount = COALESCE(_amount, amount),
      currency = COALESCE(_currency, currency),
      interval_months = COALESCE(_interval_months, interval_months),
      next_billing_date = COALESCE(_next_billing_date, next_billing_date),
      notes = _notes,
      is_active = COALESCE(_is_active, is_active),
      updated_at = now()
    WHERE id = _renewal_id;
    RETURN json_build_object('success', true, 'id', _renewal_id);

  ELSIF _action = 'toggle_active' THEN
    IF _renewal_id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'renewal_id required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.renewals WHERE id = _renewal_id AND workspace_id = _workspace_id) THEN
      RETURN json_build_object('success', false, 'error', 'Not found');
    END IF;
    UPDATE public.renewals SET is_active = NOT is_active, updated_at = now()
    WHERE id = _renewal_id;
    RETURN json_build_object('success', true);

  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid action');
  END IF;
END;
$$;

-- 3) Add updated_at trigger for renewals
CREATE TRIGGER set_renewals_updated_at
  BEFORE UPDATE ON public.renewals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();