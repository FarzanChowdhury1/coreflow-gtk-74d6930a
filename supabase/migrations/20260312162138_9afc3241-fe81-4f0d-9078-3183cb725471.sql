
-- ============================================================
-- 1. ROLE-AWARE DASHBOARD METRICS RPC
-- Admins: full workspace rollups
-- Team members: only projects they are assigned to, and related invoices
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id UUID;
  _is_admin BOOLEAN;
  _active_leads BIGINT;
  _open_proposals BIGINT;
  _running_projects BIGINT;
  _pending_invoices BIGINT;
  _total_receivable NUMERIC;
  _total_collected NUMERIC;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;

  -- Check workspace access
  IF NOT public.has_workspace_access(_user_id, _workspace_id) THEN
    RETURN json_build_object('error', 'Access denied');
  END IF;

  -- Check role
  _is_admin := public.has_workspace_role(_user_id, _workspace_id, 'admin');

  IF _is_admin THEN
    -- ADMIN: full workspace-scoped rollups
    SELECT COUNT(*) INTO _active_leads
    FROM public.leads
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status IN ('new', 'contacted', 'qualified');

    SELECT COUNT(*) INTO _open_proposals
    FROM public.proposal_versions
    WHERE workspace_id = _workspace_id
      AND status IN ('draft', 'sent');

    SELECT COUNT(*) INTO _running_projects
    FROM public.projects
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status = 'active';

    SELECT COUNT(*) INTO _pending_invoices
    FROM public.invoices
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status IN ('draft', 'issued', 'partially_paid');

    SELECT COALESCE(SUM(grand_total - amount_paid), 0) INTO _total_receivable
    FROM public.invoices
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status IN ('issued', 'partially_paid');

    SELECT COALESCE(SUM(amount_paid), 0) INTO _total_collected
    FROM public.invoices
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status IN ('paid', 'partially_paid');
  ELSE
    -- TEAM MEMBER: scoped to assigned projects and their related entities
    -- Leads: team members see all workspace leads (leads are not project-scoped)
    SELECT COUNT(*) INTO _active_leads
    FROM public.leads
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND status IN ('new', 'contacted', 'qualified')
      AND (owner_id = _user_id OR owner_id IS NULL);

    -- Open proposals: only for companies linked to assigned projects
    SELECT COUNT(*) INTO _open_proposals
    FROM public.proposal_versions pv
    JOIN public.proposals p ON p.id = pv.proposal_id
    WHERE pv.workspace_id = _workspace_id
      AND pv.status IN ('draft', 'sent')
      AND p.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.projects pr
        JOIN public.project_members pm ON pm.project_id = pr.id
        WHERE pr.company_id = p.company_id
          AND pm.user_id = _user_id
          AND pr.deleted_at IS NULL
      );

    -- Running projects: only assigned
    SELECT COUNT(*) INTO _running_projects
    FROM public.projects pr
    JOIN public.project_members pm ON pm.project_id = pr.id
    WHERE pr.workspace_id = _workspace_id AND pr.deleted_at IS NULL
      AND pr.status = 'active'
      AND pm.user_id = _user_id;

    -- Pending invoices: only for assigned projects
    SELECT COUNT(*) INTO _pending_invoices
    FROM public.invoices i
    WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
      AND i.status IN ('draft', 'issued', 'partially_paid')
      AND (i.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = i.project_id AND pm.user_id = _user_id
      ));

    SELECT COALESCE(SUM(i.grand_total - i.amount_paid), 0) INTO _total_receivable
    FROM public.invoices i
    WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
      AND i.status IN ('issued', 'partially_paid')
      AND (i.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = i.project_id AND pm.user_id = _user_id
      ));

    SELECT COALESCE(SUM(i.amount_paid), 0) INTO _total_collected
    FROM public.invoices i
    WHERE i.workspace_id = _workspace_id AND i.deleted_at IS NULL
      AND i.status IN ('paid', 'partially_paid')
      AND (i.project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = i.project_id AND pm.user_id = _user_id
      ));
  END IF;

  RETURN json_build_object(
    'active_leads', _active_leads,
    'open_proposals', _open_proposals,
    'running_projects', _running_projects,
    'pending_invoices', _pending_invoices,
    'total_receivable', _total_receivable,
    'total_collected', _total_collected,
    'is_admin', _is_admin
  );
END;
$$;

-- ============================================================
-- 2. ADDITIONAL AUDIT TRIGGERS (companies, approval_requests, approval_actions)
-- ============================================================

CREATE TRIGGER trg_audit_companies
  AFTER INSERT OR UPDATE OR DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER trg_audit_approval_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER trg_audit_approval_actions
  AFTER INSERT OR UPDATE OR DELETE ON public.approval_actions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ============================================================
-- 3. RELAX PHONE VALIDATION (E.164: + followed by 1-15 digits, min 6 total)
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- E.164: + followed by 1-15 digits, practical minimum ~6 digits
  IF NEW.phone IS NOT NULL AND NEW.phone != '' AND NEW.phone !~ '^\+[1-9]\d{4,13}$' THEN
    RAISE EXCEPTION 'Phone must be in E.164 international format (e.g. +8801712345678), got: %', NEW.phone;
  END IF;
  RETURN NEW;
END;
$$;
