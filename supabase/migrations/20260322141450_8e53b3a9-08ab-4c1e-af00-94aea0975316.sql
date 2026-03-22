
-- RPC: Swap sort_order of two client_tasks atomically
CREATE OR REPLACE FUNCTION public.swap_client_task_order(
  _task_a uuid,
  _task_b uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_a int;
  _order_b int;
  _ws_a uuid;
  _ws_b uuid;
BEGIN
  SELECT sort_order, workspace_id INTO _order_a, _ws_a FROM client_tasks WHERE id = _task_a;
  SELECT sort_order, workspace_id INTO _order_b, _ws_b FROM client_tasks WHERE id = _task_b;

  IF _order_a IS NULL OR _order_b IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;
  IF _ws_a != _ws_b THEN
    RAISE EXCEPTION 'Tasks must belong to same workspace';
  END IF;
  -- Verify caller is admin
  IF NOT has_workspace_role(auth.uid(), _ws_a, 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE client_tasks SET sort_order = _order_b, updated_at = now() WHERE id = _task_a;
  UPDATE client_tasks SET sort_order = _order_a, updated_at = now() WHERE id = _task_b;
END;
$$;

-- RPC: Get next sort_order for a company's tasks
CREATE OR REPLACE FUNCTION public.next_client_task_order(
  _company_id uuid,
  _workspace_id uuid
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM client_tasks
  WHERE company_id = _company_id AND workspace_id = _workspace_id;
$$;

-- RPC: Normalize sort_order for a company's tasks (close gaps)
CREATE OR REPLACE FUNCTION public.normalize_client_task_order(
  _company_id uuid,
  _workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1 AS new_order
    FROM client_tasks
    WHERE company_id = _company_id AND workspace_id = _workspace_id
  )
  UPDATE client_tasks ct
  SET sort_order = r.new_order, updated_at = now()
  FROM ranked r
  WHERE ct.id = r.id AND ct.sort_order != r.new_order;
END;
$$;
