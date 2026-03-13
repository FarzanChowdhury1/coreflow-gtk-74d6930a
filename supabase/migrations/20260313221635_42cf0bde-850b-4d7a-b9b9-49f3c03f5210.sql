
-- Defence-in-depth: revoke all grants from authenticated and anon on service-role-only tables
REVOKE ALL ON public.portal_tokens FROM authenticated, anon;
REVOKE ALL ON public.portal_failed_attempts FROM authenticated, anon;
