-- Harden RLS helper functions: prevent probing arbitrary user memberships via RPC
-- Add guard: if _user_id != auth.uid(), return false immediately
-- This is safe because all callers (RLS policies + SECURITY DEFINER functions) always pass auth.uid()

CREATE OR REPLACE FUNCTION public.has_workspace_access(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.workspace_memberships
      WHERE user_id = _user_id
        AND workspace_id = _workspace_id
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_user_id uuid, _workspace_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.workspace_memberships
      WHERE user_id = _user_id
        AND workspace_id = _workspace_id
        AND role = _role
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.project_members
      WHERE user_id = _user_id AND project_id = _project_id
    )
  END
$$;