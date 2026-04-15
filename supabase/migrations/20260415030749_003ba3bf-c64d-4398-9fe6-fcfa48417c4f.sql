
-- Create enum for contact lifecycle
CREATE TYPE public.contact_lifecycle_status AS ENUM ('active', 'inactive', 'left_company', 'bounced');

-- Add column with safe default
ALTER TABLE public.contacts
  ADD COLUMN lifecycle_status public.contact_lifecycle_status NOT NULL DEFAULT 'active';

-- Index for filtering by status
CREATE INDEX idx_contacts_lifecycle_status ON public.contacts (workspace_id, lifecycle_status);
