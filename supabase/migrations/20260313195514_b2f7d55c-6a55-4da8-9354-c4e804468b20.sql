
DROP POLICY "Team members can insert updates for assigned projects" ON public.client_updates;

CREATE POLICY "Team members can insert updates for assigned projects"
ON public.client_updates
FOR INSERT
TO authenticated
WITH CHECK (
  has_workspace_access((SELECT auth.uid()), workspace_id)
  AND is_project_member((SELECT auth.uid()), project_id)
  AND author_id = (SELECT auth.uid())
);
