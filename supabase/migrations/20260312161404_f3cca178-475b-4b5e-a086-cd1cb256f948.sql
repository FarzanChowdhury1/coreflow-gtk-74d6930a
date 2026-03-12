
-- ============================================================
-- 1. BIN VALIDATION TRIGGER (companies) 
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_company_bin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.bin IS NULL OR NEW.bin !~ '^[0-9A-Za-z]{13}$' THEN
    RAISE EXCEPTION 'BIN must be exactly 13 alphanumeric characters, got: %', COALESCE(NEW.bin, 'NULL');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_company_bin
  BEFORE INSERT OR UPDATE OF bin ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_company_bin();

-- ============================================================
-- 2. PHONE VALIDATION TRIGGER (contacts)
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone != '' AND NEW.phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'Phone must be in international format (e.g. +8801712345678), got: %', NEW.phone;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_contact_phone
  BEFORE INSERT OR UPDATE OF phone ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contact_phone();

-- ============================================================
-- 3. AUTOMATIC AUDIT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _workspace_id UUID;
  _entity_id UUID;
  _actor_id UUID;
  _actor_name TEXT;
  _action TEXT;
  _meta JSONB;
BEGIN
  _actor_id := auth.uid();

  IF _actor_id IS NOT NULL THEN
    SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _actor_id LIMIT 1;
  END IF;

  _action := lower(TG_OP);

  IF TG_OP = 'DELETE' THEN
    _workspace_id := OLD.workspace_id;
    _entity_id := OLD.id;
    _meta := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'INSERT' THEN
    _workspace_id := NEW.workspace_id;
    _entity_id := NEW.id;
    _meta := jsonb_build_object('new', to_jsonb(NEW));
  ELSE
    _workspace_id := NEW.workspace_id;
    _entity_id := NEW.id;
    _meta := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (_workspace_id, _actor_id, _actor_name, _action, TG_TABLE_NAME, _entity_id, _meta);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_proposal_versions
  AFTER INSERT OR UPDATE OR DELETE ON public.proposal_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER trg_audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER trg_audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER trg_audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
