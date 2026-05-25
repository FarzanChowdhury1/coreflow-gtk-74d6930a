
-- =========================================================
-- PHASE 1: Branding RLS aliasing fix
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_workspace_branding_readable(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws uuid;
BEGIN
  IF _user_id IS NULL OR _object_name IS NULL THEN
    RETURN false;
  END IF;
  IF _object_name !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(doc|portal)-logo\.(png|jpe?g|webp|svg)$' THEN
    RETURN false;
  END IF;
  _ws := ((regexp_match(_object_name, '^([0-9a-f-]{36})/'))[1])::uuid;
  RETURN EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = _ws
      AND w.deleted_at IS NULL
      AND (
        w.doc_logo_storage_path = _object_name
        OR w.portal_logo_storage_path = _object_name
      )
      AND public.has_workspace_access(_user_id, w.id)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_branding_writable(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws uuid;
BEGIN
  IF _user_id IS NULL OR _object_name IS NULL THEN
    RETURN false;
  END IF;
  IF _object_name !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(doc|portal)-logo\.(png|jpe?g|webp|svg)$' THEN
    RETURN false;
  END IF;
  _ws := ((regexp_match(_object_name, '^([0-9a-f-]{36})/'))[1])::uuid;
  RETURN EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = _ws
      AND w.deleted_at IS NULL
      AND (
        w.doc_logo_storage_path = _object_name
        OR w.portal_logo_storage_path = _object_name
      )
      AND public.has_workspace_role(_user_id, w.id, 'admin'::app_role)
  );
END
$$;

-- Defense-in-depth: prevent admins from saving a logo path that points outside
-- their own workspace's UUID prefix or that uses an unexpected filename pattern.
CREATE OR REPLACE FUNCTION public.validate_workspace_logo_paths()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _pat text;
BEGIN
  _pat := '^' || NEW.id::text || '/(doc|portal)-logo\.(png|jpe?g|webp|svg)$';

  IF NEW.doc_logo_storage_path IS NOT NULL
     AND NEW.doc_logo_storage_path !~* _pat THEN
    RAISE EXCEPTION 'doc_logo_storage_path must be in the form <workspace_id>/doc-logo.<png|jpg|jpeg|webp|svg>'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.portal_logo_storage_path IS NOT NULL
     AND NEW.portal_logo_storage_path !~* _pat THEN
    RAISE EXCEPTION 'portal_logo_storage_path must be in the form <workspace_id>/portal-logo.<png|jpg|jpeg|webp|svg>'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_validate_workspace_logo_paths ON public.workspaces;
CREATE TRIGGER trg_validate_workspace_logo_paths
BEFORE INSERT OR UPDATE OF doc_logo_storage_path, portal_logo_storage_path
ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.validate_workspace_logo_paths();

-- =========================================================
-- PHASE 2: Worker RPC authorization guard
-- =========================================================

CREATE OR REPLACE FUNCTION public.require_internal_worker(_job text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _claim_role text;
BEGIN
  BEGIN
    _claim_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN
    _claim_role := NULL;
  END;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR session_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(_claim_role, '') = 'service_role'
     OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Function % can only be invoked by the internal scheduler', _job
    USING ERRCODE = '42501';
END
$$;

REVOKE ALL ON FUNCTION public.require_internal_worker(text) FROM PUBLIC;

-- Patch billing worker functions with body-level guard.
CREATE OR REPLACE FUNCTION public.apply_pending_downgrades()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _seats int;
  _applied int := 0;
  _blocked int := 0;
BEGIN
  PERFORM public.require_internal_worker('apply_pending_downgrades');

  FOR _row IN
    SELECT id, pending_downgrade_to, billing_cycle, next_renewal_at
      FROM workspaces
     WHERE pending_downgrade_to IS NOT NULL
       AND next_renewal_at IS NOT NULL
       AND next_renewal_at <= now()
       AND deleted_at IS NULL
  LOOP
    IF _row.pending_downgrade_to = 'cancel' THEN
      UPDATE workspaces
         SET deleted_at = now(),
             pending_downgrade_to = NULL
       WHERE id = _row.id;
      _applied := _applied + 1;
    ELSIF _row.pending_downgrade_to = 'starter' THEN
      _seats := workspace_effective_seat_count(_row.id);
      IF _seats <= 10 THEN
        UPDATE workspaces
           SET plan = 'starter',
               seat_limit = 10,
               pending_downgrade_to = NULL,
               next_renewal_at = CASE
                 WHEN _row.billing_cycle = 'annual' THEN now() + interval '12 months'
                 ELSE now() + interval '1 month'
               END
         WHERE id = _row.id;
        _applied := _applied + 1;
      ELSE
        _blocked := _blocked + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('applied', _applied, 'blocked', _blocked);
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_grace_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ws record;
  _admin record;
  _next_index int;
  _days_left int;
  _sent int := 0;
BEGIN
  PERFORM public.require_internal_worker('send_grace_reminders');

  FOR _ws IN
    SELECT id, name, grace_ends_at, grace_reminders_sent, last_grace_reminder_at
      FROM workspaces
     WHERE deleted_at IS NULL
       AND trial_ends_at IS NOT NULL
       AND grace_ends_at IS NOT NULL
       AND trial_ends_at <= now()
       AND grace_ends_at > now()
       AND next_renewal_at IS NULL
       AND grace_reminders_sent < 3
       AND (last_grace_reminder_at IS NULL OR last_grace_reminder_at < now() - interval '36 hours')
  LOOP
    _next_index := _ws.grace_reminders_sent + 1;
    _days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_ws.grace_ends_at - now())) / 86400.0))::int;

    FOR _admin IN
      SELECT user_id FROM workspace_memberships
       WHERE workspace_id = _ws.id AND role = 'admin'
    LOOP
      INSERT INTO notifications (workspace_id, user_id, title, body, severity, category, link)
      VALUES (
        _ws.id,
        _admin.user_id,
        'Activate your plan to keep ' || _ws.name || ' running',
        'Your trial ended. ' || _days_left || ' day(s) of grace remain. Activate Starter or Growth to avoid suspension.',
        CASE WHEN _next_index >= 3 THEN 'critical' ELSE 'warning' END,
        'billing',
        '/settings?tab=plan'
      );
    END LOOP;

    UPDATE workspaces
       SET grace_reminders_sent = _next_index,
           last_grace_reminder_at = now()
     WHERE id = _ws.id;
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object('workspaces_notified', _sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_pending_downgrades() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_pending_downgrades() FROM anon;
REVOKE ALL ON FUNCTION public.apply_pending_downgrades() FROM authenticated;
REVOKE ALL ON FUNCTION public.send_grace_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_grace_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.send_grace_reminders() FROM authenticated;

-- =========================================================
-- PHASE 4: has_company_access must deny access in deactivated workspaces
-- =========================================================

CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (
    _user_id = (SELECT auth.uid())
    AND (
      EXISTS (
        SELECT 1
        FROM public.companies c
        JOIN public.workspaces w ON w.id = c.workspace_id
        JOIN public.workspace_memberships wm ON wm.workspace_id = c.workspace_id
        WHERE c.id = _company_id
          AND c.deleted_at IS NULL
          AND w.deleted_at IS NULL
          AND wm.user_id = _user_id
          AND wm.role = 'admin'
      )
      OR EXISTS (
        SELECT 1
        FROM public.companies c
        JOIN public.workspaces w ON w.id = c.workspace_id
        WHERE c.id = _company_id
          AND c.owner_id = _user_id
          AND c.deleted_at IS NULL
          AND w.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_access ca
        JOIN public.companies c ON c.id = ca.company_id
        JOIN public.workspaces w ON w.id = c.workspace_id
        WHERE ca.company_id = _company_id
          AND ca.user_id = _user_id
          AND c.deleted_at IS NULL
          AND w.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.projects p
        JOIN public.workspaces w ON w.id = p.workspace_id
        JOIN public.project_members pm ON pm.project_id = p.id
        WHERE p.company_id = _company_id
          AND pm.user_id = _user_id
          AND p.deleted_at IS NULL
          AND w.deleted_at IS NULL
      )
    )
  )
$function$;
