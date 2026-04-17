-- Forward cleanup: remove OCR / receipt extraction artifacts.
-- Live + Test counts verified zero for jobs, corrections, and expense_receipt files.

-- 1) Drop OCR-only RPCs
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('approve_extraction_and_create_expense', 'cancel_extraction_job')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

-- 2) Drop OCR-only tables
DROP TABLE IF EXISTS public.expense_extraction_corrections CASCADE;
DROP TABLE IF EXISTS public.expense_extraction_jobs CASCADE;

-- 3) Drop OCR-only enum
DROP TYPE IF EXISTS public.expense_extraction_status;

-- Note: files_owner_type_check still permits 'expense_receipt' for historical safety.
-- No application code references it; can be tightened in a future cleanup.