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

  // --- HARDENED: Require explicit workspace_id ---
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "preview";

  let workspace_id: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      workspace_id = body.workspace_id || null;
    } catch {
      // GET request or no body — try query param
    }
  }
  if (!workspace_id) {
    workspace_id = url.searchParams.get("workspace_id");
  }

  if (!workspace_id) {
    return new Response(
      JSON.stringify({ error: "workspace_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Verify admin role in the SPECIFIC workspace ---
  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: membership } = await serviceClient
    .from("workspace_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("workspace_id", workspace_id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return new Response(JSON.stringify({ error: "Admin access required for this workspace" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ======================== PREVIEW ========================
  if (mode === "preview") {
    try {
      // Workspace-scoped preview
      const [filesResult, notifResult] = await Promise.all([
        serviceClient
          .from("files")
          .select("id, storage_path, file_name, deleted_at")
          .eq("workspace_id", workspace_id)
          .not("deleted_at", "is", null)
          .limit(100),
        serviceClient
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace_id)
          .eq("is_read", true),
      ]);

      return new Response(
        JSON.stringify({
          mode: "preview",
          workspace_id,
          stale_files_count: filesResult.data?.length ?? 0,
          read_notifications_count: notifResult.count ?? 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Cleanup preview error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to load preview. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ======================== RUN ========================
  if (mode === "run") {
    // Cooldown: no successful run within 5 minutes for THIS workspace
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

        try {
          await serviceClient.from("worker_runs").insert({
            worker_name: "asset_cleanup",
            status: "cooldown_rejected",
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            duration_ms: 0,
            trigger_source: "manual",
            triggered_by: user.id,
            summary: { cooldown_remaining_sec: retryAfter, workspace_id },
          });
        } catch (_) { /* best-effort */ }

        return new Response(
          JSON.stringify({
            error: "Cooldown active",
            retry_after_seconds: retryAfter,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const startTime = Date.now();
    try {
      // WORKSPACE-SCOPED cleanup: only touch data belonging to this workspace

      // 1. Get stale files for this workspace
      const { data: staleFiles } = await serviceClient
        .from("files")
        .select("id, storage_path")
        .eq("workspace_id", workspace_id)
        .not("deleted_at", "is", null)
        .lt("deleted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      // 2. Delete storage blobs
      let blobsDeleted = 0;
      for (const file of staleFiles || []) {
        const { error: storageErr } = await serviceClient.storage
          .from("workspace-files")
          .remove([file.storage_path]);
        if (!storageErr) blobsDeleted++;
      }

      // 3. Hard-delete stale file rows for this workspace
      let fileRowsPurged = 0;
      if (staleFiles && staleFiles.length > 0) {
        const ids = staleFiles.map(f => f.id);
        const { count } = await serviceClient
          .from("files")
          .delete({ count: "exact" })
          .in("id", ids);
        fileRowsPurged = count ?? 0;
      }

      // 4. Purge read notifications for this workspace (30+ days old)
      const { count: notifsPurged } = await serviceClient
        .from("notifications")
        .delete({ count: "exact" })
        .eq("workspace_id", workspace_id)
        .eq("is_read", true)
        .lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      const durationMs = Date.now() - startTime;
      const resultSummary = {
        workspace_id,
        storage_blobs_deleted: blobsDeleted,
        file_rows_purged: fileRowsPurged,
        notifications_purged: notifsPurged ?? 0,
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
          summary: { workspace_id },
        });
      } catch (_e) { /* best-effort */ }

      return new Response(
        JSON.stringify({ error: "Cleanup failed. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Invalid mode. Use 'preview' or 'run'." }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
