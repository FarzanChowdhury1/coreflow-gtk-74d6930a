-- Add explicit deny-all policies on portal_tokens for defense-in-depth
CREATE POLICY "Deny all direct select" ON public.portal_tokens FOR SELECT TO authenticated USING (false);
CREATE POLICY "Deny all direct insert" ON public.portal_tokens FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny all direct update" ON public.portal_tokens FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Deny all direct delete" ON public.portal_tokens FOR DELETE TO authenticated USING (false);