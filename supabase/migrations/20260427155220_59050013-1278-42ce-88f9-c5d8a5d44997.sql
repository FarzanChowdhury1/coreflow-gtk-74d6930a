-- NEUTRALIZED: Previously contained a hard-coded 11-workspace UUID purge
-- across tenant tables (and in some cases drop/recreate of trg_audit_workspaces
-- and DELETE FROM workspaces). Replaced with a no-op to prevent destructive
-- replay against live or restored databases. Do not restore the original body.
DO $$
BEGIN
  RAISE NOTICE 'Skipped deprecated destructive purge migration 20260427155220_59050013-1278-42ce-88f9-c5d8a5d44997';
END
$$;
