-- Tighten leads UPDATE: only admin or lead owner can update (archive/restore/edit)
DROP POLICY IF EXISTS "Members can update leads" ON public.leads;

CREATE POLICY "Owner or admin can update leads"
ON public.leads
FOR UPDATE
TO authenticated
USING (
  has_workspace_role(( SELECT auth.uid() AS uid), workspace_id, 'admin'::app_role)
  OR (owner_id = ( SELECT auth.uid() AS uid))
);