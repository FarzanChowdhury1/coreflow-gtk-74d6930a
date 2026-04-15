
-- 1. Create the shared helper function
CREATE OR REPLACE FUNCTION public.workspace_has_active_feature(
  _workspace_id uuid,
  _feature text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Enterprise always has all features
    WHEN w.plan = 'enterprise' THEN true
    -- Growth with no trial_ends_at = paid subscription, all features
    WHEN w.plan = 'growth' AND w.trial_ends_at IS NULL THEN true
    -- Growth with active trial = features available
    WHEN w.plan = 'growth' AND w.trial_ends_at > now() THEN true
    -- Growth with expired trial = treated as free
    WHEN w.plan = 'growth' AND w.trial_ends_at <= now() THEN false
    -- Free plan = no growth features
    ELSE false
  END
  FROM workspaces w
  WHERE w.id = _workspace_id;
$$;

-- ============================================================
-- 2. EXPENSES — replace ALL policy with separate read/write
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage expenses" ON expenses;

CREATE POLICY "Admins can view expenses"
  ON expenses FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins can insert expenses"
  ON expenses FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'expenseTracking')
  );

CREATE POLICY "Admins can update expenses"
  ON expenses FOR UPDATE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'expenseTracking')
  );

CREATE POLICY "Admins can delete expenses"
  ON expenses FOR DELETE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'expenseTracking')
  );

-- ============================================================
-- 3. VENDORS — replace ALL policy with separate read/write
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage vendors" ON vendors;

CREATE POLICY "Admins can view all vendors"
  ON vendors FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- Keep existing member read policy untouched (Members can view active vendors)

CREATE POLICY "Admins can insert vendors"
  ON vendors FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

CREATE POLICY "Admins can update vendors"
  ON vendors FOR UPDATE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

CREATE POLICY "Admins can delete vendors"
  ON vendors FOR DELETE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

-- ============================================================
-- 4. SUBSCRIPTIONS — replace ALL policy with separate read/write
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage subscriptions" ON subscriptions;

CREATE POLICY "Admins can view subscriptions"
  ON subscriptions FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins can insert subscriptions"
  ON subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );

CREATE POLICY "Admins can update subscriptions"
  ON subscriptions FOR UPDATE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );

CREATE POLICY "Admins can delete subscriptions"
  ON subscriptions FOR DELETE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );

-- ============================================================
-- 5. BUDGETS — replace ALL policy with separate read/write
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage budgets" ON budgets;

CREATE POLICY "Admins can view budgets"
  ON budgets FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins can insert budgets"
  ON budgets FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'budgetVsActual')
  );

CREATE POLICY "Admins can update budgets"
  ON budgets FOR UPDATE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'budgetVsActual')
  );

CREATE POLICY "Admins can delete budgets"
  ON budgets FOR DELETE TO authenticated
  USING (
    has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'budgetVsActual')
  );

-- ============================================================
-- 6. APPROVAL_WORKFLOWS — update existing write policies
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert workflows" ON approval_workflows;
DROP POLICY IF EXISTS "Admins can update workflows" ON approval_workflows;
DROP POLICY IF EXISTS "Admins can delete workflows" ON approval_workflows;

CREATE POLICY "Admins can insert workflows"
  ON approval_workflows FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

CREATE POLICY "Admins can update workflows"
  ON approval_workflows FOR UPDATE TO authenticated
  USING (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

CREATE POLICY "Admins can delete workflows"
  ON approval_workflows FOR DELETE TO authenticated
  USING (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

-- ============================================================
-- 7. APPROVAL_STEPS — update existing write policies
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert approval steps" ON approval_steps;
DROP POLICY IF EXISTS "Admins can update approval steps" ON approval_steps;
DROP POLICY IF EXISTS "Admins can delete approval steps" ON approval_steps;

CREATE POLICY "Admins can insert approval steps"
  ON approval_steps FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

CREATE POLICY "Admins can update approval steps"
  ON approval_steps FOR UPDATE TO authenticated
  USING (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

CREATE POLICY "Admins can delete approval steps"
  ON approval_steps FOR DELETE TO authenticated
  USING (
    has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

-- ============================================================
-- 8. APPROVAL_REQUESTS — update INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "Members can insert approval requests" ON approval_requests;

CREATE POLICY "Members can insert approval requests"
  ON approval_requests FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid() AS uid), workspace_id)
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
  );

-- ============================================================
-- 9. APPROVAL_ACTIONS — update INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "Designated approvers can insert actions" ON approval_actions;

CREATE POLICY "Designated approvers can insert actions"
  ON approval_actions FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(( SELECT auth.uid() AS uid), workspace_id)
    AND (actor_id = ( SELECT auth.uid() AS uid))
    AND workspace_has_active_feature(workspace_id, 'approvalWorkflows')
    AND (EXISTS (
      SELECT 1
      FROM approval_requests ar
      JOIN approval_steps ast ON ast.workflow_id = ar.workflow_id AND ast.step_order = ar.current_step
      WHERE ar.id = approval_actions.request_id AND ast.approver_id = ( SELECT auth.uid() AS uid)
    ))
  );
