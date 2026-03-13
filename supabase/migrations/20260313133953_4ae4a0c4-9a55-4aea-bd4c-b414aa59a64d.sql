
CREATE OR REPLACE FUNCTION public.enforce_version_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IN ('sent', 'approved', 'rejected') THEN
    -- Allow voiding from any locked status
    IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
      NEW.subtotal := OLD.subtotal;
      NEW.tax_config := OLD.tax_config;
      NEW.tax_total := OLD.tax_total;
      NEW.grand_total := OLD.grand_total;
      NEW.currency := OLD.currency;
      NEW.notes := OLD.notes;
      NEW.version_number := OLD.version_number;
      RETURN NEW;
    END IF;

    -- Allow sent -> approved or sent -> rejected (portal/approval response)
    IF OLD.status = 'sent' AND NEW.status IN ('approved', 'rejected') THEN
      NEW.subtotal := OLD.subtotal;
      NEW.tax_config := OLD.tax_config;
      NEW.tax_total := OLD.tax_total;
      NEW.grand_total := OLD.grand_total;
      NEW.currency := OLD.currency;
      NEW.notes := OLD.notes;
      NEW.version_number := OLD.version_number;
      NEW.valid_until := OLD.valid_until;
      NEW.sent_at := OLD.sent_at;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Cannot modify a proposal version with status: %', OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;
