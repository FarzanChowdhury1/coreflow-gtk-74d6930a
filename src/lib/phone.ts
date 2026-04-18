/**
 * Phone helpers powered by libphonenumber-js.
 * Replaces the legacy 10-country hard-coded selector + silent +880 fallback.
 *
 * Storage format: E.164 string (e.g. "+8801712345678").
 * Multi-phone storage: contacts.phones = [{ label, number }, ...].
 */
import {
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneLabel = "primary" | "alternate" | "whatsapp" | "office" | "other";

export interface ContactPhone {
  label: PhoneLabel;
  number: string; // E.164
}

export const PHONE_LABEL_OPTIONS: { value: PhoneLabel; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "alternate", label: "Alternate" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other" },
];

export const DEFAULT_COUNTRY: CountryCode = "BD";

/** Convert ISO country code (e.g. "BD") to flag emoji. */
export function countryToFlag(country: string): string {
  if (!country || country.length !== 2) return "🏳️";
  const codePoints = country
    .toUpperCase()
    .split("")
    .map((c) => 0x1f1e6 - 65 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export interface CountryOption {
  code: CountryCode;
  name: string;
  callingCode: string; // "+880"
  flag: string;
}

let _countriesCache: CountryOption[] | null = null;

/** Returns full sorted country list with flag + calling code. */
export function getCountryList(): CountryOption[] {
  if (_countriesCache) return _countriesCache;
  // Display names (English). Fallback to ISO if Intl missing.
  const dn =
    typeof Intl !== "undefined" && (Intl as any).DisplayNames
      ? new (Intl as any).DisplayNames(["en"], { type: "region" })
      : null;
  const list: CountryOption[] = getCountries().map((c) => ({
    code: c,
    name: dn ? dn.of(c) || c : c,
    callingCode: `+${getCountryCallingCode(c)}`,
    flag: countryToFlag(c),
  }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  _countriesCache = list;
  return list;
}

/**
 * Parse a stored E.164 (or raw) value into { country, national }.
 * If parse fails, returns nulls — does NOT silently rewrite to +880.
 */
export function parseE164(value: string | null | undefined): {
  country: CountryCode | null;
  national: string;
  e164: string;
} {
  if (!value) return { country: null, national: "", e164: "" };
  const trimmed = value.trim();
  // Try strict parse first
  const parsed = parsePhoneNumberFromString(trimmed);
  if (parsed) {
    return {
      country: parsed.country ?? null,
      national: parsed.nationalNumber.toString(),
      e164: parsed.number,
    };
  }
  // Could not parse — preserve raw value, no fallback country.
  return { country: null, national: trimmed.replace(/^\+/, ""), e164: trimmed.startsWith("+") ? trimmed : "" };
}

/**
 * Build E.164 from a country + national-number input.
 * Returns "" if empty input. Returns the user's raw "+..." string if it
 * already looks international and no country is selected.
 */
export function buildE164(country: CountryCode | null, national: string): string {
  const cleaned = (national || "").replace(/[^\d]/g, "");
  if (!cleaned) return "";
  if (country) {
    const candidate = `+${getCountryCallingCode(country)}${cleaned}`;
    const parsed = parsePhoneNumberFromString(candidate);
    return parsed ? parsed.number : candidate;
  }
  // No country chosen — accept as bare international if user typed +
  return cleaned ? `+${cleaned}` : "";
}

/** Validate using libphonenumber. Empty string is valid (optional fields). */
export function isValidPhone(value: string | null | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  try {
    return isValidPhoneNumber(v);
  } catch {
    return false;
  }
}

/** Format for display (international, e.g. "+880 1712-345678"). */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = parsePhoneNumberFromString(value.trim());
  return parsed ? parsed.formatInternational() : value;
}

/** Coerce raw DB jsonb value into a typed ContactPhone[]. Tolerant of bad data. */
export function normalizePhones(raw: unknown): ContactPhone[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      if (!entry || typeof entry !== "object") return null;
      const number = typeof entry.number === "string" ? entry.number.trim() : "";
      if (!number) return null;
      const label =
        typeof entry.label === "string" && PHONE_LABEL_OPTIONS.some((o) => o.value === entry.label)
          ? (entry.label as PhoneLabel)
          : "other";
      return { label, number };
    })
    .filter((x): x is ContactPhone => !!x);
}

export function labelDisplay(label: PhoneLabel): string {
  return PHONE_LABEL_OPTIONS.find((o) => o.value === label)?.label ?? "Other";
}
