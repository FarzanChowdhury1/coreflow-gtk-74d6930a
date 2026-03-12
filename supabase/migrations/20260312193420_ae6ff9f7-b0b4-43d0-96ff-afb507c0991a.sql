-- Remove overly broad storage policies that allow cross-workspace file access
-- All file access routes through file-gateway edge function using service_role
DROP POLICY IF EXISTS "Authenticated users can read workspace-files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to workspace-files" ON storage.objects;