
-- =============================================================
-- Phase 4: Projects, Project Members, Tasks
-- Operational delivery hub — isolated from pricing data
-- =============================================================

-- 1. Project status enum
CREATE TYPE public.project_status AS ENUM ('active', 'on_hold', 'completed', 'cancelled');

-- 2. Task status enum
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'review', 'done');

-- 3. Task priority enum
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- 4. Projects — operational fulfillment container
--    Spec: instantiation permitted strictly via approved proposal versions
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  proposal_version_id UUID REFERENCES public.proposal_versions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status public.project_status NOT NULL DEFAULT 'active',
  description TEXT,
  start_date DATE,
  target_end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_projects_workspace ON public.projects(workspace_id);
CREATE INDEX idx_projects_company ON public.projects(company_id);
CREATE INDEX idx_projects_proposal_version ON public.projects(proposal_version_id);

-- 5. Project Members — granular operational visibility junction
--    Composite unique controls single membership per project
CREATE TABLE public.project_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_project_members_workspace ON public.project_members(workspace_id);
CREATE INDEX idx_project_members_project ON public.project_members(project_id);
CREATE INDEX idx_project_members_user ON public.project_members(user_id);

-- 6. Tasks — discrete internal labor units within a project
--    Decoupled from client portal visibility (spec Section 2.5)
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.task_priority NOT NULL DEFAULT 'medium',
  due_date DATE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tasks_workspace ON public.tasks(workspace_id);
CREATE INDEX idx_tasks_project ON public.tasks(project_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(workspace_id, project_id, status);

-- 7. Updated_at triggers
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Security definer helper for project member check (team_member visibility)
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

-- 9. RLS — Projects
--    Admins see all workspace projects; team_members only see assigned projects
CREATE POLICY "Admins can view all workspace projects"
  ON public.projects FOR SELECT TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "Team members can view assigned projects"
  ON public.projects FOR SELECT TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND deleted_at IS NULL
    AND public.is_project_member((SELECT auth.uid()), id)
  );

CREATE POLICY "Admins can insert projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

CREATE POLICY "Admins can update projects"
  ON public.projects FOR UPDATE TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "Admins can delete projects"
  ON public.projects FOR DELETE TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- 10. RLS — Project Members
CREATE POLICY "Members can view project members"
  ON public.project_members FOR SELECT TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
  );

CREATE POLICY "Admins can manage project members"
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

CREATE POLICY "Admins can delete project members"
  ON public.project_members FOR DELETE TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- 11. RLS — Tasks
--    Admins: all tasks in workspace; Team members: tasks in their projects
CREATE POLICY "Admins can view all workspace tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

CREATE POLICY "Team members can view tasks in assigned projects"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND public.is_project_member((SELECT auth.uid()), project_id)
  );

CREATE POLICY "Members can insert tasks in accessible projects"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND (
      public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
      OR public.is_project_member((SELECT auth.uid()), project_id)
    )
  );

CREATE POLICY "Members can update tasks in accessible projects"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
    AND (
      public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
      OR public.is_project_member((SELECT auth.uid()), project_id)
    )
  );

CREATE POLICY "Admins can delete tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- 12. Trigger: Auto-create project when approval is inserted (Phase 4 spec)
--     This will be fully wired when the approvals table exists (Phase 3 approval record).
--     For now, we create a function that can be called to instantiate a project from an approved version.
CREATE OR REPLACE FUNCTION public.create_project_from_approved_version(
  _workspace_id UUID,
  _proposal_version_id UUID,
  _created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _version RECORD;
  _proposal RECORD;
  _project_id UUID;
  _line RECORD;
BEGIN
  -- Fetch version and validate it's approved
  SELECT * INTO _version FROM public.proposal_versions WHERE id = _proposal_version_id;
  IF _version IS NULL OR _version.status != 'approved' THEN
    RAISE EXCEPTION 'Proposal version must be approved to create a project';
  END IF;

  -- Fetch parent proposal
  SELECT * INTO _proposal FROM public.proposals WHERE id = _version.proposal_id;
  IF _proposal IS NULL THEN
    RAISE EXCEPTION 'Parent proposal not found';
  END IF;

  -- Check no project already exists for this version
  IF EXISTS (SELECT 1 FROM public.projects WHERE proposal_version_id = _proposal_version_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'A project already exists for this proposal version';
  END IF;

  -- Create project
  INSERT INTO public.projects (workspace_id, company_id, proposal_version_id, name, status)
  VALUES (_workspace_id, _proposal.company_id, _proposal_version_id, _proposal.title, 'active')
  RETURNING id INTO _project_id;

  -- Add creator as project member
  INSERT INTO public.project_members (workspace_id, project_id, user_id)
  VALUES (_workspace_id, _project_id, _created_by);

  -- Auto-create tasks from line items (scope transfer)
  FOR _line IN
    SELECT description, sort_order FROM public.proposal_line_items
    WHERE version_id = _proposal_version_id
    ORDER BY sort_order
  LOOP
    INSERT INTO public.tasks (workspace_id, project_id, title, sort_order)
    VALUES (_workspace_id, _project_id, _line.description, _line.sort_order);
  END LOOP;

  RETURN _project_id;
END;
$$;
