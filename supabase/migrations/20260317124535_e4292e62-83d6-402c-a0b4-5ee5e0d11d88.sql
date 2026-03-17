
-- Dry-run count function for notifications eligible for purge (matches purge_old_notifications logic)
CREATE OR REPLACE FUNCTION public.count_retention_candidates_notifications()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'info', (SELECT count(*) FROM notifications WHERE is_read = true AND severity = 'info' AND created_at < now() - interval '30 days'),
    'warning', (SELECT count(*) FROM notifications WHERE is_read = true AND severity = 'warning' AND created_at < now() - interval '90 days'),
    'critical', (SELECT count(*) FROM notifications WHERE is_read = true AND severity = 'critical' AND created_at < now() - interval '180 days')
  );
$$;

-- Dry-run count function for operational logs eligible for purge (matches purge_operational_logs logic)
CREATE OR REPLACE FUNCTION public.count_retention_candidates_ops_logs()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'digest_runs', (SELECT count(*) FROM digest_runs WHERE executed_at < now() - interval '90 days'),
    'worker_runs', (SELECT count(*) FROM worker_runs WHERE started_at < now() - interval '90 days'),
    'email_logs', (SELECT count(*) FROM email_logs WHERE created_at < now() - interval '180 days')
  );
$$;
