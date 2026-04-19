
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.collections_case_status AS ENUM (
    'new','contacted','promised','partial','escalated','recovered','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.collections_case_priority AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cases table (one row per invoice, lazily created when admin acts on it)
CREATE TABLE IF NOT EXISTS public.collections_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL REFERENCES public.invoices(id)   ON DELETE CASCADE,
  status          public.collections_case_status   NOT NULL DEFAULT 'new',
  priority        public.collections_case_priority NOT NULL DEFAULT 'medium',
  owner_id        uuid,
  next_action_at  date,
  last_note       text,
  recovered_amount numeric NOT NULL DEFAULT 0,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  CONSTRAINT collections_cases_invoice_unique UNIQUE (workspace_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_cases_workspace ON public.collections_cases (workspace_id);
CREATE INDEX IF NOT EXISTS idx_collections_cases_status    ON public.collections_cases (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_collections_cases_invoice   ON public.collections_cases (invoice_id);

ALTER TABLE public.collections_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read collections cases"
ON public.collections_cases FOR SELECT TO authenticated
USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins insert collections cases"
ON public.collections_cases FOR INSERT TO authenticated
WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins update collections cases"
ON public.collections_cases FOR UPDATE TO authenticated
USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

CREATE POLICY "Admins delete collections cases"
ON public.collections_cases FOR DELETE TO authenticated
USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

-- updated_at trigger (reusing global helper)
DROP TRIGGER IF EXISTS trg_collections_cases_updated_at ON public.collections_cases;
CREATE TRIGGER trg_collections_cases_updated_at
BEFORE UPDATE ON public.collections_cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Overview RPC: returns overdue invoices joined with case state + summary
CREATE OR REPLACE FUNCTION public.get_collections_overview(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_runway numeric;
  v_collection_rate numeric;
  v_items jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_workspace_role(v_uid, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  -- Pull the latest finance signals (used in priority logic)
  SELECT runway_months, collection_rate
  INTO v_runway, v_collection_rate
  FROM public.finance_snapshots
  WHERE workspace_id = _workspace_id
    AND source = 'finance'
  ORDER BY snapshot_date DESC, created_at DESC
  LIMIT 1;

  WITH overdue AS (
    SELECT i.id, i.invoice_number, i.company_id, i.grand_total, i.amount_paid,
           (i.grand_total - i.amount_paid) AS amount_due,
           i.due_date,
           GREATEST(0, (v_today - i.due_date)) AS days_overdue,
           c.legal_name AS company_name
    FROM public.invoices i
    JOIN public.companies c ON c.id = i.company_id
    WHERE i.workspace_id = _workspace_id
      AND i.deleted_at IS NULL
      AND i.due_date IS NOT NULL
      AND i.due_date < v_today
      AND i.status IN ('issued','partially_paid')
      AND (i.grand_total - i.amount_paid) > 0
  ),
  scored AS (
    SELECT o.*,
      CASE
        WHEN o.amount_due >= 100000 OR o.days_overdue >= 60
             OR (v_runway IS NOT NULL AND v_runway < 2)
             OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.5)
          THEN 'high'
        WHEN o.amount_due >= 25000 OR o.days_overdue >= 21
             OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.75)
          THEN 'medium'
        ELSE 'low'
      END AS derived_priority
    FROM overdue o
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id',       s.id,
    'invoice_number',   s.invoice_number,
    'company_id',       s.company_id,
    'company_name',     s.company_name,
    'amount_due',       s.amount_due,
    'due_date',         s.due_date,
    'days_overdue',     s.days_overdue,
    'derived_priority', s.derived_priority,
    'case_id',          cc.id,
    'status',           COALESCE(cc.status::text, 'new'),
    'priority',         COALESCE(cc.priority::text, s.derived_priority),
    'owner_id',         cc.owner_id,
    'next_action_at',   cc.next_action_at,
    'last_note',        cc.last_note,
    'recovered_amount', COALESCE(cc.recovered_amount, 0),
    'updated_at',       cc.updated_at
  ) ORDER BY
      CASE COALESCE(cc.priority::text, s.derived_priority)
        WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2
      END,
      s.days_overdue DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM scored s
  LEFT JOIN public.collections_cases cc
    ON cc.workspace_id = _workspace_id AND cc.invoice_id = s.id;

  WITH overdue AS (
    SELECT i.id, (i.grand_total - i.amount_paid) AS amount_due,
           GREATEST(0, (v_today - i.due_date)) AS days_overdue
    FROM public.invoices i
    WHERE i.workspace_id = _workspace_id
      AND i.deleted_at IS NULL
      AND i.due_date IS NOT NULL
      AND i.due_date < v_today
      AND i.status IN ('issued','partially_paid')
      AND (i.grand_total - i.amount_paid) > 0
  ),
  scored AS (
    SELECT o.*,
      CASE
        WHEN o.amount_due >= 100000 OR o.days_overdue >= 60
             OR (v_runway IS NOT NULL AND v_runway < 2)
             OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.5)
          THEN 'high'
        WHEN o.amount_due >= 25000 OR o.days_overdue >= 21
             OR (v_collection_rate IS NOT NULL AND v_collection_rate < 0.75)
          THEN 'medium'
        ELSE 'low'
      END AS derived_priority
    FROM overdue o
  )
  SELECT jsonb_build_object(
    'total_overdue',      COALESCE((SELECT SUM(amount_due) FROM scored), 0),
    'overdue_count',      (SELECT COUNT(*) FROM scored),
    'high_priority_count',(SELECT COUNT(*) FROM scored s
                            LEFT JOIN public.collections_cases cc
                              ON cc.workspace_id = _workspace_id AND cc.invoice_id = s.id
                            WHERE COALESCE(cc.priority::text, s.derived_priority) = 'high'),
    'recovered_period',   COALESCE((SELECT SUM(recovered_amount) FROM public.collections_cases
                                     WHERE workspace_id = _workspace_id
                                       AND updated_at >= now() - interval '30 days'), 0),
    'at_risk_amount',     COALESCE((SELECT SUM(s.amount_due) FROM scored s
                                     LEFT JOIN public.collections_cases cc
                                       ON cc.workspace_id = _workspace_id AND cc.invoice_id = s.id
                                     WHERE COALESCE(cc.priority::text, s.derived_priority) = 'high'), 0),
    'runway_months',      v_runway,
    'collection_rate',    v_collection_rate,
    'as_of',              now()
  )
  INTO v_summary;

  RETURN jsonb_build_object('summary', v_summary, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.get_collections_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_collections_overview(uuid) TO authenticated;

-- Upsert RPC for follow-up updates (admin-only, server-enforced)
CREATE OR REPLACE FUNCTION public.upsert_collections_case(
  _workspace_id uuid,
  _invoice_id   uuid,
  _status       text,
  _priority     text,
  _owner_id     uuid,
  _next_action_at date,
  _last_note    text,
  _recovered_amount numeric
)
RETURNS public.collections_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.collections_cases;
  v_status   public.collections_case_status   := COALESCE(_status::public.collections_case_status,'new');
  v_priority public.collections_case_priority := COALESCE(_priority::public.collections_case_priority,'medium');
BEGIN
  IF v_uid IS NULL OR NOT public.has_workspace_role(v_uid, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.invoices
                 WHERE id = _invoice_id AND workspace_id = _workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invoice not found' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.collections_cases AS cc (
    workspace_id, invoice_id, status, priority, owner_id, next_action_at,
    last_note, recovered_amount, created_by, updated_by,
    closed_at
  )
  VALUES (
    _workspace_id, _invoice_id, v_status, v_priority, _owner_id, _next_action_at,
    _last_note, COALESCE(_recovered_amount,0), v_uid, v_uid,
    CASE WHEN v_status IN ('recovered','closed') THEN now() ELSE NULL END
  )
  ON CONFLICT (workspace_id, invoice_id) DO UPDATE SET
    status           = EXCLUDED.status,
    priority         = EXCLUDED.priority,
    owner_id         = EXCLUDED.owner_id,
    next_action_at   = EXCLUDED.next_action_at,
    last_note        = EXCLUDED.last_note,
    recovered_amount = EXCLUDED.recovered_amount,
    updated_by       = v_uid,
    closed_at        = CASE WHEN EXCLUDED.status IN ('recovered','closed') THEN now() ELSE NULL END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_collections_case(uuid,uuid,text,text,uuid,date,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_collections_case(uuid,uuid,text,text,uuid,date,text,numeric) TO authenticated;
