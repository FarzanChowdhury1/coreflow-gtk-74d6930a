
-- 1. Add offboarding export tracking column
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS offboarding_export_used_at timestamptz DEFAULT NULL;

-- 2. One-time offboarding export claim RPC
CREATE OR REPLACE FUNCTION public.claim_offboarding_export(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid;
  _ws record;
  _actor_name text;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_role(_uid, _workspace_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Only workspace admins can claim offboarding export');
  END IF;

  SELECT * INTO _ws FROM workspaces WHERE id = _workspace_id;
  IF _ws IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Workspace not found');
  END IF;

  IF _ws.offboarding_export_used_at IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Offboarding export has already been claimed for this workspace');
  END IF;

  -- Set the one-time claim
  UPDATE workspaces
  SET offboarding_export_used_at = now(), updated_at = now()
  WHERE id = _workspace_id;

  -- Audit log
  SELECT full_name INTO _actor_name FROM profiles WHERE user_id = _uid LIMIT 1;

  INSERT INTO audit_logs (workspace_id, actor_id, actor_name, entity_type, entity_id, action, metadata)
  VALUES (
    _workspace_id, _uid, _actor_name, 'workspace', _workspace_id, 'offboarding_export_claimed',
    jsonb_build_object('workspace_name', _ws.name)
  );

  RETURN json_build_object('success', true, 'expires_at', (now() + interval '1 hour')::text);
END;
$$;

-- 3. Update assert_export_allowed with narrow offboarding exception
CREATE OR REPLACE FUNCTION public.assert_export_allowed(_workspace_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid;
  _offboarding_ts timestamptz;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN json_build_object('allowed', false, 'error', 'Not authenticated');
  END IF;

  IF NOT has_workspace_access(_uid, _workspace_id) THEN
    RETURN json_build_object('allowed', false, 'error', 'Access denied');
  END IF;

  -- Normal entitlement check
  IF workspace_has_active_feature(_workspace_id, 'csvExport') THEN
    RETURN json_build_object('allowed', true);
  END IF;

  -- Narrow offboarding exception: admin-only, one-time, 1-hour window
  SELECT offboarding_export_used_at INTO _offboarding_ts
  FROM workspaces WHERE id = _workspace_id;

  IF _offboarding_ts IS NOT NULL
     AND _offboarding_ts > now() - interval '1 hour'
     AND has_workspace_role(_uid, _workspace_id, 'admin')
  THEN
    RETURN json_build_object('allowed', true);
  END IF;

  RETURN json_build_object('allowed', false, 'error', 'Data export requires a Growth plan. Upgrade to unlock exports.');
END;
$$;
