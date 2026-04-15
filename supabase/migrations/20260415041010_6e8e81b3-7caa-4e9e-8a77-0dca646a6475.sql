-- Helper: check if a workspace can add another seat
-- Returns true if there is room, false if at/over limit
CREATE OR REPLACE FUNCTION public.check_workspace_seat_capacity(
  _workspace_id uuid,
  _include_pending_invites boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _seat_limit integer;
  _current_count integer;
BEGIN
  SELECT seat_limit INTO _seat_limit
  FROM public.workspaces
  WHERE id = _workspace_id AND deleted_at IS NULL;

  -- No limit or workspace not found (null = unlimited)
  IF _seat_limit IS NULL THEN
    RETURN true;
  END IF;

  -- Count current members
  SELECT count(*)::integer INTO _current_count
  FROM public.workspace_memberships
  WHERE workspace_id = _workspace_id;

  -- Optionally count pending invites too
  IF _include_pending_invites THEN
    _current_count := _current_count + (
      SELECT count(*)::integer
      FROM public.workspace_invites
      WHERE workspace_id = _workspace_id
        AND status = 'pending'
        AND expires_at > now()
    );
  END IF;

  RETURN _current_count < _seat_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_workspace_seat_capacity(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_workspace_seat_capacity(uuid, boolean) TO authenticated, service_role;

-- Patch create_workspace_invite with seat enforcement
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

  -- SEAT ENFORCEMENT: check capacity including pending invites
  IF NOT public.check_workspace_seat_capacity(_workspace_id, true) THEN
    RETURN json_build_object('success', false, 'error', 'Seat limit reached. Upgrade your plan to invite more members.');
  END IF;

  -- Check for existing pending invite
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

-- Patch accept_invite_by_token with seat enforcement
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

  -- SEAT ENFORCEMENT: check capacity (members only, not pending invites)
  IF NOT public.check_workspace_seat_capacity(_invite.workspace_id, false) THEN
    RETURN json_build_object('success', false, 'error', 'This workspace has reached its seat limit. Ask the workspace admin to upgrade the plan.');
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