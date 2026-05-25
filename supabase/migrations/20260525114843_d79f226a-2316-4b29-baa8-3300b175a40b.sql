
CREATE OR REPLACE FUNCTION public.has_module_access(
  _user_id uuid,
  _workspace_id uuid,
  _module public.workspace_module
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _user_id IS NULL OR _workspace_id IS NULL OR _module IS NULL THEN
    RETURN false;
  END IF;

  -- Workspace must exist and not be soft-deleted
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = _workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  -- Platform admins bypass
  IF public.is_platform_admin(_user_id) THEN
    RETURN true;
  END IF;

  -- Workspace admins bypass module-specific grants
  IF public.has_workspace_role(_user_id, _workspace_id, 'admin'::public.app_role) THEN
    RETURN true;
  END IF;

  -- Non-admin members require:
  --   1. active workspace membership/access
  --   2. an explicit row in workspace_module_access for this module
  RETURN public.has_workspace_access(_user_id, _workspace_id)
    AND EXISTS (
      SELECT 1
      FROM public.workspace_module_access wma
      WHERE wma.workspace_id = _workspace_id
        AND wma.user_id      = _user_id
        AND wma.module       = _module
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) TO authenticated;
