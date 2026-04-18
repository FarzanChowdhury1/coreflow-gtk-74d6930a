-- READ helper: object is the active doc/portal logo on a workspace the user belongs to.
CREATE OR REPLACE FUNCTION public.is_workspace_branding_readable(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
      AND (
        w.doc_logo_storage_path = _object_name
        OR w.portal_logo_storage_path = _object_name
      )
      AND public.has_workspace_access(_user_id, w.id)
  );
$$;

-- WRITE helper (UPDATE/DELETE): object is the active branding path on a workspace the user admins.
CREATE OR REPLACE FUNCTION public.is_workspace_branding_writable(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
      AND (
        w.doc_logo_storage_path = _object_name
        OR w.portal_logo_storage_path = _object_name
      )
      AND public.has_workspace_role(_user_id, w.id, 'admin'::app_role)
  );
$$;

-- INSERT helper: workspace row may not yet point at this path. Require strict
-- branding scheme AND admin role on the workspace whose UUID prefixes the path.
CREATE OR REPLACE FUNCTION public.is_workspace_branding_insertable(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
    AND public.has_workspace_role(
      _user_id,
      ((regexp_match(_object_name, '^([0-9a-f-]{36})/'))[1])::uuid,
      'admin'::app_role
    );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_branding_readable(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.is_workspace_branding_writable(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.is_workspace_branding_insertable(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_workspace_branding_readable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_branding_writable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_branding_insertable(uuid, text) TO authenticated;

-- Replace pattern-based branding policies with row-bound ones.
DROP POLICY IF EXISTS "branding assets readable by workspace members" ON storage.objects;
DROP POLICY IF EXISTS "branding assets insertable by workspace admins" ON storage.objects;
DROP POLICY IF EXISTS "branding assets updatable by workspace admins" ON storage.objects;
DROP POLICY IF EXISTS "branding assets deletable by workspace admins" ON storage.objects;

CREATE POLICY "branding assets readable by workspace members"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND public.is_workspace_branding_readable(auth.uid(), name)
);

CREATE POLICY "branding assets insertable by workspace admins"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-files'
  AND public.is_workspace_branding_insertable(auth.uid(), name)
);

CREATE POLICY "branding assets updatable by workspace admins"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND (
    public.is_workspace_branding_writable(auth.uid(), name)
    OR public.is_workspace_branding_insertable(auth.uid(), name)
  )
)
WITH CHECK (
  bucket_id = 'workspace-files'
  AND (
    public.is_workspace_branding_writable(auth.uid(), name)
    OR public.is_workspace_branding_insertable(auth.uid(), name)
  )
);

CREATE POLICY "branding assets deletable by workspace admins"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND public.is_workspace_branding_writable(auth.uid(), name)
);