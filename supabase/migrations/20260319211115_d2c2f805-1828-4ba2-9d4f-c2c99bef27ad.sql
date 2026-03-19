
-- Make BIN optional on companies
ALTER TABLE public.companies ALTER COLUMN bin DROP NOT NULL;
ALTER TABLE public.companies ALTER COLUMN bin SET DEFAULT '';

-- Update the trigger function to allow NULL/empty BIN
CREATE OR REPLACE FUNCTION public.validate_company_bin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow NULL or empty BIN (optional field)
  IF NEW.bin IS NOT NULL AND NEW.bin != '' THEN
    IF NEW.bin !~ '^[0-9A-Za-z]{13}$' THEN
      RAISE EXCEPTION 'BIN must be exactly 13 alphanumeric characters, got: %', NEW.bin;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Add phone column to companies for company contact number
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone text;

-- Add alt_phone column to contacts for multiple phone numbers
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS alt_phone text;

-- Update the contact phone validation trigger to also validate alt_phone
CREATE OR REPLACE FUNCTION public.validate_contact_phone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone != '' THEN
    IF NEW.phone !~ '^\+[1-9]\d{4,13}$' THEN
      RAISE EXCEPTION 'Phone must be in E.164 international format (e.g. +8801712345678)';
    END IF;
  END IF;
  IF NEW.alt_phone IS NOT NULL AND NEW.alt_phone != '' THEN
    IF NEW.alt_phone !~ '^\+[1-9]\d{4,13}$' THEN
      RAISE EXCEPTION 'Alternate phone must be in E.164 international format (e.g. +8801712345678)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
