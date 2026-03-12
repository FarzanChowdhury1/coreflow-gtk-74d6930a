-- Update cron helpers to use X-Worker-Secret header instead of Authorization
-- This avoids Supabase gateway intercepting/replacing the Authorization header

CREATE OR REPLACE FUNCTION public.invoke_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _key text;
BEGIN
  SELECT decrypted_secret INTO _key
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_AUTH_KEY';

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'WORKER_AUTH_KEY not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Worker-Secret', _key
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
  SELECT decrypted_secret INTO _key
  FROM vault.decrypted_secrets
  WHERE name = 'WORKER_AUTH_KEY';

  IF _key IS NULL OR _key = '' THEN
    RAISE WARNING 'WORKER_AUTH_KEY not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/asset-cleanup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Worker-Secret', _key
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;
