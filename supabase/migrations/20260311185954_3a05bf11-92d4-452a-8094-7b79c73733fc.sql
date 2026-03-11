
-- =============================================================
-- Phase 1: Authentication, Tenancy, RBAC
-- CoreFlow OS — Foundational Schema
-- =============================================================

-- 1. Role enum (admin, team_member) — spec Section 2.9
CREATE TYPE public.app_role AS ENUM ('admin', 'team_member');

-- 2. Workspaces — root multi-tenant isolation container
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  currency TEXT NOT NULL DEFAULT 'BDT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- 3. Profiles — extended internal identity metadata
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Workspace Memberships — RBAC with composite unique
CREATE TABLE public.workspace_memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'team_member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

-- 5. Indexes for RLS performance (spec Section 2.10 — leading workspace_id)
CREATE INDEX idx_workspace_memberships_workspace ON public.workspace_memberships(workspace_id);
CREATE INDEX idx_workspace_memberships_user ON public.workspace_memberships(user_id);
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);

-- 6. Updated_at trigger function (universal, spec Section 2.13)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_memberships_updated_at
  BEFORE UPDATE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Auth → profiles sync trigger (spec Section 2.4 Phase 1)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Security definer helpers for RLS (spec Section 2.10 — scalar subquery pattern)
CREATE OR REPLACE FUNCTION public.has_workspace_access(_user_id UUID, _workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = _user_id
      AND workspace_id = _workspace_id
  )
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_user_id UUID, _workspace_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = _user_id
      AND workspace_id = _workspace_id
      AND role = _role
  )
$$;

-- 9. RLS Policies — Workspaces
CREATE POLICY "Members can view their workspaces"
  ON public.workspaces FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), id)
    AND deleted_at IS NULL
  );

CREATE POLICY "Admins can update workspaces"
  ON public.workspaces FOR UPDATE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), id, 'admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "Authenticated users can create workspaces"
  ON public.workspaces FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 10. RLS Policies — Profiles
CREATE POLICY "Users can view profiles in their workspaces"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.workspace_memberships wm1
      JOIN public.workspace_memberships wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = (SELECT auth.uid())
        AND wm2.user_id = profiles.user_id
    )
  );

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 11. RLS Policies — Workspace Memberships
CREATE POLICY "Members can view memberships in their workspaces"
  ON public.workspace_memberships FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_access((SELECT auth.uid()), workspace_id)
  );

CREATE POLICY "Admins can insert memberships"
  ON public.workspace_memberships FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships wm WHERE wm.workspace_id = workspace_memberships.workspace_id
    )
  );

CREATE POLICY "Admins can update memberships"
  ON public.workspace_memberships FOR UPDATE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

CREATE POLICY "Admins can delete memberships"
  ON public.workspace_memberships FOR DELETE
  TO authenticated
  USING (
    public.has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );
