import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // --- Authenticate caller ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Verify admin role ---
  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: membership } = await serviceClient
    .from("workspace_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Parse mode ---
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "preview";

  // ======================== PREVIEW ========================
  if (mode === "preview") {
    try {
      const [
        { data: candidates, error: candErr },
        { data: notifCounts, error: notifErr },
        { data: opsCounts, error: opsErr },
      ] = await Promise.all([
        serviceClient.rpc("select_retention_candidates"),
        serviceClient.rpc("count_retention_candidates_notifications"),
        serviceClient.rpc("count_retention_candidates_ops_logs"),
      ]);
      if (candErr) throw candErr;
      if (notifErr) throw notifErr;
      if (opsErr) throw opsErr;
      return new Response(
        JSON.stringify({
          mode: "preview",
          candidates,
          notification_candidates: notifCounts,
          ops_log_candidates: opsCounts,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err).slice(0, 500) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  // ======================== RUN ========================
  if (mode === "run") {
    // Cooldown: no successful run within 5 minutes
    const { data: recentRuns } = await serviceClient
      .from("worker_runs")
      .select("started_at")
      .eq("worker_name", "asset_cleanup")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1);

    if (recentRuns && recentRuns.length > 0) {
      const lastRun = new Date(recentRuns[0].started_at).getTime();
      const cooldownMs = 5 * 60 * 1000;
      if (Date.now() - lastRun < cooldownMs) {
        const retryAfter = Math.ceil(
          (cooldownMs - (Date.now() - lastRun)) / 1000
        );

        // Log the cooldown rejection
        try {
          await serviceClient.from("worker_runs").insert({
            worker_name: "asset_cleanup",
            status: "cooldown_rejected",
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            duration_ms: 0,
            trigger_source: "manual",
            triggered_by: user.id,
            summary: { cooldown_remaining_sec: retryAfter },
          });
        } catch (_) { /* best-effort */ }

        return new Response(
          JSON.stringify({
            error: "Cooldown active",
            retry_after_seconds: retryAfter,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const startTime = Date.now();
    try {
      // 1. Get retention candidates
      const { data: candidates, error: candErr } = await serviceClient.rpc(
        "select_retention_candidates"
      );
      if (candErr) throw candErr;

      // 2. Delete physical storage blobs
      const staleFiles = candidates?.stale_files || [];
      let blobsDeleted = 0;
      for (const file of staleFiles) {
        const { error: storageErr } = await serviceClient.storage
          .from("workspace-files")
          .remove([file.storage_path]);
        if (!storageErr) blobsDeleted++;
      }

      // 3–7. Purge rows
      const { data: purgedFiles } = await serviceClient.rpc("purge_stale_file_rows");
      const { data: purgedTokens } = await serviceClient.rpc("purge_expired_portal_tokens");
      const { data: purgedLinks } = await serviceClient.rpc("purge_expired_short_links");
      const { data: purgedOpsLogs } = await serviceClient.rpc("purge_operational_logs");
      const { data: purgedNotifications } = await serviceClient.rpc("purge_old_notifications");

      const durationMs = Date.now() - startTime;
      const resultSummary = {
        storage_blobs_deleted: blobsDeleted,
        file_rows_purged: purgedFiles?.purged_files || 0,
        portal_tokens_purged: purgedTokens?.purged_tokens || 0,
        short_links_purged: purgedLinks?.purged_short_links || 0,
        ops_logs_purged: purgedOpsLogs || {},
        notifications_purged: purgedNotifications || {},
        candidates_found: {
          stale_files: staleFiles.length,
          expired_tokens: (candidates?.expired_portal_tokens || []).length,
          expired_short_links: (candidates?.expired_short_links || []).length,
        },
      };

      // Log success
      try {
        await serviceClient.from("worker_runs").insert({
          worker_name: "asset_cleanup",
          status: "success",
          started_at: new Date(startTime).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          trigger_source: "manual",
          triggered_by: user.id,
          summary: resultSummary,
        });
      } catch (_) { /* best-effort */ }

      return new Response(
        JSON.stringify({ mode: "run", success: true, ...resultSummary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errMsg = String(err).slice(0, 500);

      try {
        await serviceClient.from("worker_runs").insert({
          worker_name: "asset_cleanup",
          status: "failed",
          started_at: new Date(startTime).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          trigger_source: "manual",
          triggered_by: user.id,
          error_message: errMsg,
        });
      } catch (_e) { /* best-effort */ }

      return new Response(
        JSON.stringify({ error: "Cleanup failed", detail: errMsg }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Invalid mode. Use 'preview' or 'run'." }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
