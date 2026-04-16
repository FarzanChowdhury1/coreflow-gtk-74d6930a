-- Per-company payment behavior / reliability RPC
-- Truthful: uses real invoice due_date + payment settlement timestamps.
-- Honest with multi-currency: returns per-currency arrays, no FX faking.
-- Partial payments: an invoice is considered "paid on time" only when
-- amount_paid >= grand_total AND the LAST payment date <= due_date.
-- "Partially paid" invoices that are not yet fully paid count separately and
-- are NOT credited as on-time behavior.

CREATE OR REPLACE FUNCTION public.get_company_payment_reliability(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _workspace_id uuid;
  _today date := current_date;
  _result jsonb;
  _per_currency jsonb;
  _recent jsonb;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve workspace_id from company and enforce admin access
  SELECT workspace_id INTO _workspace_id
  FROM companies WHERE id = _company_id AND deleted_at IS NULL;

  IF _workspace_id IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Per-invoice settlement facts (last payment date + paid total)
  WITH inv AS (
    SELECT
      i.id,
      i.currency,
      i.grand_total,
      i.amount_paid,
      i.status::text AS status,
      i.due_date,
      i.issue_date,
      (
        SELECT MAX(p.paid_at)::date
        FROM payments p
        WHERE p.invoice_id = i.id
      ) AS last_payment_date,
      (
        SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id
      ) AS payment_count
    FROM invoices i
    WHERE i.company_id = _company_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('draft','void')
  ),
  classified AS (
    SELECT
      currency,
      grand_total,
      amount_paid,
      due_date,
      last_payment_date,
      status,
      -- fully paid?
      (status = 'paid' OR amount_paid >= grand_total) AS is_fully_paid,
      -- partial = some money in but not full
      (amount_paid > 0 AND amount_paid < grand_total AND status <> 'paid') AS is_partial,
      -- overdue right now?
      (due_date IS NOT NULL AND due_date < _today AND status NOT IN ('paid','void') AND amount_paid < grand_total) AS is_overdue,
      -- days to pay (only if fully paid AND we have a settlement date AND a due date)
      CASE
        WHEN (status = 'paid' OR amount_paid >= grand_total) AND last_payment_date IS NOT NULL AND issue_date IS NOT NULL
          THEN (last_payment_date - issue_date)
        ELSE NULL
      END AS days_to_pay,
      -- lateness = settlement_date - due_date (positive = late)
      CASE
        WHEN (status = 'paid' OR amount_paid >= grand_total) AND last_payment_date IS NOT NULL AND due_date IS NOT NULL
          THEN (last_payment_date - due_date)
        ELSE NULL
      END AS lateness_days
    FROM inv
  ),
  per_cur AS (
    SELECT
      currency,
      COUNT(*)::int AS invoice_count,
      COUNT(*) FILTER (WHERE is_fully_paid)::int AS paid_count,
      COUNT(*) FILTER (WHERE is_partial)::int AS partial_count,
      COUNT(*) FILTER (WHERE is_overdue)::int AS overdue_count,
      COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)) FILTER (WHERE is_overdue), 0)::numeric AS overdue_amount,
      COALESCE(SUM(grand_total), 0)::numeric AS total_invoiced,
      COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
      -- on-time = fully paid AND lateness <= 0
      COUNT(*) FILTER (WHERE is_fully_paid AND lateness_days IS NOT NULL AND lateness_days <= 0)::int AS on_time_count,
      -- denominator for on-time rate: fully-paid invoices with measurable due dates
      COUNT(*) FILTER (WHERE is_fully_paid AND lateness_days IS NOT NULL)::int AS measurable_paid_count,
      AVG(days_to_pay) FILTER (WHERE days_to_pay IS NOT NULL)::numeric AS avg_days_to_pay,
      AVG(GREATEST(lateness_days, 0)) FILTER (WHERE lateness_days IS NOT NULL AND lateness_days > 0)::numeric AS avg_days_late,
      MAX(lateness_days) FILTER (WHERE lateness_days IS NOT NULL)::int AS worst_lateness_days
    FROM classified
    GROUP BY currency
  ),
  banded AS (
    SELECT
      currency,
      invoice_count,
      paid_count,
      partial_count,
      overdue_count,
      overdue_amount,
      total_invoiced,
      total_collected,
      on_time_count,
      measurable_paid_count,
      ROUND(avg_days_to_pay, 1) AS avg_days_to_pay,
      ROUND(avg_days_late, 1) AS avg_days_late,
      worst_lateness_days,
      CASE WHEN measurable_paid_count > 0
        THEN ROUND((on_time_count::numeric / measurable_paid_count::numeric) * 100, 1)
        ELSE NULL
      END AS on_time_rate_pct,
      -- transparent reliability band
      CASE
        WHEN measurable_paid_count = 0 AND overdue_count = 0 THEN 'unknown'
        WHEN overdue_count > 0 AND COALESCE(worst_lateness_days,0) > 30 THEN 'high_risk'
        WHEN measurable_paid_count > 0
             AND (on_time_count::numeric / measurable_paid_count::numeric) >= 0.9
             AND COALESCE(avg_days_late, 0) <= 3
             AND overdue_count = 0
          THEN 'excellent'
        WHEN measurable_paid_count > 0
             AND (on_time_count::numeric / measurable_paid_count::numeric) >= 0.7
             AND COALESCE(avg_days_late, 0) <= 10
          THEN 'good'
        WHEN measurable_paid_count > 0
             AND (on_time_count::numeric / measurable_paid_count::numeric) >= 0.5
          THEN 'watchlist'
        ELSE 'high_risk'
      END AS reliability_band
    FROM per_cur
  )
  SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY total_invoiced DESC), '[]'::jsonb) INTO _per_currency FROM banded b;

  -- Recent 10 payments for evidence
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.paid_at DESC), '[]'::jsonb) INTO _recent
  FROM (
    SELECT
      p.id,
      p.amount,
      i.currency,
      p.paid_at,
      i.invoice_number,
      i.due_date,
      CASE WHEN i.due_date IS NOT NULL
        THEN (p.paid_at::date - i.due_date)
        ELSE NULL
      END AS days_vs_due
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.company_id = _company_id AND i.deleted_at IS NULL
    ORDER BY p.paid_at DESC
    LIMIT 10
  ) r;

  _result := jsonb_build_object(
    'company_id', _company_id,
    'workspace_id', _workspace_id,
    'as_of', _today,
    'per_currency', _per_currency,
    'recent_payments', _recent,
    'rules', jsonb_build_object(
      'on_time_definition', 'Invoice fully paid AND last payment date <= due date',
      'partial_excluded_from_on_time', true,
      'bands', jsonb_build_object(
        'excellent', 'on-time rate >= 90% AND avg days late <= 3 AND no current overdue',
        'good', 'on-time rate >= 70% AND avg days late <= 10',
        'watchlist', 'on-time rate >= 50%',
        'high_risk', 'on-time rate < 50% OR worst lateness > 30 days with current overdue'
      )
    )
  );

  RETURN _result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_company_payment_reliability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_payment_reliability(uuid) TO authenticated, service_role;