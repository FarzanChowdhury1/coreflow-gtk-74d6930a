
-- 1. Add owner_id to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT NULL;

-- 2. Create company_access table for explicit collaborator grants
CREATE TABLE IF NOT EXISTS public.company_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  granted_by uuid DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);

ALTER TABLE public.company_access ENABLE ROW LEVEL SECURITY;

-- RLS for company_access: admins full, members can view own grants
CREATE POLICY "Admins can manage company access"
  ON public.company_access FOR ALL
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

CREATE POLICY "Members can view own access grants"
  ON public.company_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 3. Create has_company_access helper function
CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Must be the calling user
    _user_id = (SELECT auth.uid())
    AND (
      -- Admin in the company's workspace
      EXISTS (
        SELECT 1 FROM public.companies c
        JOIN public.workspace_memberships wm ON wm.workspace_id = c.workspace_id
        WHERE c.id = _company_id AND wm.user_id = _user_id AND wm.role = 'admin'
      )
      -- Company owner
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = _company_id AND c.owner_id = _user_id AND c.deleted_at IS NULL
      )
      -- Explicit access grant
      OR EXISTS (
        SELECT 1 FROM public.company_access ca
        WHERE ca.company_id = _company_id AND ca.user_id = _user_id
      )
      -- Project member on a project linked to this company
      OR EXISTS (
        SELECT 1 FROM public.projects p
        JOIN public.project_members pm ON pm.project_id = p.id
        WHERE p.company_id = _company_id AND pm.user_id = _user_id AND p.deleted_at IS NULL
      )
    )
  )
$$;

-- 4. Replace companies SELECT policy to scope visibility
DROP POLICY IF EXISTS "Members can view companies in their workspace" ON public.companies;

CREATE POLICY "Admins can view all companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can view accessible companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND has_company_access((SELECT auth.uid()), id)
  );

-- 5. Restrict companies INSERT/UPDATE to admins (write stays admin-only)
DROP POLICY IF EXISTS "Members can insert companies" ON public.companies;
CREATE POLICY "Admins can insert companies"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

DROP POLICY IF EXISTS "Members can update companies" ON public.companies;
CREATE POLICY "Admins can update companies"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin') AND deleted_at IS NULL);

-- 6. Replace contacts SELECT to scope via company access
DROP POLICY IF EXISTS "Members can view contacts in their workspace" ON public.contacts;

CREATE POLICY "Admins can view all contacts"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can view accessible contacts"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (
      company_id IS NULL
      OR has_company_access((SELECT auth.uid()), company_id)
    )
  );

-- Restrict contact writes to admins
DROP POLICY IF EXISTS "Members can insert contacts" ON public.contacts;
CREATE POLICY "Admins can insert contacts"
  ON public.contacts FOR INSERT
  TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

DROP POLICY IF EXISTS "Members can update contacts" ON public.contacts;
CREATE POLICY "Admins can update contacts"
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin') AND deleted_at IS NULL);

-- 7. Update leads RLS to use has_company_access for company-linked leads
DROP POLICY IF EXISTS "Team members can view relevant leads" ON public.leads;
CREATE POLICY "Team members can view relevant leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (
      owner_id = (SELECT auth.uid())
      OR (company_id IS NOT NULL AND has_company_access((SELECT auth.uid()), company_id))
    )
  );

-- 8. Update proposals RLS to use has_company_access
DROP POLICY IF EXISTS "Team members can view relevant proposals" ON public.proposals;
CREATE POLICY "Team members can view relevant proposals"
  ON public.proposals FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (
      owner_id = (SELECT auth.uid())
      OR (company_id IS NOT NULL AND has_company_access((SELECT auth.uid()), company_id))
    )
  );
