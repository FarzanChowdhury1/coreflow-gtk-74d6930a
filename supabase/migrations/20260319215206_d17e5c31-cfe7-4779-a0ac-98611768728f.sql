
-- Meeting status enum
CREATE TYPE public.meeting_status AS ENUM ('scheduled', 'completed', 'cancelled');

-- Meeting type enum
CREATE TYPE public.meeting_type AS ENUM ('internal', 'client');

-- Meetings table
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  title text NOT NULL,
  description text,
  meeting_type public.meeting_type NOT NULL DEFAULT 'client',
  status public.meeting_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text,
  attendees text,
  minutes text,
  company_id uuid REFERENCES public.companies(id),
  contact_id uuid REFERENCES public.contacts(id),
  lead_id uuid REFERENCES public.leads(id),
  project_id uuid REFERENCES public.projects(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins can manage meetings"
ON public.meetings FOR ALL TO authenticated
USING (has_workspace_role(auth.uid(), workspace_id, 'admin'))
WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- Team members can view meetings for their projects or unscoped meetings
CREATE POLICY "Members can view relevant meetings"
ON public.meetings FOR SELECT TO authenticated
USING (
  has_workspace_access(auth.uid(), workspace_id)
  AND (project_id IS NULL OR is_project_member(auth.uid(), project_id))
);

-- Members can insert meetings
CREATE POLICY "Members can insert meetings"
ON public.meetings FOR INSERT TO authenticated
WITH CHECK (
  has_workspace_access(auth.uid(), workspace_id)
  AND created_by = auth.uid()
);

-- Members can update meetings they created
CREATE POLICY "Members can update own meetings"
ON public.meetings FOR UPDATE TO authenticated
USING (
  has_workspace_access(auth.uid(), workspace_id)
  AND created_by = auth.uid()
);

-- Update the files owner_type CHECK to include 'meeting'
ALTER TABLE public.files DROP CONSTRAINT files_owner_type_check;
ALTER TABLE public.files ADD CONSTRAINT files_owner_type_check
  CHECK (owner_type IN ('project', 'invoice', 'company', 'payment_proof', 'client_update', 'meeting'));

-- Index for common queries
CREATE INDEX idx_meetings_workspace_starts ON public.meetings(workspace_id, starts_at DESC);
