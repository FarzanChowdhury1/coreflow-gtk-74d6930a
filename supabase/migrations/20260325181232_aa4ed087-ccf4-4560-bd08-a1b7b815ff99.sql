CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON public.audit_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_workspace ON public.payments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_company_access_workspace ON public.company_access (workspace_id);
CREATE INDEX IF NOT EXISTS idx_company_access_user ON public.company_access (user_id);