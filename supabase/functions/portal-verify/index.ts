import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "https://deno.land/x/jose@v5.2.2/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;
const SESSION_DAYS = 7;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60; // 604800
const COOKIE_NAME = "coreflow_portal_session";

const PORTAL_JWT_SECRET = Deno.env.get("PORTAL_JWT_SECRET")!;

// --------------- JWT secret ---------------

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(PORTAL_JWT_SECRET);
}

// --------------- Origin / CORS helpers ---------------

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  // Built-in patterns
  if (origin.endsWith(".lovable.app")) return origin;
  if (origin.endsWith(".lovableproject.com")) return origin;
  if (origin === "http://localhost:8080" || origin === "http://localhost:5173") return origin;
  // Production custom domain
  if (origin === "https://coreflow.gatekeepr.live") return origin;
  // Env-driven custom domains (comma-separated)
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
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
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

// --------------- Handler ---------------

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const hdrs = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: hdrs });
  }

  // --- DELETE: Server-side logout (clear httpOnly cookie) ---
  if (req.method === "DELETE") {
    return jsonResponse({ success: true }, 200, hdrs, {
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`,
    });
  }

  // --- GET: Peek branding for a token (no consumption) ---
  if (req.method === "GET") {
    // Enforce same origin restriction as POST
    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: "Forbidden" }, 403, hdrs);
    }

    const url = new URL(req.url);
    const peekToken = url.searchParams.get("peek_token");
    if (!peekToken || peekToken.length > 200) {
      return jsonResponse({ error: "peek_token required" }, 400, hdrs);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const ip = getClientIp(req);

    // Same rate-limit pool as POST redemption
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("portal_failed_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return jsonResponse({ error: "Too many attempts. Please try again later." }, 429, hdrs);
    }

    // Default branding response — returned for BOTH valid and invalid tokens
    // to prevent token-validity oracle attacks
    const defaultBranding = {
      workspace_name: "",
      accent_color: null,
      logo_url: null,
      support_email: null,
    };

    // Look up token → workspace, but do NOT consume
    const { data: tokenRow } = await supabase
      .from("portal_tokens")
      .select("workspace_id")
      .eq("token", peekToken)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!tokenRow) {
      // Record failed attempt in same pool — prevents brute-force via peek
      await supabase.from("portal_failed_attempts").insert({ ip_address: ip });
      // Return 200 with default branding (not 401) to avoid oracle
      return jsonResponse({ branding: defaultBranding }, 200, hdrs);
    }

    const { data: ws } = await supabase
      .from("workspaces")
      .select("name, portal_accent_color, portal_logo_storage_path, portal_support_email")
      .eq("id", tokenRow.workspace_id)
      .single();

    let logo_url: string | null = null;
    if (ws?.portal_logo_storage_path) {
      const { data: signedUrl } = await supabase.storage
        .from("workspace-files")
        .createSignedUrl(ws.portal_logo_storage_path, 3600);
      logo_url = signedUrl?.signedUrl || null;
    }

    return jsonResponse({
      branding: {
        workspace_name: ws?.name || "",
        accent_color: ws?.portal_accent_color || null,
        logo_url,
        support_email: ws?.portal_support_email || null,
      },
    }, 200, hdrs);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, hdrs);
  }

  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: "Forbidden" }, 403, hdrs);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== "string" || token.length > 200) {
      return jsonResponse({ error: "Token required" }, 400, hdrs);
    }

    const ip = getClientIp(req);

    // --- Brute-force rate limit ---
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("portal_failed_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return jsonResponse({ error: "Too many attempts. Please try again later." }, 429, hdrs);
    }

    // --- ATOMIC token consumption: validate + consume in a single UPDATE ---
    // This prevents race conditions where two concurrent requests could both
    // read consumed_at IS NULL and then both issue sessions.
    const { data: consumedTokens, error: consumeErr } = await supabase
      .from("portal_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("token", token)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id, workspace_id, company_id, contact_id, expires_at")

    if (consumeErr || !consumedTokens || consumedTokens.length === 0) {
      // Token not found, already consumed, revoked, or expired
      // Check if it exists at all to give a better error message
      const { data: existingToken } = await supabase
        .from("portal_tokens")
        .select("consumed_at, revoked_at, expires_at")
        .eq("token", token)
        .maybeSingle();

      await supabase.from("portal_failed_attempts").insert({ ip_address: ip });
      // Best-effort cleanup of old failed attempts
      await supabase
        .from("portal_failed_attempts")
        .delete()
        .lt("attempted_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

      if (existingToken?.consumed_at) {
        return jsonResponse({ error: "This token has already been consumed. Please request a new portal link." }, 401, hdrs);
      }
      if (existingToken?.revoked_at) {
        return jsonResponse({ error: "This access token has been revoked." }, 401, hdrs);
      }
      if (existingToken && new Date(existingToken.expires_at) < new Date()) {
        return jsonResponse({ error: "This access token has expired. Please request a new portal link." }, 401, hdrs);
      }

      return jsonResponse({ error: "Invalid or expired access token" }, 401, hdrs);
    }

    const tokenRecord = consumedTokens[0];

    // --- Fetch contact, company, and branding info ---
    const [{ data: contact }, { data: company }, { data: ws }] = await Promise.all([
      supabase.from("contacts").select("full_name, email").eq("id", tokenRecord.contact_id).single(),
      supabase.from("companies").select("legal_name").eq("id", tokenRecord.company_id).single(),
      supabase.from("workspaces").select("name, portal_accent_color, portal_logo_storage_path, portal_support_email").eq("id", tokenRecord.workspace_id).single(),
    ]);

    let branding_logo_url: string | null = null;
    if (ws?.portal_logo_storage_path) {
      const { data: signedUrl } = await supabase.storage
        .from("workspace-files")
        .createSignedUrl(ws.portal_logo_storage_path, 3600);
      branding_logo_url = signedUrl?.signedUrl || null;
    }

    // --- Sign JWT ---
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      workspace_id: tokenRecord.workspace_id,
      company_id: tokenRecord.company_id,
      contact_id: tokenRecord.contact_id,
      contact_name: contact?.full_name || "",
      contact_email: contact?.email || "",
      company_name: company?.legal_name || "",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + SESSION_SECONDS)
      .setSubject(tokenRecord.contact_id)
      .setIssuer("coreflow-portal")
      .sign(getJwtSecret());

    // --- Set cookie ---
    const cookieValue = `${COOKIE_NAME}=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_SECONDS}`;

    return jsonResponse(
      {
        success: true,
        portal_jwt: jwt,
        workspace_id: tokenRecord.workspace_id,
        company_id: tokenRecord.company_id,
        contact_id: tokenRecord.contact_id,
        contact_name: contact?.full_name || "",
        contact_email: contact?.email || "",
        company_name: company?.legal_name || "",
        branding: {
          workspace_name: ws?.name || "",
          accent_color: ws?.portal_accent_color || null,
          logo_url: branding_logo_url,
          support_email: ws?.portal_support_email || null,
        },
      },
      200,
      hdrs,
      { "Set-Cookie": cookieValue }
    );
  } catch (_err) {
    return jsonResponse({ error: "Internal error" }, 500, hdrs);
  }
});
