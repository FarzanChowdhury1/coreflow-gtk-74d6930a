
-- 1. Module enum
DO $$ BEGIN
  CREATE TYPE public.workspace_module AS ENUM ('vendor_management', 'subscription_management');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Module access table
CREATE TABLE IF NOT EXISTS public.workspace_module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  module public.workspace_module NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, module)
);

CREATE INDEX IF NOT EXISTS idx_wma_lookup
  ON public.workspace_module_access (user_id, workspace_id, module);

ALTER TABLE public.workspace_module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage module access" ON public.workspace_module_access;
CREATE POLICY "Admins manage module access"
  ON public.workspace_module_access
  FOR ALL TO authenticated
  USING (public.has_workspace_role(auth.uid(), workspace_id, 'admin'::public.app_role))
  WITH CHECK (public.has_workspace_role(auth.uid(), workspace_id, 'admin'::public.app_role));

DROP POLICY IF EXISTS "Members view own module grants" ON public.workspace_module_access;
CREATE POLICY "Members view own module grants"
  ON public.workspace_module_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Helper: admin OR explicit grant
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _workspace_id uuid, _module public.workspace_module)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_workspace_role(_user_id, _workspace_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.workspace_module_access wma
      WHERE wma.workspace_id = _workspace_id
        AND wma.user_id = _user_id
        AND wma.module = _module
    );
$$;

REVOKE ALL ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) FROM public;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, public.workspace_module) TO authenticated;

-- 4. Replace VENDORS write policies (keep existing SELECT policies — already member-readable)
DROP POLICY IF EXISTS "Admins can insert vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can update vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can delete vendors" ON public.vendors;

CREATE POLICY "Authorized members can insert vendors"
  ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access(auth.uid(), workspace_id, 'vendor_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

CREATE POLICY "Authorized members can update vendors"
  ON public.vendors
  FOR UPDATE TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'vendor_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

CREATE POLICY "Authorized members can delete vendors"
  ON public.vendors
  FOR DELETE TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'vendor_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'vendorManagement')
  );

-- 5. Replace SUBSCRIPTIONS policies
DROP POLICY IF EXISTS "Admins can view subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Admins can insert subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Admins can update subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Admins can delete subscriptions" ON public.subscriptions;

CREATE POLICY "Authorized members can view subscriptions"
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'subscription_management'::public.workspace_module)
  );

CREATE POLICY "Authorized members can insert subscriptions"
  ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access(auth.uid(), workspace_id, 'subscription_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );

CREATE POLICY "Authorized members can update subscriptions"
  ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'subscription_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );

CREATE POLICY "Authorized members can delete subscriptions"
  ON public.subscriptions
  FOR DELETE TO authenticated
  USING (
    public.has_module_access(auth.uid(), workspace_id, 'subscription_management'::public.workspace_module)
    AND public.workspace_has_active_feature(workspace_id, 'subscriptionTracking')
  );
