import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Not authenticated" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid auth" }, 401);

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (!workspaceId) return json({ error: "Missing workspace_id" }, 400);

  // Admin check
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: membership } = await adminClient
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "admin") {
    return json({ error: "Admin access required" }, 403);
  }

  const listParam = url.searchParams.get("list");

  // --- List contacts with active portal tokens (no raw tokens exposed) ---
  if (listParam === "portal_contacts") {
    const { data: tokens } = await adminClient
      .from("portal_tokens")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (!tokens || tokens.length === 0) {
      return json({ contacts: [] });
    }

    // Deduplicate contact IDs
    const contactIds = [...new Set(tokens.map((t: any) => t.contact_id))];

    const { data: contacts } = await adminClient
      .from("contacts")
      .select("id, full_name, email")
      .in("id", contactIds);

    return json({
      contacts: (contacts || []).map((c: any) => ({
        contact_id: c.id,
        full_name: c.full_name,
        email: c.email,
      })),
    });
  }

  // --- Default: return config status (never expose secret values) ---
  const config = {
    RESEND_API_KEY: !!Deno.env.get("RESEND_API_KEY"),
    APP_BASE_URL: !!Deno.env.get("APP_BASE_URL"),
    SENDER_EMAIL: !!Deno.env.get("SENDER_EMAIL"),
    SENDER_NAME: !!Deno.env.get("SENDER_NAME"),
  };

  return json({ config });
});
