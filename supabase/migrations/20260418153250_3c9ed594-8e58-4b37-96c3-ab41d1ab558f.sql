-- Phone foundation rewrite: add structured multi-phone support to contacts.
-- Strategy: keep legacy phone/alt_phone columns (do NOT drop) for safety/back-compat.
-- Introduce contacts.phones JSONB array of { label, number } objects (number is E.164).
-- Backfill from existing phone + alt_phone. Keep legacy columns synced from phones[0]/[1] via trigger.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill phones from existing phone + alt_phone (idempotent: only when phones is empty)
UPDATE public.contacts
SET phones = (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('label', 'primary', 'number', phone) AS entry
    WHERE phone IS NOT NULL AND length(trim(phone)) > 0
    UNION ALL
    SELECT jsonb_build_object('label', 'alternate', 'number', alt_phone) AS entry
    WHERE alt_phone IS NOT NULL AND length(trim(alt_phone)) > 0
  ) sub
)
WHERE phones = '[]'::jsonb
  AND ((phone IS NOT NULL AND length(trim(phone)) > 0) OR (alt_phone IS NOT NULL AND length(trim(alt_phone)) > 0));

-- Trigger: keep legacy phone/alt_phone in sync with phones[] so any code still
-- reading the legacy columns continues to work without behavior change.
CREATE OR REPLACE FUNCTION public.sync_contact_legacy_phones()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.phones IS NOT NULL AND jsonb_typeof(NEW.phones) = 'array' AND jsonb_array_length(NEW.phones) > 0 THEN
    NEW.phone := NULLIF(NEW.phones->0->>'number', '');
    IF jsonb_array_length(NEW.phones) > 1 THEN
      NEW.alt_phone := NULLIF(NEW.phones->1->>'number', '');
    ELSE
      NEW.alt_phone := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_legacy_phones_trg ON public.contacts;
CREATE TRIGGER sync_contact_legacy_phones_trg
BEFORE INSERT OR UPDATE OF phones ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.sync_contact_legacy_phones();