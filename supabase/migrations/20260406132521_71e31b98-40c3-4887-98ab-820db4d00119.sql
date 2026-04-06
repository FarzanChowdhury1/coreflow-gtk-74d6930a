-- Fix: Storage INSERT policy should verify workspace membership matches the upload path
-- The storage path pattern is: {workspace_id}/... so we extract workspace_id from the path

DROP POLICY IF EXISTS "workspace members can upload files" ON storage.objects;

CREATE POLICY "workspace members can upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-files'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.user_id = (SELECT auth.uid())
      AND wm.workspace_id = (split_part(name, '/', 1))::uuid
  )
);