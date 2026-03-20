-- Tighten unlinked contacts: non-admins should NOT see contacts without a company
-- unless linked through company access (which requires company_id to be non-null)
DROP POLICY IF EXISTS "Members can view accessible contacts" ON public.contacts;

CREATE POLICY "Members can view accessible contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (
  has_workspace_access(( SELECT auth.uid() AS uid), workspace_id)
  AND (deleted_at IS NULL)
  AND (company_id IS NOT NULL)
  AND has_company_access(( SELECT auth.uid() AS uid), company_id)
);

-- Also update admin policies to allow viewing archived records
DROP POLICY IF EXISTS "Admins can view all companies" ON public.companies;
CREATE POLICY "Admins can view all companies"
ON public.companies
FOR SELECT
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
);

DROP POLICY IF EXISTS "Admins can view all contacts" ON public.contacts;
CREATE POLICY "Admins can view all contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
);

-- Update admin update policies to allow archiving (updating deleted_at)
DROP POLICY IF EXISTS "Admins can update companies" ON public.companies;
CREATE POLICY "Admins can update companies"
ON public.companies
FOR UPDATE
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
);

DROP POLICY IF EXISTS "Admins can update contacts" ON public.contacts;
CREATE POLICY "Admins can update contacts"
ON public.contacts
FOR UPDATE
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
);

-- Allow leads update for archiving (remove deleted_at IS NULL constraint)
DROP POLICY IF EXISTS "Members can update leads" ON public.leads;
CREATE POLICY "Members can update leads"
ON public.leads
FOR UPDATE
TO authenticated
USING (
  has_workspace_access(( SELECT auth.uid() AS uid), workspace_id)
);

-- Allow admins to view archived leads
DROP POLICY IF EXISTS "Admins can view all leads" ON public.leads;
CREATE POLICY "Admins can view all leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
);