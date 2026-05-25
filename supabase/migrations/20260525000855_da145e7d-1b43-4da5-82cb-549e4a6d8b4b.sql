
-- 1. SENSITIVE WORKSPACE COLUMNS: hide from non-admin members via column-level GRANTs.
-- Member-readable: id, name, timezone, currency, created_at, updated_at, deleted_at,
--   plan, trial_ends_at, trial_started_at, grace_ends_at, renewal_grace_ends_at,
--   seat_limit, billing_owner_id, billing_cycle, next_renewal_at, pending_downgrade_to,
--   grace_reminders_sent, last_grace_reminder_at, offboarding_export_used_at,
--   offboarding_export_claimed_by, portal_accent_color, portal_logo_storage_path,
--   portal_support_email, is_synthetic.
REVOKE SELECT ON public.workspaces FROM anon, authenticated;
GRANT SELECT (
  id, name, timezone, currency, created_at, updated_at, deleted_at,
  plan, trial_ends_at, trial_started_at, grace_ends_at, renewal_grace_ends_at,
  seat_limit, billing_owner_id, billing_cycle, next_renewal_at, pending_downgrade_to,
  grace_reminders_sent, last_grace_reminder_at, offboarding_export_used_at,
  offboarding_export_claimed_by, portal_accent_color, portal_logo_storage_path,
  portal_support_email, is_synthetic
) ON public.workspaces TO authenticated;

-- Admin-only RPC to read sensitive doc identity fields.
CREATE OR REPLACE FUNCTION public.get_workspace_doc_identity(_workspace_id uuid)
RETURNS TABLE (
  doc_registered_name text, doc_trade_name text, doc_address text,
  doc_phone text, doc_email text, doc_bin text, doc_logo_storage_path text,
  doc_bank_account_name text, doc_bank_account_number text,
  doc_bank_name text, doc_bank_branch text, doc_payment_instructions text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT w.doc_registered_name, w.doc_trade_name, w.doc_address, w.doc_phone,
         w.doc_email, w.doc_bin, w.doc_logo_storage_path,
         w.doc_bank_account_name, w.doc_bank_account_number,
         w.doc_bank_name, w.doc_bank_branch, w.doc_payment_instructions
  FROM public.workspaces w
  WHERE w.id = _workspace_id
    AND w.deleted_at IS NULL
    AND public.has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role);
$$;
REVOKE EXECUTE ON FUNCTION public.get_workspace_doc_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_doc_identity(uuid) TO authenticated;

-- Lightweight admin-only RPC to check if doc identity is "complete" (for onboarding).
CREATE OR REPLACE FUNCTION public.workspace_doc_identity_ready(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = _workspace_id
      AND w.deleted_at IS NULL
      AND public.has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role)
      AND coalesce(btrim(w.doc_registered_name), '') <> ''
      AND coalesce(btrim(w.doc_address), '') <> ''
      AND (coalesce(btrim(w.doc_bank_account_number), '') <> ''
        OR coalesce(btrim(w.doc_payment_instructions), '') <> '')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.workspace_doc_identity_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_doc_identity_ready(uuid) TO authenticated;

-- 2. data_erasure_requests: allow workspace members to submit & view their own request.
DROP POLICY IF EXISTS "Members can submit own erasure requests" ON public.data_erasure_requests;
CREATE POLICY "Members can submit own erasure requests"
ON public.data_erasure_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND public.has_workspace_access(auth.uid(), workspace_id)
);

DROP POLICY IF EXISTS "Members can view own erasure requests" ON public.data_erasure_requests;
CREATE POLICY "Members can view own erasure requests"
ON public.data_erasure_requests
FOR SELECT
TO authenticated
USING (requested_by = auth.uid());

-- 3. email_send_log: allow service role to delete old rows for retention.
DROP POLICY IF EXISTS "Service role can delete send log" ON public.email_send_log;
CREATE POLICY "Service role can delete send log"
ON public.email_send_log
FOR DELETE
TO public
USING (auth.role() = 'service_role');

-- 4. suppressed_emails: allow service role to delete entries (e.g. after erasure).
DROP POLICY IF EXISTS "Service role can delete suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can delete suppressed emails"
ON public.suppressed_emails
FOR DELETE
TO public
USING (auth.role() = 'service_role');

-- 5. SECURITY DEFINER functions: revoke broad EXECUTE from anon (and PUBLIC).
-- Authenticated keeps EXECUTE because functions self-enforce auth.uid() / role checks.
-- Anonymous callers should never execute any public function.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;
