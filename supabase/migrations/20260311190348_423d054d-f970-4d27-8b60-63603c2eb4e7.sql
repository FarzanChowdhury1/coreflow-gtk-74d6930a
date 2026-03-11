
-- =============================================================
-- Phase 2: Leads, Companies, Contacts
-- All tenant-scoped via workspace_id as leading column
-- =============================================================

-- 1. Lead status enum
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'unqualified', 'converted');

-- 2. Companies — verified commercial stakeholder records
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  bin TEXT NOT NULL,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT companies_bin_length CHECK (char_length(bin) = 13 AND bin ~ '^[0-9A-Za-z]{13}$')
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Leading workspace_id index for RLS performance
CREATE INDEX idx_companies_workspace ON public.companies(workspace_id);
CREATE UNIQUE INDEX idx_companies_workspace_bin ON public.companies(workspace_id, bin) WHERE deleted_at IS NULL;

-- 3. Contacts — human identifier linked to company
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  designation TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT contacts_phone_international CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$')
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contacts_workspace ON public.contacts(workspace_id);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);

-- 4. Leads — pre-sales momentum tracking
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status public.lead_status NOT NULL DEFAULT 'new',
  source TEXT,
  estimated_value NUMERIC(15,2),
  currency TEXT NOT NULL DEFAULT 'BDT',
  notes TEXT,
  next_follow_up TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_leads_workspace ON public.leads(workspace_id);
CREATE INDEX idx_leads_owner ON public.leads(owner_id);
CREATE INDEX idx_leads_status ON public.leads(workspace_id, status);

-- 5. Updated_at triggers
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. RLS Policies — Companies (all workspace members can read, workspace-scoped)
CREATE POLICY "Members can view companies in their workspace"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can insert companies"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
  );

CREATE POLICY "Members can update companies"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

-- Only admins can soft-delete (spec: admin-only for BIN config)
CREATE POLICY "Admins can delete companies"
  ON public.companies FOR DELETE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- 7. RLS Policies — Contacts
CREATE POLICY "Members can view contacts in their workspace"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can insert contacts"
  ON public.contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
  );

CREATE POLICY "Members can update contacts"
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Admins can delete contacts"
  ON public.contacts FOR DELETE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- 8. RLS Policies — Leads
CREATE POLICY "Members can view leads in their workspace"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can insert leads"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
  );

CREATE POLICY "Members can update leads"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Admins can delete leads"
  ON public.leads FOR DELETE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );
