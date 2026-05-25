-- SECURITY FIX: neutralized hard-coded workspace soft-delete by UUID literal.
-- Replay must be non-destructive.
DO $$
BEGIN
  RAISE NOTICE 'No-op: hard-coded pilot-workspace soft-delete neutralized.';
END $$;
