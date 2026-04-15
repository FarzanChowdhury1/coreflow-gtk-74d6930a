import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Rate-limit config: shared with portal-verify for defense-in-depth
const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

// Allowlisted URL prefixes for safe redirect targets
const ALLOWED_PREFIXES = [
  "/portal",
  "/dashboard",
  "/invoices",
  "/proposals",
  "/projects",
];

function isSafeRedirect(url: string, supabaseUrl: string): boolean {
  if (url.startsWith("/")) {
    return ALLOWED_PREFIXES.some((p) => url.startsWith(p));
  }
  try {
    const parsed = new URL(url);
    const supaHost = new URL(supabaseUrl).hostname;
    if (parsed.hostname === supaHost) return true;
    if (parsed.hostname.endsWith(".lovable.app")) return true;
    return false;
  } catch {
    return false;
  }
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    let code = url.searchParams.get("code");

    if (!code && req.method === "POST") {
      try {
        const body = await req.json();
        code = body.code || null;
      } catch { /* ignore */ }
    }

    if (!code || code.length < 6) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid short code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip = getClientIp(req);

    // --- IP-based rate limiting (shared pool with portal-verify) ---
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("portal_failed_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: link, error } = await supabase
      .from("short_links")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !link) {
      // Record failed attempt
      await supabase.from("portal_failed_attempts").insert({ ip_address: ip });
      return new Response(
        JSON.stringify({ error: "Short link not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(link.expires_at) < new Date()) {
      // Record failed attempt for expired links too (prevents enumeration)
      await supabase.from("portal_failed_attempts").insert({ ip_address: ip });
      return new Response(
        JSON.stringify({ error: "Short link has expired" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isSafeRedirect(link.target_url, supabaseUrl)) {
      return new Response(
        JSON.stringify({ error: "Redirect target not allowed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Increment click count (fire-and-forget)
    supabase
      .from("short_links")
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq("id", link.id)
      .then(() => {});

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: link.target_url,
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (err) {
    console.error("Short link resolver error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
