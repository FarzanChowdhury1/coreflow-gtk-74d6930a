
-- P0: Fix proposals RLS - drop the overly broad workspace-wide SELECT policy
-- that overrides the scoped "Team members can view relevant proposals" policy
DROP POLICY IF EXISTS "Members can view proposals in their workspace" ON public.proposals;

-- P0: Restrict audit_logs visibility to admin only
DROP POLICY IF EXISTS "Members can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- P0: Restrict invoice INSERT to admin only
DROP POLICY IF EXISTS "Members can insert invoices" ON public.invoices;
CREATE POLICY "Admins can insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- P0: Restrict invoice UPDATE to admin only
DROP POLICY IF EXISTS "Members can update invoices" ON public.invoices;
CREATE POLICY "Admins can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin') AND deleted_at IS NULL);

-- P0: Restrict payment INSERT to admin only
DROP POLICY IF EXISTS "Members can insert payments" ON public.payments;
CREATE POLICY "Admins can insert payments"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- P0: Restrict invoice_line_items INSERT to admin only
DROP POLICY IF EXISTS "Members can insert invoice line items" ON public.invoice_line_items;
CREATE POLICY "Admins can insert invoice line items"
  ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- P0: Restrict invoice_line_items UPDATE to admin only
DROP POLICY IF EXISTS "Members can update invoice line items" ON public.invoice_line_items;
CREATE POLICY "Admins can update invoice line items"
  ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- P0: Restrict audit_logs INSERT to admin only (prevent non-admins from writing arbitrary audit entries)
DROP POLICY IF EXISTS "Members can insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin') AND actor_id = (SELECT auth.uid()));
