-- Drop all 7 legacy anon SELECT policies that expose business data
DROP POLICY IF EXISTS "Anon can view proposals by id" ON public.proposals;
DROP POLICY IF EXISTS "Anon can view proposal versions" ON public.proposal_versions;
DROP POLICY IF EXISTS "Anon can view proposal line items" ON public.proposal_line_items;
DROP POLICY IF EXISTS "Anon can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Anon can view invoice line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Anon can view payments" ON public.payments;
DROP POLICY IF EXISTS "Anon can view companies by id" ON public.companies;

-- Enable RLS on portal system tables (service-role access only, no public policies)
ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_failed_attempts ENABLE ROW LEVEL SECURITY;
