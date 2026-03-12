
-- ============================================================
-- FILES TABLE — relational metadata registry
-- ============================================================
CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  uploaded_by uuid, -- NULL for portal uploads
  description text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_owner_type_check CHECK (owner_type IN ('project', 'invoice', 'company', 'payment_proof', 'client_update'))
);

CREATE INDEX idx_files_owner ON public.files(owner_type, owner_id);
CREATE INDEX idx_files_workspace ON public.files(workspace_id);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- Internal users: workspace-scoped access
CREATE POLICY "Members can view files in workspace"
  ON public.files FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Members can insert files"
  ON public.files FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update files"
  ON public.files FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Admins can delete files"
  ON public.files FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- updated_at trigger
CREATE TRIGGER trg_files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit trigger
CREATE TRIGGER trg_audit_files
  AFTER INSERT OR UPDATE OR DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ============================================================
-- CLIENT_UPDATES TABLE — manually authored, client-visible
-- ============================================================
CREATE TABLE public.client_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  author_id uuid NOT NULL, -- the team member who wrote it
  title text NOT NULL,
  body text,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  file_id uuid REFERENCES public.files(id), -- optional milestone attachment
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_updates_project ON public.client_updates(project_id);
CREATE INDEX idx_client_updates_company ON public.client_updates(company_id);

ALTER TABLE public.client_updates ENABLE ROW LEVEL SECURITY;

-- Admins: full workspace access
CREATE POLICY "Admins can manage client updates"
  ON public.client_updates FOR ALL TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'))
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- Team members: only for assigned projects
CREATE POLICY "Team members can view updates for assigned projects"
  ON public.client_updates FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL
    AND is_project_member((SELECT auth.uid()), project_id));

CREATE POLICY "Team members can insert updates for assigned projects"
  ON public.client_updates FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id)
    AND is_project_member((SELECT auth.uid()), project_id));

CREATE POLICY "Team members can update own updates"
  ON public.client_updates FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL
    AND author_id = (SELECT auth.uid()));

CREATE TRIGGER trg_client_updates_updated_at
  BEFORE UPDATE ON public.client_updates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_audit_client_updates
  AFTER INSERT OR UPDATE OR DELETE ON public.client_updates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ============================================================
-- STORAGE BUCKET — private, restricted
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-files',
  'workspace-files',
  false,
  20971520, -- 20MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
);

-- RLS on storage.objects for this bucket — authenticated users in workspace
CREATE POLICY "Authenticated users can upload to workspace-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workspace-files');

CREATE POLICY "Authenticated users can read workspace-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workspace-files');

-- Service role handles portal uploads (no anon/public policy needed)
