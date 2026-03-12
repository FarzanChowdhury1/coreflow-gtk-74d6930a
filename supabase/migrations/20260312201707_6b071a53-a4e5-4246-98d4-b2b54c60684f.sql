-- Fix approval_actions: only the designated step approver can insert
DROP POLICY IF EXISTS "Members can insert approval actions" ON public.approval_actions;
CREATE POLICY "Designated approvers can insert actions" ON public.approval_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid()), workspace_id)
    AND actor_id = ( SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM approval_requests ar
      JOIN approval_steps ast ON ast.workflow_id = ar.workflow_id AND ast.step_order = ar.current_step
      WHERE ar.id = approval_actions.request_id
        AND ast.approver_id = ( SELECT auth.uid())
    )
  );

-- Fix approval_requests: only admins can update (the RPC handles workflow advancement)
DROP POLICY IF EXISTS "Members can update approval requests" ON public.approval_requests;
CREATE POLICY "Admins can update approval requests" ON public.approval_requests
  FOR UPDATE TO authenticated
  USING (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role));

-- Remove the bootstrap path from workspace_memberships INSERT
-- The bootstrap_workspace RPC (SECURITY DEFINER) bypasses RLS,
-- so only admin-initiated inserts should go through the policy
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.workspace_memberships;
CREATE POLICY "Admins can insert memberships" ON public.workspace_memberships
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role));
