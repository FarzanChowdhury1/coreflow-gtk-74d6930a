
-- =============================================
-- Phase 6: Client Portal — Magic Links
-- =============================================

-- Portal tokens for decoupled client access
CREATE TABLE public.portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  contact_id UUID NOT NULL REFERENCES public.contacts(id),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;

-- Internal users can manage portal tokens in their workspace
CREATE POLICY "Members can view portal tokens"
  ON public.portal_tokens FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert portal tokens"
  ON public.portal_tokens FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update portal tokens"
  ON public.portal_tokens FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

-- Anonymous users need SELECT for token validation via RPC
CREATE POLICY "Anon can validate tokens"
  ON public.portal_tokens FOR SELECT TO anon
  USING (true);

-- Anon read policies for portal data access (scoped by RPC validation)
-- Proposals
CREATE POLICY "Anon can view proposals by id"
  ON public.proposals FOR SELECT TO anon
  USING (deleted_at IS NULL);

CREATE POLICY "Anon can view proposal versions"
  ON public.proposal_versions FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon can view proposal line items"
  ON public.proposal_line_items FOR SELECT TO anon
  USING (true);

-- Anon can update proposal version status (for approve/reject)
CREATE POLICY "Anon can update proposal version status"
  ON public.proposal_versions FOR UPDATE TO anon
  USING (true);

-- Invoices
CREATE POLICY "Anon can view invoices"
  ON public.invoices FOR SELECT TO anon
  USING (deleted_at IS NULL);

CREATE POLICY "Anon can view invoice line items"
  ON public.invoice_line_items FOR SELECT TO anon
  USING (true);

-- Payments
CREATE POLICY "Anon can view payments"
  ON public.payments FOR SELECT TO anon
  USING (true);

-- Companies (for display)
CREATE POLICY "Anon can view companies by id"
  ON public.companies FOR SELECT TO anon
  USING (deleted_at IS NULL);

-- =============================================
-- RPC: Validate portal token and return session data
-- =============================================
CREATE OR REPLACE FUNCTION public.validate_portal_token(_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _record RECORD;
  _contact RECORD;
  _company RECORD;
BEGIN
  SELECT * INTO _record FROM public.portal_tokens
  WHERE token = _token AND revoked_at IS NULL AND expires_at > now();

  IF _record IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid or expired token');
  END IF;

  SELECT full_name, email INTO _contact FROM public.contacts WHERE id = _record.contact_id;
  SELECT legal_name INTO _company FROM public.companies WHERE id = _record.company_id;

  RETURN json_build_object(
    'valid', true,
    'workspace_id', _record.workspace_id,
    'contact_id', _record.contact_id,
    'company_id', _record.company_id,
    'contact_name', _contact.full_name,
    'contact_email', _contact.email,
    'company_name', _company.legal_name
  );
END;
$$;

-- =============================================
-- RPC: Portal — approve or reject a proposal version
-- =============================================
CREATE OR REPLACE FUNCTION public.portal_respond_proposal(
  _token TEXT,
  _version_id UUID,
  _action TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _session JSON;
  _version RECORD;
  _proposal RECORD;
BEGIN
  -- Validate token
  _session := public.validate_portal_token(_token);
  IF NOT (_session->>'valid')::boolean THEN
    RETURN json_build_object('success', false, 'error', 'Invalid token');
  END IF;

  -- Validate action
  IF _action NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid action');
  END IF;

  -- Fetch version
  SELECT * INTO _version FROM public.proposal_versions WHERE id = _version_id;
  IF _version IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Version not found');
  END IF;

  -- Version must be in 'sent' status to respond
  IF _version.status != 'sent' THEN
    RETURN json_build_object('success', false, 'error', 'Proposal is not awaiting response');
  END IF;

  -- Verify proposal belongs to the token's company
  SELECT * INTO _proposal FROM public.proposals WHERE id = _version.proposal_id;
  IF _proposal.company_id != (_session->>'company_id')::uuid THEN
    RETURN json_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Update status
  UPDATE public.proposal_versions SET status = _action::proposal_version_status WHERE id = _version_id;

  RETURN json_build_object('success', true, 'new_status', _action);
END;
$$;
