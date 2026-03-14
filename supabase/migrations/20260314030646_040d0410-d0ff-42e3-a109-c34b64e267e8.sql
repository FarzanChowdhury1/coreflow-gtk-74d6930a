
-- Restrict financial table SELECT policies to scope team members by project assignment
-- Pattern: Admins see all workspace records, team members see only project-scoped records

-- 1. INVOICES: Drop broad SELECT, add admin + team member policies
DROP POLICY IF EXISTS "Members can view invoices in their workspace" ON public.invoices;

CREATE POLICY "Admins can view all workspace invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role) AND deleted_at IS NULL);

CREATE POLICY "Team members can view project-scoped invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND (project_id IS NULL OR is_project_member((SELECT auth.uid()), project_id))
  );

-- 2. INVOICE_LINE_ITEMS: Drop broad SELECT, add admin + team member policies
DROP POLICY IF EXISTS "Members can view invoice line items" ON public.invoice_line_items;

CREATE POLICY "Admins can view all invoice line items"
  ON public.invoice_line_items FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Team members can view project-scoped invoice line items"
  ON public.invoice_line_items FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.deleted_at IS NULL
        AND (i.project_id IS NULL OR is_project_member((SELECT auth.uid()), i.project_id))
    )
  );

-- 3. PAYMENTS: Drop broad SELECT, add admin + team member policies
DROP POLICY IF EXISTS "Members can view payments" ON public.payments;

CREATE POLICY "Admins can view all payments"
  ON public.payments FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Team members can view project-scoped payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = payments.invoice_id
        AND i.deleted_at IS NULL
        AND (i.project_id IS NULL OR is_project_member((SELECT auth.uid()), i.project_id))
    )
  );
