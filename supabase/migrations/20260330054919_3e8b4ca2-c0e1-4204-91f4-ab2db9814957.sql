-- Add RLS policies to storage.objects for workspace-files bucket

-- SELECT: workspace members can read files from their workspace
CREATE POLICY "workspace members can read own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1 FROM public.files f
    JOIN public.workspace_memberships wm
      ON wm.workspace_id = f.workspace_id
    WHERE f.storage_path = storage.objects.name
      AND wm.user_id = (SELECT auth.uid())
      AND f.deleted_at IS NULL
  )
);

-- INSERT: workspace members can upload files
CREATE POLICY "workspace members can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = (SELECT auth.uid())
  )
);

-- UPDATE: workspace members can update their workspace files
CREATE POLICY "workspace members can update own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1 FROM public.files f
    JOIN public.workspace_memberships wm
      ON wm.workspace_id = f.workspace_id
    WHERE f.storage_path = storage.objects.name
      AND wm.user_id = (SELECT auth.uid())
      AND f.deleted_at IS NULL
  )
);

-- DELETE: only admins can delete workspace files
CREATE POLICY "admins can delete workspace files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1 FROM public.files f
    JOIN public.workspace_memberships wm
      ON wm.workspace_id = f.workspace_id
    WHERE f.storage_path = storage.objects.name
      AND wm.user_id = (SELECT auth.uid())
      AND wm.role = 'admin'
  )
);
