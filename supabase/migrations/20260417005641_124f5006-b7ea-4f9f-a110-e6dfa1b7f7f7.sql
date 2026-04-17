-- Align expense_extraction_status enum ordering on Test with Live.
-- Live order: uploaded, processing, extracted, review_required, approved, expense_created, failed, cancelled
-- Test order: uploaded, processing, extracted, review_required, expense_created, failed, cancelled, approved
--
-- Postgres cannot reorder enum values in place. We swap the type via text round-trip,
-- keeping all data and dependencies intact. The column default and NOT NULL are preserved.

DO $$
DECLARE
  _live_order text[] := ARRAY[
    'uploaded','processing','extracted','review_required',
    'approved','expense_created','failed','cancelled'
  ];
  _current_order text[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder)
    INTO _current_order
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'expense_extraction_status';

  IF _current_order IS DISTINCT FROM _live_order THEN
    -- Drop default so we can change column type
    ALTER TABLE public.expense_extraction_jobs
      ALTER COLUMN status DROP DEFAULT;

    -- Rename old type out of the way
    ALTER TYPE public.expense_extraction_status RENAME TO expense_extraction_status__old;

    -- Recreate type with the live ordering
    CREATE TYPE public.expense_extraction_status AS ENUM (
      'uploaded','processing','extracted','review_required',
      'approved','expense_created','failed','cancelled'
    );

    -- Cast existing column data through text into the new type
    ALTER TABLE public.expense_extraction_jobs
      ALTER COLUMN status TYPE public.expense_extraction_status
      USING status::text::public.expense_extraction_status;

    -- Restore default
    ALTER TABLE public.expense_extraction_jobs
      ALTER COLUMN status SET DEFAULT 'uploaded'::public.expense_extraction_status;

    -- Drop the old type (no remaining dependencies)
    DROP TYPE public.expense_extraction_status__old;
  END IF;
END$$;