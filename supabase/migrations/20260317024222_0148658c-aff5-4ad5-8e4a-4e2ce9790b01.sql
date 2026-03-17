
-- Worker run log for automated job observability
CREATE TABLE public.worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  summary jsonb DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: admin-only read (any workspace admin can see global worker health)
ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_worker_runs"
  ON public.worker_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Index for recent runs lookup
CREATE INDEX idx_worker_runs_name_time ON public.worker_runs (worker_name, started_at DESC);
