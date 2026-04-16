-- 1. Client error reporting table
CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  error_message text NOT NULL,
  error_stack text,
  component_stack text,
  url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service insert client errors" ON public.client_errors;
CREATE POLICY "Service insert client errors" ON public.client_errors
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admins view client errors" ON public.client_errors;
CREATE POLICY "Admins view client errors" ON public.client_errors
  FOR SELECT TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- 2. Data erasure requests table for GDPR-like compliance
CREATE TABLE IF NOT EXISTS public.data_erasure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  request_type text NOT NULL DEFAULT 'full_erasure',
  status text NOT NULL DEFAULT 'pending',
  reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_erasure_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage erasure requests" ON public.data_erasure_requests;
CREATE POLICY "Admins can manage erasure requests" ON public.data_erasure_requests
  FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- 3. Meeting requests table for portal client-side booking
CREATE TABLE IF NOT EXISTS public.meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  preferred_date date,
  preferred_time text,
  status text NOT NULL DEFAULT 'pending',
  resolved_meeting_id uuid REFERENCES public.meetings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage meeting requests" ON public.meeting_requests;
CREATE POLICY "Admins can manage meeting requests" ON public.meeting_requests
  FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Members can view meeting requests" ON public.meeting_requests;
CREATE POLICY "Members can view meeting requests" ON public.meeting_requests
  FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_client_errors_workspace ON public.client_errors(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_erasure_workspace ON public.data_erasure_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_meeting_requests_workspace ON public.meeting_requests(workspace_id, status);