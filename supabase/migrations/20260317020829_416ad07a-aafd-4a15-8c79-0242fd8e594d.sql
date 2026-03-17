
-- Lightweight digest run log for admin observability
CREATE TABLE public.digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  triggered_by uuid NOT NULL,
  mode text NOT NULL DEFAULT 'run',
  status text NOT NULL DEFAULT 'success',
  overdue_invoices_count integer NOT NULL DEFAULT 0,
  overdue_followups_count integer NOT NULL DEFAULT 0,
  upcoming_renewals_count integer NOT NULL DEFAULT 0,
  error_message text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: admin-only read, no client writes (service role inserts from edge function)
ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_admins_read_digest_runs"
  ON public.digest_runs FOR SELECT TO authenticated
  USING (public.has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- Index for fast workspace+time lookups
CREATE INDEX idx_digest_runs_workspace_time ON public.digest_runs (workspace_id, executed_at DESC);
