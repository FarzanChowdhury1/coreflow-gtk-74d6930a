
-- Add severity column with sensible default
ALTER TABLE public.notifications
ADD COLUMN severity text NOT NULL DEFAULT 'info';

-- Backfill existing worker failure notifications using title heuristics
UPDATE public.notifications
SET severity = 'critical'
WHERE severity = 'info'
  AND title LIKE '%[CRITICAL]%';

UPDATE public.notifications
SET severity = 'warning'
WHERE severity = 'info'
  AND title LIKE '%[WARNING]%';

UPDATE public.notifications
SET severity = 'warning'
WHERE severity = 'info'
  AND title LIKE 'Worker failed:%';

-- Update the worker failure alert RPC to write severity explicitly
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
    WHEN _consecutive >= 3 THEN '[CRITICAL] Worker failing repeatedly: ' || _worker_name
    WHEN _consecutive >= 2 THEN '[WARNING] Worker failing repeatedly: ' || _worker_name
    ELSE 'Worker failed: ' || _worker_name
  END;

  _body := _error_summary;
  IF _consecutive >= 2 THEN
    _body := _consecutive || ' consecutive failure(s). Latest: ' || _error_summary;
  END IF;

  FOR _admin IN
    SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
    FROM public.workspace_memberships wm
    WHERE wm.role = 'admin'
    ORDER BY wm.user_id, wm.created_at ASC
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = _admin.user_id
        AND is_read = false
        AND title LIKE '%Worker fail%' || _worker_name || '%'
        AND created_at > (now() - interval '1 hour')
    ) THEN
      INSERT INTO public.notifications (workspace_id, user_id, title, body, link, severity)
      VALUES (_admin.workspace_id, _admin.user_id, _title, _body, '/ops', _severity);
    END IF;
  END LOOP;
END;
$$;
