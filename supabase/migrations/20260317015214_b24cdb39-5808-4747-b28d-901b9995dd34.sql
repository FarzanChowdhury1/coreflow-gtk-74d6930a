
-- Tighten email_logs: only admins can read (they're the only ones who send)
DROP POLICY IF EXISTS "workspace_members_read_email_logs" ON public.email_logs;

CREATE POLICY "workspace_admins_read_email_logs"
  ON public.email_logs FOR SELECT TO authenticated
  USING (
    public.has_workspace_role(auth.uid(), workspace_id, 'admin')
  );
