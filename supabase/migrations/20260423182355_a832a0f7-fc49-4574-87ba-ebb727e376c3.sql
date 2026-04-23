-- Consolidated Collections repair migration
-- Idempotent. Composite-type free. jsonb-only RPC returns.

-- 1) Synthetic flag on workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_is_synthetic
  ON public.workspaces (is_synthetic)
  WHERE is_synthetic = true;

-- 2) Enums
DO $$ BEGIN
  CREATE TYPE public.collections_case_status AS ENUM ('new','in_progress','promised','escalated','recovered','written_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.collections_case_priority AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Table
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
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_cases_workspace ON public.collections_cases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_collections_cases_invoice ON public.collections_cases(invoice_id);
CREATE INDEX IF NOT EXISTS idx_collections_cases_status ON public.collections_cases(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_collections_cases_owner ON public.collections_cases(workspace_id, owner_id);

-- 4) RLS + policies
ALTER TABLE public.collections_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read collections cases" ON public.collections_cases;
CREATE POLICY "Admins read collections cases"
  ON public.collections_cases FOR SELECT TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Admins insert collections cases" ON public.collections_cases;
CREATE POLICY "Admins insert collections cases"
  ON public.collections_cases FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update collections cases" ON public.collections_cases;
CREATE POLICY "Admins update collections cases"
  ON public.collections_cases FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete collections cases" ON public.collections_cases;
CREATE POLICY "Admins delete collections cases"
  ON public.collections_cases FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'::app_role));

-- 5) updated_at trigger
DROP TRIGGER IF EXISTS trg_collections_cases_updated_at ON public.collections_cases;
CREATE TRIGGER trg_collections_cases_updated_at
  BEFORE UPDATE ON public.collections_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Drop any prior composite-typed overloads of upsert_collections_case
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_collections_case'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- 7) get_collections_overview(uuid) — jsonb only, valid invoice statuses only
CREATE OR REPLACE FUNCTION public.get_collections_overview(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  WITH overdue AS (
    SELECT i.id AS invoice_id,
           i.invoice_number,
           i.company_id,
           i.grand_total,
           i.amount_paid,
           (i.grand_total - i.amount_paid) AS balance_due,
           i.due_date,
           i.status,
           GREATEST(0, (CURRENT_DATE - i.due_date))::int AS days_overdue,
           c.legal_name AS company_name
    FROM public.invoices i
    LEFT JOIN public.companies c ON c.id = i.company_id
    WHERE i.workspace_id = _workspace_id
      AND i.deleted_at IS NULL
      AND i.status IN ('issued','partially_paid')
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
      AND (i.grand_total - i.amount_paid) > 0
  ),
  joined AS (
    SELECT o.*,
           cc.id AS case_id,
           cc.status AS case_status,
           cc.priority AS case_priority,
           cc.owner_id,
           cc.next_action_at,
           cc.last_note,
           cc.recovered_amount,
           cc.closed_at,
           cc.updated_at AS case_updated_at
    FROM overdue o
    LEFT JOIN public.collections_cases cc
      ON cc.workspace_id = _workspace_id AND cc.invoice_id = o.invoice_id
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'overdue_count', (SELECT count(*) FROM overdue),
      'overdue_balance', COALESCE((SELECT sum(balance_due) FROM overdue), 0),
      'open_cases', (SELECT count(*) FROM joined WHERE case_id IS NOT NULL AND closed_at IS NULL),
      'recovered_total', COALESCE((SELECT sum(recovered_amount) FROM joined WHERE case_id IS NOT NULL), 0)
    ),
    'queue', COALESCE((
      SELECT jsonb_agg(to_jsonb(j) ORDER BY j.days_overdue DESC)
      FROM joined j
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_collections_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_collections_overview(uuid) TO authenticated;

-- 8) upsert_collections_case — jsonb return, single canonical signature
CREATE OR REPLACE FUNCTION public.upsert_collections_case(
  _workspace_id uuid,
  _invoice_id uuid,
  _status text DEFAULT NULL,
  _priority text DEFAULT NULL,
  _owner_id uuid DEFAULT NULL,
  _next_action_at date DEFAULT NULL,
  _last_note text DEFAULT NULL,
  _recovered_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_status public.collections_case_status;
  v_priority public.collections_case_priority;
  v_row public.collections_cases%ROWTYPE;
  v_invoice_ws uuid;
BEGIN
  IF NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT workspace_id INTO v_invoice_ws FROM public.invoices WHERE id = _invoice_id;
  IF v_invoice_ws IS NULL OR v_invoice_ws <> _workspace_id THEN
    RAISE EXCEPTION 'invoice_not_in_workspace';
  END IF;

  v_status := COALESCE(NULLIF(_status,'')::public.collections_case_status, 'new'::public.collections_case_status);
  v_priority := COALESCE(NULLIF(_priority,'')::public.collections_case_priority, 'medium'::public.collections_case_priority);

  INSERT INTO public.collections_cases AS cc (
    workspace_id, invoice_id, status, priority, owner_id,
    next_action_at, last_note, recovered_amount, created_by, updated_by
  ) VALUES (
    _workspace_id, _invoice_id, v_status, v_priority, _owner_id,
    _next_action_at, _last_note, COALESCE(_recovered_amount, 0), auth.uid(), auth.uid()
  )
  ON CONFLICT (workspace_id, invoice_id) DO UPDATE SET
    status = COALESCE(NULLIF(_status,'')::public.collections_case_status, cc.status),
    priority = COALESCE(NULLIF(_priority,'')::public.collections_case_priority, cc.priority),
    owner_id = COALESCE(_owner_id, cc.owner_id),
    next_action_at = COALESCE(_next_action_at, cc.next_action_at),
    last_note = COALESCE(_last_note, cc.last_note),
    recovered_amount = COALESCE(_recovered_amount, cc.recovered_amount),
    closed_at = CASE
      WHEN COALESCE(NULLIF(_status,'')::public.collections_case_status, cc.status) IN ('recovered','written_off') THEN COALESCE(cc.closed_at, now())
      ELSE NULL
    END,
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING id INTO v_id;

  SELECT * INTO v_row FROM public.collections_cases WHERE id = v_id;
  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_collections_case(uuid, uuid, text, text, uuid, date, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_collections_case(uuid, uuid, text, text, uuid, date, text, numeric) TO authenticated;

-- 9) Hardened sweep_finance_watchlist_all — skips deleted + synthetic workspaces
CREATE OR REPLACE FUNCTION public.sweep_finance_watchlist_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_err text;
  ws record;
BEGIN
  FOR ws IN
    SELECT id, name
    FROM public.workspaces
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

  SELECT count(*) INTO v_skipped
  FROM public.workspaces
  WHERE deleted_at IS NOT NULL OR COALESCE(is_synthetic, false) = true;

  RETURN jsonb_build_object(
    'refreshed', v_count,
    'failed', v_failed,
    'skipped', v_skipped,
    'errors', v_errors,
    'at', now()
  );
END;
$function$;