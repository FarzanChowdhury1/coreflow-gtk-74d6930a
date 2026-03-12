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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Get retention candidates (files with deleted_at > 30 days)
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

      if (!storageErr) {
        blobsDeleted++;
      }
      // Continue even if individual blob deletion fails (may already be gone)
    }

    // 3. Hard-delete stale file rows from DB
    const { data: purgedFiles, error: purgeFilesErr } = await supabase.rpc(
      "purge_stale_file_rows"
    );
    if (purgeFilesErr) throw purgeFilesErr;

    // 4. Purge expired portal tokens
    const { data: purgedTokens, error: purgeTokensErr } = await supabase.rpc(
      "purge_expired_portal_tokens"
    );
    if (purgeTokensErr) throw purgeTokensErr;

    return new Response(
      JSON.stringify({
        success: true,
        storage_blobs_deleted: blobsDeleted,
        file_rows_purged: purgedFiles?.purged_files || 0,
        portal_tokens_purged: purgedTokens?.purged_tokens || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
