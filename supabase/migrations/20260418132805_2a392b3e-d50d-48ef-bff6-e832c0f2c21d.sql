-- ============================================================
-- COMMERCIAL MODEL REWRITE (corrected)
-- ============================================================

-- 1) Email normalization helper
CREATE OR REPLACE FUNCTION public.normalize_email(_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _local text; _domain text; _at int;
BEGIN
  IF _email IS NULL THEN RETURN NULL; END IF;
  _email := lower(trim(_email));
  _at := position('@' in _email);
  IF _at = 0 THEN RETURN _email; END IF;
  _local := substring(_email FROM 1 FOR _at - 1);
  _domain := substring(_email FROM _at + 1);
  IF _domain IN ('gmail.com', 'googlemail.com') THEN
    _local := split_part(_local, '+', 1);
    _local := replace(_local, '.', '');
    _domain := 'gmail.com';
  ELSE
    _local := split_part(_local, '+', 1);
  END IF;
  RETURN _local || '@' || _domain;
END;
$$;

-- 2) Account-level trial-consumption ledger
CREATE TABLE IF NOT EXISTS public.trial_consumed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL UNIQUE,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid,
  user_id uuid
);
CREATE INDEX IF NOT EXISTS idx_trial_consumed_email ON public.trial_consumed_accounts(normalized_email);
ALTER TABLE public.trial_consumed_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins read trial consumption" ON public.trial_consumed_accounts;
CREATE POLICY "Platform admins read trial consumption"
  ON public.trial_consumed_accounts FOR SELECT
  TO authenticated
  USING (is_platform_admin(auth.uid()));

-- 3) Workspace billing-state columns
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS grace_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS next_renewal_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_downgrade_to text
    CHECK (pending_downgrade_to IS NULL OR pending_downgrade_to IN ('starter','growth'));

-- 4) Migrate legacy plan values
UPDATE public.workspaces SET plan = 'starter' WHERE plan = 'free';
UPDATE public.workspaces SET plan = 'growth'  WHERE plan = 'enterprise';

-- 5) New defaults
ALTER TABLE public.workspaces ALTER COLUMN plan SET DEFAULT 'starter';
ALTER TABLE public.workspaces ALTER COLUMN seat_limit SET DEFAULT 10;

-- 6) Seat-capacity helper (no deactivated_at column exists; all memberships count)
CREATE OR REPLACE FUNCTION public.workspace_effective_seat_count(_workspace_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = _workspace_id)
    +
    (SELECT COUNT(*) FROM workspace_invites
       WHERE workspace_id = _workspace_id
         AND status = 'pending'
         AND expires_at > now())
  )::int;
$$;

-- 7) Plan/state resolver
CREATE OR REPLACE FUNCTION public.workspace_billing_state(_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN w.deleted_at IS NOT NULL THEN 'suspended'
    WHEN w.trial_ends_at IS NOT NULL AND w.trial_ends_at > now()
         AND (w.grace_ends_at IS NULL OR w.grace_ends_at > now())
         AND w.next_renewal_at IS NULL
      THEN 'trial'
    WHEN w.trial_ends_at IS NOT NULL AND w.trial_ends_at <= now()
         AND w.grace_ends_at IS NOT NULL AND w.grace_ends_at > now()
         AND w.next_renewal_at IS NULL
      THEN 'grace'
    WHEN w.trial_ends_at IS NOT NULL AND w.grace_ends_at IS NOT NULL
         AND w.grace_ends_at <= now() AND w.next_renewal_at IS NULL
      THEN 'suspended'
    WHEN w.plan = 'growth' THEN 'growth'
    ELSE 'starter'
  END
  FROM workspaces w WHERE w.id = _workspace_id;
$$;

-- 8) Feature parity: Starter and Growth share all features. Suspended denies.
CREATE OR REPLACE FUNCTION public.workspace_has_active_feature(_workspace_id uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_billing_state(_workspace_id) IN ('trial','grace','starter','growth');
$$;

-- 9) Rewrite start_growth_trial: 28d + 7d grace + account lock
CREATE OR REPLACE FUNCTION public.start_growth_trial(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid; _role app_role; _norm_email text;
  _existing_trial timestamptz; _trial_end timestamptz; _grace_end timestamptz;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT role INTO _role FROM workspace_memberships
    WHERE user_id = _caller_id AND workspace_id = _workspace_id LIMIT 1;
  IF _role IS NULL OR _role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only workspace admins can start a trial');
  END IF;
  SELECT trial_ends_at INTO _existing_trial FROM workspaces WHERE id = _workspace_id;
  IF _existing_trial IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This workspace has already used its trial');
  END IF;
  SELECT normalize_email(email) INTO _norm_email FROM auth.users WHERE id = _caller_id;
  IF _norm_email IS NULL THEN RETURN jsonb_build_object('error', 'Cannot resolve account email'); END IF;
  IF EXISTS (SELECT 1 FROM trial_consumed_accounts WHERE normalized_email = _norm_email) THEN
    RETURN jsonb_build_object('error', 'A trial has already been used by this account');
  END IF;
  _trial_end := now() + interval '28 days';
  _grace_end := _trial_end + interval '7 days';
  UPDATE workspaces SET
    plan = 'growth',
    trial_started_at = now(),
    trial_ends_at = _trial_end,
    grace_ends_at = _grace_end,
    seat_limit = 10
  WHERE id = _workspace_id;
  INSERT INTO trial_consumed_accounts (normalized_email, workspace_id, user_id)
    VALUES (_norm_email, _workspace_id, _caller_id)
    ON CONFLICT (normalized_email) DO NOTHING;
  RETURN jsonb_build_object('success', true, 'trial_ends_at', _trial_end, 'grace_ends_at', _grace_end);
END;
$$;

-- 10) Activate paid plan (platform-admin only manual surface)
CREATE OR REPLACE FUNCTION public.activate_paid_plan(
  _workspace_id uuid, _plan text, _billing_cycle text DEFAULT 'monthly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid; _seat_count int; _renewal timestamptz;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT is_platform_admin(_caller_id) THEN
    RETURN jsonb_build_object('error', 'Only platform admins can activate paid plans');
  END IF;
  IF _plan NOT IN ('starter','growth') THEN
    RETURN jsonb_build_object('error', 'Invalid plan');
  END IF;
  IF _billing_cycle NOT IN ('monthly','annual') THEN
    RETURN jsonb_build_object('error', 'Invalid billing cycle');
  END IF;
  _seat_count := workspace_effective_seat_count(_workspace_id);
  IF _seat_count > 10 AND _plan = 'starter' THEN
    RETURN jsonb_build_object('error', 'Workspace exceeds 10 seats — Growth required');
  END IF;
  IF _billing_cycle = 'annual' THEN _renewal := now() + interval '12 months';
  ELSE _renewal := now() + interval '1 month'; END IF;
  UPDATE workspaces SET
    plan = _plan,
    billing_cycle = _billing_cycle,
    next_renewal_at = _renewal,
    grace_ends_at = NULL,
    pending_downgrade_to = NULL,
    seat_limit = CASE WHEN _plan = 'starter' THEN 10 ELSE 9999 END
  WHERE id = _workspace_id;
  RETURN jsonb_build_object('success', true, 'plan', _plan, 'next_renewal_at', _renewal);
END;
$$;

-- 11) Upgrade Starter -> Growth mid-cycle
CREATE OR REPLACE FUNCTION public.upgrade_to_growth(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid; _role app_role;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT role INTO _role FROM workspace_memberships
    WHERE user_id = _caller_id AND workspace_id = _workspace_id LIMIT 1;
  IF _role IS NULL OR _role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only workspace admins can upgrade');
  END IF;
  UPDATE workspaces SET plan = 'growth', seat_limit = 9999, pending_downgrade_to = NULL
    WHERE id = _workspace_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 12) Schedule downgrade at next renewal
CREATE OR REPLACE FUNCTION public.schedule_downgrade(_workspace_id uuid, _target text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid; _role app_role;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT role INTO _role FROM workspace_memberships
    WHERE user_id = _caller_id AND workspace_id = _workspace_id LIMIT 1;
  IF _role IS NULL OR _role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only workspace admins can change billing');
  END IF;
  IF _target NOT IN ('starter','cancel') THEN
    RETURN jsonb_build_object('error', 'Invalid downgrade target');
  END IF;
  UPDATE workspaces SET pending_downgrade_to = _target WHERE id = _workspace_id;
  RETURN jsonb_build_object('success', true, 'effective_at_renewal', true);
END;
$$;

-- 13) Seat-capacity guard
CREATE OR REPLACE FUNCTION public.check_workspace_seat_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _state text; _count int;
BEGIN
  _state := workspace_billing_state(NEW.workspace_id);
  IF _state = 'suspended' THEN
    RAISE EXCEPTION 'Workspace is suspended — cannot add seats';
  END IF;
  _count := workspace_effective_seat_count(NEW.workspace_id);
  IF _state = 'starter' AND _count >= 10 THEN
    RAISE EXCEPTION 'Starter plan limited to 10 seats — upgrade to Growth to add more';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_seat_capacity_membership ON public.workspace_memberships;
CREATE TRIGGER check_seat_capacity_membership
  BEFORE INSERT ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.check_workspace_seat_capacity();

DROP TRIGGER IF EXISTS check_seat_capacity_invite ON public.workspace_invites;
CREATE TRIGGER check_seat_capacity_invite
  BEFORE INSERT ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.check_workspace_seat_capacity();

-- 14) Auto-promote at threshold
CREATE OR REPLACE FUNCTION public.auto_promote_at_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int; _ws_id uuid;
BEGIN
  _ws_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  _count := workspace_effective_seat_count(_ws_id);
  IF _count >= 11 THEN
    UPDATE workspaces SET plan = 'growth', seat_limit = 9999, pending_downgrade_to = NULL
      WHERE id = _ws_id AND plan = 'starter';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS auto_promote_membership ON public.workspace_memberships;
CREATE TRIGGER auto_promote_membership
  AFTER INSERT ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.auto_promote_at_threshold();

-- 15) Rewrite platform_workspace_overview
DROP FUNCTION IF EXISTS public.platform_workspace_overview();
CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid; _workspaces jsonb; _summary jsonb;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL OR NOT is_platform_admin(_caller) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  SELECT jsonb_agg(row_to_json(r)) INTO _workspaces FROM (
    SELECT
      w.id, w.name, w.plan, w.seat_limit,
      workspace_effective_seat_count(w.id) AS seat_count,
      w.trial_started_at, w.trial_ends_at, w.grace_ends_at,
      w.next_renewal_at, w.billing_cycle, w.pending_downgrade_to,
      workspace_billing_state(w.id) AS billing_state,
      w.created_at, w.deleted_at,
      (SELECT MAX(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT COUNT(*) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT COUNT(*) FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      (SELECT array_agg(u.email) FROM workspace_memberships wm
         JOIN auth.users u ON u.id = wm.user_id
        WHERE wm.workspace_id = w.id AND wm.role = 'admin') AS admin_emails,
      (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.role = 'admin') AS admin_count,
      (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.role = 'team_member') AS team_member_count,
      (SELECT u.email FROM auth.users u WHERE u.id = w.billing_owner_id) AS billing_owner_email,
      f.followup_stage, f.next_followup_date, f.last_contacted_at, f.followup_priority,
      (SELECT u.email FROM auth.users u WHERE u.id = f.followup_owner_id) AS followup_owner_email,
      f.last_note, f.note_count
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT wf.followup_stage, wf.next_followup_date, wf.last_contacted_at,
             wf.followup_priority, wf.followup_owner_id, wf.last_note, wf.note_count
      FROM workspace_followups wf WHERE wf.workspace_id = w.id LIMIT 1
    ) f ON true
    ORDER BY w.created_at DESC
  ) r;

  SELECT jsonb_build_object(
    'total',           (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL),
    'starter',         (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND plan = 'starter' AND workspace_billing_state(id) = 'starter'),
    'growth',          (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND plan = 'growth'  AND workspace_billing_state(id) = 'growth'),
    'active_trials',   (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'trial'),
    'in_grace',        (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'grace'),
    'suspended',       (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_billing_state(id) = 'suspended'),
    'expired_trials',  (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()),
    'over_seat_limit', (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND workspace_effective_seat_count(id) > seat_limit)
  ) INTO _summary;

  RETURN jsonb_build_object('workspaces', COALESCE(_workspaces, '[]'::jsonb), 'summary', _summary);
END;
$$;

-- 16) Rewrite has_workspace_access / has_workspace_role: deny when suspended
CREATE OR REPLACE FUNCTION public.has_workspace_access(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = _user_id
      AND m.workspace_id = _workspace_id
      AND w.deleted_at IS NULL
      AND workspace_billing_state(w.id) <> 'suspended'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_user_id uuid, _workspace_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = _user_id
      AND m.workspace_id = _workspace_id
      AND m.role = _role
      AND w.deleted_at IS NULL
      AND workspace_billing_state(w.id) <> 'suspended'
  );
$$;

-- 17) Bootstrap workspace: account-level repeat-trial block
CREATE OR REPLACE FUNCTION public.bootstrap_workspace(_user_id uuid, _name text DEFAULT 'My Workspace'::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws_id uuid; _membership_id uuid; _caller_id uuid; _norm_email text;
  _trial_already_used boolean; _trial_end timestamptz; _grace_end timestamptz;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RETURN json_build_object('error', 'Not authenticated'); END IF;
  IF _user_id != _caller_id THEN
    RETURN json_build_object('error', 'Cannot create workspace for another user');
  END IF;

  SELECT normalize_email(email) INTO _norm_email FROM auth.users WHERE id = _caller_id;
  _trial_already_used := EXISTS (SELECT 1 FROM trial_consumed_accounts WHERE normalized_email = _norm_email);

  IF _trial_already_used THEN
    INSERT INTO public.workspaces (name, plan, seat_limit) VALUES (_name, 'starter', 10) RETURNING id INTO _ws_id;
  ELSE
    _trial_end := now() + interval '28 days';
    _grace_end := _trial_end + interval '7 days';
    INSERT INTO public.workspaces (name, plan, seat_limit, trial_started_at, trial_ends_at, grace_ends_at)
      VALUES (_name, 'growth', 10, now(), _trial_end, _grace_end)
      RETURNING id INTO _ws_id;
    INSERT INTO trial_consumed_accounts (normalized_email, workspace_id, user_id)
      VALUES (_norm_email, _ws_id, _caller_id)
      ON CONFLICT (normalized_email) DO NOTHING;
  END IF;

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    VALUES (_ws_id, _user_id, 'admin')
    RETURNING id INTO _membership_id;

  RETURN json_build_object('workspace_id', _ws_id, 'membership_id', _membership_id);
END;
$$;