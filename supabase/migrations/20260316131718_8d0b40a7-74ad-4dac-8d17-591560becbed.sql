
CREATE OR REPLACE FUNCTION public.count_portal_tokens(_workspace_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.portal_tokens
  WHERE workspace_id = _workspace_id
    AND revoked_at IS NULL;
$$;
