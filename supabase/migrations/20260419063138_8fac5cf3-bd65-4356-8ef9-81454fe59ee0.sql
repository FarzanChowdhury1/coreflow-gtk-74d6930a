-- Improve sweep to capture and surface errors per workspace for diagnostics
CREATE OR REPLACE FUNCTION public.sweep_finance_watchlist_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_err text;
  ws record;
BEGIN
  FOR ws IN
    SELECT id, name FROM public.workspaces WHERE deleted_at IS NULL
  LOOP
    BEGIN
      PERFORM public.refresh_finance_watchlist(ws.id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object('workspace_id', ws.id, 'name', ws.name, 'error', v_err);
    END;
  END LOOP;
  RETURN jsonb_build_object('refreshed', v_count, 'failed', v_failed, 'errors', v_errors, 'at', now());
END;
$function$;