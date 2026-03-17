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
 * Safety:
 *  - NO global sweep RPCs (reserved for scheduled worker)
 *  - Reads via aggregate_daily_digest, filtered to target workspace
 *  - Writes only to target workspace (notifications + digest_runs log)
 *  - 5-minute cooldown between "run" executions per workspace (checked via digest_runs)
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

    // --- Admin check ---
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

    // --- Cooldown check via digest_runs (run mode only) ---
    if (mode === "run") {
      const { data: lastRun } = await sc
        .from("digest_runs")
        .select("executed_at")
        .eq("workspace_id", workspaceId)
        .eq("mode", "run")
        .eq("status", "success")
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastRun?.executed_at) {
        const elapsed = Date.now() - new Date(lastRun.executed_at).getTime();
        if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
          // Log the rejection
          await sc.from("digest_runs").insert({
            workspace_id: workspaceId,
            triggered_by: user.id,
            mode: "run",
            status: "cooldown_rejected",
            error_message: `Cooldown active — ${Math.ceil((COOLDOWN_MINUTES * 60 * 1000 - elapsed) / 1000)}s remaining`,
          });

          return json({
            success: false,
            error: "cooldown",
            message: `Please wait ${COOLDOWN_MINUTES} minutes between digest runs.`,
            last_run_at: lastRun.executed_at,
            cooldown_remaining_seconds: Math.ceil(
              (COOLDOWN_MINUTES * 60 * 1000 - elapsed) / 1000
            ),
          });
        }
      }
    }

    // --- Aggregate digest (read-only) then filter to workspace ---
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

    const counts = {
      overdue_invoices: overdueInvoices.length,
      overdue_followups: overdueFollowups.length,
      upcoming_renewals: upcomingRenewals.length,
    };

    // --- Run mode: create workspace-scoped notifications ---
    if (mode === "run") {
      const summary = [
        counts.overdue_invoices > 0
          ? `${counts.overdue_invoices} overdue invoice(s)`
          : null,
        counts.overdue_followups > 0
          ? `${counts.overdue_followups} lead follow-up(s) due`
          : null,
        counts.upcoming_renewals > 0
          ? `${counts.upcoming_renewals} renewal(s) approaching`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      const notifBody = summary || "No actionable items found.";

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
            body: notifBody,
            link: "/dashboard",
          }))
        );
      }
    }

    // --- Log the run ---
    const executedAt = new Date().toISOString();
    await sc.from("digest_runs").insert({
      workspace_id: workspaceId,
      triggered_by: user.id,
      mode,
      status: "success",
      overdue_invoices_count: counts.overdue_invoices,
      overdue_followups_count: counts.overdue_followups,
      upcoming_renewals_count: counts.upcoming_renewals,
      executed_at: executedAt,
    });

    return json({
      success: true,
      mode,
      workspace_id: workspaceId,
      executed_at: executedAt,
      digest: {
        ...counts,
        details: wsDigest,
      },
    });
  } catch (err) {
    return json({ error: "Internal server error", message: String(err) }, 500);
  }
});
