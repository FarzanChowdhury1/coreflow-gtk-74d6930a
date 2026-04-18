-- Workspace document identity for formal PDFs (proposals/invoices).
-- Adds optional fields used purely for document rendering. Existing
-- workspace RLS already restricts member SELECT, admin UPDATE.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS doc_registered_name text,
  ADD COLUMN IF NOT EXISTS doc_trade_name text,
  ADD COLUMN IF NOT EXISTS doc_address text,
  ADD COLUMN IF NOT EXISTS doc_phone text,
  ADD COLUMN IF NOT EXISTS doc_email text,
  ADD COLUMN IF NOT EXISTS doc_bin text,
  ADD COLUMN IF NOT EXISTS doc_logo_storage_path text,
  ADD COLUMN IF NOT EXISTS doc_bank_account_name text,
  ADD COLUMN IF NOT EXISTS doc_bank_account_number text,
  ADD COLUMN IF NOT EXISTS doc_bank_name text,
  ADD COLUMN IF NOT EXISTS doc_bank_branch text,
  ADD COLUMN IF NOT EXISTS doc_payment_instructions text;

COMMENT ON COLUMN public.workspaces.doc_registered_name IS
  'Registered/legal business name used as primary issuer on formal PDFs (proposals, invoices). Falls back to workspaces.name when null.';
COMMENT ON COLUMN public.workspaces.doc_logo_storage_path IS
  'Path inside the workspace-files bucket to the document logo image (PNG/JPG). Used on formal PDFs when present.';