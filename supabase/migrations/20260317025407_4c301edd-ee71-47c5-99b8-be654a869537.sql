
-- Purge operational logs older than their retention windows
-- digest_runs: 90 days, worker_runs: 90 days, email_logs: 180 days
CREATE OR REPLACE FUNCTION public.purge_operational_logs()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _digest_count int;
  _worker_count int;
  _email_count int;
BEGIN
  DELETE FROM public.digest_runs WHERE executed_at < (now() - interval '90 days');
  GET DIAGNOSTICS _digest_count = ROW_COUNT;

  DELETE FROM public.worker_runs WHERE started_at < (now() - interval '90 days');
  GET DIAGNOSTICS _worker_count = ROW_COUNT;

  DELETE FROM public.email_logs WHERE created_at < (now() - interval '180 days');
  GET DIAGNOSTICS _email_count = ROW_COUNT;

  RETURN json_build_object(
    'purged_digest_runs', _digest_count,
    'purged_worker_runs', _worker_count,
    'purged_email_logs', _email_count
  );
END;
$$;
