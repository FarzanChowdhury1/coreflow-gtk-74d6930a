-- SECURITY FIX: neutralized unsafe destructive lr-verify cleanup migration.
--
-- Previously this migration deleted tenant rows by non-unique workspace name
-- and deleted auth.users by broad email LIKE pattern. That is unsafe in shared
-- production-like environments and is now disabled.
--
-- Left as a non-destructive no-op so migration replay remains safe.

DO $cleanup$
BEGIN
  RAISE NOTICE 'No-op: unsafe lr-verify destructive cleanup migration has been neutralized.';
END
$cleanup$;
