
-- Email send log table for tracking transactional email delivery
CREATE TABLE public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  email_type text NOT NULL,
  recipient_email text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  provider_message_id text,
  entity_type text,
  entity_id uuid,
  triggered_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_email_logs"
  ON public.email_logs FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "service_role_insert_email_logs"
  ON public.email_logs FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_email_logs_workspace ON public.email_logs(workspace_id);
CREATE INDEX idx_email_logs_type_status ON public.email_logs(email_type, status);
