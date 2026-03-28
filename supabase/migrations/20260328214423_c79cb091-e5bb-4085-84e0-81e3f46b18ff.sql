
-- Enable pg_trgm extension for trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create unified global search RPC
CREATE OR REPLACE FUNCTION public.global_search(
  _workspace_id uuid,
  _term text,
  _limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _like text := '%' || _term || '%';
  _result jsonb := '{}';
BEGIN
  -- Membership check
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = _workspace_id AND user_id = _uid
  ) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  -- Companies
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', legal_name, 'subtitle', bin
  ) ORDER BY legal_name <-> _term), '[]'::jsonb) INTO _result
  FROM (
    SELECT id, legal_name, bin
    FROM public.companies
    WHERE workspace_id = _workspace_id AND deleted_at IS NULL
      AND legal_name ILIKE _like
    ORDER BY legal_name <-> _term
    LIMIT _limit
  ) c;

  _result := jsonb_build_object('companies', _result);

  -- Contacts
  _result := _result || jsonb_build_object('contacts', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', full_name, 'subtitle', email
    ) ORDER BY full_name <-> _term), '[]'::jsonb)
    FROM (
      SELECT id, full_name, email
      FROM public.contacts
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND (full_name ILIKE _like OR email ILIKE _like)
      ORDER BY full_name <-> _term
      LIMIT _limit
    ) ct
  ));

  -- Leads
  _result := _result || jsonb_build_object('leads', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'subtitle', status::text
    ) ORDER BY title <-> _term), '[]'::jsonb)
    FROM (
      SELECT id, title, status
      FROM public.leads
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND title ILIKE _like
      ORDER BY title <-> _term
      LIMIT _limit
    ) l
  ));

  -- Proposals
  _result := _result || jsonb_build_object('proposals', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'subtitle', null
    ) ORDER BY title <-> _term), '[]'::jsonb)
    FROM (
      SELECT id, title
      FROM public.proposals
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND title ILIKE _like
      ORDER BY title <-> _term
      LIMIT _limit
    ) p
  ));

  -- Projects
  _result := _result || jsonb_build_object('projects', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', name, 'subtitle', status::text
    ) ORDER BY name <-> _term), '[]'::jsonb)
    FROM (
      SELECT id, name, status
      FROM public.projects
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND name ILIKE _like
      ORDER BY name <-> _term
      LIMIT _limit
    ) pr
  ));

  -- Invoices
  _result := _result || jsonb_build_object('invoices', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', invoice_number, 'subtitle', currency || ' ' || grand_total::text
    ) ORDER BY invoice_number <-> _term), '[]'::jsonb)
    FROM (
      SELECT id, invoice_number, currency, grand_total
      FROM public.invoices
      WHERE workspace_id = _workspace_id AND deleted_at IS NULL
        AND invoice_number ILIKE _like
      ORDER BY invoice_number <-> _term
      LIMIT _limit
    ) inv
  ));

  RETURN _result;
END;
$$;

-- Restrict execution
REVOKE EXECUTE ON FUNCTION public.global_search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, text, integer) TO authenticated, service_role;

-- Trigram indexes for search performance
CREATE INDEX IF NOT EXISTS idx_companies_legal_name_trgm ON public.companies USING gin (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_full_name_trgm ON public.contacts USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_title_trgm ON public.leads USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_proposals_title_trgm ON public.proposals USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON public.projects USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_invoices_number_trgm ON public.invoices USING gin (invoice_number gin_trgm_ops);
