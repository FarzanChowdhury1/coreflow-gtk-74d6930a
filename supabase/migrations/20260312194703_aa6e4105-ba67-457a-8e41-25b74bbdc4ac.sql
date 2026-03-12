-- Fix approval_actions: enforce actor_id = auth.uid()
DROP POLICY IF EXISTS "Members can insert approval actions" ON public.approval_actions;
CREATE POLICY "Members can insert approval actions" ON public.approval_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid()), workspace_id)
    AND actor_id = ( SELECT auth.uid())
  );

-- Fix notifications: prevent targeting arbitrary users
DROP POLICY IF EXISTS "Members can insert notifications" ON public.notifications;
CREATE POLICY "Members can insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid()), workspace_id)
    AND user_id = ( SELECT auth.uid())
  );

-- Fix audit_logs: enforce actor_id = auth.uid()
DROP POLICY IF EXISTS "Members can insert audit logs" ON public.audit_logs;
CREATE POLICY "Members can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid()), workspace_id)
    AND actor_id = ( SELECT auth.uid())
  );

-- Fix workspace takeover: restrict bootstrap INSERT to require user_id = auth.uid()
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.workspace_memberships;
CREATE POLICY "Admins can insert memberships" ON public.workspace_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role))
    OR (NOT workspace_has_members(workspace_id) AND user_id = ( SELECT auth.uid()))
  );
