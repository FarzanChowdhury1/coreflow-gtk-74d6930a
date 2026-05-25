-- Finding 16 follow-up: ensure broad workspace-files SELECT/UPDATE policies are removed on Live.
-- Test already lacks these; this migration is a no-op there and the corrective drop on Live.
DROP POLICY IF EXISTS "workspace members can read own files"   ON storage.objects;
DROP POLICY IF EXISTS "workspace members can update own files" ON storage.objects;
-- Defensive: also drop any equivalent that may have been re-introduced.
DROP POLICY IF EXISTS "Authenticated users can read workspace-files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update workspace-files" ON storage.objects;