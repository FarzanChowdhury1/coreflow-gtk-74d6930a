CREATE OR REPLACE FUNCTION public.fetch_prioritized_notifications(
  _user_id uuid,
  _limit integer DEFAULT 20,
  _workspace_id uuid DEFAULT NULL
)
RETURNS SETOF public.notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.*
  FROM public.notifications n
  JOIN public.workspaces w ON w.id = n.workspace_id
  WHERE n.user_id = _user_id
    AND w.deleted_at IS NULL
    AND (_workspace_id IS NULL OR n.workspace_id = _workspace_id)
  ORDER BY
    n.is_read ASC,
    CASE n.severity
      WHEN 'critical' THEN 0
      WHEN 'warning'  THEN 1
      ELSE 2
    END ASC,
    n.created_at DESC
  LIMIT _limit;
$$;