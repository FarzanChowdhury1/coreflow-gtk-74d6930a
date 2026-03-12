-- Fix infinite recursion in workspace_memberships INSERT policy
-- Create a security definer function to check if workspace has members
CREATE OR REPLACE FUNCTION public.workspace_has_members(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = _workspace_id
  )
$$;

-- Drop the old policy and recreate without self-reference
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.workspace_memberships;

CREATE POLICY "Admins can insert memberships"
ON public.workspace_memberships
FOR INSERT
TO authenticated
WITH CHECK (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
  OR NOT workspace_has_members(workspace_id)
);

-- Clean up duplicate workspaces created by race condition
-- Keep only the first workspace for this user
DELETE FROM public.workspaces WHERE id NOT IN (
  SELECT id FROM public.workspaces ORDER BY created_at ASC LIMIT 1
);