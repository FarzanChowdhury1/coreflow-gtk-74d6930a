-- Update cron helpers to use the service_role_key for auth
-- Workers already accept SERVICE_ROLE_KEY as a valid auth token

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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmaHNja3psdGdscHlnbXdlemhqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzI0ODQwMCwiZXhwIjoyMDg4ODI0NDAwfQ.TFDebQIXHeOwuKbpbozyVyHMaX9DIcFP0e0E6OR6B1M'
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmaHNja3psdGdscHlnbXdlemhqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzI0ODQwMCwiZXhwIjoyMDg4ODI0NDAwfQ.TFDebQIXHeOwuKbpbozyVyHMaX9DIcFP0e0E6OR6B1M'
    ),
    body := jsonb_build_object('time', now())
  );
END;
$$;
