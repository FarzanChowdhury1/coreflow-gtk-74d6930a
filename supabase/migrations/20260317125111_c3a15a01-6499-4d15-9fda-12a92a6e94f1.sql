
-- Fix search_path on the two IMMUTABLE helper functions
CREATE OR REPLACE FUNCTION public.retention_days_notification(_severity text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE _severity
    WHEN 'info'     THEN 30
    WHEN 'warning'  THEN 90
    WHEN 'critical' THEN 180
    ELSE 30
  END;
$$;

CREATE OR REPLACE FUNCTION public.retention_days_ops_log(_log_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE _log_type
    WHEN 'digest_runs' THEN 90
    WHEN 'worker_runs' THEN 90
    WHEN 'email_logs'  THEN 180
    ELSE 90
  END;
$$;
