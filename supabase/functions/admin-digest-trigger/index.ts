import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const COOLDOWN_MINUTES = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Admin-triggered digest for a SINGLE workspace.
 *
 * Key safety properties:
 *  - NO global sweep RPCs (those are cross-workspace and reserved for scheduled worker)
 *  - Reads digest data via aggregate_daily_digest, filtered to the target workspace
 *  - Writes (notifications) only to the target workspace
 *  - 5-minute cooldown between "run" executions per workspace
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Invalid session" }, 401);
    }

    // --- Parse request ---
    const body = await req.json().catch(() => ({}));
    const workspaceId = body.workspace_id;
    const mode: "run" | "preview" = body.mode === "preview" ? "preview" : "run";

    if (!workspaceId || typeof workspaceId !== "string") {
      return json({ error: "workspace_id required" }, 400);
    }

    // --- Admin check (service client, bypasses auth.uid() guard) ---
    const sc = createClient(supabaseUrl, serviceKey);
    const { data: membership } = await sc
      .from("workspace_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!membership || membership.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    // --- Cooldown check (run mode only) ---
    let lastRunAt: string | null = null;
    if (mode === "run") {
      const { data: recent } = await sc
        .from("notifications")
        .select("created_at")
        .eq("workspace_id", workspaceId)
        .eq("title", "Daily Digest")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent?.created_at) {
        lastRunAt = recent.created_at;
        const elapsed = Date.now() - new Date(recent.created_at).getTime();
        if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
          return json({
            success: false,
            error: "cooldown",
            message: `Please wait ${COOLDOWN_MINUTES} minutes between digest runs.`,
            last_run_at: recent.created_at,
            cooldown_remaining_seconds: Math.ceil(
              (COOLDOWN_MINUTES * 60 * 1000 - elapsed) / 1000
            ),
          });
        }
      }
    }

    // --- Aggregate digest (read-only, all workspaces) then filter ---
    // NOTE: We intentionally do NOT call sweep_overdue_invoices / sweep_lead_followups /
    // sweep_renewal_reminders here. Those are global cross-workspace RPCs and must only
    // run from the scheduled worker. The aggregate RPC reads existing data only.
    const { data: allDigest, error: digestErr } = await sc.rpc(
      "aggregate_daily_digest"
    );
    if (digestErr) throw digestErr;

    const workspaces = Array.isArray(allDigest) ? allDigest : [];
    const wsDigest =
      workspaces.find((ws: any) => ws.workspace_id === workspaceId) || null;

    const overdueInvoices = Array.isArray(wsDigest?.overdue_invoices)
      ? wsDigest.overdue_invoices
      : [];
    const overdueFollowups = Array.isArray(wsDigest?.overdue_followups)
      ? wsDigest.overdue_followups
      : [];
    const upcomingRenewals = Array.isArray(wsDigest?.upcoming_renewals)
      ? wsDigest.upcoming_renewals
      : [];

    // --- Run mode: create workspace-scoped notifications only ---
    if (mode === "run") {
      const summary = [
        overdueInvoices.length > 0
          ? `${overdueInvoices.length} overdue invoice(s)`
          : null,
        overdueFollowups.length > 0
          ? `${overdueFollowups.length} lead follow-up(s) due`
          : null,
        upcomingRenewals.length > 0
          ? `${upcomingRenewals.length} renewal(s) approaching`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      const body = summary || "No actionable items found.";

      // Only notify admins in THIS workspace
      const { data: admins } = await sc
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "admin");

      if (admins && admins.length > 0) {
        await sc.from("notifications").insert(
          admins.map((a: { user_id: string }) => ({
            workspace_id: workspaceId,
            user_id: a.user_id,
            title: "Daily Digest",
            body,
            link: "/dashboard",
          }))
        );
      }
    }

    // --- Response ---
    const executedAt = new Date().toISOString();
    return json({
      success: true,
      mode,
      workspace_id: workspaceId,
      executed_at: executedAt,
      last_run_at: mode === "run" ? executedAt : lastRunAt,
      digest: {
        overdue_invoices: overdueInvoices.length,
        overdue_followups: overdueFollowups.length,
        upcoming_renewals: upcomingRenewals.length,
        details: wsDigest,
      },
    });
  } catch (err) {
    return json({ error: "Internal server error", message: String(err) }, 500);
  }
});
