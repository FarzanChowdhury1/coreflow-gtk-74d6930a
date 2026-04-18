-- Narrow the storage RLS for workspace branding assets.
-- Replace the prior broad workspace-prefix policies with policies that
-- ONLY allow access to the deterministic branding object paths:
--   <workspace_id>/doc-logo.(png|jpg|jpeg)
--   <workspace_id>/portal-logo.(png|jpg|jpeg)
-- All other workspace-files objects continue to be governed by the
-- existing public.files-backed policies (unchanged).

-- Drop the previous broad policies if they exist
DROP POLICY IF EXISTS "workspace members can read identity assets" ON storage.objects;
DROP POLICY IF EXISTS "workspace admins can update identity assets" ON storage.objects;
DROP POLICY IF EXISTS "workspace members can read branding assets" ON storage.objects;
DROP POLICY IF EXISTS "workspace admins can write branding assets" ON storage.objects;
DROP POLICY IF EXISTS "workspace admins can update branding assets" ON storage.objects;
DROP POLICY IF EXISTS "workspace admins can delete branding assets" ON storage.objects;

-- Helper: branding path predicate
-- name format: '<uuid>/doc-logo.<ext>' or '<uuid>/portal-logo.<ext>'
-- ext restricted to png/jpg/jpeg (case-insensitive)
-- The first path segment must be a workspace UUID the user is a member of.

-- READ: workspace members may read ONLY the two deterministic branding paths
CREATE POLICY "branding assets readable by workspace members"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND (
    name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
  )
  AND has_workspace_access(
    auth.uid(),
    ((regexp_match(name, '^([0-9a-f-]{36})/'))[1])::uuid
  )
);

-- INSERT: workspace admins may upload ONLY branding paths for their workspace
CREATE POLICY "branding assets insertable by workspace admins"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-files'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
  AND has_workspace_role(
    auth.uid(),
    ((regexp_match(name, '^([0-9a-f-]{36})/'))[1])::uuid,
    'admin'::app_role
  )
);

-- UPDATE: workspace admins may replace ONLY branding paths for their workspace
CREATE POLICY "branding assets updatable by workspace admins"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
  AND has_workspace_role(
    auth.uid(),
    ((regexp_match(name, '^([0-9a-f-]{36})/'))[1])::uuid,
    'admin'::app_role
  )
)
WITH CHECK (
  bucket_id = 'workspace-files'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
  AND has_workspace_role(
    auth.uid(),
    ((regexp_match(name, '^([0-9a-f-]{36})/'))[1])::uuid,
    'admin'::app_role
  )
);

-- DELETE: workspace admins may remove ONLY branding paths for their workspace
CREATE POLICY "branding assets deletable by workspace admins"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(doc|portal)-logo\.(png|jpe?g)$'
  AND has_workspace_role(
    auth.uid(),
    ((regexp_match(name, '^([0-9a-f-]{36})/'))[1])::uuid,
    'admin'::app_role
  )
);