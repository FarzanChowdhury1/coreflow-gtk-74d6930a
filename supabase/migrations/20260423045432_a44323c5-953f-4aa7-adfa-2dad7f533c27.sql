-- =========================================================================
-- COLLECTIONS CONTROL CENTER — REPAIR MIGRATION (idempotent)
-- =========================================================================

-- 1. workspaces.is_synthetic --------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_is_synthetic
  ON public.workspaces(is_synthetic) WHERE is_synthetic = true;

-- 2. collections_cases table --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collections_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  status public.collections_case_status NOT NULL DEFAULT 'new',
  priority public.collections_case_priority NOT NULL DEFAULT 'medium',
  owner_id uuid,
  next_action_at date,
  last_note text,
  recovered_amount numeric NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT collections_cases_unique_invoice UNIQUE (workspace_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_cases_workspace ON public.collections_cases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_collections_cases_invoice ON public.collections_cases(invoice_id);
CREATE INDEX IF NOT EXISTS idx_collections_cases_status ON public.collections_cases(workspace_id, status);

ALTER TABLE public.collections_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read collections cases" ON public.collections_cases;
DROP POLICY IF EXISTS "Admins insert collections cases" ON public.collections_cases;
DROP POLICY IF EXISTS "Admins update collections cases" ON public.collections_cases;
DROP POLICY IF EXISTS "Admins delete collections cases" ON public.collections_cases;

CREATE POLICY "Admins read collections cases" ON public.collections_cases
  FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins insert collections cases" ON public.collections_cases
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins update collections cases" ON public.collections_cases
  FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins delete collections cases" ON public.collections_cases
  FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_collections_cases_updated_at ON public.collections_cases;
CREATE TRIGGER trg_collections_cases_updated_at
  BEFORE UPDATE ON public.collections_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Hardened watchlist sweep (excludes synthetic + soft-deleted) ------------
CREATE OR REPLACE FUNCTION public.sweep_finance_watchlist_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_err text;
  ws record;
BEGIN
  FOR ws IN
    SELECT id, name FROM public.workspaces
    WHERE deleted_at IS NULL
      AND COALESCE(is_synthetic, false) = false
  LOOP
    BEGIN
      PERFORM public.refresh_finance_watchlist(ws.id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object('workspace_id', ws.id, 'name', ws.name, 'error', v_err);
    END;
  END LOOP;
  RETURN jsonb_build_object('refreshed', v_count, 'failed', v_failed, 'errors', v_errors, 'at', now());
END;
$function$;

-- 4. get_collections_overview RPC --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_collections_overview(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_runway numeric;
  v_collection_rate numeric;
  v_total_overdue numeric := 0;
  v_overdue_count int := 0;
  v_high_priority_count int := 0;
  v_recovered_period numeric := 0;
  v_at_risk_amount numeric := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  -- Permission check
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  -- Pull most recent finance snapshot for runway + collection rate context
  SELECT runway_months, collection_rate
    INTO v_runway, v_collection_rate
  FROM public.finance_snapshots
  WHERE workspace_id = _workspace_id
  ORDER BY snapshot_date DESC, created_at DESC
  LIMIT 1;

  -- Build queue + summary in one pass
  WITH overdue AS (
    SELECT
      i.id          AS invoice_id,
      i.invoice_number,
      i.company_id,
      c.legal_name  AS company_name,
      GREATEST(i.grand_total - COALESCE(i.amount_paid, 0), 0) AS amount_due,
      i.due_date,
      GREATEST((v_today - i.due_date)::int, 0) AS days_overdue
    FROM public.invoices i
    LEFT JOIN public.companies c ON c.id = i.company_id
    WHERE i.workspace_id = _workspace_id
      AND i.deleted_at IS NULL
      AND i.status IN ('issued'::invoice_status, 'partially_paid'::invoice_status)
      AND i.due_date IS NOT NULL
      AND i.due_date < v_today
      AND GREATEST(i.grand_total - COALESCE(i.amount_paid, 0), 0) > 0
  ),
  enriched AS (
    SELECT
      o.*,
      CASE
        WHEN o.amount_due >= 100000
          OR o.days_overdue >= 60
          OR (v_runway IS NOT NULL AND v_runway < 2)
          OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.5)
          THEN 'high'
        WHEN o.amount_due >= 25000
          OR o.days_overdue >= 21
          OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.75)
          THEN 'medium'
        ELSE 'low'
      END AS derived_priority,
      cc.id              AS case_id,
      cc.status          AS case_status,
      cc.priority        AS case_priority,
      cc.owner_id        AS case_owner_id,
      cc.next_action_at  AS case_next_action_at,
      cc.last_note       AS case_last_note,
      cc.recovered_amount AS case_recovered_amount,
      cc.updated_at      AS case_updated_at
    FROM overdue o
    LEFT JOIN public.collections_cases cc
      ON cc.workspace_id = _workspace_id AND cc.invoice_id = o.invoice_id
  )
  SELECT
    COALESCE(SUM(amount_due), 0),
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE derived_priority = 'high')::int,
    COALESCE(SUM(amount_due) FILTER (WHERE derived_priority = 'high'), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', invoice_number,
      'company_id', company_id,
      'company_name', company_name,
      'amount_due', amount_due,
      'due_date', due_date,
      'days_overdue', days_overdue,
      'derived_priority', derived_priority,
      'case_id', case_id,
      'status', case_status,
      'priority', case_priority,
      'owner_id', case_owner_id,
      'next_action_at', case_next_action_at,
      'last_note', case_last_note,
      'recovered_amount', case_recovered_amount,
      'updated_at', case_updated_at
    ) ORDER BY
        (derived_priority = 'high') DESC,
        (derived_priority = 'medium') DESC,
        days_overdue DESC,
        amount_due DESC
    ), '[]'::jsonb)
    INTO v_total_overdue, v_overdue_count, v_high_priority_count, v_at_risk_amount, v_items
  FROM enriched;

  -- Recovered in trailing 30 days (sum of recovered_amount on cases updated in window)
  SELECT COALESCE(SUM(recovered_amount), 0)
    INTO v_recovered_period
  FROM public.collections_cases
  WHERE workspace_id = _workspace_id
    AND updated_at >= now() - interval '30 days';

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_overdue', v_total_overdue,
      'overdue_count', v_overdue_count,
      'high_priority_count', v_high_priority_count,
      'recovered_period', v_recovered_period,
      'at_risk_amount', v_at_risk_amount,
      'runway_months', v_runway,
      'collection_rate', v_collection_rate,
      'as_of', v_today
    ),
    'items', v_items
  );
END;
$function$;

-- 5. upsert_collections_case RPC ---------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_collections_case(
  _workspace_id uuid,
  _invoice_id uuid,
  _status public.collections_case_status DEFAULT NULL,
  _priority public.collections_case_priority DEFAULT NULL,
  _owner_id uuid DEFAULT NULL,
  _next_action_at date DEFAULT NULL,
  _last_note text DEFAULT NULL,
  _recovered_amount numeric DEFAULT NULL
)
RETURNS public.collections_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.collections_cases;
BEGIN
  IF NOT has_workspace_role(v_uid, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = _invoice_id AND workspace_id = _workspace_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.collections_cases AS cc (
    workspace_id, invoice_id, status, priority, owner_id,
    next_action_at, last_note, recovered_amount, created_by, updated_by
  )
  VALUES (
    _workspace_id, _invoice_id,
    COALESCE(_status, 'new'::collections_case_status),
    COALESCE(_priority, 'medium'::collections_case_priority),
    _owner_id, _next_action_at, _last_note,
    COALESCE(_recovered_amount, 0), v_uid, v_uid
  )
  ON CONFLICT (workspace_id, invoice_id) DO UPDATE
    SET status            = COALESCE(_status, cc.status),
        priority          = COALESCE(_priority, cc.priority),
        owner_id          = COALESCE(_owner_id, cc.owner_id),
        next_action_at    = COALESCE(_next_action_at, cc.next_action_at),
        last_note         = COALESCE(_last_note, cc.last_note),
        recovered_amount  = COALESCE(_recovered_amount, cc.recovered_amount),
        updated_by        = v_uid,
        closed_at         = CASE
                              WHEN COALESCE(_status, cc.status) IN ('recovered','closed')
                                THEN COALESCE(cc.closed_at, now())
                              ELSE NULL
                            END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_collections_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_collections_case(uuid, uuid, public.collections_case_status, public.collections_case_priority, uuid, date, text, numeric) TO authenticated;