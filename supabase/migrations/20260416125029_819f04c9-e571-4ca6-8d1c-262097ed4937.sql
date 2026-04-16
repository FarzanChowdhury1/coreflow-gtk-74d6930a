-- Tighten client_errors INSERT to require user_id = auth.uid()
DROP POLICY IF EXISTS "Service insert client errors" ON public.client_errors;
CREATE POLICY "Authenticated users insert own errors" ON public.client_errors
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);