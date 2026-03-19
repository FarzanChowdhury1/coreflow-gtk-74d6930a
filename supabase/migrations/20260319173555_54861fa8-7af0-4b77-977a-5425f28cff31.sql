-- Add lead_id to proposals for conversion provenance tracking
ALTER TABLE public.proposals ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL DEFAULT NULL;

-- Create index for efficient lookups
CREATE INDEX idx_proposals_lead_id ON public.proposals(lead_id) WHERE lead_id IS NOT NULL;