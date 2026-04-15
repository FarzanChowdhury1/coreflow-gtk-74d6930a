-- =============================================================
-- Hard-delete safety guard: LEADS
-- Block DELETE when linked proposals, meetings, or lead_tasks exist
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_lead_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _linked text := '';
BEGIN
  -- Check proposals
  IF EXISTS (SELECT 1 FROM public.proposals WHERE lead_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'proposals, ';
  END IF;

  -- Check meetings
  IF EXISTS (SELECT 1 FROM public.meetings WHERE lead_id = OLD.id) THEN
    _linked := _linked || 'meetings, ';
  END IF;

  -- Check lead_tasks
  IF EXISTS (SELECT 1 FROM public.lead_tasks WHERE lead_id = OLD.id) THEN
    _linked := _linked || 'lead tasks, ';
  END IF;

  IF _linked <> '' THEN
    _linked := rtrim(_linked, ', ');
    RAISE EXCEPTION 'Cannot hard-delete lead "%" because it has linked records: %. Archive it instead.',
      OLD.title, _linked;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_lead_hard_delete ON public.leads;
CREATE TRIGGER trg_guard_lead_hard_delete
  BEFORE DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lead_hard_delete();

-- =============================================================
-- Hard-delete safety guard: COMPANIES
-- Block DELETE when linked contacts, proposals, invoices, projects,
-- meetings, renewals, client_tasks, client_updates, or portal_tokens exist
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_company_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _linked text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM public.contacts WHERE company_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'contacts, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.proposals WHERE company_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'proposals, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoices WHERE company_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'invoices, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.projects WHERE company_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'projects, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.meetings WHERE company_id = OLD.id) THEN
    _linked := _linked || 'meetings, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.renewals WHERE company_id = OLD.id) THEN
    _linked := _linked || 'renewals, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.client_tasks WHERE company_id = OLD.id) THEN
    _linked := _linked || 'client tasks, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.client_updates WHERE company_id = OLD.id AND deleted_at IS NULL) THEN
    _linked := _linked || 'client updates, ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.portal_tokens WHERE company_id = OLD.id AND revoked_at IS NULL AND consumed_at IS NULL) THEN
    _linked := _linked || 'portal tokens, ';
  END IF;

  IF _linked <> '' THEN
    _linked := rtrim(_linked, ', ');
    RAISE EXCEPTION 'Cannot hard-delete company "%" because it has linked records: %. Archive it instead.',
      OLD.legal_name, _linked;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_company_hard_delete ON public.companies;
CREATE TRIGGER trg_guard_company_hard_delete
  BEFORE DELETE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_company_hard_delete();

-- Revoke execute from public/anon for safety
REVOKE EXECUTE ON FUNCTION public.guard_lead_hard_delete() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_company_hard_delete() FROM PUBLIC, anon;