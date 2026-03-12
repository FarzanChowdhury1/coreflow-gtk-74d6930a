-- Use a deterministic shared secret embedded in the SECURITY DEFINER function
-- This is safe: function body is only visible to superusers
-- The same value must be set as WORKER_SECRET edge function env var

CREATE OR REPLACE FUNCTION public.invoke_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer cfw_worker_auth_2026_xK9mP3qR7nL5vT8hB2jY4dF6gA0wE1'
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
BEGIN
  PERFORM net.http_post(
    url := 'https://efhsckzltglpygmwezhj.supabase.co/functions/v1/asset-cleanup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer cfw_worker_auth_2026_xK9mP3qR7nL5vT8hB2jY4dF6gA0wE1'
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;
