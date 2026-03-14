-- Add explicit deny-all policies on portal_failed_attempts for defense-in-depth
CREATE POLICY "Deny all direct select" ON public.portal_failed_attempts FOR SELECT TO authenticated USING (false);
CREATE POLICY "Deny all direct insert" ON public.portal_failed_attempts FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny all direct update" ON public.portal_failed_attempts FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Deny all direct delete" ON public.portal_failed_attempts FOR DELETE TO authenticated USING (false);