CREATE TABLE IF NOT EXISTS public.portal_failed_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_failed_ip_time 
ON public.portal_failed_attempts (ip_address, attempted_at DESC);

ALTER TABLE public.portal_failed_attempts ENABLE ROW LEVEL SECURITY;