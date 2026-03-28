CREATE OR REPLACE FUNCTION public.get_onboarding_counts(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships
      WHERE user_id = auth.uid() AND workspace_id = _workspace_id
    ) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'companies',     (SELECT count(*) FROM companies     WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'contacts',      (SELECT count(*) FROM contacts      WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'leads',         (SELECT count(*) FROM leads          WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'proposals',     (SELECT count(*) FROM proposals      WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'projects',      (SELECT count(*) FROM projects       WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'invoices',      (SELECT count(*) FROM invoices       WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'meetings',      (SELECT count(*) FROM meetings       WHERE workspace_id = _workspace_id),
      'vendors',       (SELECT count(*) FROM vendors        WHERE workspace_id = _workspace_id AND deleted_at IS NULL),
      'members',       (SELECT count(*) FROM workspace_memberships WHERE workspace_id = _workspace_id),
      'portal_tokens', (SELECT count(*) FROM portal_tokens  WHERE workspace_id = _workspace_id AND revoked_at IS NULL AND expires_at > now())
    )
  END;
$function$;