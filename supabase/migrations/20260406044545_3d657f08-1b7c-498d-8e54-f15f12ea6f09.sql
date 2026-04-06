
-- Enum for commercial stages
CREATE TYPE public.workspace_commercial_stage AS ENUM (
  'new',
  'trialing',
  'activated_free',
  'expansion_opportunity',
  'trial_expired',
  'follow_up_needed',
  'converted_manual',
  'enterprise_pipeline',
  'churn_risk',
  'inactive',
  'closed_lost'
);

-- Internal follow-up table (platform-admin only)
CREATE TABLE public.workspace_followups (
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

-- Internal follow-up notes log
CREATE TABLE public.workspace_followup_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id uuid NOT NULL REFERENCES public.workspace_followups(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workspace_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_followup_notes ENABLE ROW LEVEL SECURITY;

-- Platform admins only policies for workspace_followups
CREATE POLICY "Platform admins can view followups"
  ON public.workspace_followups FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins can insert followups"
  ON public.workspace_followups FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins can update followups"
  ON public.workspace_followups FOR UPDATE TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins can delete followups"
  ON public.workspace_followups FOR DELETE TO authenticated
  USING (is_platform_admin(auth.uid()));

-- Platform admins only policies for notes
CREATE POLICY "Platform admins can view followup notes"
  ON public.workspace_followup_notes FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins can insert followup notes"
  ON public.workspace_followup_notes FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()) AND author_id = auth.uid());

CREATE POLICY "Platform admins can delete followup notes"
  ON public.workspace_followup_notes FOR DELETE TO authenticated
  USING (is_platform_admin(auth.uid()));

-- Indexes
CREATE INDEX idx_workspace_followups_workspace ON public.workspace_followups(workspace_id);
CREATE INDEX idx_workspace_followups_stage ON public.workspace_followups(stage);
CREATE INDEX idx_workspace_followups_next ON public.workspace_followups(next_followup_date);
CREATE INDEX idx_followup_notes_followup ON public.workspace_followup_notes(followup_id);

-- Auto-seed followup rows for existing workspaces
INSERT INTO public.workspace_followups (workspace_id, stage)
SELECT id, 'new'::workspace_commercial_stage FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- Update platform_workspace_overview to include followup data
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
      w.id,
      w.name,
      w.plan,
      w.seat_limit,
      w.trial_ends_at,
      w.created_at,
      w.billing_owner_id,
      (SELECT count(*)::int FROM workspace_memberships wm WHERE wm.workspace_id = w.id) AS seat_count,
      (SELECT max(pe.created_at) FROM product_events pe WHERE pe.workspace_id = w.id) AS last_activity,
      (SELECT count(*)::int FROM product_events pe WHERE pe.workspace_id = w.id) AS event_count,
      (SELECT array_agg(DISTINCT pe.event_name) FROM product_events pe WHERE pe.workspace_id = w.id) AS event_names,
      (SELECT count(*)::int FROM companies c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS company_count,
      (SELECT array_agg(u.email ORDER BY wm2.created_at)
       FROM workspace_memberships wm2
       JOIN auth.users u ON u.id = wm2.user_id
       WHERE wm2.workspace_id = w.id AND wm2.role = 'admin') AS admin_emails,
      (SELECT count(*)::int FROM workspace_memberships wm3 WHERE wm3.workspace_id = w.id AND wm3.role = 'admin') AS admin_count,
      (SELECT count(*)::int FROM workspace_memberships wm4 WHERE wm4.workspace_id = w.id AND wm4.role = 'team_member') AS team_member_count,
      (SELECT u2.email FROM auth.users u2 WHERE u2.id = w.billing_owner_id) AS billing_owner_email,
      -- Followup data
      wf.stage AS followup_stage,
      wf.next_followup_date,
      wf.last_contacted_at,
      wf.priority AS followup_priority,
      wf.owner_id AS followup_owner_id,
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
    ) AS val
    FROM ws_data
  )
  SELECT jsonb_build_object(
    'summary', (SELECT val FROM summary),
    'workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'plan', plan,
        'seat_limit', seat_limit,
        'seat_count', seat_count,
        'trial_ends_at', trial_ends_at,
        'created_at', created_at,
        'last_activity', last_activity,
        'event_count', event_count,
        'event_names', event_names,
        'company_count', company_count,
        'admin_emails', admin_emails,
        'admin_count', admin_count,
        'team_member_count', team_member_count,
        'billing_owner_email', billing_owner_email,
        'followup_stage', followup_stage,
        'next_followup_date', next_followup_date,
        'last_contacted_at', last_contacted_at,
        'followup_priority', followup_priority,
        'followup_owner_email', followup_owner_email,
        'last_note', last_note,
        'note_count', note_count
      ))
      FROM ws_data
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

-- Revoke public access
REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_workspace_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_workspace_overview() TO authenticated;
