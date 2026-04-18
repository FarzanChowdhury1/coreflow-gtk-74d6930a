-- Batch C: extend lead visibility for company-less leads via task linkage
-- Without weakening tenancy: non-admin team members can see a lead if they
-- own it, have company access, OR are linked through any lead_task they
-- created or are assigned to. Admins continue to see everything.

DROP POLICY IF EXISTS "Team members can view relevant leads" ON public.leads;

CREATE POLICY "Team members can view relevant leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
  has_workspace_access((SELECT auth.uid()), workspace_id)
  AND (deleted_at IS NULL)
  AND (
    (owner_id = (SELECT auth.uid()))
    OR (
      company_id IS NOT NULL
      AND has_company_access((SELECT auth.uid()), company_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lead_tasks lt
      WHERE lt.lead_id = leads.id
        AND (
          lt.assigned_to = (SELECT auth.uid())
          OR lt.created_by = (SELECT auth.uid())
        )
    )
  )
);