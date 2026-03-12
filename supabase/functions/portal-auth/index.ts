import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;
const SESSION_HOURS = 2;

// --------------- Origin / CORS helpers ---------------

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.endsWith(".lovable.app")) return origin;
  if (origin.endsWith(".lovableproject.com")) return origin;
  if (origin === "http://localhost:8080" || origin === "http://localhost:5173") return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed || "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", ...extraHeaders },
  });
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
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

// --------------- Handler ---------------

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const hdrs = corsHeaders(origin);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: hdrs });
  }

  // Only POST (verify) and DELETE (logout)
  if (req.method !== "POST" && req.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405, hdrs);
  }

  // Server-side origin validation on mutations
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: "Forbidden" }, 403, hdrs);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ---- DELETE: Logout ----
    if (req.method === "DELETE") {
      const cookies = parseCookies(req.headers.get("Cookie"));
      const sessionToken = cookies["portal_session"];
      if (sessionToken) {
        await supabase.from("portal_sessions").delete().eq("session_token", sessionToken);
      }
      return jsonResponse({ success: true }, 200, hdrs, {
        "Set-Cookie": "portal_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0",
      });
    }

    // ---- POST: Verify token and establish session ----
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== "string" || token.length > 200) {
      return jsonResponse({ error: "Token required" }, 400, hdrs);
    }

    const ip = getClientIp(req);

    // Check brute-force rate limit
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("portal_failed_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return jsonResponse({ error: "Too many attempts. Please try again later." }, 429, hdrs);
    }

    // Validate the portal token
    const { data: tokenRecord } = await supabase
      .from("portal_tokens")
      .select("workspace_id, company_id, contact_id, expires_at, revoked_at")
      .eq("token", token)
      .single();

    if (
      !tokenRecord ||
      tokenRecord.revoked_at ||
      new Date(tokenRecord.expires_at) < new Date()
    ) {
      // Record failure
      await supabase.from("portal_failed_attempts").insert({ ip_address: ip });
      // Cleanup old entries (> 1 hour)
      await supabase
        .from("portal_failed_attempts")
        .delete()
        .lt("attempted_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

      return jsonResponse({ error: "Invalid or expired access token" }, 401, hdrs);
    }

    // Fetch contact and company info
    const [{ data: contact }, { data: company }] = await Promise.all([
      supabase.from("contacts").select("full_name, email").eq("id", tokenRecord.contact_id).single(),
      supabase.from("companies").select("legal_name").eq("id", tokenRecord.company_id).single(),
    ]);

    // Create server-side session
    const { data: session, error: sessionErr } = await supabase
      .from("portal_sessions")
      .insert({
        workspace_id: tokenRecord.workspace_id,
        company_id: tokenRecord.company_id,
        contact_id: tokenRecord.contact_id,
      })
      .select("session_token, expires_at")
      .single();

    if (sessionErr || !session) {
      return jsonResponse({ error: "Session creation failed" }, 500, hdrs);
    }

    // Compute cookie Max-Age
    const maxAge = Math.max(
      0,
      Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000)
    );
    const cookieValue = `portal_session=${session.session_token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;

    return jsonResponse(
      {
        success: true,
        workspace_id: tokenRecord.workspace_id,
        company_id: tokenRecord.company_id,
        contact_id: tokenRecord.contact_id,
        contact_name: contact?.full_name || "",
        contact_email: contact?.email || "",
        company_name: company?.legal_name || "",
      },
      200,
      hdrs,
      { "Set-Cookie": cookieValue }
    );
  } catch (_err) {
    return jsonResponse({ error: "Internal error" }, 500, hdrs);
  }
});
