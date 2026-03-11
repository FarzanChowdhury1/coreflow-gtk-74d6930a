
-- =============================================
-- Phase 5: Invoices & Payments
-- =============================================

-- Invoice status enum
CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'paid', 'partially_paid', 'void');

-- Payment method enum
CREATE TYPE public.payment_method AS ENUM ('bank_transfer', 'cash', 'cheque', 'mobile_banking', 'other');

-- =============================================
-- Invoice numbering sequence per workspace
-- =============================================
CREATE TABLE public.invoice_sequences (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view invoice sequences"
  ON public.invoice_sequences FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert invoice sequences"
  ON public.invoice_sequences FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update invoice sequences"
  ON public.invoice_sequences FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

-- =============================================
-- Invoices table
-- =============================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  invoice_number TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  project_id UUID REFERENCES public.projects(id),
  proposal_version_id UUID REFERENCES public.proposal_versions(id),
  status public.invoice_status NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'BDT',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  mushak_6_3 JSONB NOT NULL DEFAULT '{}'::jsonb,
  issue_date DATE,
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (workspace_id, invoice_number)
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoices
CREATE POLICY "Members can view invoices in their workspace"
  ON public.invoices FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Members can insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id) AND deleted_at IS NULL);

CREATE POLICY "Admins can delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (has_workspace_role((SELECT auth.uid()), workspace_id, 'admin'));

-- updated_at trigger
CREATE TRIGGER set_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Invoice line items
-- =============================================
CREATE TABLE public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view invoice line items"
  ON public.invoice_line_items FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert invoice line items"
  ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can update invoice line items"
  ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can delete invoice line items"
  ON public.invoice_line_items FOR DELETE TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE TRIGGER set_invoice_line_items_updated_at
  BEFORE UPDATE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Payments table (append-only ledger)
-- =============================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  amount NUMERIC NOT NULL,
  method public.payment_method NOT NULL DEFAULT 'bank_transfer',
  reference TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID NOT NULL,
  notes TEXT,
  proof_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No updated_at — append-only ledger, payments are never modified
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view payments"
  ON public.payments FOR SELECT TO authenticated
  USING (has_workspace_access((SELECT auth.uid()), workspace_id));

CREATE POLICY "Members can insert payments"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access((SELECT auth.uid()), workspace_id));

-- No UPDATE or DELETE — append-only ledger

-- =============================================
-- Gapless invoice numbering RPC (advisory lock)
-- =============================================
CREATE OR REPLACE FUNCTION public.next_invoice_number(_workspace_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _next BIGINT;
  _lock_key BIGINT;
BEGIN
  -- Deterministic lock key from workspace UUID
  _lock_key := ('x' || left(replace(_workspace_id::text, '-', ''), 15))::bit(64)::bigint;
  
  -- Advisory lock ensures serialized access per workspace
  PERFORM pg_advisory_xact_lock(_lock_key);
  
  -- Upsert sequence
  INSERT INTO public.invoice_sequences (workspace_id, last_number)
  VALUES (_workspace_id, 1)
  ON CONFLICT (workspace_id)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO _next;
  
  RETURN 'INV-' || lpad(_next::text, 6, '0');
END;
$$;

-- =============================================
-- Trigger: update invoice amount_paid & status on payment insert
-- =============================================
CREATE OR REPLACE FUNCTION public.update_invoice_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _total_paid NUMERIC;
  _grand_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO _total_paid
  FROM public.payments WHERE invoice_id = NEW.invoice_id;
  
  SELECT grand_total INTO _grand_total
  FROM public.invoices WHERE id = NEW.invoice_id;
  
  UPDATE public.invoices
  SET amount_paid = _total_paid,
      status = CASE
        WHEN _total_paid >= _grand_total THEN 'paid'::invoice_status
        WHEN _total_paid > 0 THEN 'partially_paid'::invoice_status
        ELSE status
      END
  WHERE id = NEW.invoice_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_invoice_on_payment
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_invoice_on_payment();

-- =============================================
-- Trigger: prevent modification of issued invoices (except void)
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IN ('issued', 'paid', 'partially_paid') THEN
    -- Allow status change to void or payment updates
    IF NEW.status = 'void' AND OLD.status != 'void' THEN
      RETURN NEW;
    END IF;
    -- Allow amount_paid and status updates (from payment trigger)
    IF NEW.amount_paid != OLD.amount_paid THEN
      RETURN NEW;
    END IF;
    -- Block other modifications
    IF NEW.subtotal != OLD.subtotal OR NEW.tax_total != OLD.tax_total 
       OR NEW.grand_total != OLD.grand_total OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.currency != OLD.currency THEN
      RAISE EXCEPTION 'Cannot modify an invoice with status: %', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_invoice_immutability
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_immutability();
