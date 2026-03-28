import { jwtVerify } from "https://deno.land/x/jose@v5.2.2/index.ts";

const PORTAL_JWT_SECRET = Deno.env.get("PORTAL_JWT_SECRET")!;
const COOKIE_NAME = "coreflow_portal_session";

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(PORTAL_JWT_SECRET);
}

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.endsWith(".lovable.app")) return origin;
  if (origin.endsWith(".lovableproject.com")) return origin;
  if (origin === "http://localhost:8080" || origin === "http://localhost:5173") return origin;
  const extra = Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "";
  if (extra) {
    const origins = extra.split(",").map((s) => s.trim()).filter(Boolean);
    for (const allowed of origins) {
      if (origin === allowed || origin === `https://${allowed}` || origin === `http://${allowed}`) return origin;
    }
  }
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed || "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}

/**
 * Extract JWT from cookie or Authorization header (fallback for cross-site cookie blocking).
 */
function extractToken(req: Request): string | null {
  // Try cookie first
  const cookies = parseCookies(req.headers.get("Cookie"));
  const cookieToken = cookies[COOKIE_NAME];
  if (cookieToken) return cookieToken;

  // Fallback: Authorization Bearer header
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const hdrs = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: hdrs });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, hdrs);
  }

  const token = extractToken(req);

  if (!token) {
    return jsonResponse({ error: "Not authenticated" }, 401, hdrs);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "coreflow-portal",
    });

    return jsonResponse(
      {
        workspace_id: payload.workspace_id,
        company_id: payload.company_id,
        contact_id: payload.contact_id,
        contact_name: payload.contact_name,
        contact_email: payload.contact_email,
        company_name: payload.company_name,
      },
      200,
      hdrs
    );
  } catch (_err) {
    return jsonResponse({ error: "Session expired or invalid" }, 401, hdrs);
  }
});
