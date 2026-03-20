
-- 1. Make projects.company_id nullable for internal projects
ALTER TABLE public.projects ALTER COLUMN company_id DROP NOT NULL;

-- 2. Create departments table
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view departments"
  ON public.departments FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Admins can manage departments"
  ON public.departments FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- 3. Create teams table (pods/squads)
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view teams"
  ON public.teams FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Admins can manage teams"
  ON public.teams FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- 4. Create team_members junction table
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view team members"
  ON public.team_members FOR SELECT TO authenticated
  USING (has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Admins can manage team members"
  ON public.team_members FOR ALL TO authenticated
  USING (has_workspace_role(auth.uid(), workspace_id, 'admin'))
  WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- 5. Add department_id to workspace_memberships for department assignment
ALTER TABLE public.workspace_memberships
  ADD COLUMN department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
