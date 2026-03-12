-- Fix: enforce role = 'team_member' on bootstrap path to prevent admin self-escalation
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.workspace_memberships;
CREATE POLICY "Admins can insert memberships" ON public.workspace_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role))
    OR (NOT workspace_has_members(workspace_id) AND user_id = ( SELECT auth.uid()) AND role = 'team_member'::app_role)
  );
