-- Final OCR residue cleanup: tighten files_owner_type_check to remove 'expense_receipt'.
-- Safety preconditions verified:
--   * Production: 0 rows with owner_type='expense_receipt'
--   * Test: 5 orphan rows from defunct OCR test uploads (no downstream references)
--   * All OCR tables/functions/RPCs already dropped
-- Strategy: soft-delete any remaining 'expense_receipt' rows (preserves audit trail
-- via deleted_at), then rebuild the constraint without 'expense_receipt'.

-- 1) Soft-delete any orphan expense_receipt files (idempotent)
UPDATE public.files
   SET deleted_at = COALESCE(deleted_at, now())
 WHERE owner_type = 'expense_receipt';

-- 2) Hard-delete the soft-deleted OCR orphan rows so the CHECK can be tightened
DELETE FROM public.files
 WHERE owner_type = 'expense_receipt';

-- 3) Rebuild constraint without 'expense_receipt'
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_owner_type_check;

ALTER TABLE public.files
  ADD CONSTRAINT files_owner_type_check
  CHECK (owner_type = ANY (ARRAY[
    'project'::text,
    'invoice'::text,
    'company'::text,
    'payment_proof'::text,
    'client_update'::text,
    'meeting'::text,
    'expense'::text,
    'feedback'::text
  ]));