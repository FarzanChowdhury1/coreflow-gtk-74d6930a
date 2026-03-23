-- Fix 1: invoices - team members should only see project-scoped invoices they're members of
-- Remove the policy that leaks NULL-project invoices to all members
DROP POLICY IF EXISTS "Team members can view project-scoped invoices" ON public.invoices;
CREATE POLICY "Team members can view project-scoped invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND project_id IS NOT NULL
    AND is_project_member((SELECT auth.uid()), project_id)
  );

-- Fix 2: invoice_line_items - same leak via parent invoice join
DROP POLICY IF EXISTS "Team members can view project-scoped invoice line items" ON public.invoice_line_items;
CREATE POLICY "Team members can view project-scoped invoice line items"
  ON public.invoice_line_items FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.deleted_at IS NULL
        AND i.project_id IS NOT NULL
        AND is_project_member((SELECT auth.uid()), i.project_id)
    )
  );

-- Fix 3: payments - same leak via parent invoice join
DROP POLICY IF EXISTS "Team members can view project-scoped payments" ON public.payments;
CREATE POLICY "Team members can view project-scoped payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payments.invoice_id
        AND i.deleted_at IS NULL
        AND i.project_id IS NOT NULL
        AND is_project_member((SELECT auth.uid()), i.project_id)
    )
  );

-- Fix 4: invoice_sequences - restrict INSERT/UPDATE to admin only
DROP POLICY IF EXISTS "Members can insert invoice sequences" ON public.invoice_sequences;
CREATE POLICY "Admins can insert invoice sequences"
  ON public.invoice_sequences FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

DROP POLICY IF EXISTS "Members can update invoice sequences" ON public.invoice_sequences;
CREATE POLICY "Admins can update invoice sequences"
  ON public.invoice_sequences FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));