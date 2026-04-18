-- Add structured social handles to companies and contacts.
-- Shape: jsonb array of { platform: text, value: text }
-- platform whitelist enforced at trigger level (cannot use CHECK with array funcs cleanly).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Validation trigger: ensures socials is a JSON array, max 15 entries,
-- each entry has a known platform and a non-empty value <= 500 chars.
CREATE OR REPLACE FUNCTION public.validate_socials_jsonb()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s jsonb;
  item jsonb;
  allowed text[] := ARRAY['facebook','instagram','linkedin','twitter','youtube','tiktok','whatsapp','website'];
  plat text;
  val text;
BEGIN
  s := COALESCE(NEW.socials, '[]'::jsonb);

  IF jsonb_typeof(s) <> 'array' THEN
    RAISE EXCEPTION 'socials must be a JSON array';
  END IF;

  IF jsonb_array_length(s) > 15 THEN
    RAISE EXCEPTION 'socials cannot exceed 15 entries';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(s)
  LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'each social entry must be a JSON object';
    END IF;
    plat := item->>'platform';
    val := item->>'value';
    IF plat IS NULL OR NOT (plat = ANY(allowed)) THEN
      RAISE EXCEPTION 'invalid social platform: %', plat;
    END IF;
    IF val IS NULL OR length(btrim(val)) = 0 THEN
      RAISE EXCEPTION 'social value cannot be empty';
    END IF;
    IF length(val) > 500 THEN
      RAISE EXCEPTION 'social value too long (max 500 chars)';
    END IF;
  END LOOP;

  NEW.socials := s;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_companies_socials_trg ON public.companies;
CREATE TRIGGER validate_companies_socials_trg
  BEFORE INSERT OR UPDATE OF socials ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_socials_jsonb();

DROP TRIGGER IF EXISTS validate_contacts_socials_trg ON public.contacts;
CREATE TRIGGER validate_contacts_socials_trg
  BEFORE INSERT OR UPDATE OF socials ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_socials_jsonb();