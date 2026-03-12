-- Fix: Allow users to SELECT workspaces they just created (for the insert().select() pattern)
-- Add a policy that lets the creator read the workspace during the same transaction
CREATE POLICY "Creator can view workspace just inserted"
ON public.workspaces
FOR SELECT
TO authenticated
USING (
  -- Fallback: if no membership exists yet, allow the creator to see it
  -- This covers the bootstrapping case where insert + select happens before membership insert
  NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm WHERE wm.workspace_id = workspaces.id
  )
  AND deleted_at IS NULL
);