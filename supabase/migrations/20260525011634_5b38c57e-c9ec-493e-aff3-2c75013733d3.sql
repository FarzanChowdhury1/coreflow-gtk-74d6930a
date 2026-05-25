-- Lock down sensitive admin-only RPCs: revoke from anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.get_workspace_doc_identity(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.workspace_doc_identity_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_doc_identity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_doc_identity_ready(uuid) TO authenticated;

-- Patch has_module_access to also exclude soft-deleted workspaces, so module
-- grants do not survive a workspace deactivation.
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _workspace_id uuid, _module workspace_module)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      JOIN public.workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = _workspace_id
        AND wm.user_id = _user_id
        AND w.deleted_at IS NULL
    )
    AND (
      public.has_workspace_role(_user_id, _workspace_id, 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.workspace_module_access wma
        WHERE wma.workspace_id = _workspace_id
          AND wma.user_id = _user_id
          AND wma.module = _module
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) TO authenticated;