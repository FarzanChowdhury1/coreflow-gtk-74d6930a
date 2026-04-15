
-- Add category column to notifications for preference enforcement
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system_alert';

-- Create index for category-based filtering
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications(category);

-- Update the fetch RPC to filter out disabled in-app categories
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
  LEFT JOIN public.notification_preferences np
    ON np.user_id = n.user_id
    AND np.workspace_id = n.workspace_id
    AND np.category::text = n.category
  WHERE n.user_id = _user_id
    AND w.deleted_at IS NULL
    AND (_workspace_id IS NULL OR n.workspace_id = _workspace_id)
    -- If no preference row exists, default to enabled (true)
    AND COALESCE(np.in_app_enabled, true) = true
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

-- Maintain existing grants
REVOKE EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_prioritized_notifications(uuid, integer, uuid) TO authenticated, service_role;
