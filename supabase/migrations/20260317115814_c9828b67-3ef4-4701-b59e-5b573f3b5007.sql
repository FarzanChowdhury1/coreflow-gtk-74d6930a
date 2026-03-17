
CREATE OR REPLACE FUNCTION public.fetch_prioritized_notifications(_user_id uuid, _limit integer DEFAULT 50)
RETURNS SETOF public.notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.notifications
  WHERE user_id = _user_id
  ORDER BY
    is_read ASC,
    CASE severity
      WHEN 'critical' THEN 0
      WHEN 'warning'  THEN 1
      ELSE 2
    END ASC,
    created_at DESC
  LIMIT _limit;
$$;
