-- Loophole-hardening pass for delegated vendor/subscription access

-- 1. has_module_access: require active membership AND (admin OR explicit grant)
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _workspace_id uuid, _module public.workspace_module)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = _workspace_id
        AND wm.user_id = _user_id
    )
    AND (
      public.has_workspace_role(_user_id, _workspace_id, 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.workspace_module_access wma
        WHERE wma.workspace_id = _workspace_id
          AND wma.user_id = _user_id
          AND wma.module = _module
      )
    );
$$;

REVOKE ALL ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) FROM public;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) TO authenticated;

-- 2. Bind grants to membership reality.
-- 2a. Trigger: refuse INSERT/UPDATE that targets a non-member.
CREATE OR REPLACE FUNCTION public.enforce_module_access_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot grant module access: user is not a member of workspace'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wma_enforce_membership ON public.workspace_module_access;
CREATE TRIGGER trg_wma_enforce_membership
  BEFORE INSERT OR UPDATE ON public.workspace_module_access
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_access_membership();

-- 2b. Cascade: when a membership is removed, drop matching grants.
CREATE OR REPLACE FUNCTION public.cleanup_module_access_on_membership_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.workspace_module_access
   WHERE workspace_id = OLD.workspace_id
     AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_cleanup_module_access ON public.workspace_memberships;
CREATE TRIGGER trg_membership_cleanup_module_access
  AFTER DELETE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_module_access_on_membership_delete();

-- 2c. Sweep any pre-existing stale grants right now.
DELETE FROM public.workspace_module_access wma
 WHERE NOT EXISTS (
   SELECT 1 FROM public.workspace_memberships wm
   WHERE wm.workspace_id = wma.workspace_id
     AND wm.user_id = wma.user_id
 );

-- 2d. Prevent duplicates (defensive — index already exists, add unique constraint).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_module_access_unique'
  ) THEN
    ALTER TABLE public.workspace_module_access
      ADD CONSTRAINT workspace_module_access_unique
      UNIQUE (workspace_id, user_id, module);
  END IF;
END $$;

-- 3. Tighten VENDORS read policies — match subscriptions model.
DROP POLICY IF EXISTS "Members can view active vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can view all vendors" ON public.vendors;
DROP POLICY IF EXISTS "Authorized members can view vendors" ON public.vendors;

CREATE POLICY "Authorized members can view vendors"
  ON public.vendors
  FOR SELECT TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'vendor_management'::public.workspace_module)
  );