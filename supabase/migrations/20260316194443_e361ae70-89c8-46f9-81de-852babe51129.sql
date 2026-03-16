-- Composite indexes for dashboard RPC (get_dashboard_metrics) performance
-- These cover the workspace_id + deleted_at + status filter patterns used by the RPC

-- Invoices: covers COUNT and SUM queries filtered by workspace + soft-delete + status
CREATE INDEX IF NOT EXISTS idx_invoices_ws_status ON public.invoices (workspace_id, status) WHERE deleted_at IS NULL;

-- Projects: covers running projects count filtered by workspace + soft-delete + status
CREATE INDEX IF NOT EXISTS idx_projects_ws_status ON public.projects (workspace_id, status) WHERE deleted_at IS NULL;

-- Proposal versions: covers open proposals count filtered by workspace + status
CREATE INDEX IF NOT EXISTS idx_proposal_versions_ws_status ON public.proposal_versions (workspace_id, status);

-- Invoices workspace covering index for list page queries
CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON public.invoices (workspace_id) WHERE deleted_at IS NULL;

-- System alerts: covers dashboard alerts query filtered by workspace + dismissed
CREATE INDEX IF NOT EXISTS idx_system_alerts_ws_active ON public.system_alerts (workspace_id, is_dismissed) WHERE is_dismissed = false;

-- Notifications: covers user notification queries  
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);