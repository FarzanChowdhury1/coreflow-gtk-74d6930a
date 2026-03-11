
-- =============================================
-- Phase 7: Approval Engine + Audit Trail + Notifications
-- =============================================

-- Approval entity types
CREATE TYPE public.approvable_type AS ENUM ('proposal_version', 'invoice', 'project');

-- Approval request status
CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- =============================================
-- Approval workflows — configurable per workspace
-- =============================================
CREATE TABLE public.approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  name TEXT NOT NULL,
  entity_type public.approvable_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workflows"
  ON public.approval_workflows FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Admins can insert workflows"
  ON public.approval_workflows FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

CREATE POLICY "Admins can update workflows"
  ON public.approval_workflows FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

CREATE POLICY "Admins can delete workflows"
  ON public.approval_workflows FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

CREATE TRIGGER set_approval_workflows_updated_at
  BEFORE UPDATE ON public.approval_workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Approval steps — ordered chain of approvers
-- =============================================
CREATE TABLE public.approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.approval_workflows(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  step_order INT NOT NULL DEFAULT 1,
  approver_id UUID NOT NULL, -- references auth.users via profiles
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, step_order)
);

ALTER TABLE public.approval_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view approval steps"
  ON public.approval_steps FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Admins can insert approval steps"
  ON public.approval_steps FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

CREATE POLICY "Admins can update approval steps"
  ON public.approval_steps FOR UPDATE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

CREATE POLICY "Admins can delete approval steps"
  ON public.approval_steps FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- =============================================
-- Approval requests — individual items pending approval
-- =============================================
CREATE TABLE public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  workflow_id UUID NOT NULL REFERENCES public.approval_workflows(id),
  entity_type public.approvable_type NOT NULL,
  entity_id UUID NOT NULL,
  current_step INT NOT NULL DEFAULT 1,
  status public.approval_status NOT NULL DEFAULT 'pending',
  requested_by UUID NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view approval requests"
  ON public.approval_requests FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert approval requests"
  ON public.approval_requests FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update approval requests"
  ON public.approval_requests FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE TRIGGER set_approval_requests_updated_at
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Approval actions — individual step decisions (audit)
-- =============================================
CREATE TABLE public.approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  request_id UUID NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  actor_id UUID NOT NULL,
  decision public.approval_status NOT NULL,
  comment TEXT,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view approval actions"
  ON public.approval_actions FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert approval actions"
  ON public.approval_actions FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

-- No UPDATE/DELETE — append-only audit trail

-- =============================================
-- Audit log — immutable forensic records
-- =============================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  actor_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert audit logs"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

-- No UPDATE/DELETE — immutable

-- =============================================
-- Notifications table
-- =============================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Members can insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- =============================================
-- RPC: Process approval decision (advance chain or finalize)
-- =============================================
CREATE OR REPLACE FUNCTION public.process_approval_decision(
  _request_id UUID,
  _decision TEXT,
  _comment TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _request RECORD;
  _step RECORD;
  _next_step RECORD;
  _total_steps INT;
  _user_id UUID;
  _actor_name TEXT;
BEGIN
  _user_id := auth.uid();
  
  -- Get request
  SELECT * INTO _request FROM public.approval_requests WHERE id = _request_id;
  IF _request IS NULL OR _request.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or not pending');
  END IF;

  -- Get current step
  SELECT * INTO _step FROM public.approval_steps
  WHERE workflow_id = _request.workflow_id AND step_order = _request.current_step;
  
  IF _step IS NULL OR _step.approver_id != _user_id THEN
    RETURN json_build_object('success', false, 'error', 'You are not the current approver');
  END IF;

  -- Validate decision
  IF _decision NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid decision');
  END IF;

  -- Get actor name
  SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _user_id;

  -- Record the action
  INSERT INTO public.approval_actions (workspace_id, request_id, step_order, actor_id, decision, comment)
  VALUES (_request.workspace_id, _request_id, _request.current_step, _user_id, _decision::approval_status, _comment);

  IF _decision = 'rejected' THEN
    -- Reject immediately
    UPDATE public.approval_requests SET status = 'rejected', resolved_at = now() WHERE id = _request_id;
    
    -- Audit log
    INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
    VALUES (_request.workspace_id, _user_id, _actor_name, 'approval_rejected', _request.entity_type::text, _request.entity_id,
      json_build_object('request_id', _request_id, 'step', _request.current_step, 'comment', _comment)::jsonb);

    -- Notify requester
    INSERT INTO public.notifications (workspace_id, user_id, title, body, link)
    VALUES (_request.workspace_id, _request.requested_by, 
      'Approval Rejected', 
      COALESCE(_actor_name, 'Someone') || ' rejected your ' || _request.entity_type::text || ' approval request',
      '/approvals');

    RETURN json_build_object('success', true, 'status', 'rejected');
  END IF;

  -- Approved — check if there are more steps
  SELECT COUNT(*) INTO _total_steps FROM public.approval_steps WHERE workflow_id = _request.workflow_id;

  IF _request.current_step >= _total_steps THEN
    -- Final approval
    UPDATE public.approval_requests SET status = 'approved', resolved_at = now() WHERE id = _request_id;
    
    INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
    VALUES (_request.workspace_id, _user_id, _actor_name, 'approval_granted', _request.entity_type::text, _request.entity_id,
      json_build_object('request_id', _request_id, 'step', _request.current_step, 'final', true)::jsonb);

    INSERT INTO public.notifications (workspace_id, user_id, title, body, link)
    VALUES (_request.workspace_id, _request.requested_by,
      'Approval Granted',
      'Your ' || _request.entity_type::text || ' has been fully approved',
      '/approvals');

    RETURN json_build_object('success', true, 'status', 'approved');
  ELSE
    -- Advance to next step
    UPDATE public.approval_requests SET current_step = _request.current_step + 1 WHERE id = _request_id;
    
    -- Get next approver and notify
    SELECT * INTO _next_step FROM public.approval_steps
    WHERE workflow_id = _request.workflow_id AND step_order = _request.current_step + 1;
    
    IF _next_step IS NOT NULL THEN
      INSERT INTO public.notifications (workspace_id, user_id, title, body, link)
      VALUES (_request.workspace_id, _next_step.approver_id,
        'Approval Required',
        'A ' || _request.entity_type::text || ' needs your approval (step ' || (_request.current_step + 1) || ')',
        '/approvals');
    END IF;

    INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
    VALUES (_request.workspace_id, _user_id, _actor_name, 'approval_step_approved', _request.entity_type::text, _request.entity_id,
      json_build_object('request_id', _request_id, 'step', _request.current_step, 'next_step', _request.current_step + 1)::jsonb);

    RETURN json_build_object('success', true, 'status', 'advanced', 'next_step', _request.current_step + 1);
  END IF;
END;
$$;

-- =============================================
-- RPC: Submit entity for approval
-- =============================================
CREATE OR REPLACE FUNCTION public.submit_for_approval(
  _workspace_id UUID,
  _entity_type TEXT,
  _entity_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _workflow RECORD;
  _first_approver RECORD;
  _request_id UUID;
  _user_id UUID;
  _actor_name TEXT;
BEGIN
  _user_id := auth.uid();

  -- Find active workflow for this entity type
  SELECT * INTO _workflow FROM public.approval_workflows
  WHERE workspace_id = _workspace_id AND entity_type = _entity_type::approvable_type AND is_active = true
  LIMIT 1;

  IF _workflow IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active workflow found for ' || _entity_type);
  END IF;

  -- Check if there's already a pending request
  IF EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE entity_id = _entity_id AND entity_type = _entity_type::approvable_type AND status = 'pending'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'An approval request is already pending');
  END IF;

  -- Create request
  INSERT INTO public.approval_requests (workspace_id, workflow_id, entity_type, entity_id, requested_by)
  VALUES (_workspace_id, _workflow.id, _entity_type::approvable_type, _entity_id, _user_id)
  RETURNING id INTO _request_id;

  -- Notify first approver
  SELECT * INTO _first_approver FROM public.approval_steps
  WHERE workflow_id = _workflow.id AND step_order = 1;

  IF _first_approver IS NOT NULL THEN
    INSERT INTO public.notifications (workspace_id, user_id, title, body, link)
    VALUES (_workspace_id, _first_approver.approver_id,
      'Approval Required',
      'A ' || _entity_type || ' needs your approval',
      '/approvals');
  END IF;

  SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _user_id;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (_workspace_id, _user_id, _actor_name, 'approval_submitted', _entity_type, _entity_id,
    json_build_object('request_id', _request_id, 'workflow', _workflow.name)::jsonb);

  RETURN json_build_object('success', true, 'request_id', _request_id);
END;
$$;
