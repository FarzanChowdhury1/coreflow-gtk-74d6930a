import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const workerAuth = req.headers.get("X-Worker-Secret");
  if (!WORKER_SECRET || workerAuth !== WORKER_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Get retention candidates
    const { data: candidates, error: candErr } = await supabase.rpc(
      "select_retention_candidates"
    );
    if (candErr) throw candErr;

    // 2. Delete physical storage blobs for stale files
    const staleFiles = candidates?.stale_files || [];
    let blobsDeleted = 0;
    for (const file of staleFiles) {
      const { error: storageErr } = await supabase.storage
        .from("workspace-files")
        .remove([file.storage_path]);
      if (!storageErr) blobsDeleted++;
    }

    // 3. Hard-delete stale file rows
    const { data: purgedFiles } = await supabase.rpc("purge_stale_file_rows");

    // 4. Purge expired portal tokens
    const { data: purgedTokens } = await supabase.rpc("purge_expired_portal_tokens");

    // 5. Purge expired short links
    const { data: purgedLinks } = await supabase.rpc("purge_expired_short_links");

    // 6. Purge stale operational logs (digest_runs, worker_runs, email_logs)
    const { data: purgedOpsLogs } = await supabase.rpc("purge_operational_logs");

    // 7. Purge old read notifications (30d info, 90d warning, 180d critical)
    const { data: purgedNotifications } = await supabase.rpc("purge_old_notifications");

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

    // Best-effort worker run log
    try {
      await supabase.from("worker_runs").insert({
        worker_name: "asset_cleanup",
        status: "success",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        trigger_source: "scheduled",
        summary: resultSummary,
      });
    } catch (_logErr) {
      console.warn("Failed to log worker run:", _logErr);
    }

    return new Response(
      JSON.stringify({ success: true, ...resultSummary }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Asset cleanup error:", err);
    const durationMs = Date.now() - startTime;
    const errMsg = String(err).slice(0, 500);

    // Best-effort failure log
    try {
      await supabase.from("worker_runs").insert({
        worker_name: "asset_cleanup",
        status: "failed",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        trigger_source: "scheduled",
        error_message: errMsg,
      });
    } catch (_logErr) {
      console.warn("Failed to log worker failure:", _logErr);
    }

    // Best-effort failure alert to admins
    try {
      await supabase.rpc("create_worker_failure_alert", {
        _worker_name: "asset_cleanup",
        _error_summary: errMsg,
      });
    } catch (_alertErr) {
      console.warn("Failed to create failure alert:", _alertErr);
    }

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
