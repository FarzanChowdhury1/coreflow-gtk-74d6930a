import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

Deno.serve(async (req) => {
  // No CORS needed — server-to-server cron endpoint
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Authenticate: require Bearer token matching WORKER_SECRET
  const authHeader = req.headers.get("Authorization");
  if (!WORKER_SECRET || authHeader !== `Bearer ${WORKER_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

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

    return new Response(
      JSON.stringify({
        success: true,
        storage_blobs_deleted: blobsDeleted,
        file_rows_purged: purgedFiles?.purged_files || 0,
        portal_tokens_purged: purgedTokens?.purged_tokens || 0,
        short_links_purged: purgedLinks?.purged_short_links || 0,
        candidates_found: {
          stale_files: staleFiles.length,
          expired_tokens: (candidates?.expired_portal_tokens || []).length,
          expired_short_links: (candidates?.expired_short_links || []).length,
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Asset cleanup error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
