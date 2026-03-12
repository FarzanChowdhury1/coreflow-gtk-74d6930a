
-- 1. Add consumed_at to portal_tokens for replay prevention
ALTER TABLE public.portal_tokens ADD COLUMN IF NOT EXISTS consumed_at timestamptz DEFAULT NULL;

-- 2. Drop portal_sessions table (replacing with JWT cookies)
DROP TABLE IF EXISTS public.portal_sessions;

-- 3. Fix RLS posture on system tables
-- portal_failed_attempts: disable RLS (system table, only accessed by service_role edge functions)
ALTER TABLE public.portal_failed_attempts DISABLE ROW LEVEL SECURITY;

-- portal_tokens: keep RLS enabled but drop the anon SELECT policy (edge functions use service_role)
DROP POLICY IF EXISTS "Anon can validate tokens" ON public.portal_tokens;
