
-- Add plan/entitlement columns to workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS seat_limit integer NOT NULL DEFAULT 3;

-- Create product_events table for instrumentation
CREATE TABLE public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying events
CREATE INDEX idx_product_events_workspace ON public.product_events(workspace_id, event_name);
CREATE INDEX idx_product_events_created ON public.product_events(created_at);

-- RLS
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Members can insert events for their workspace
CREATE POLICY "Members can insert product events"
  ON public.product_events FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access(auth.uid(), workspace_id)
    AND user_id = auth.uid()
  );

-- Admins can read events
CREATE POLICY "Admins can view product events"
  ON public.product_events FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));
