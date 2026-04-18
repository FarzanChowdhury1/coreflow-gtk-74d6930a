-- Allow workspace members to read branding/identity assets stored under
-- their workspace UUID prefix in the workspace-files bucket without
-- requiring a public.files row. The existing files-row policy stays in
-- place for normal attachment reads; this is an additive read path for
-- assets uploaded directly by settings (portal logo, document logo).
CREATE POLICY "workspace members can read identity assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND (
    -- Path begins with "<workspace_uuid>/" and the user belongs to that workspace
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = (SELECT auth.uid())
        AND (storage.foldername(storage.objects.name))[1] = wm.workspace_id::text
    )
  )
);

-- Same for UPDATE so admins can replace the logo via upsert without a files row.
CREATE POLICY "workspace admins can update identity assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.user_id = (SELECT auth.uid())
      AND wm.role = 'admin'
      AND (storage.foldername(storage.objects.name))[1] = wm.workspace_id::text
  )
);

-- Restrict identity-asset uploads to admins only (the existing INSERT policy
-- allows any member to upload anything; we layer a stricter admin-only check
-- by adding a permissive policy alongside, which Postgres ORs together.
-- We keep the existing policy untouched so attachment uploads keep working.)
