-- 1. Drop the race-condition-prone SELECT policy on workspaces
-- The bootstrap_workspace RPC (SECURITY DEFINER) creates workspace + membership atomically
-- After bootstrap, "Members can view their workspaces" handles visibility via has_workspace_access()
DROP POLICY IF EXISTS "Creator can view workspace just inserted" ON public.workspaces;

-- 2. Drop the open INSERT policy on workspaces
-- Only bootstrap_workspace RPC should create workspaces (runs as SECURITY DEFINER, bypasses RLS)
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
