
-- =============================================================
-- Phase 3: Proposals, Proposal Versions, Line Items
-- Immutable commercial offer engine with tax calculations
-- =============================================================

-- 1. Proposal version status enum
CREATE TYPE public.proposal_version_status AS ENUM ('draft', 'sent', 'approved', 'rejected', 'voided');

-- 2. Proposals — static organizational referencing parent (anchor)
CREATE TABLE public.proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_proposals_workspace ON public.proposals(workspace_id);
CREATE INDEX idx_proposals_company ON public.proposals(company_id);

-- 3. Proposal Versions — immutable chronological pricing snapshots
--    Line items attach to versions, NOT to proposals (spec Section 2.8)
CREATE TABLE public.proposal_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  status public.proposal_version_status NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BDT',
  valid_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proposal_id, version_number)
);

ALTER TABLE public.proposal_versions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_proposal_versions_workspace ON public.proposal_versions(workspace_id);
CREATE INDEX idx_proposal_versions_proposal ON public.proposal_versions(proposal_id);

-- 4. Proposal Line Items — version-bound delivery scope
--    Keys attach to immutable version, NOT to proposal (spec Section 2.8)
CREATE TABLE public.proposal_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.proposal_versions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_line_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_proposal_line_items_workspace ON public.proposal_line_items(workspace_id);
CREATE INDEX idx_proposal_line_items_version ON public.proposal_line_items(version_id);

-- 5. Updated_at triggers
CREATE TRIGGER update_proposals_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_proposal_versions_updated_at
  BEFORE UPDATE ON public.proposal_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_proposal_line_items_updated_at
  BEFORE UPDATE ON public.proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. IMMUTABILITY TRIGGER — reject updates to sent/approved/rejected versions
--    Only allow status change to 'voided' by admin (spec Section 2.13)
CREATE OR REPLACE FUNCTION public.enforce_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- If version is already locked (sent, approved, rejected), block updates
  -- Exception: status change to 'voided' is allowed (admin emergency override)
  IF OLD.status IN ('sent', 'approved', 'rejected') THEN
    IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
      -- Allow voiding only
      NEW.subtotal := OLD.subtotal;
      NEW.tax_config := OLD.tax_config;
      NEW.tax_total := OLD.tax_total;
      NEW.grand_total := OLD.grand_total;
      NEW.currency := OLD.currency;
      NEW.notes := OLD.notes;
      NEW.version_number := OLD.version_number;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify a proposal version with status: %', OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_proposal_version_immutability
  BEFORE UPDATE ON public.proposal_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_version_immutability();

-- 7. IMMUTABILITY TRIGGER — reject line item changes on locked versions
CREATE OR REPLACE FUNCTION public.enforce_line_item_immutability()
RETURNS TRIGGER AS $$
DECLARE
  version_status public.proposal_version_status;
BEGIN
  -- For INSERT or UPDATE, check the version status
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO version_status FROM public.proposal_versions WHERE id = OLD.version_id;
  ELSE
    SELECT status INTO version_status FROM public.proposal_versions WHERE id = NEW.version_id;
  END IF;

  IF version_status IN ('sent', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Cannot modify line items on a locked proposal version (status: %)', version_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_line_item_version_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_line_item_immutability();

-- 8. RLS Policies — Proposals
CREATE POLICY "Members can view proposals in their workspace"
  ON public.proposals FOR SELECT TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Members can insert proposals"
  ON public.proposals FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update proposals"
  ON public.proposals FOR UPDATE TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Admins can delete proposals"
  ON public.proposals FOR DELETE TO authenticated
  USING (public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- 9. RLS Policies — Proposal Versions
CREATE POLICY "Members can view proposal versions"
  ON public.proposal_versions FOR SELECT TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert proposal versions"
  ON public.proposal_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update proposal versions"
  ON public.proposal_versions FOR UPDATE TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id));

-- 10. RLS Policies — Proposal Line Items
CREATE POLICY "Members can view proposal line items"
  ON public.proposal_line_items FOR SELECT TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert proposal line items"
  ON public.proposal_line_items FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update proposal line items"
  ON public.proposal_line_items FOR UPDATE TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can delete proposal line items"
  ON public.proposal_line_items FOR DELETE TO authenticated
  USING (public.has_workspace_access((SELECT auth.uid()), workspace_id));
