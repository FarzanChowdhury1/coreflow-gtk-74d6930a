import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Admin-triggered digest execution for a single workspace.
 * Reuses existing sweep RPCs + aggregate_daily_digest.
 * Auth: standard JWT (admin role required for the target workspace).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Validate JWT and get user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Parse request
    const body = await req.json().catch(() => ({}));
    const workspaceId = body.workspace_id;
    const mode = body.mode || "run"; // "run" | "preview"

    if (!workspaceId || typeof workspaceId !== "string") {
      return new Response(JSON.stringify({ error: "workspace_id required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Verify admin role using service client (bypasses auth.uid() guard)
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: membership } = await serviceClient
      .from("workspace_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!membership || membership.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Run sweeps (cross-workspace but idempotent — same as scheduled job)
    let sweepResults: Record<string, unknown> = {};
    if (mode === "run") {
      const [overdueRes, followupRes, renewalRes] = await Promise.all([
        serviceClient.rpc("sweep_overdue_invoices"),
        serviceClient.rpc("sweep_lead_followups"),
        serviceClient.rpc("sweep_renewal_reminders"),
      ]);
      sweepResults = {
        overdue: overdueRes.data,
        followups: followupRes.data,
        renewals: renewalRes.data,
      };
    }

    // Get digest data (all workspaces, we filter below)
    const { data: allDigest, error: digestErr } = await serviceClient.rpc("aggregate_daily_digest");
    if (digestErr) throw digestErr;

    const workspaces = Array.isArray(allDigest) ? allDigest : [];
    const wsDigest = workspaces.find((ws: any) => ws.workspace_id === workspaceId) || null;

    // In "run" mode, create notification for the admin (same as the worker does)
    if (mode === "run" && wsDigest) {
      const overdueInvoices = Array.isArray(wsDigest.overdue_invoices) ? wsDigest.overdue_invoices : [];
      const overdueFollowups = Array.isArray(wsDigest.overdue_followups) ? wsDigest.overdue_followups : [];
      const upcomingRenewals = Array.isArray(wsDigest.upcoming_renewals) ? wsDigest.upcoming_renewals : [];

      const summary = [
        overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice(s)` : null,
        overdueFollowups.length > 0 ? `${overdueFollowups.length} lead follow-up(s) due` : null,
        upcomingRenewals.length > 0 ? `${upcomingRenewals.length} renewal(s) approaching` : null,
      ].filter(Boolean).join(", ");

      if (summary) {
        // Get all admins in the workspace
        const { data: admins } = await serviceClient
          .from("workspace_memberships")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("role", "admin");

        if (admins) {
          for (const admin of admins) {
            await serviceClient.from("notifications").insert({
              workspace_id: workspaceId,
              user_id: admin.user_id,
              title: "Daily Digest",
              body: summary,
              link: "/dashboard",
            });
          }
        }
      }
    }

    // Build response
    const digestSummary = wsDigest
      ? {
          overdue_invoices: Array.isArray(wsDigest.overdue_invoices) ? wsDigest.overdue_invoices.length : 0,
          overdue_followups: Array.isArray(wsDigest.overdue_followups) ? wsDigest.overdue_followups.length : 0,
          upcoming_renewals: Array.isArray(wsDigest.upcoming_renewals) ? wsDigest.upcoming_renewals.length : 0,
          details: wsDigest,
        }
      : { overdue_invoices: 0, overdue_followups: 0, upcoming_renewals: 0, details: null };

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        workspace_id: workspaceId,
        executed_at: new Date().toISOString(),
        sweeps: mode === "run" ? sweepResults : null,
        digest: digestSummary,
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } }
    );
  }
});
