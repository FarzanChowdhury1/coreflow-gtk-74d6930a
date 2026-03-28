CREATE OR REPLACE VIEW public.latest_proposal_versions
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (proposal_id)
    id,
    proposal_id,
    version_number,
    status,
    grand_total,
    currency,
    workspace_id,
    sent_at,
    created_at
FROM public.proposal_versions pv
ORDER BY proposal_id, version_number DESC;