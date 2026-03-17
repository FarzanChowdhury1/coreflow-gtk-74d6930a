
-- Add trigger source and actor attribution columns to worker_runs
ALTER TABLE public.worker_runs
  ADD COLUMN trigger_source text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN triggered_by uuid NULL;

-- Add constraint for valid source values via trigger (not CHECK, per guidelines)
CREATE OR REPLACE FUNCTION public.validate_worker_run_trigger_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.trigger_source NOT IN ('scheduled', 'manual') THEN
    RAISE EXCEPTION 'Invalid trigger_source: %', NEW.trigger_source;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_worker_run_trigger_source
  BEFORE INSERT OR UPDATE ON public.worker_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_worker_run_trigger_source();
