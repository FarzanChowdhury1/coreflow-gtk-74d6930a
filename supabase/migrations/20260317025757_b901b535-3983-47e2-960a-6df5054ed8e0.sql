
-- RPC: create_worker_failure_alert
-- Called by workers after logging a failure to worker_runs.
-- Checks consecutive failures, notifies all admins with dedup.
CREATE OR REPLACE FUNCTION public.create_worker_failure_alert(
  _worker_name text,
  _error_summary text DEFAULT 'Unknown error'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consecutive int;
  _severity text;
  _title text;
  _body text;
  _admin record;
BEGIN
  -- Count consecutive recent failures for this worker (no success in between)
  SELECT COUNT(*) INTO _consecutive
  FROM (
    SELECT status FROM public.worker_runs
    WHERE worker_name = _worker_name
    ORDER BY started_at DESC
    LIMIT 10
  ) recent
  WHERE recent.status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT status, started_at FROM public.worker_runs
        WHERE worker_name = _worker_name
        ORDER BY started_at DESC
        LIMIT 10
      ) r2
      WHERE r2.status = 'success'
        AND r2.started_at > (
          SELECT MIN(started_at) FROM public.worker_runs
          WHERE worker_name = _worker_name AND status = 'failed'
          ORDER BY started_at DESC
          LIMIT 1
        )
    );

  -- Simpler: just count consecutive failures from the top
  SELECT COUNT(*) INTO _consecutive
  FROM (
    SELECT status, ROW_NUMBER() OVER (ORDER BY started_at DESC) as rn
    FROM public.worker_runs
    WHERE worker_name = _worker_name
    ORDER BY started_at DESC
    LIMIT 10
  ) ranked
  WHERE ranked.status = 'failed'
    AND ranked.rn <= (
      SELECT COALESCE(MIN(rn2.rn) - 1, 10)
      FROM (
        SELECT status, ROW_NUMBER() OVER (ORDER BY started_at DESC) as rn
        FROM public.worker_runs
        WHERE worker_name = _worker_name
        ORDER BY started_at DESC
        LIMIT 10
      ) rn2
      WHERE rn2.status != 'failed'
    );

  _severity := CASE WHEN _consecutive >= 3 THEN 'critical'
                     WHEN _consecutive >= 2 THEN 'warning'
                     ELSE 'info' END;

  _title := CASE
    WHEN _consecutive >= 2 THEN 'Worker failing repeatedly: ' || _worker_name
    ELSE 'Worker failed: ' || _worker_name
  END;

  _body := _error_summary;
  IF _consecutive >= 2 THEN
    _body := _consecutive || ' consecutive failure(s). Latest: ' || _error_summary;
  END IF;

  -- Notify all admins across all workspaces (dedup: skip if unread notification exists within 1 hour)
  FOR _admin IN
    SELECT DISTINCT wm.user_id, wm.workspace_id
    FROM public.workspace_memberships wm
    WHERE wm.role = 'admin'
  LOOP
    -- Dedup: skip if an unread worker failure notification exists for this admin in the last hour
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = _admin.user_id
        AND workspace_id = _admin.workspace_id
        AND is_read = false
        AND title LIKE 'Worker fail%' || _worker_name || '%'
        AND created_at > (now() - interval '1 hour')
    ) THEN
      INSERT INTO public.notifications (workspace_id, user_id, title, body, link)
      VALUES (_admin.workspace_id, _admin.user_id, _title, _body, '/ops');
    END IF;
  END LOOP;
END;
$$;
