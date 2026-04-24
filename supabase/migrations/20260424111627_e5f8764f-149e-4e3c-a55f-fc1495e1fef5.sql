-- Helper: can the user see a lead because they have a task on it?
CREATE OR REPLACE FUNCTION public.user_can_see_lead_via_task(_user uuid, _lead uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lead_tasks lt
    WHERE lt.lead_id = _lead
      AND (lt.assigned_to = _user OR lt.created_by = _user)
  );
$$;

-- Helper: can the user see a lead_task because they own the parent lead?
CREATE OR REPLACE FUNCTION public.user_owns_lead(_user uuid, _lead uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = _lead
      AND l.deleted_at IS NULL
      AND l.owner_id = _user
  );
$$;

-- Drop and recreate the recursive lead_tasks SELECT policy
DROP POLICY IF EXISTS "Team members can view relevant lead tasks" ON public.lead_tasks;

CREATE POLICY "Team members can view relevant lead tasks"
ON public.lead_tasks
FOR SELECT
TO authenticated
USING (
  has_workspace_access((SELECT auth.uid()), workspace_id)
  AND (
    assigned_to = (SELECT auth.uid())
    OR created_by = (SELECT auth.uid())
    OR public.user_owns_lead((SELECT auth.uid()), lead_id)
  )
);

-- Find and replace any recursive leads SELECT policy that references lead_tasks.
-- The current "Team members can view relevant leads" policy (per audit) does an
-- EXISTS on lead_tasks, which combined with lead_tasks' EXISTS-on-leads creates the loop.
DROP POLICY IF EXISTS "Team members can view relevant leads" ON public.leads;

CREATE POLICY "Team members can view relevant leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
  has_workspace_access((SELECT auth.uid()), workspace_id)
  AND deleted_at IS NULL
  AND (
    owner_id = (SELECT auth.uid())
    OR public.user_can_see_lead_via_task((SELECT auth.uid()), id)
  )
);