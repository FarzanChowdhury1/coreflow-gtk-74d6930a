
-- Meeting actions/decisions table
CREATE TABLE public.meeting_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  action_type TEXT NOT NULL DEFAULT 'action' CHECK (action_type IN ('action', 'decision')),
  title TEXT NOT NULL,
  assignee_id UUID NULL,
  due_date DATE NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookup by meeting
CREATE INDEX idx_meeting_actions_meeting_id ON public.meeting_actions(meeting_id);

-- Enable RLS
ALTER TABLE public.meeting_actions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all meeting actions
CREATE POLICY "Admins can manage meeting actions"
ON public.meeting_actions FOR ALL TO authenticated
USING (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role))
WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- Members can view meeting actions for meetings they can see
CREATE POLICY "Members can view meeting actions"
ON public.meeting_actions FOR SELECT TO authenticated
USING (
  has_workspace_access(auth.uid(), workspace_id)
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_actions.meeting_id
    AND (m.project_id IS NULL OR is_project_member(auth.uid(), m.project_id))
  )
);

-- Members can insert meeting actions
CREATE POLICY "Members can insert meeting actions"
ON public.meeting_actions FOR INSERT TO authenticated
WITH CHECK (has_workspace_access(auth.uid(), workspace_id));

-- Members can update meeting actions
CREATE POLICY "Members can update meeting actions"
ON public.meeting_actions FOR UPDATE TO authenticated
USING (has_workspace_access(auth.uid(), workspace_id));
