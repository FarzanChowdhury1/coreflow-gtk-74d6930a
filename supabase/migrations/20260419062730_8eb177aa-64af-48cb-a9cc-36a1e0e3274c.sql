CREATE OR REPLACE FUNCTION public.refresh_finance_watchlist(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_overdue_growth_pct numeric;
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

  IF curr_runway.band = 'critical' THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_critical','runway_forecast','critical',
      'Runway is critical',
      'Runway sits in the critical band (' || COALESCE(to_char(curr_runway.runway_months,'FM999990.0'),'n/a') || ' mo).',
      'At this level you are at immediate risk of cash shortfall within weeks.',
      'Cut non-essential spend, accelerate collections, and revisit pricing or financing options now.',
      jsonb_build_object('band',curr_runway.band,'runway_months',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_critical');
  ELSIF curr_runway.band = 'tight' THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_tight','runway_forecast','warning',
      'Runway is tight',
      'Runway is in the tight band (' || COALESCE(to_char(curr_runway.runway_months,'FM999990.0'),'n/a') || ' mo).',
      'You have limited buffer before cash flow problems appear.',
      'Tighten spend approvals and prioritise overdue invoice collection this week.',
      jsonb_build_object('band',curr_runway.band,'runway_months',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_tight');
  END IF;

  IF prev_runway.band IS NOT NULL AND curr_runway.band IS NOT NULL
     AND prev_runway.band <> curr_runway.band
     AND COALESCE((band_rank->>curr_runway.band)::int,0) < COALESCE((band_rank->>prev_runway.band)::int,0)
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_band_downgrade','runway_forecast',
      CASE WHEN curr_runway.band='critical' THEN 'critical' ELSE 'warning' END,
      'Runway band worsened',
      'Runway band moved from ' || prev_runway.band || ' to ' || curr_runway.band || '.',
      'Risk of running out of cash has increased materially since the last snapshot.',
      'Review burn rate drivers and reset the next 60-day spending plan.',
      jsonb_build_object('from',prev_runway.band,'to',curr_runway.band,
                         'runway_now',curr_runway.runway_months,'runway_prev',prev_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_band_downgrade');
  END IF;

  IF prev_runway.runway_months IS NOT NULL AND curr_runway.runway_months IS NOT NULL
     AND prev_runway.runway_months > 0
     AND (prev_runway.runway_months - curr_runway.runway_months) / prev_runway.runway_months >= 0.25
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'runway_months_drop','runway_forecast','warning',
      'Runway shortened sharply',
      'Runway dropped from ' || to_char(prev_runway.runway_months,'FM999990.0') || ' mo to ' || to_char(curr_runway.runway_months,'FM999990.0') || ' mo.',
      'A drop this large usually indicates a spike in burn or a collapse in collections.',
      'Investigate this week''s expense and payment activity, then re-forecast.',
      jsonb_build_object('runway_months_prev',prev_runway.runway_months,'runway_months_now',curr_runway.runway_months));
    fresh_keys := array_append(fresh_keys,'runway_months_drop');
  END IF;

  IF prev_lender.band IS NOT NULL AND curr_lender.band IS NOT NULL
     AND prev_lender.band <> curr_lender.band
     AND COALESCE((band_rank->>curr_lender.band)::int,0) < COALESCE((band_rank->>prev_lender.band)::int,0)
  THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'lender_band_downgrade','lender_readiness','warning',
      'Lender readiness downgraded',
      'Lender readiness moved from ' || prev_lender.band || ' to ' || curr_lender.band || '.',
      'External financing or credit terms become harder to secure at this level.',
      'Stabilise collections and reduce overdue exposure before approaching lenders.',
      jsonb_build_object('from',prev_lender.band,'to',curr_lender.band,
                         'score_now',curr_lender.score,'score_prev',prev_lender.score));
    fresh_keys := array_append(fresh_keys,'lender_band_downgrade');
  END IF;

  IF curr_finance.collection_rate IS NOT NULL AND curr_finance.collection_rate < 0.70 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'collection_rate_low','finance_analytics','warning',
      'Collection rate below 70%',
      'Current collection rate is ' || to_char(curr_finance.collection_rate * 100,'FM999990') || '%.',
      'Slow collections starve the business of working capital and worsen runway.',
      'Push overdue follow-ups today and review payment terms on slow-paying clients.',
      jsonb_build_object('collection_rate',curr_finance.collection_rate));
    fresh_keys := array_append(fresh_keys,'collection_rate_low');
  END IF;

  IF prev_finance.overdue_amount IS NOT NULL AND curr_finance.overdue_amount IS NOT NULL
     AND prev_finance.overdue_amount > 0
     AND (curr_finance.overdue_amount - prev_finance.overdue_amount) / prev_finance.overdue_amount >= 0.20
  THEN
    v_overdue_growth_pct := ROUND(((curr_finance.overdue_amount - prev_finance.overdue_amount) / prev_finance.overdue_amount) * 100);
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'overdue_up','finance_analytics','warning',
      'Overdue exposure rising',
      'Overdue receivables grew ' || v_overdue_growth_pct::text || '% since last snapshot.',
      'Each rising bucket increases bad-debt risk and erodes cash position.',
      'Trigger a fresh aging review and contact accounts in 31-60 and 61-90 buckets.',
      jsonb_build_object('overdue_now',curr_finance.overdue_amount,'overdue_prev',prev_finance.overdue_amount));
    fresh_keys := array_append(fresh_keys,'overdue_up');
  END IF;

  IF curr_burden.vendor_concentration_pct IS NOT NULL AND curr_burden.vendor_concentration_pct >= 40 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'vendor_concentration','burden_analytics','warning',
      'Vendor concentration high',
      'Top vendor accounts for ' || to_char(curr_burden.vendor_concentration_pct,'FM999990') || '% of recurring spend.',
      'High concentration means a single vendor change can disrupt operations or cash flow.',
      'Negotiate terms or evaluate redundancy for your top 1-2 vendors.',
      jsonb_build_object('concentration_pct',curr_burden.vendor_concentration_pct));
    fresh_keys := array_append(fresh_keys,'vendor_concentration');
  END IF;

  IF curr_burden.burden_vs_inflow_pct IS NOT NULL AND curr_burden.burden_vs_inflow_pct >= 35 THEN
    PERFORM public._upsert_finance_watchlist_item(_workspace_id,'burden_vs_inflow','burden_analytics',
      CASE WHEN curr_burden.burden_vs_inflow_pct >= 60 THEN 'critical' ELSE 'warning' END,
      'Recurring burden vs inflow is high',
      'Recurring monthly burden equals ' || to_char(curr_burden.burden_vs_inflow_pct,'FM999990') || '% of monthly inflow.',
      'A high ratio leaves little room for irregular costs or revenue dips.',
      'Audit subscriptions, consolidate tools, and pause non-critical recurring spend.',
      jsonb_build_object('burden_vs_inflow_pct',curr_burden.burden_vs_inflow_pct));
    fresh_keys := array_append(fresh_keys,'burden_vs_inflow');
  END IF;

  UPDATE public.finance_watchlist_items
     SET is_dismissed = true,
         dismissed_at = COALESCE(dismissed_at, now()),
         updated_at = now()
   WHERE workspace_id = _workspace_id
     AND is_dismissed = false
     AND NOT (trigger_key = ANY (fresh_keys));

  RETURN jsonb_build_object('ok', true, 'fresh_items', fresh_keys);
END;
$function$;