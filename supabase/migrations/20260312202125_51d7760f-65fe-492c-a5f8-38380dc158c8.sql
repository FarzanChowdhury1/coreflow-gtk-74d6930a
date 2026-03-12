-- Restrict line item DELETE to admins, matching parent table protection
DROP POLICY IF EXISTS "Members can delete proposal line items" ON public.proposal_line_items;
CREATE POLICY "Admins can delete proposal line items" ON public.proposal_line_items
  FOR DELETE TO authenticated
  USING (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Members can delete invoice line items" ON public.invoice_line_items;
CREATE POLICY "Admins can delete invoice line items" ON public.invoice_line_items
  FOR DELETE TO authenticated
  USING (has_workspace_role(( SELECT auth.uid()), workspace_id, 'admin'::app_role));
