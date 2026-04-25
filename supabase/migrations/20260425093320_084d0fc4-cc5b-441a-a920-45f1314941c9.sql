
-- ============================================================
-- A. Storage bucket for payment proofs (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: only workspace admins can read/list/delete; service role does inserts via signed URLs.
DROP POLICY IF EXISTS "Admins can read payment proofs" ON storage.objects;
CREATE POLICY "Admins can read payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND public.has_workspace_role(
    auth.uid(),
    ((storage.foldername(name))[1])::uuid,
    'admin'::app_role
  )
);

DROP POLICY IF EXISTS "Admins can delete payment proofs" ON storage.objects;
CREATE POLICY "Admins can delete payment proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND public.has_workspace_role(
    auth.uid(),
    ((storage.foldername(name))[1])::uuid,
    'admin'::app_role
  )
);

-- ============================================================
-- B. payment_proof_submissions table
-- ============================================================
DO $$ BEGIN
  CREATE TYPE payment_proof_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payment_proof_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  invoice_id      uuid NOT NULL,
  submitted_by_name  text,
  submitted_by_email text,
  declared_amount    numeric NOT NULL CHECK (declared_amount >= 0),
  declared_method    text NOT NULL,
  declared_reference text,
  notes              text,
  file_path          text NOT NULL,
  original_filename  text,
  mime_type          text,
  size_bytes         bigint,
  status             payment_proof_status NOT NULL DEFAULT 'pending',
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  rejection_reason   text,
  payment_id         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pps_workspace_status
  ON public.payment_proof_submissions (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pps_invoice
  ON public.payment_proof_submissions (invoice_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS set_pps_updated_at ON public.payment_proof_submissions;
CREATE TRIGGER set_pps_updated_at
BEFORE UPDATE ON public.payment_proof_submissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- audit trigger
DROP TRIGGER IF EXISTS trg_audit_pps ON public.payment_proof_submissions;
CREATE TRIGGER trg_audit_pps
AFTER INSERT OR UPDATE OR DELETE ON public.payment_proof_submissions
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

ALTER TABLE public.payment_proof_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read proof submissions" ON public.payment_proof_submissions;
CREATE POLICY "Admins read proof submissions"
ON public.payment_proof_submissions FOR SELECT
TO authenticated
USING (public.has_workspace_role(auth.uid(), workspace_id, 'admin'::app_role));

-- No direct INSERT/UPDATE/DELETE policies — all writes go through service-role
-- functions (portal-data edge function + accept/reject RPCs running under
-- service role from admin server-side flows). RLS-default-deny holds.

-- ============================================================
-- C. Invoice recompute on payment INSERT / UPDATE / DELETE
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_invoice_paid(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total_paid  numeric;
  _grand_total numeric;
  _cur_status  invoice_status;
  _new_status  invoice_status;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO _total_paid
  FROM public.payments WHERE invoice_id = _invoice_id;

  SELECT grand_total, status INTO _grand_total, _cur_status
  FROM public.invoices WHERE id = _invoice_id;

  IF _cur_status = 'void' OR _cur_status = 'draft' THEN
    -- Don't auto-flip void/draft invoices via payment changes
    UPDATE public.invoices
       SET amount_paid = _total_paid
     WHERE id = _invoice_id;
    RETURN;
  END IF;

  _new_status := CASE
    WHEN _total_paid >= _grand_total AND _grand_total > 0 THEN 'paid'::invoice_status
    WHEN _total_paid > 0 THEN 'partially_paid'::invoice_status
    ELSE 'issued'::invoice_status
  END;

  UPDATE public.invoices
     SET amount_paid = _total_paid,
         status      = _new_status
   WHERE id = _invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_invoice_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_paid(OLD.invoice_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.recompute_invoice_paid(NEW.invoice_id);
    IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
      PERFORM public.recompute_invoice_paid(OLD.invoice_id);
    END IF;
    RETURN NEW;
  ELSE
    PERFORM public.recompute_invoice_paid(NEW.invoice_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_invoice_on_payment ON public.payments;
CREATE TRIGGER trg_update_invoice_on_payment
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.update_invoice_on_payment();

-- ============================================================
-- D. Accept / reject RPCs (atomic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_payment_proof(
  _submission_id uuid,
  _paid_at       timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub      public.payment_proof_submissions;
  _actor    uuid := auth.uid();
  _payment_id uuid;
  _method   payment_method;
  _proof_url text;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _sub FROM public.payment_proof_submissions
   WHERE id = _submission_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF NOT public.has_workspace_role(_actor, _sub.workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _sub.status <> 'pending' THEN
    RAISE EXCEPTION 'Submission already %', _sub.status;
  END IF;

  -- Map declared_method to enum; default to 'other' if unknown
  BEGIN
    _method := _sub.declared_method::payment_method;
  EXCEPTION WHEN others THEN
    _method := 'other'::payment_method;
  END;

  _proof_url := 'payment-proofs/' || _sub.file_path;

  INSERT INTO public.payments (
    workspace_id, invoice_id, amount, method, reference,
    paid_at, recorded_by, notes, proof_url
  ) VALUES (
    _sub.workspace_id, _sub.invoice_id, _sub.declared_amount, _method,
    _sub.declared_reference, _paid_at, _actor,
    COALESCE(_sub.notes, '') ||
      CASE WHEN _sub.submitted_by_name IS NOT NULL
           THEN E'\n[Proof from: ' || _sub.submitted_by_name ||
                COALESCE(' <' || _sub.submitted_by_email || '>', '') || ']'
           ELSE '' END,
    _proof_url
  ) RETURNING id INTO _payment_id;

  UPDATE public.payment_proof_submissions
     SET status = 'accepted',
         reviewed_by = _actor,
         reviewed_at = now(),
         payment_id  = _payment_id
   WHERE id = _submission_id;

  RETURN _payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_proof(
  _submission_id uuid,
  _reason        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub   public.payment_proof_submissions;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _sub FROM public.payment_proof_submissions
   WHERE id = _submission_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found'; END IF;

  IF NOT public.has_workspace_role(_actor, _sub.workspace_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _sub.status <> 'pending' THEN
    RAISE EXCEPTION 'Submission already %', _sub.status;
  END IF;

  UPDATE public.payment_proof_submissions
     SET status = 'rejected',
         reviewed_by = _actor,
         reviewed_at = now(),
         rejection_reason = _reason
   WHERE id = _submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_payment_proof(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_proof(uuid, text) TO authenticated;
