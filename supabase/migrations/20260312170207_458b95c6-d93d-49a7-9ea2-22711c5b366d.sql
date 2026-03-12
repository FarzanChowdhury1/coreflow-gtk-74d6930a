-- Clean up ALL orphan workspaces with no memberships
DELETE FROM public.workspaces
WHERE id NOT IN (
  SELECT DISTINCT workspace_id FROM public.workspace_memberships
);