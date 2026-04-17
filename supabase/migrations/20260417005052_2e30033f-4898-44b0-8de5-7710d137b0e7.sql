-- Defensive: ensure all expense_extraction_status enum values exist.
-- This is additive and idempotent. It exists to neutralize any stale diff
-- engine attempt to drop the enum type. We never drop the type or its values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'expense_extraction_status' AND e.enumlabel = 'uploaded'
  ) THEN
    ALTER TYPE public.expense_extraction_status ADD VALUE IF NOT EXISTS 'uploaded';
  END IF;
END$$;

DO $$
DECLARE
  _v text;
BEGIN
  FOREACH _v IN ARRAY ARRAY[
    'uploaded','processing','extracted','review_required',
    'approved','expense_created','failed','cancelled'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER TYPE public.expense_extraction_status ADD VALUE IF NOT EXISTS %L', _v);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END$$;