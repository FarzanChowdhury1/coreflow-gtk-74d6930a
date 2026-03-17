
CREATE OR REPLACE FUNCTION public.purge_old_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_info   integer;
  _deleted_warn   integer;
  _deleted_crit   integer;
BEGIN
  -- Read info: purge after 30 days
  DELETE FROM public.notifications
  WHERE is_read = true
    AND (severity = 'info' OR severity IS NULL)
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS _deleted_info = ROW_COUNT;

  -- Read warning: purge after 90 days
  DELETE FROM public.notifications
  WHERE is_read = true
    AND severity = 'warning'
    AND created_at < now() - interval '90 days';
  GET DIAGNOSTICS _deleted_warn = ROW_COUNT;

  -- Read critical: purge after 180 days
  DELETE FROM public.notifications
  WHERE is_read = true
    AND severity = 'critical'
    AND created_at < now() - interval '180 days';
  GET DIAGNOSTICS _deleted_crit = ROW_COUNT;

  RETURN jsonb_build_object(
    'purged_info', _deleted_info,
    'purged_warning', _deleted_warn,
    'purged_critical', _deleted_crit
  );
END;
$$;
