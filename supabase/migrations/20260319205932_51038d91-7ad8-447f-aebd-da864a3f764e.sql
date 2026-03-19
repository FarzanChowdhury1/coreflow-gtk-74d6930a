
-- Lead-stage internal work items (intentionally lighter than project tasks)
CREATE TYPE public.lead_task_status AS ENUM ('todo', 'in_progress', 'done', 'blocked');

CREATE TABLE public.lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  title text NOT NULL,
  description text,
  status lead_task_status NOT NULL DEFAULT 'todo',
  assigned_to uuid,
  due_date date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_tasks_lead_id ON public.lead_tasks(lead_id);
CREATE INDEX idx_lead_tasks_workspace_id ON public.lead_tasks(workspace_id);

ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view lead tasks"
  ON public.lead_tasks FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Members can insert lead tasks"
  ON public.lead_tasks FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access(auth.uid(), workspace_id) AND created_by = auth.uid());

CREATE POLICY "Members can update lead tasks"
  ON public.lead_tasks FOR UPDATE TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Admins can delete lead tasks"
  ON public.lead_tasks FOR DELETE TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'));
