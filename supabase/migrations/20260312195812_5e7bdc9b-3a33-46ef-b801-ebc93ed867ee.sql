-- Create helper functions that cron jobs call to invoke workers with proper auth
-- These read the WORKER_SECRET from vault at runtime

CREATE OR REPLACE FUNCTION public.invoke_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _secret text;
  _url text;
BEGIN
  SELECT decrypted_secret INTO _secret
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_SECRET';

  IF _secret IS NULL THEN
    RAISE WARNING 'WORKER_SECRET not found in vault';
    RETURN;
  END IF;

  _url := current_setting('app.settings.supabase_url', true);
  IF _url IS NULL OR _url = '' THEN
    _url := 'https://efhsckzltglpygmwezhj.supabase.co';
  END IF;

  PERFORM net.http_post(
    url := _url || '/functions/v1/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _secret
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
  _secret text;
  _url text;
BEGIN
  SELECT decrypted_secret INTO _secret
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_SECRET';

  IF _secret IS NULL THEN
    RAISE WARNING 'WORKER_SECRET not found in vault';
    RETURN;
  END IF;

  _url := current_setting('app.settings.supabase_url', true);
  IF _url IS NULL OR _url = '' THEN
    _url := 'https://efhsckzltglpygmwezhj.supabase.co';
  END IF;

  PERFORM net.http_post(
    url := _url || '/functions/v1/asset-cleanup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _secret
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;
