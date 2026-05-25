/**
 * Returns the input only if it is a safe http(s) URL.
 * Rejects javascript:, data:, vbscript:, relative URLs, and any non-string.
 * Use whenever rendering a user-controlled value into href={...}.
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
