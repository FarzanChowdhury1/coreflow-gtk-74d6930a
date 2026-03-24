
-- Fix: Set the view to use invoker security so RLS on proposal_versions is respected
ALTER VIEW public.latest_proposal_versions SET (security_invoker = on);
