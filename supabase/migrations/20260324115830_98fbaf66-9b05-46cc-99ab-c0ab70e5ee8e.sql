
-- Create a view that returns one row per proposal: the latest (highest version_number) version.
-- This moves deduplication to the DB and avoids fetching all versions client-side.
CREATE OR REPLACE VIEW public.latest_proposal_versions AS
SELECT DISTINCT ON (pv.proposal_id)
  pv.id,
  pv.proposal_id,
  pv.version_number,
  pv.status,
  pv.grand_total,
  pv.currency,
  pv.workspace_id,
  pv.sent_at,
  pv.created_at
FROM public.proposal_versions pv
ORDER BY pv.proposal_id, pv.version_number DESC;
