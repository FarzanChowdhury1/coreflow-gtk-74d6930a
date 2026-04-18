// Social handles: shared model + helpers for companies and contacts.
// Storage shape (JSONB column `socials` on companies/contacts):
//   Array<{ platform: SocialPlatform; value: string }>
// `value` is either a username/handle or a URL — whichever the user entered.

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "youtube"
  | "tiktok"
  | "whatsapp"
  | "website";

export interface SocialEntry {
  platform: SocialPlatform;
  value: string;
}

export const SOCIAL_PLATFORMS: { value: SocialPlatform; label: string; placeholder: string }[] = [
  { value: "facebook", label: "Facebook", placeholder: "facebook.com/page or @handle" },
  { value: "instagram", label: "Instagram", placeholder: "@handle or instagram.com/..." },
  { value: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/company/..." },
  { value: "twitter", label: "X / Twitter", placeholder: "@handle or x.com/..." },
  { value: "youtube", label: "YouTube", placeholder: "youtube.com/@channel" },
  { value: "tiktok", label: "TikTok", placeholder: "@handle or tiktok.com/@..." },
  { value: "whatsapp", label: "WhatsApp", placeholder: "wa.me/8801... or +8801..." },
  { value: "website", label: "Website", placeholder: "https://example.com" },
];

const PLATFORM_VALUES = new Set<SocialPlatform>(SOCIAL_PLATFORMS.map((p) => p.value));

export function platformLabel(p: string): string {
  return SOCIAL_PLATFORMS.find((s) => s.value === p)?.label ?? p;
}

/** Coerce arbitrary JSON into a clean SocialEntry[] — drops anything malformed. */
export function normalizeSocials(raw: unknown): SocialEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SocialEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const plat = (item as any).platform;
    const val = (item as any).value;
    if (typeof plat !== "string" || typeof val !== "string") continue;
    if (!PLATFORM_VALUES.has(plat as SocialPlatform)) continue;
    const trimmed = val.trim();
    if (!trimmed) continue;
    out.push({ platform: plat as SocialPlatform, value: trimmed });
  }
  return out.slice(0, 15);
}

/** Strip empties, normalize whitespace; returns the cleaned list ready to save. */
export function cleanSocialsForSave(entries: SocialEntry[]): SocialEntry[] {
  const out: SocialEntry[] = [];
  for (const e of entries) {
    if (!e || !PLATFORM_VALUES.has(e.platform)) continue;
    const v = (e.value || "").trim();
    if (!v) continue;
    if (v.length > 500) continue;
    out.push({ platform: e.platform, value: v });
  }
  return out.slice(0, 15);
}

/** Resolve a social entry to an absolute URL when possible; returns null if not URL-able. */
export function socialToHref(entry: SocialEntry): string | null {
  const v = entry.value.trim();
  if (!v) return null;
  // If user already gave a URL, respect it.
  if (/^https?:\/\//i.test(v)) return v;

  switch (entry.platform) {
    case "facebook":
      return v.startsWith("@") ? `https://facebook.com/${v.slice(1)}` : `https://${stripDomain(v, "facebook.com")}`;
    case "instagram":
      return v.startsWith("@") ? `https://instagram.com/${v.slice(1)}` : `https://${stripDomain(v, "instagram.com")}`;
    case "linkedin":
      return `https://${stripDomain(v, "linkedin.com")}`;
    case "twitter":
      return v.startsWith("@") ? `https://x.com/${v.slice(1)}` : `https://${stripDomain(v, "x.com")}`;
    case "youtube":
      return v.startsWith("@") ? `https://youtube.com/${v}` : `https://${stripDomain(v, "youtube.com")}`;
    case "tiktok":
      return v.startsWith("@") ? `https://tiktok.com/${v}` : `https://${stripDomain(v, "tiktok.com")}`;
    case "whatsapp": {
      const digits = v.replace(/[^\d]/g, "");
      return digits ? `https://wa.me/${digits}` : null;
    }
    case "website":
      return `https://${v.replace(/^\/+/, "")}`;
    default:
      return null;
  }
}

function stripDomain(v: string, domain: string): string {
  const cleaned = v.replace(/^\/+/, "");
  return cleaned.toLowerCase().includes(domain) ? cleaned : `${domain}/${cleaned}`;
}

/** Validation: returns null if entry is acceptable, or a human-readable error. */
export function validateSocialEntry(entry: SocialEntry): string | null {
  if (!PLATFORM_VALUES.has(entry.platform)) return "Unsupported platform";
  const v = (entry.value || "").trim();
  if (!v) return "Value is required";
  if (v.length > 500) return "Value too long";
  if (entry.platform === "website") {
    // Be lenient: accept bare domain or full URL.
    const looksLikeDomain = /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(v);
    const looksLikeUrl = /^https?:\/\//i.test(v);
    if (!looksLikeDomain && !looksLikeUrl) return "Enter a valid website (e.g. example.com)";
  }
  return null;
}

/** Compact text representation for CSV/XLSX export. */
export function socialsToExportString(entries: SocialEntry[]): string {
  return entries.map((e) => `${e.platform}:${e.value}`).join(" | ");
}
