-- portal_sessions table was partially created; ensure clean state
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);

-- Plain index on session_token (unique constraint already covers this, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires ON public.portal_sessions (expires_at);

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;