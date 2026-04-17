ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_owner_type_check;
ALTER TABLE public.files ADD CONSTRAINT files_owner_type_check
  CHECK (owner_type = ANY (ARRAY[
    'project'::text,
    'invoice'::text,
    'company'::text,
    'payment_proof'::text,
    'client_update'::text,
    'meeting'::text,
    'expense_receipt'::text,
    'feedback'::text
  ]));