
-- ============================================================
-- PUBLISH REPAIR: make all Sprint 6/7 objects idempotent
-- This migration is safe to run whether or not prior migrations
-- partially applied in production.
-- ============================================================

-- 1. Ensure plan/entitlement columns exist on workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS seat_limit integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS billing_owner_id uuid REFERENCES auth.users(id) DEFAULT NULL;

-- 2. Ensure product_events table exists
CREATE TABLE IF NOT EXISTS public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_events_workspace ON public.product_events(workspace_id, event_name);
CREATE INDEX IF NOT EXISTS idx_product_events_created ON public.product_events(created_at);
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can insert product events" ON public.product_events;
CREATE POLICY "Members can insert product events"
  ON public.product_events FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access(auth.uid(), workspace_id) AND user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can view product events" ON public.product_events;
CREATE POLICY "Admins can view product events"
  ON public.product_events FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- 3. Ensure meeting_actions table exists
CREATE TABLE IF NOT EXISTS public.meeting_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  action_type TEXT NOT NULL DEFAULT 'action',
  title TEXT NOT NULL,
  assignee_id UUID NULL,
  due_date DATE NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_actions_meeting_id ON public.meeting_actions(meeting_id);
ALTER TABLE public.meeting_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage meeting actions" ON public.meeting_actions;
CREATE POLICY "Admins can manage meeting actions"
  ON public.meeting_actions FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));
DROP POLICY IF EXISTS "Members can view meeting actions" ON public.meeting_actions;
CREATE POLICY "Members can view meeting actions"
  ON public.meeting_actions FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));
DROP POLICY IF EXISTS "Members can insert meeting actions" ON public.meeting_actions;
CREATE POLICY "Members can insert meeting actions"
  ON public.meeting_actions FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access(auth.uid(), workspace_id));
DROP POLICY IF EXISTS "Members can update meeting actions" ON public.meeting_actions;
CREATE POLICY "Members can update meeting actions"
  ON public.meeting_actions FOR UPDATE TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

-- 4. Backfill billing_owner_id for workspaces missing it
UPDATE public.workspaces w
SET billing_owner_id = sub.earliest_admin
FROM (
  SELECT DISTINCT ON (wm.workspace_id)
    wm.workspace_id,
    wm.user_id AS earliest_admin
  FROM workspace_memberships wm
  WHERE wm.role = 'admin'
  ORDER BY wm.workspace_id, wm.created_at ASC
) sub
WHERE w.id = sub.workspace_id
  AND w.billing_owner_id IS NULL;

-- 5. Ensure workspace_commercial_stage enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_commercial_stage') THEN
    CREATE TYPE public.workspace_commercial_stage AS ENUM (
      'new','trialing','activated_free','expansion_opportunity',
      'trial_expired','follow_up_needed','converted_manual',
      'enterprise_pipeline','churn_risk','inactive','closed_lost'
    );
  END IF;
END $$;

-- 6. Ensure workspace_followups table exists
CREATE TABLE IF NOT EXISTS public.workspace_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stage workspace_commercial_stage NOT NULL DEFAULT 'new',
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  next_followup_date date,
  last_contacted_at timestamptz,
  priority text DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
CREATE TABLE IF NOT EXISTS public.workspace_followup_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id uuid NOT NULL REFERENCES public.workspace_followups(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_followup_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can view followups" ON public.workspace_followups;
CREATE POLICY "Platform admins can view followups"
  ON public.workspace_followups FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins can insert followups" ON public.workspace_followups;
CREATE POLICY "Platform admins can insert followups"
  ON public.workspace_followups FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins can update followups" ON public.workspace_followups;
CREATE POLICY "Platform admins can update followups"
  ON public.workspace_followups FOR UPDATE TO authenticated
  USING (is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins can delete followups" ON public.workspace_followups;
CREATE POLICY "Platform admins can delete followups"
  ON public.workspace_followups FOR DELETE TO authenticated
  USING (is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins can view followup notes" ON public.workspace_followup_notes;
CREATE POLICY "Platform admins can view followup notes"
  ON public.workspace_followup_notes FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins can insert followup notes" ON public.workspace_followup_notes;
CREATE POLICY "Platform admins can insert followup notes"
  ON public.workspace_followup_notes FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()) AND author_id = auth.uid());
DROP POLICY IF EXISTS "Platform admins can delete followup notes" ON public.workspace_followup_notes;
CREATE POLICY "Platform admins can delete followup notes"
  ON public.workspace_followup_notes FOR DELETE TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_workspace_followups_workspace ON public.workspace_followups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_followups_stage ON public.workspace_followups(stage);
CREATE INDEX IF NOT EXISTS idx_workspace_followups_next ON public.workspace_followups(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_followup_notes_followup ON public.workspace_followup_notes(followup_id);

-- Seed followup rows for any workspaces that don't have one yet
INSERT INTO public.workspace_followups (workspace_id, stage)
SELECT id, 'new'::workspace_commercial_stage FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- 7. Insert platform admin for nazrafnc@gmail.com (idempotent)
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'nazrafnc@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- 8. Remove notifications from realtime (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;
  END IF;
END $$;

-- 9. Harden is_platform_admin with auth.uid() guard
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = _user_id
    )
  END;
$$;

-- 10. Final platform_workspace_overview with all fields
CREATE OR REPLACE FUNCTION public.platform_workspace_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _result jsonb;
BEGIN
  IF NOT is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH ws_data AS (
    SELECT
      w.id, w.name, w.plan, w.seat_limit, w.trial_ends_at, w.created_at, w.billing_owner_id,
      (SELECT count(*)::int FROM workspace_memberships wm WHERE wm.workspace_id = w.id) AS seat_count,
      (SELECT max(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT count(*)::int FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT count(*)::int FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      (SELECT array_agg(u.email ORDER BY wm2.created_at)
       FROM workspace_memberships wm2 JOIN auth.users u ON u.id = wm2.user_id
       WHERE wm2.workspace_id = w.id AND wm2.role = 'admin') AS admin_emails,
      (SELECT count(*)::int FROM workspace_memberships wm3 WHERE wm3.workspace_id = w.id AND wm3.role = 'admin') AS admin_count,
      (SELECT count(*)::int FROM workspace_memberships wm4 WHERE wm4.workspace_id = w.id AND wm4.role = 'team_member') AS team_member_count,
      (SELECT u2.email FROM auth.users u2 WHERE u2.id = w.billing_owner_id) AS billing_owner_email,
      wf.stage AS followup_stage, wf.next_followup_date, wf.last_contacted_at,
      wf.priority AS followup_priority, wf.owner_id AS followup_owner_id,
      (SELECT u3.email FROM auth.users u3 WHERE u3.id = wf.owner_id) AS followup_owner_email,
      (SELECT wfn.note FROM workspace_followup_notes wfn WHERE wfn.followup_id = wf.id ORDER BY wfn.created_at DESC LIMIT 1) AS last_note,
      (SELECT count(*)::int FROM workspace_followup_notes wfn2 WHERE wfn2.followup_id = wf.id) AS note_count
    FROM workspaces w
    LEFT JOIN workspace_followups wf ON wf.workspace_id = w.id
    ORDER BY w.created_at DESC
  ),
  summary AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'free', count(*) FILTER (WHERE plan = 'free'),
      'growth', count(*) FILTER (WHERE plan = 'growth'),
      'enterprise', count(*) FILTER (WHERE plan = 'enterprise'),
      'active_trials', count(*) FILTER (WHERE trial_ends_at IS NOT NULL AND trial_ends_at > now()),
      'expired_trials', count(*) FILTER (WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now()),
      'over_seat_limit', count(*) FILTER (WHERE seat_count > seat_limit)
    ) AS val FROM ws_data
  )
  SELECT jsonb_build_object(
    'summary', (SELECT val FROM summary),
    'workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'plan', plan, 'seat_limit', seat_limit,
        'seat_count', seat_count, 'trial_ends_at', trial_ends_at,
        'created_at', created_at, 'last_activity', last_activity,
        'event_count', event_count, 'event_names', event_names,
        'company_count', company_count, 'admin_emails', admin_emails,
        'admin_count', admin_count, 'team_member_count', team_member_count,
        'billing_owner_email', billing_owner_email,
        'followup_stage', followup_stage, 'next_followup_date', next_followup_date,
        'last_contacted_at', last_contacted_at, 'followup_priority', followup_priority,
        'followup_owner_email', followup_owner_email,
        'last_note', last_note, 'note_count', note_count
      )) FROM ws_data
    ), '[]'::jsonb)
  ) INTO _result;
  RETURN _result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_workspace_overview() TO authenticated;

-- 11. Ensure start_growth_trial exists
CREATE OR REPLACE FUNCTION public.start_growth_trial(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _role app_role;
  _current_plan text;
  _current_trial_ends_at timestamptz;
  _trial_end timestamptz;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;
  SELECT role INTO _role FROM workspace_memberships
    WHERE user_id = _caller_id AND workspace_id = _workspace_id LIMIT 1;
  IF _role IS NULL OR _role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only workspace admins can start a trial');
  END IF;
  SELECT plan, trial_ends_at INTO _current_plan, _current_trial_ends_at
    FROM workspaces WHERE id = _workspace_id;
  IF _current_plan IS NULL THEN
    RETURN jsonb_build_object('error', 'Workspace not found');
  END IF;
  IF _current_plan = 'enterprise' THEN
    RETURN jsonb_build_object('error', 'Enterprise workspaces cannot start a Growth trial');
  END IF;
  IF _current_trial_ends_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This workspace has already used its Growth trial');
  END IF;
  _trial_end := now() + interval '14 days';
  UPDATE workspaces SET plan = 'growth', trial_ends_at = _trial_end, seat_limit = 999
    WHERE id = _workspace_id;
  RETURN jsonb_build_object('success', true, 'trial_ends_at', _trial_end);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_growth_trial(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_growth_trial(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_growth_trial(uuid) TO authenticated;
