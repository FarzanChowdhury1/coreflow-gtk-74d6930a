-- Sweep function: refresh watchlist for every active workspace
CREATE OR REPLACE FUNCTION public.sweep_finance_watchlist_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_failed int := 0;
  ws record;
BEGIN
  FOR ws IN
    SELECT id FROM public.workspaces WHERE deleted_at IS NULL
  LOOP
    BEGIN
      PERFORM public.refresh_finance_watchlist(ws.id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('refreshed', v_count, 'failed', v_failed, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_finance_watchlist_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_finance_watchlist_all() TO service_role;

-- Schedule daily at 02:15 UTC (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep_finance_watchlist_daily') THEN
    PERFORM cron.schedule(
      'sweep_finance_watchlist_daily',
      '15 2 * * *',
      $cron$ SELECT public.sweep_finance_watchlist_all(); $cron$
    );
  END IF;
END $$;