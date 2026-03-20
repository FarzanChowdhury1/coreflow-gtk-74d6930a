
-- 1. Add owner_id to proposals (leads already has owner_id)
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS owner_id uuid;

-- 2. Tighten leads SELECT: admin sees all, team member sees owned or project-linked
DROP POLICY IF EXISTS "Members can view leads in their workspace" ON public.leads;

CREATE POLICY "Admins can view all leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role)
    AND deleted_at IS NULL
  );

CREATE POLICY "Team members can view relevant leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (
      owner_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM projects p
        JOIN project_members pm ON pm.project_id = p.id
        WHERE p.company_id = leads.company_id
          AND p.company_id IS NOT NULL
          AND pm.user_id = (SELECT auth.uid())
          AND p.deleted_at IS NULL
      )
    )
  );

-- 3. Tighten proposals SELECT: admin sees all, team member sees owned or project-linked
-- First drop the broad members policy
DROP POLICY IF EXISTS "Members can view proposals" ON public.proposals;

CREATE POLICY "Admins can view all proposals"
  ON public.proposals FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role)
    AND deleted_at IS NULL
  );

CREATE POLICY "Team members can view relevant proposals"
  ON public.proposals FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (
      owner_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM projects p
        JOIN project_members pm ON pm.project_id = p.id
        WHERE p.company_id = proposals.company_id
          AND p.company_id IS NOT NULL
          AND pm.user_id = (SELECT auth.uid())
          AND p.deleted_at IS NULL
      )
    )
  );

-- 4. Tighten proposal_versions SELECT to match proposal scoping
DROP POLICY IF EXISTS "Members can view proposal versions" ON public.proposal_versions;

CREATE POLICY "Admins can view all proposal versions"
  ON public.proposal_versions FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role)
  );

CREATE POLICY "Team members can view relevant proposal versions"
  ON public.proposal_versions FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = proposal_versions.proposal_id
        AND p.deleted_at IS NULL
        AND (
          p.owner_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM projects pr
            JOIN project_members pm ON pm.project_id = pr.id
            WHERE pr.company_id = p.company_id
              AND p.company_id IS NOT NULL
              AND pm.user_id = (SELECT auth.uid())
              AND pr.deleted_at IS NULL
          )
        )
    )
  );

-- 5. Tighten proposal_line_items SELECT similarly
DROP POLICY IF EXISTS "Members can view proposal line items" ON public.proposal_line_items;

CREATE POLICY "Admins can view all proposal line items"
  ON public.proposal_line_items FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role)
  );

CREATE POLICY "Team members can view relevant proposal line items"
  ON public.proposal_line_items FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM proposal_versions pv
      JOIN proposals p ON p.id = pv.proposal_id
      WHERE pv.id = proposal_line_items.version_id
        AND p.deleted_at IS NULL
        AND (
          p.owner_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM projects pr
            JOIN project_members pm ON pm.project_id = pr.id
            WHERE pr.company_id = p.company_id
              AND p.company_id IS NOT NULL
              AND pm.user_id = (SELECT auth.uid())
              AND pr.deleted_at IS NULL
          )
        )
    )
  );

-- 6. Tighten lead_tasks to match lead visibility
DROP POLICY IF EXISTS "Members can view lead tasks" ON public.lead_tasks;

CREATE POLICY "Admins can view all lead tasks"
  ON public.lead_tasks FOR SELECT
  TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role)
  );

CREATE POLICY "Team members can view relevant lead tasks"
  ON public.lead_tasks FOR SELECT
  TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND (
      assigned_to = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM leads l
        WHERE l.id = lead_tasks.lead_id
          AND l.deleted_at IS NULL
          AND l.owner_id = (SELECT auth.uid())
      )
    )
  );

-- 7. Tighten client_updates SELECT for non-admin
-- Keep admin ALL policy, add scoped team member policy (already has project-scoped)
-- Already good - team members can only see updates for assigned projects
