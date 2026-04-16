-- Per-company financial health RPC.
-- Truthful attribution rules:
--   Revenue: invoices where invoices.company_id = _company_id (excluding draft/void/deleted)
--   Collected: payments on those invoices (payments.amount, summed)
--   Expenses attributed: expenses where expenses.project_id IN (projects linked to this company)
--                        — NEVER allocate workspace-wide overhead.
-- Per-currency only. No FX conversion. No black-box scoring.

CREATE OR REPLACE FUNCTION public.get_company_financial_health(_company_id uuid)
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
  _per_currency jsonb;
  _attribution jsonb;
  _result jsonb;
  _attributable_project_count int;
  _total_project_count int;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT workspace_id INTO _workspace_id
  FROM companies WHERE id = _company_id AND deleted_at IS NULL;

  IF _workspace_id IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT public.has_workspace_role(_user_id, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Attribution coverage: how many of the company's projects are linked + how many expenses can be attributed
  SELECT COUNT(*)::int INTO _total_project_count
  FROM projects WHERE company_id = _company_id AND deleted_at IS NULL;

  _attributable_project_count := _total_project_count;

  WITH inv AS (
    SELECT
      i.id, i.currency, i.grand_total, i.amount_paid, i.status::text AS status,
      i.due_date, i.issue_date,
      (SELECT MAX(p.paid_at)::date FROM payments p WHERE p.invoice_id = i.id) AS last_payment_date
    FROM invoices i
    WHERE i.company_id = _company_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('draft','void')
  ),
  inv_metrics AS (
    SELECT
      currency,
      COUNT(*)::int AS invoice_count,
      COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < _today AND status <> 'paid' AND amount_paid < grand_total)::int AS overdue_count,
      COALESCE(SUM(grand_total), 0)::numeric AS total_invoiced,
      COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
      COALESCE(SUM(GREATEST(grand_total - amount_paid, 0)), 0)::numeric AS outstanding,
      COALESCE(SUM(GREATEST(grand_total - amount_paid, 0))
        FILTER (WHERE due_date IS NOT NULL AND due_date < _today AND status <> 'paid'), 0)::numeric AS overdue_amount,
      AVG(
        CASE
          WHEN (status = 'paid' OR amount_paid >= grand_total)
            AND last_payment_date IS NOT NULL AND issue_date IS NOT NULL
          THEN (last_payment_date - issue_date)
          ELSE NULL
        END
      )::numeric AS avg_days_to_pay
    FROM inv
    GROUP BY currency
  ),
  exp_metrics AS (
    -- Only expenses attached to projects belonging to this company.
    SELECT
      e.currency,
      COALESCE(SUM(e.amount), 0)::numeric AS attributed_expenses
    FROM expenses e
    JOIN projects p ON p.id = e.project_id
    WHERE p.company_id = _company_id
      AND e.deleted_at IS NULL
      AND p.deleted_at IS NULL
    GROUP BY e.currency
  ),
  combined AS (
    SELECT
      COALESCE(im.currency, em.currency) AS currency,
      COALESCE(im.invoice_count, 0) AS invoice_count,
      COALESCE(im.overdue_count, 0) AS overdue_count,
      COALESCE(im.total_invoiced, 0) AS total_invoiced,
      COALESCE(im.total_collected, 0) AS total_collected,
      COALESCE(im.outstanding, 0) AS outstanding,
      COALESCE(im.overdue_amount, 0) AS overdue_amount,
      ROUND(im.avg_days_to_pay, 1) AS avg_days_to_pay,
      COALESCE(em.attributed_expenses, 0) AS attributed_expenses,
      -- Collection rate = collected / invoiced (when invoiced > 0)
      CASE WHEN COALESCE(im.total_invoiced, 0) > 0
        THEN ROUND((COALESCE(im.total_collected, 0) / im.total_invoiced) * 100, 1)
        ELSE NULL
      END AS collection_rate_pct,
      -- Gross margin (cash-basis revenue): collected - attributed expenses
      (COALESCE(im.total_collected, 0) - COALESCE(em.attributed_expenses, 0))::numeric AS gross_margin,
      CASE WHEN COALESCE(im.total_collected, 0) > 0
        THEN ROUND(((COALESCE(im.total_collected, 0) - COALESCE(em.attributed_expenses, 0)) / im.total_collected) * 100, 1)
        ELSE NULL
      END AS gross_margin_pct
    FROM inv_metrics im
    FULL OUTER JOIN exp_metrics em ON em.currency = im.currency
  ),
  banded AS (
    SELECT
      *,
      -- Transparent health band — pure rule-based, no opaque score
      CASE
        WHEN invoice_count = 0 THEN 'unknown'
        WHEN overdue_count > 0 AND overdue_amount > (total_collected * 0.5) AND collection_rate_pct IS NOT NULL AND collection_rate_pct < 50 THEN 'at_risk'
        WHEN overdue_count > 0 AND collection_rate_pct IS NOT NULL AND collection_rate_pct < 70 THEN 'watchlist'
        WHEN collection_rate_pct IS NOT NULL AND collection_rate_pct >= 90 AND overdue_count = 0
             AND COALESCE(gross_margin_pct, 0) >= 20 THEN 'healthy'
        WHEN collection_rate_pct IS NOT NULL AND collection_rate_pct >= 75 AND overdue_count <= 1 THEN 'stable'
        ELSE 'watchlist'
      END AS health_band
    FROM combined
  )
  SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY total_invoiced DESC), '[]'::jsonb) INTO _per_currency FROM banded b;

  _attribution := jsonb_build_object(
    'linked_projects', _total_project_count,
    'expense_attribution_path', 'expenses → projects.company_id',
    'note', CASE
      WHEN _total_project_count = 0
        THEN 'No projects linked to this client. Expenses cannot be attributed; gross margin is shown as collected revenue only.'
      ELSE NULL
    END
  );

  _result := jsonb_build_object(
    'company_id', _company_id,
    'workspace_id', _workspace_id,
    'as_of', _today,
    'per_currency', _per_currency,
    'attribution', _attribution,
    'rules', jsonb_build_object(
      'revenue', 'Sum of company-linked invoices (excluding draft/void/deleted)',
      'collected', 'Sum of payments.amount on those invoices',
      'attributed_expenses', 'Expenses attached to projects whose company_id = this client. Workspace overhead is NEVER allocated.',
      'gross_margin', 'collected − attributed_expenses (per currency, cash basis)',
      'bands', jsonb_build_object(
        'healthy', 'collection rate ≥ 90%, no overdue, gross margin ≥ 20%',
        'stable', 'collection rate ≥ 75%, ≤1 overdue invoice',
        'watchlist', 'collection rate 50–75% or has overdue',
        'at_risk', 'collection rate <50% AND overdue > 50% of collected revenue',
        'unknown', 'no issued invoices yet'
      )
    )
  );

  RETURN _result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_company_financial_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_financial_health(uuid) TO authenticated, service_role;