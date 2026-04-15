-- Notification preference categories matching real notification sources
CREATE TYPE public.notification_category AS ENUM (
  'daily_digest',
  'approval_request',
  'invoice_overdue',
  'lead_followup',
  'renewal_upcoming',
  'system_alert'
);

-- Per-user, per-workspace notification preferences
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category notification_category NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, category)
);

-- Index for fast lookups
CREATE INDEX idx_notification_preferences_user_workspace
  ON public.notification_preferences(user_id, workspace_id);

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "Users can view own notification preferences"
  ON public.notification_preferences FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Users can insert their own preferences
CREATE POLICY "Users can insert own notification preferences"
  ON public.notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND has_workspace_access((SELECT auth.uid()), workspace_id)
  );

-- Users can update their own preferences
CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- No delete — preferences are toggled, not removed