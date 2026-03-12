
-- Disable RLS on portal_tokens (system table, accessed only by service_role edge functions)
DROP POLICY IF EXISTS "Members can insert portal tokens" ON public.portal_tokens;
DROP POLICY IF EXISTS "Members can update portal tokens" ON public.portal_tokens;
DROP POLICY IF EXISTS "Members can view portal tokens" ON public.portal_tokens;
ALTER TABLE public.portal_tokens DISABLE ROW LEVEL SECURITY;
