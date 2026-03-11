
-- Remove overly permissive anon UPDATE policy on proposal_versions
-- The portal_respond_proposal RPC is SECURITY DEFINER, so it bypasses RLS
DROP POLICY "Anon can update proposal version status" ON public.proposal_versions;
