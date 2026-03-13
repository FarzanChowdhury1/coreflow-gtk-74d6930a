
-- Create workspace_invites table
CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'team_member'::app_role,
  invited_by uuid NOT NULL,
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid
);

-- Prevent duplicate pending invites for same email in same workspace
CREATE UNIQUE INDEX workspace_invites_pending_unique
  ON public.workspace_invites (workspace_id, lower(email))
  WHERE status = 'pending';

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- Admins can fully manage invites in their workspace
CREATE POLICY "Admins can manage invites"
  ON public.workspace_invites FOR ALL TO authenticated
  USING (public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

-- Authenticated users can see invites addressed to their email
CREATE POLICY "Users can view invites for their email"
  ON public.workspace_invites FOR SELECT TO authenticated
  USING (lower(email) = lower((SELECT auth.jwt()->>'email')));

-- Secure RPC to accept an invite
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(_invite_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _user_email text;
  _invite record;
  _membership_id uuid;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  _user_email := lower(auth.jwt()->>'email');

  SELECT * INTO _invite FROM public.workspace_invites WHERE id = _invite_id;

  IF _invite IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invite not found');
  END IF;

  IF _invite.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Invite already ' || _invite.status);
  END IF;

  IF _invite.expires_at < now() THEN
    RETURN json_build_object('success', false, 'error', 'Invite has expired');
  END IF;

  IF lower(_invite.email) != _user_email THEN
    RETURN json_build_object('success', false, 'error', 'Email does not match invite');
  END IF;

  -- Prevent duplicate membership
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = _user_id AND workspace_id = _invite.workspace_id
  ) THEN
    UPDATE public.workspace_invites
    SET status = 'accepted', accepted_at = now(), accepted_by = _user_id
    WHERE id = _invite_id;
    RETURN json_build_object('success', true, 'already_member', true, 'workspace_id', _invite.workspace_id);
  END IF;

  -- Create membership with invited role
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
  VALUES (_invite.workspace_id, _user_id, _invite.role)
  RETURNING id INTO _membership_id;

  -- Mark invite as accepted
  UPDATE public.workspace_invites
  SET status = 'accepted', accepted_at = now(), accepted_by = _user_id
  WHERE id = _invite_id;

  RETURN json_build_object('success', true, 'workspace_id', _invite.workspace_id, 'membership_id', _membership_id);
END;
$$;
