
-- ============================================================
-- PHASE 1: Body-level guards on sensitive SECURITY DEFINER RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_workspace_doc_identity(_workspace_id uuid)
RETURNS TABLE(
  doc_registered_name text, doc_trade_name text, doc_address text, doc_phone text,
  doc_email text, doc_bin text, doc_logo_storage_path text,
  doc_bank_account_name text, doc_bank_account_number text,
  doc_bank_name text, doc_bank_branch text, doc_payment_instructions text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Only workspace admins can view business identity details.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_workspace_role(_uid, _workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only workspace admins can view business identity details.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT w.doc_registered_name, w.doc_trade_name, w.doc_address, w.doc_phone,
           w.doc_email, w.doc_bin, w.doc_logo_storage_path,
           w.doc_bank_account_name, w.doc_bank_account_number,
           w.doc_bank_name, w.doc_bank_branch, w.doc_payment_instructions
    FROM public.workspaces w
    WHERE w.id = _workspace_id
      AND w.deleted_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_doc_identity_ready(_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ready boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.has_workspace_role(_uid, _workspace_id, 'admin'::app_role) THEN
    RETURN false;
  END IF;

  SELECT
    coalesce(btrim(w.doc_registered_name), '') <> ''
    AND coalesce(btrim(w.doc_address), '') <> ''
    AND (
      coalesce(btrim(w.doc_bank_account_number), '') <> ''
      OR coalesce(btrim(w.doc_payment_instructions), '') <> ''
    )
  INTO _ready
  FROM public.workspaces w
  WHERE w.id = _workspace_id
    AND w.deleted_at IS NULL;

  RETURN coalesce(_ready, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_module_access(
  _user_id uuid, _workspace_id uuid, _module workspace_module
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL OR _workspace_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
    WHERE wm.workspace_id = _workspace_id
      AND wm.user_id = _user_id
      AND w.deleted_at IS NULL
  );
END;
$function$;

-- ============================================================
-- PHASE 2: worker_runs RLS — null workspace = platform admin only
-- ============================================================

DROP POLICY IF EXISTS workspace_admins_read_worker_runs ON public.worker_runs;

CREATE POLICY workspace_admins_read_worker_runs
ON public.worker_runs
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN workspace_id IS NOT NULL
      THEN public.has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role)
    ELSE public.is_platform_admin(auth.uid())
  END
);
