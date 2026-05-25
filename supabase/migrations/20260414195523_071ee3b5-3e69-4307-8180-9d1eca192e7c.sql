-- SECURITY FIX: neutralized unsafe hard-coded workspace soft-delete migration.
--
-- Previous version soft-deleted a hard-coded UUID list without checking whether
-- the workspaces were empty, synthetic, approved for deletion, or non-production.
-- Replay must be non-destructive.
DO $$
BEGIN
  RAISE NOTICE 'No-op: unsafe hard-coded workspace soft-delete migration neutralized.';
END $$;
