-- =========================================================
-- Finance Snapshot Engine + Watchlist
-- =========================================================

CREATE TABLE IF NOT EXISTS public.finance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  source text NOT NULL CHECK (source IN ('finance_analytics','lender_readiness','burden_analytics','runway_forecast')),
  band text,
  data_quality text,
  score numeric,
  runway_months numeric,
  cash_proxy numeric,
  collection_rate numeric,
  overdue_amount numeric,
  recurring_monthly_burden numeric,
  vendor_concentration_pct numeric,
  burden_vs_inflow_pct numeric,
  budget_status text,
  summary text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_snapshots_unique_per_day UNIQUE (workspace_id, snapshot_date, source)
);

CREATE INDEX IF NOT EXISTS idx_finance_snapshots_ws_source_date
  ON public.finance_snapshots (workspace_id, source, snapshot_date DESC);

ALTER TABLE public.finance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read finance snapshots" ON public.finance_snapshots;
CREATE POLICY "Admins read finance snapshots"
  ON public.finance_snapshots FOR SELECT
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.finance_watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','warning','info')),
  title text NOT NULL,
  what_changed text NOT NULL,
  why_it_matters text NOT NULL,
  recommended_action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_dismissed boolean NOT NULL DEFAULT false,
  dismissed_at timestamptz,
  dismissed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_watchlist_unique_active UNIQUE (workspace_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_finance_watchlist_ws_active
  ON public.finance_watchlist_items (workspace_id, is_dismissed, severity);

ALTER TABLE public.finance_watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read finance watchlist" ON public.finance_watchlist_items;
CREATE POLICY "Admins read finance watchlist"
  ON public.finance_watchlist_items FOR SELECT
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update finance watchlist" ON public.finance_watchlist_items;
CREATE POLICY "Admins update finance watchlist"
  ON public.finance_watchlist_items FOR UPDATE
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- ---------------- take_finance_snapshot ----------------
CREATE OR REPLACE FUNCTION public.take_finance_snapshot(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_finance jsonb;
  v_lender  jsonb;
  v_burden  jsonb;
  v_runway  jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_finance := public.get_finance_analytics(_workspace_id);
  v_lender  := public.get_lender_readiness(_workspace_id);
  v_burden  := public.get_burden_analytics(_workspace_id, 90);
  v_runway  := public.get_runway_forecast(_workspace_id);

  INSERT INTO public.finance_snapshots
    (workspace_id, snapshot_date, source, score, collection_rate, overdue_amount, summary, payload)
  VALUES (_workspace_id, v_today, 'finance_analytics',
    NULLIF(v_finance->>'score','')::numeric,
    NULLIF(v_finance->>'collection_rate','')::numeric,
    NULLIF(v_finance->>'overdue_amount','')::numeric,
    v_finance->>'summary', v_finance)
  ON CONFLICT (workspace_id, snapshot_date, source) DO UPDATE SET
    score = EXCLUDED.score,
    collection_rate = EXCLUDED.collection_rate,
    overdue_amount = EXCLUDED.overdue_amount,
    summary = EXCLUDED.summary,
    payload = EXCLUDED.payload;

  INSERT INTO public.finance_snapshots
    (workspace_id, snapshot_date, source, band, score, summary, payload)
  VALUES (_workspace_id, v_today, 'lender_readiness',
    v_lender->>'band',
    NULLIF(v_lender->>'score','')::numeric,
    v_lender->>'summary', v_lender)
  ON CONFLICT (workspace_id, snapshot_date, source) DO UPDATE SET
    band = EXCLUDED.band,
    score = EXCLUDED.score,
    summary = EXCLUDED.summary,
    payload = EXCLUDED.payload;

  INSERT INTO public.finance_snapshots
    (workspace_id, snapshot_date, source, recurring_monthly_burden, vendor_concentration_pct, burden_vs_inflow_pct, summary, payload)
  VALUES (_workspace_id, v_today, 'burden_analytics',
    NULLIF(v_burden->>'recurring_monthly_burden','')::numeric,
    NULLIF(v_burden->>'vendor_concentration_pct','')::numeric,
    NULLIF(v_burden->>'burden_vs_inflow_pct','')::numeric,
    v_burden->>'summary', v_burden)
  ON CONFLICT (workspace_id, snapshot_date, source) DO UPDATE SET
    recurring_monthly_burden = EXCLUDED.recurring_monthly_burden,
    vendor_concentration_pct = EXCLUDED.vendor_concentration_pct,
    burden_vs_inflow_pct = EXCLUDED.burden_vs_inflow_pct,
    summary = EXCLUDED.summary,
    payload = EXCLUDED.payload;

  INSERT INTO public.finance_snapshots
    (workspace_id, snapshot_date, source, band, data_quality, runway_months, cash_proxy, summary, payload)
  VALUES (_workspace_id, v_today, 'runway_forecast',
    v_runway->>'band',
    v_runway->>'data_quality',
    NULLIF(v_runway->>'runway_months','')::numeric,
    NULLIF(v_runway->>'cash_proxy','')::numeric,
    v_runway->>'summary', v_runway)
  ON CONFLICT (workspace_id, snapshot_date, source) DO UPDATE SET
    band = EXCLUDED.band,
    data_quality = EXCLUDED.data_quality,
    runway_months = EXCLUDED.runway_months,
    cash_proxy = EXCLUDED.cash_proxy,
    summary = EXCLUDED.summary,
    payload = EXCLUDED.payload;

  RETURN jsonb_build_object('ok', true, 'snapshot_date', v_today);
END;
$$;

REVOKE ALL ON FUNCTION public.take_finance_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_finance_snapshot(uuid) TO authenticated, service_role;

-- ---------------- internal upsert helper ----------------
CREATE OR REPLACE FUNCTION public._upsert_finance_watchlist_item(
  _workspace_id uuid,
  _key text, _source text, _sev text, _title text,
  _changed text, _why text, _action text, _details jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.finance_watchlist_items
    (workspace_id, trigger_key, source, severity, title, what_changed, why_it_matters, recommended_action, details, is_dismissed, dismissed_at, dismissed_by, updated_at)
  VALUES
    (_workspace_id, _key, _source, _sev, _title, _changed, _why, _action, COALESCE(_details,'{}'::jsonb), false, NULL, NULL, now())
  ON CONFLICT (workspace_id, trigger_key) DO UPDATE SET
    source = EXCLUDED.source,
    severity = EXCLUDED.severity,
    title = EXCLUDED.title,
    what_changed = EXCLUDED.what_changed,
    why_it_matters = EXCLUDED.why_it_matters,
    recommended_action = EXCLUDED.recommended_action,
    details = EXCLUDED.details,
    is_dismissed = false,
    dismissed_at = NULL,
    dismissed_by = NULL,
    updated_at = now();
$$;

REVOKE ALL ON FUNCTION public._upsert_finance_watchlist_item(uuid,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;

-- ---------------- refresh_finance_watchlist ----------------
CREATE OR REPLACE FUNCTION public.refresh_finance_watchlist(_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  curr_runway public.finance_snapshots;
  prev_runway public.finance_snapshots;
  curr_lender public.finance_snapshots;
  prev_lender public.finance_snapshots;
  curr_finance public.finance_snapshots;
  prev_finance public.finance_snapshots;
  curr_burden public.finance_snapshots;
  prev_burden public.finance_snapshots;
  band_rank constant jsonb := '{"healthy_buffer":4,"moderate":3,"tight":2,"critical":1,"insufficient_data":0,"ready":4,"borderline":2,"not_ready":1}';
  fresh_keys text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NOT NULL AND NOT has_workspace_role(auth.uid(), _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM public.take_finance_snapshot(_workspace_id);

  SELECT * INTO curr_runway FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='runway_forecast'
   ORDER BY snapshot_date DESC LIMIT 1;
  SELECT * INTO prev_runway FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='runway_forecast'
     AND snapshot_date < curr_runway.snapshot_date
   ORDER BY snapshot_date DESC LIMIT 1;

  SELECT * INTO curr_lender FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='lender_readiness'
   ORDER BY snapshot_date DESC LIMIT 1;
  SELECT * INTO prev_lender FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='lender_readiness'
     AND snapshot_date < curr_lender.snapshot_date
   ORDER BY snapshot_date DESC LIMIT 1;

  SELECT * INTO curr_finance FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='finance_analytics'
   ORDER BY snapshot_date DESC LIMIT 1;
  SELECT * INTO prev_finance FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='finance_analytics'
     AND snapshot_date < curr_finance.snapshot_date
   ORDER BY snapshot_date DESC LIMIT 1;

  SELECT * INTO curr_burden FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='burden_analytics'
   ORDER BY snapshot_date DESC LIMIT 1;
  SELECT * INTO prev_burden FROM public.finance_snapshots
   WHERE workspace_id=_workspace_id AND source='burden_analytics'
     AND snapshot_date < curr_burden.snapshot_date
   ORDER BY snapshot_date DESC LIMIT 1;

  -- Runway critical / tight (absolute)
  IF curr_runway.band = 'critical' THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_critical','runway_forecast','critical',
      'Runway is critical',
      format('Runway sits in the critical band (%s mo).', COALESCE(curr_runway.runway_months::text,'n/a')),
      'At this level you are at immediate risk of cash shortfall within weeks.',
      'Cut non-essential spend, accelerate collections, and revisit pricing or financing options now.',
      jsonb_build_object('band',curr_runway.band,'runway_months',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_critical');
  ELSIF curr_runway.band = 'tight' THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_tight','runway_forecast','warning',
      'Runway is tight',
      format('Runway is in the tight band (%s mo).', COALESCE(curr_runway.runway_months::text,'n/a')),
      'You have limited buffer before cash flow problems appear.',
      'Tighten spend approvals and prioritise overdue invoice collection this week.',
      jsonb_build_object('band',curr_runway.band,'runway_months',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_tight');
  END IF;

  -- Runway band downgrade
  IF prev_runway.band IS NOT NULL AND curr_runway.band IS NOT NULL
     AND prev_runway.band <> curr_runway.band
     AND COALESCE((band_rank->>curr_runway.band)::int,0) < COALESCE((band_rank->>prev_runway.band)::int,0)
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_band_downgrade','runway_forecast',
      CASE WHEN curr_runway.band='critical' THEN 'critical' ELSE 'warning' END,
      'Runway band worsened',
      format('Runway band moved from %s to %s.', prev_runway.band, curr_runway.band),
      'Risk of running out of cash has increased materially since the last snapshot.',
      'Review burn rate drivers and reset the next 60-day spending plan.',
      jsonb_build_object('from',prev_runway.band,'to',curr_runway.band,
                         'runway_months_now',curr_runway.runway_months,
                         'runway_months_prev',prev_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_band_downgrade');
  END IF;

  -- Runway months drop ≥25%
  IF prev_runway.runway_months IS NOT NULL AND curr_runway.runway_months IS NOT NULL
     AND prev_runway.runway_months > 0
     AND (prev_runway.runway_months - curr_runway.runway_months) / prev_runway.runway_months >= 0.25
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_months_drop','runway_forecast','warning',
      'Runway shortened sharply',
      format('Runway dropped from %.1f mo to %.1f mo.', prev_runway.runway_months, curr_runway.runway_months),
      'A drop this large usually indicates a spike in burn or a collapse in collections.',
      'Investigate this week''s expense and payment activity, then re-forecast.',
      jsonb_build_object('runway_months_prev',prev_runway.runway_months,'runway_months_now',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_months_drop');
  END IF;

  -- Lender band downgrade
  IF prev_lender.band IS NOT NULL AND curr_lender.band IS NOT NULL
     AND prev_lender.band <> curr_lender.band
     AND COALESCE((band_rank->>curr_lender.band)::int,0) < COALESCE((band_rank->>prev_lender.band)::int,0)
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'lender_band_downgrade','lender_readiness','warning',
      'Lender readiness downgraded',
      format('Lender readiness moved from %s to %s.', prev_lender.band, curr_lender.band),
      'External financing or credit terms become harder to secure at this level.',
      'Stabilise collections and reduce overdue exposure before approaching lenders.',
      jsonb_build_object('from',prev_lender.band,'to',curr_lender.band,
                         'score_now',curr_lender.score,'score_prev',prev_lender.score));
    fresh_keys := array_append(fresh_keys,'lender_band_downgrade');
  END IF;

  -- Collection rate < 70%
  IF curr_finance.collection_rate IS NOT NULL AND curr_finance.collection_rate < 70 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'collection_rate_low','finance_analytics','warning',
      'Collection rate below 70%',
      format('Current collection rate is %.0f%%.', curr_finance.collection_rate),
      'Slow collections starve the business of working capital and worsen runway.',
      'Push overdue follow-ups today and review payment terms on slow-paying clients.',
      jsonb_build_object('collection_rate',curr_finance.collection_rate));
    fresh_keys := array_append(fresh_keys,'collection_rate_low');
  END IF;

  -- Overdue exposure rising ≥20%
  IF prev_finance.overdue_amount IS NOT NULL AND curr_finance.overdue_amount IS NOT NULL
     AND prev_finance.overdue_amount > 0
     AND (curr_finance.overdue_amount - prev_finance.overdue_amount) / prev_finance.overdue_amount >= 0.20
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'overdue_up','finance_analytics','warning',
      'Overdue exposure rising',
      format('Overdue receivables grew %.0f%% since last snapshot.',
             ((curr_finance.overdue_amount - prev_finance.overdue_amount) / prev_finance.overdue_amount) * 100),
      'Each rising bucket increases bad-debt risk and erodes cash position.',
      'Trigger a fresh aging review and contact accounts in 31-60 and 61-90 buckets.',
      jsonb_build_object('overdue_now',curr_finance.overdue_amount,'overdue_prev',prev_finance.overdue_amount));
    fresh_keys := array_append(fresh_keys,'overdue_up');
  END IF;

  -- Vendor concentration ≥40%
  IF curr_burden.vendor_concentration_pct IS NOT NULL AND curr_burden.vendor_concentration_pct >= 40 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'vendor_concentration','burden_analytics','warning',
      'Vendor concentration high',
      format('Top vendor accounts for %.0f%% of recurring spend.', curr_burden.vendor_concentration_pct),
      'High concentration means a single vendor change can disrupt operations or cash flow.',
      'Negotiate terms or evaluate redundancy for your top 1-2 vendors.',
      jsonb_build_object('concentration_pct',curr_burden.vendor_concentration_pct));
    fresh_keys := array_append(fresh_keys,'vendor_concentration');
  END IF;

  -- Burden vs inflow ≥35%
  IF curr_burden.burden_vs_inflow_pct IS NOT NULL AND curr_burden.burden_vs_inflow_pct >= 35 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'burden_vs_inflow','burden_analytics',
      CASE WHEN curr_burden.burden_vs_inflow_pct >= 60 THEN 'critical' ELSE 'warning' END,
      'Recurring burden vs inflow is high',
      format('Recurring monthly burden equals %.0f%% of monthly inflow.', curr_burden.burden_vs_inflow_pct),
      'A high ratio leaves little room for irregular costs or revenue dips.',
      'Audit subscriptions, consolidate tools, and pause non-critical recurring spend.',
      jsonb_build_object('burden_vs_inflow_pct',curr_burden.burden_vs_inflow_pct));
    fresh_keys := array_append(fresh_keys,'burden_vs_inflow');
  END IF;

  -- Stale items not refreshed → quietly mark dismissed
  UPDATE public.finance_watchlist_items
     SET is_dismissed = true,
         dismissed_at = COALESCE(dismissed_at, now()),
         updated_at = now()
   WHERE workspace_id = _workspace_id
     AND is_dismissed = false
     AND NOT (trigger_key = ANY (fresh_keys));

  RETURN jsonb_build_object('ok', true, 'fresh_items', fresh_keys);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_finance_watchlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_finance_watchlist(uuid) TO authenticated, service_role;

-- ---------------- dismiss helper ----------------
CREATE OR REPLACE FUNCTION public.dismiss_finance_watchlist_item(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.finance_watchlist_items WHERE id = _item_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF NOT has_workspace_role(auth.uid(), v_ws, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.finance_watchlist_items
     SET is_dismissed = true, dismissed_at = now(), dismissed_by = auth.uid(), updated_at = now()
   WHERE id = _item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_finance_watchlist_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_finance_watchlist_item(uuid) TO authenticated;