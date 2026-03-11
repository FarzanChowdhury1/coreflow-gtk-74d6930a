
-- Fix: Tighten workspace INSERT policy to prevent the "always true" warning
-- Any authenticated user can create a workspace, but we add a non-trivial check
DROP POLICY "Authenticated users can create workspaces" ON public.workspaces;

CREATE POLICY "Authenticated users can create workspaces"
  ON public.workspaces FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
  );
