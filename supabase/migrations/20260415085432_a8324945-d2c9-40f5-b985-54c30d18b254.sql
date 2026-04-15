
-- Harden has_workspace_access: reject deactivated workspaces
CREATE OR REPLACE FUNCTION public.has_workspace_access(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      JOIN public.workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = _user_id
        AND wm.workspace_id = _workspace_id
        AND w.deleted_at IS NULL
    )
  END
$$;

-- Harden has_workspace_role: reject deactivated workspaces
CREATE OR REPLACE FUNCTION public.has_workspace_role(_user_id uuid, _workspace_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      JOIN public.workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = _user_id
        AND wm.workspace_id = _workspace_id
        AND wm.role = _role
        AND w.deleted_at IS NULL
    )
  END
$$;
