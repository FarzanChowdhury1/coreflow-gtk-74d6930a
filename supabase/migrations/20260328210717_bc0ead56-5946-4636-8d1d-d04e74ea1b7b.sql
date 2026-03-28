REVOKE EXECUTE ON FUNCTION public.get_onboarding_counts(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_onboarding_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_onboarding_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_onboarding_counts(uuid) TO service_role;