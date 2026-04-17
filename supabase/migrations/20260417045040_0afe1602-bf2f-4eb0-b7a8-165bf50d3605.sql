-- Fix files_owner_type_check to allow 'expense' so the receipt extraction
-- approval flow can re-link the receipt file from owner_type='expense_receipt'
-- to owner_type='expense' against the newly-created expense row.
-- Idempotent: drop-if-exists then recreate with the full canonical allowlist.

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
    'expense_receipt'::text,
    'expense'::text,
    'feedback'::text
  ]));