
-- Update check_workspace_seat_capacity to be trial-expiry-aware
CREATE OR REPLACE FUNCTION public.check_workspace_seat_capacity(
  _workspace_id uuid,
  _include_pending_invites boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan text;
  _seat_limit integer;
  _trial_ends_at timestamptz;
  _effective_limit integer;
  _current_count integer;
BEGIN
  -- Get workspace plan info
  SELECT plan, seat_limit, trial_ends_at
  INTO _plan, _seat_limit, _trial_ends_at
  FROM workspaces
  WHERE id = _workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  -- Determine effective seat limit
  -- If growth trial has expired, revert to free-plan cap of 3
  IF _plan = 'growth' AND _trial_ends_at IS NOT NULL AND _trial_ends_at <= now() THEN
    _effective_limit := 3;
  ELSE
    _effective_limit := _seat_limit;
  END IF;

  -- NULL seat_limit means unlimited (enterprise / paid growth)
  IF _effective_limit IS NULL THEN
    RETURN true;
  END IF;

  -- Count current members
  SELECT count(*)::int INTO _current_count
  FROM workspace_memberships
  WHERE workspace_id = _workspace_id;

  -- Optionally include pending invites
  IF _include_pending_invites THEN
    _current_count := _current_count + (
      SELECT count(*)::int
      FROM workspace_invites
      WHERE workspace_id = _workspace_id
        AND status = 'pending'
        AND expires_at > now()
    );
  END IF;

  RETURN _current_count < _effective_limit;
END;
$$;
