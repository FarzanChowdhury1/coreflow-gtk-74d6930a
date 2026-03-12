-- Update helper functions to use service_role_key instead of WORKER_SECRET from vault
-- The service_role_key is always available and can be read from the environment

CREATE OR REPLACE FUNCTION public.invoke_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _key text;
BEGIN
  -- Use the service_role key from Supabase project settings (always available)
  _key := current_setting('supabase.service_role_key', true);
  
  -- Fallback: read from vault if project setting unavailable
  IF _key IS NULL OR _key = '' THEN
    SELECT decrypted_secret INTO _key
    FROM vault.decrypted_secrets
    WHERE name = 'WORKER_SECRET';
  END IF;

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'No auth key available for worker invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _key
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_asset_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _key text;
BEGIN
  _key := current_setting('supabase.service_role_key', true);
  
  IF _key IS NULL OR _key = '' THEN
    SELECT decrypted_secret INTO _key
    FROM vault.decrypted_secrets
    WHERE name = 'WORKER_SECRET';
  END IF;

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'No auth key available for worker invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/asset-cleanup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _key
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;
