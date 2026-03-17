
-- Centralized retention policy helper functions
-- These are the single source of truth for all retention windows.

CREATE OR REPLACE FUNCTION public.retention_days_notification(_severity text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE _severity
    WHEN 'info'     THEN 30
    WHEN 'warning'  THEN 90
    WHEN 'critical' THEN 180
    ELSE 30  -- default (NULL severity treated as info)
  END;
$$;

CREATE OR REPLACE FUNCTION public.retention_days_ops_log(_log_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE _log_type
    WHEN 'digest_runs' THEN 90
    WHEN 'worker_runs' THEN 90
    WHEN 'email_logs'  THEN 180
    ELSE 90
  END;
$$;

-- Rewrite purge_old_notifications to use centralized thresholds
CREATE OR REPLACE FUNCTION public.purge_old_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_info   integer;
  _deleted_warn   integer;
  _deleted_crit   integer;
BEGIN
  DELETE FROM public.notifications
  WHERE is_read = true
    AND (severity = 'info' OR severity IS NULL)
    AND created_at < now() - (retention_days_notification('info') || ' days')::interval;
  GET DIAGNOSTICS _deleted_info = ROW_COUNT;

  DELETE FROM public.notifications
  WHERE is_read = true
    AND severity = 'warning'
    AND created_at < now() - (retention_days_notification('warning') || ' days')::interval;
  GET DIAGNOSTICS _deleted_warn = ROW_COUNT;

  DELETE FROM public.notifications
  WHERE is_read = true
    AND severity = 'critical'
    AND created_at < now() - (retention_days_notification('critical') || ' days')::interval;
  GET DIAGNOSTICS _deleted_crit = ROW_COUNT;

  RETURN jsonb_build_object(
    'purged_info', _deleted_info,
    'purged_warning', _deleted_warn,
    'purged_critical', _deleted_crit
  );
END;
$$;

-- Rewrite purge_operational_logs to use centralized thresholds
CREATE OR REPLACE FUNCTION public.purge_operational_logs()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _digest_count int;
  _worker_count int;
  _email_count int;
BEGIN
  DELETE FROM public.digest_runs WHERE executed_at < now() - (retention_days_ops_log('digest_runs') || ' days')::interval;
  GET DIAGNOSTICS _digest_count = ROW_COUNT;

  DELETE FROM public.worker_runs WHERE started_at < now() - (retention_days_ops_log('worker_runs') || ' days')::interval;
  GET DIAGNOSTICS _worker_count = ROW_COUNT;

  DELETE FROM public.email_logs WHERE created_at < now() - (retention_days_ops_log('email_logs') || ' days')::interval;
  GET DIAGNOSTICS _email_count = ROW_COUNT;

  RETURN json_build_object(
    'purged_digest_runs', _digest_count,
    'purged_worker_runs', _worker_count,
    'purged_email_logs', _email_count
  );
END;
$$;

-- Rewrite count_retention_candidates_notifications to use centralized thresholds
CREATE OR REPLACE FUNCTION public.count_retention_candidates_notifications()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'info',     (SELECT count(*) FROM notifications WHERE is_read = true AND (severity = 'info' OR severity IS NULL) AND created_at < now() - (retention_days_notification('info') || ' days')::interval),
    'warning',  (SELECT count(*) FROM notifications WHERE is_read = true AND severity = 'warning' AND created_at < now() - (retention_days_notification('warning') || ' days')::interval),
    'critical', (SELECT count(*) FROM notifications WHERE is_read = true AND severity = 'critical' AND created_at < now() - (retention_days_notification('critical') || ' days')::interval)
  );
$$;

-- Rewrite count_retention_candidates_ops_logs to use centralized thresholds
CREATE OR REPLACE FUNCTION public.count_retention_candidates_ops_logs()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'digest_runs', (SELECT count(*) FROM digest_runs WHERE executed_at < now() - (retention_days_ops_log('digest_runs') || ' days')::interval),
    'worker_runs', (SELECT count(*) FROM worker_runs WHERE started_at < now() - (retention_days_ops_log('worker_runs') || ' days')::interval),
    'email_logs',  (SELECT count(*) FROM email_logs WHERE created_at < now() - (retention_days_ops_log('email_logs') || ' days')::interval)
  );
$$;
