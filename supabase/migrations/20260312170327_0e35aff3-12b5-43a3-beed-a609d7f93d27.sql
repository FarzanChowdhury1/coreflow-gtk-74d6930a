-- Atomic workspace bootstrapping function
CREATE OR REPLACE FUNCTION public.bootstrap_workspace(_user_id uuid, _name text DEFAULT 'My Workspace')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws_id uuid;
  _membership_id uuid;
BEGIN
  -- Create workspace
  INSERT INTO public.workspaces (name) VALUES (_name) RETURNING id INTO _ws_id;
  
  -- Create admin membership
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
  VALUES (_ws_id, _user_id, 'admin')
  RETURNING id INTO _membership_id;
  
  RETURN json_build_object(
    'workspace_id', _ws_id,
    'membership_id', _membership_id
  );
END;
$$;

-- Clean up orphan workspaces again
DELETE FROM public.workspaces
WHERE id NOT IN (
  SELECT DISTINCT workspace_id FROM public.workspace_memberships
);