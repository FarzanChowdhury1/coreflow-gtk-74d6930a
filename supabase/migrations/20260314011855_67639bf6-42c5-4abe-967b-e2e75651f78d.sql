
-- RPC: create_workspace_invite (admin-only, server-side)
CREATE OR REPLACE FUNCTION public.create_workspace_invite(
  _workspace_id uuid,
  _email text,
  _role app_role DEFAULT 'team_member'::app_role
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _invite_id uuid;
  _token text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Admin-only
  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Validate email
  IF _email IS NULL OR trim(_email) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Email is required');
  END IF;

  -- Validate role
  IF _role NOT IN ('admin', 'team_member') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid role');
  END IF;

  -- Check for existing pending invite (unique index handles race, but give a nice error)
  IF EXISTS (
    SELECT 1 FROM public.workspace_invites
    WHERE workspace_id = _workspace_id AND lower(email) = lower(trim(_email)) AND status = 'pending'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'A pending invite already exists for this email');
  END IF;

  -- Check if user is already a member
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    JOIN auth.users au ON au.id = wm.user_id
    WHERE wm.workspace_id = _workspace_id AND lower(au.email) = lower(trim(_email))
  ) THEN
    RETURN json_build_object('success', false, 'error', 'This user is already a member of the workspace');
  END IF;

  -- Create the invite
  INSERT INTO public.workspace_invites (workspace_id, email, role, invited_by)
  VALUES (_workspace_id, lower(trim(_email)), _role, _user_id)
  RETURNING id, token INTO _invite_id, _token;

  RETURN json_build_object('success', true, 'invite_id', _invite_id, 'token', _token);
END;
$$;

-- RPC: revoke_workspace_invite (admin-only, server-side)
CREATE OR REPLACE FUNCTION public.revoke_workspace_invite(_invite_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _invite record;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO _invite FROM public.workspace_invites WHERE id = _invite_id;

  IF _invite IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invite not found');
  END IF;

  -- Admin-only on the invite's workspace
  IF NOT public.has_workspace_role(_user_id, _invite.workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  IF _invite.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Invite is already ' || _invite.status);
  END IF;

  UPDATE public.workspace_invites
  SET status = 'revoked'
  WHERE id = _invite_id;

  RETURN json_build_object('success', true);
END;
$$;

-- RPC: resolve_invite_by_token (public-facing, returns invite details without accepting)
CREATE OR REPLACE FUNCTION public.resolve_invite_by_token(_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invite record;
  _ws record;
BEGIN
  SELECT * INTO _invite FROM public.workspace_invites WHERE token = _token;

  IF _invite IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invite not found');
  END IF;

  IF _invite.status = 'revoked' THEN
    RETURN json_build_object('valid', false, 'error', 'This invite has been revoked');
  END IF;

  IF _invite.status = 'accepted' THEN
    RETURN json_build_object('valid', false, 'error', 'This invite has already been accepted');
  END IF;

  IF _invite.status != 'pending' THEN
    RETURN json_build_object('valid', false, 'error', 'This invite is no longer valid');
  END IF;

  IF _invite.expires_at < now() THEN
    RETURN json_build_object('valid', false, 'error', 'This invite has expired');
  END IF;

  SELECT name INTO _ws FROM public.workspaces WHERE id = _invite.workspace_id AND deleted_at IS NULL;

  RETURN json_build_object(
    'valid', true,
    'invite_id', _invite.id,
    'workspace_name', COALESCE(_ws.name, 'Unknown Workspace'),
    'role', _invite.role,
    'email', _invite.email
  );
END;
$$;

-- RPC: accept_invite_by_token (authenticated user accepts via token)
CREATE OR REPLACE FUNCTION public.accept_invite_by_token(_token text)
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

  SELECT * INTO _invite FROM public.workspace_invites WHERE token = _token;

  IF _invite IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invite not found');
  END IF;

  IF _invite.status = 'revoked' THEN
    RETURN json_build_object('success', false, 'error', 'This invite has been revoked');
  END IF;

  IF _invite.status = 'accepted' THEN
    RETURN json_build_object('success', false, 'error', 'This invite has already been accepted');
  END IF;

  IF _invite.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'This invite is no longer valid');
  END IF;

  IF _invite.expires_at < now() THEN
    RETURN json_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  IF lower(_invite.email) != _user_email THEN
    RETURN json_build_object('success', false, 'error', 'This invite was sent to a different email address');
  END IF;

  -- Prevent duplicate membership
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = _user_id AND workspace_id = _invite.workspace_id
  ) THEN
    UPDATE public.workspace_invites
    SET status = 'accepted', accepted_at = now(), accepted_by = _user_id
    WHERE id = _invite.id;
    RETURN json_build_object('success', true, 'already_member', true, 'workspace_id', _invite.workspace_id);
  END IF;

  -- Create membership
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
  VALUES (_invite.workspace_id, _user_id, _invite.role)
  RETURNING id INTO _membership_id;

  -- Mark invite as accepted
  UPDATE public.workspace_invites
  SET status = 'accepted', accepted_at = now(), accepted_by = _user_id
  WHERE id = _invite.id;

  RETURN json_build_object('success', true, 'workspace_id', _invite.workspace_id, 'membership_id', _membership_id);
END;
$$;

-- RPC: decline_workspace_invite (authenticated user declines)
CREATE OR REPLACE FUNCTION public.decline_workspace_invite(_invite_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
  _user_email text;
  _invite record;
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
    RETURN json_build_object('success', false, 'error', 'Invite is already ' || _invite.status);
  END IF;

  IF lower(_invite.email) != _user_email THEN
    RETURN json_build_object('success', false, 'error', 'Email does not match invite');
  END IF;

  UPDATE public.workspace_invites
  SET status = 'declined'
  WHERE id = _invite_id;

  RETURN json_build_object('success', true);
END;
$$;
