
-- 1. Structural exclusion flag
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_is_synthetic
  ON public.workspaces (is_synthetic)
  WHERE is_synthetic = true;

-- 2. Mark current fixture workspaces as synthetic (covers all current and historical naming patterns)
UPDATE public.workspaces
SET is_synthetic = true
WHERE name LIKE 'runway_verify_%'
   OR name LIKE 'lender_verify_%'
   OR name LIKE 'burden_verify_%'
   OR name LIKE 'finance_verify_%'
   OR name LIKE '%-test-cleaned';

-- 3. Purge finance artifacts tied to synthetic workspaces
DELETE FROM public.finance_watchlist_items
WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE is_synthetic = true);

DELETE FROM public.finance_snapshots
WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE is_synthetic = true);

-- Verification-only tables: clear them entirely (fixture-only by definition)
TRUNCATE public.runway_forecast_verification_runs;
TRUNCATE public.lender_readiness_verification_runs;

-- 4. Soft-delete the synthetic workspaces so they vanish from the app
UPDATE public.workspaces
SET deleted_at = COALESCE(deleted_at, now())
WHERE is_synthetic = true;

-- 5. Harden sweep to structurally exclude synthetic + deleted workspaces
CREATE OR REPLACE FUNCTION public.sweep_finance_watchlist_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_err text;
  ws record;
BEGIN
  FOR ws IN
    SELECT id, name
    FROM public.workspaces
    WHERE deleted_at IS NULL
      AND is_synthetic = false
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

  SELECT count(*) INTO v_skipped
  FROM public.workspaces
  WHERE deleted_at IS NOT NULL OR is_synthetic = true;

  RETURN jsonb_build_object(
    'refreshed', v_count,
    'failed', v_failed,
    'skipped', v_skipped,
    'errors', v_errors,
    'at', now()
  );
END;
$function$;
