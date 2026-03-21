-- Client onboarding / intake tasks
CREATE TYPE public.client_task_status AS ENUM ('todo', 'submitted', 'approved', 'revision_requested');

CREATE TABLE public.client_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid REFERENCES public.projects(id),
  title text NOT NULL,
  description text,
  status public.client_task_status NOT NULL DEFAULT 'todo',
  sort_order integer NOT NULL DEFAULT 0,
  due_date date,
  created_by uuid NOT NULL,
  submitted_at timestamptz,
  approved_at timestamptz,
  response_text text,
  response_link text,
  response_notes text,
  revision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_tasks_workspace ON public.client_tasks(workspace_id);
CREATE INDEX idx_client_tasks_company ON public.client_tasks(company_id);

ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

-- Admins can fully manage
CREATE POLICY "Admins can manage client tasks"
  ON public.client_tasks FOR ALL
  TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- Team members with company access can view
CREATE POLICY "Members with company access can view client tasks"
  ON public.client_tasks FOR SELECT
  TO authenticated
  USING (
    has_workspace_access(auth.uid(), workspace_id)
    AND has_company_access(auth.uid(), company_id)
  );