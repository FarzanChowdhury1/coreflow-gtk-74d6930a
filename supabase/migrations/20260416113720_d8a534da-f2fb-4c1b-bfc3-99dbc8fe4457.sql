
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS portal_accent_color text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS portal_logo_storage_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS portal_support_email text DEFAULT NULL;
