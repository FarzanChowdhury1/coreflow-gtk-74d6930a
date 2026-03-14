
-- Create feedback category and status enums
CREATE TYPE public.feedback_category AS ENUM ('bug', 'ui_ux', 'feature_request', 'performance', 'other');
CREATE TYPE public.feedback_status AS ENUM ('new', 'reviewed', 'accepted', 'closed');

-- Create beta_feedback table
CREATE TABLE public.beta_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  submitted_by UUID NOT NULL,
  category public.feedback_category NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  description TEXT,
  status public.feedback_status NOT NULL DEFAULT 'new',
  file_id UUID REFERENCES public.files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- Members can insert their own feedback
CREATE POLICY "Members can submit feedback"
  ON public.beta_feedback FOR INSERT TO authenticated
  WITH CHECK (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND submitted_by = (SELECT auth.uid())
  );

-- Members can view their own feedback
CREATE POLICY "Members can view own feedback"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (
    submitted_by = (SELECT auth.uid())
  );

-- Admins can view all feedback in workspace
CREATE POLICY "Admins can view all feedback"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- Admins can update feedback status
CREATE POLICY "Admins can update feedback"
  ON public.beta_feedback FOR UPDATE TO authenticated
  USING (
    has_workspace_role((SELECT auth.uid()), workspace_id, 'admin')
  );

-- Updated_at trigger
CREATE TRIGGER set_beta_feedback_updated_at
  BEFORE UPDATE ON public.beta_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
