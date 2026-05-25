-- Neutralized: hard-coded platform-admin seed by personal email removed.
-- Platform admin grants must be performed via an authenticated admin workflow,
-- never by identity-specific production migrations.
DO $$
BEGIN
  RAISE NOTICE 'No-op: hard-coded platform-admin seed migration neutralized.';
END $$;
