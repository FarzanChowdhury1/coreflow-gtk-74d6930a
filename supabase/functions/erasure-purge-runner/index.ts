import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.24.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  workspace_id: z.string().uuid(),
  request_id: z.string().uuid(),
});

const RETRYABLE_STATUSES = ["pending_purge", "storage_cleanup_failed", "purge_incomplete"] as const;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/storage\/v1\/object\/(?:sign\/)?(?:public\/)?workspace-files\/(.+)$/);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (trimmed.startsWith("workspace-files/")) {
    return trimmed.slice("workspace-files/".length);
  }

  return trimmed;
}

function appendNote(existing: string | null, addition: string) {
  return existing?.trim() ? `${existing} | ${addition}` : addition;
}

async function insertAuditLog(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  requestId: string,
  action: string,
  actorId: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_logs").insert({
    workspace_id: workspaceId,
    entity_type: "data_erasure_request",
    entity_id: requestId,
    action,
    actor_id: actorId,
    metadata,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "").trim();
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  let parsedBody: z.infer<typeof BodySchema>;
  try {
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ success: false, error: parsed.error.flatten().fieldErrors }, 400);
    }
    parsedBody = parsed.data;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { workspace_id: workspaceId, request_id: requestId } = parsedBody;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: membership, error: membershipError } = await admin
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (membershipError || !membership) {
    return jsonResponse({ success: false, error: "Admin access required" }, 403);
  }

  const { data: erasureRequest, error: requestError } = await admin
    .from("data_erasure_requests")
    .select("id, status, notes")
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (requestError || !erasureRequest) {
    return jsonResponse({ success: false, error: "Erasure request not found" }, 404);
  }

  if (!RETRYABLE_STATUSES.includes(erasureRequest.status as (typeof RETRYABLE_STATUSES)[number])) {
    return jsonResponse({
      success: false,
      error: `Request is not retryable from status '${erasureRequest.status}'`,
      status: erasureRequest.status,
    }, 409);
  }

  const [{ data: workspace }, { data: fileRows }, { data: paymentRows }] = await Promise.all([
    admin
      .from("workspaces")
      .select("id, deleted_at, portal_logo_storage_path")
      .eq("id", workspaceId)
      .maybeSingle(),
    admin
      .from("files")
      .select("storage_path")
      .eq("workspace_id", workspaceId)
      .not("storage_path", "is", null),
    admin
      .from("payments")
      .select("proof_url")
      .eq("workspace_id", workspaceId)
      .not("proof_url", "is", null),
  ]);

  if (!workspace) {
    return jsonResponse({ success: false, error: "Workspace not found" }, 404);
  }

  if (!workspace.deleted_at) {
    return jsonResponse({ success: false, error: "Workspace must be deactivated before final purge" }, 409);
  }

  const storagePaths = Array.from(
    new Set(
      [
        ...(fileRows ?? []).map((row) => normalizeStoragePath(row.storage_path)),
        normalizeStoragePath(workspace.portal_logo_storage_path),
        ...((paymentRows ?? []).map((row) => normalizeStoragePath(row.proof_url))),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  await admin
    .from("data_erasure_requests")
    .update({
      status: "purging_storage",
      updated_at: new Date().toISOString(),
      notes: appendNote(erasureRequest.notes, `storage_cleanup_started:${storagePaths.length}`),
    })
    .eq("id", requestId)
    .eq("workspace_id", workspaceId);

  await insertAuditLog(admin, workspaceId, requestId, "erasure_storage_cleanup_started", userId, {
    stage: "purging_storage",
    storage_reference_count: storagePaths.length,
  });

  const failedPaths: string[] = [];
  let storageDeleted = 0;

  for (const storagePath of storagePaths) {
    const { error } = await admin.storage.from("workspace-files").remove([storagePath]);
    if (error) {
      failedPaths.push(storagePath);
      continue;
    }
    storageDeleted += 1;
  }

  if (failedPaths.length > 0) {
    const failureNote = `storage_cleanup_failed:${failedPaths.length}/${storagePaths.length}`;
    await admin
      .from("data_erasure_requests")
      .update({
        status: "storage_cleanup_failed",
        updated_at: new Date().toISOString(),
        notes: appendNote(erasureRequest.notes, failureNote),
      })
      .eq("id", requestId)
      .eq("workspace_id", workspaceId);

    await insertAuditLog(admin, workspaceId, requestId, "erasure_storage_cleanup_failed", userId, {
      stage: "storage_cleanup_failed",
      storage_deleted: storageDeleted,
      storage_failed: failedPaths.length,
      failed_paths: failedPaths,
    });

    return jsonResponse({
      success: false,
      status: "storage_cleanup_failed",
      error: "Storage cleanup failed; purge was not finalized",
      storage_deleted: storageDeleted,
      storage_failed: failedPaths.length,
      failed_paths: failedPaths,
    }, 500);
  }

  await admin
    .from("workspaces")
    .update({ portal_logo_storage_path: null })
    .eq("id", workspaceId);

  await insertAuditLog(admin, workspaceId, requestId, "erasure_storage_cleanup_succeeded", userId, {
    stage: "purging_storage",
    storage_deleted: storageDeleted,
    storage_failed: 0,
  });

  const { data: purgeResult, error: purgeError } = await admin.rpc("purge_workspace_data", {
    _workspace_id: workspaceId,
    _request_id: requestId,
  });

  const normalizedResult = (purgeResult ?? null) as Record<string, unknown> | null;
  if (purgeError || normalizedResult?.success !== true) {
    const errorMessage = purgeError?.message || String(normalizedResult?.error || "Record purge failed");

    await admin
      .from("data_erasure_requests")
      .update({
        status: "purge_incomplete",
        updated_at: new Date().toISOString(),
        notes: appendNote(erasureRequest.notes, `record_purge_failed:${errorMessage}`),
      })
      .eq("id", requestId)
      .eq("workspace_id", workspaceId);

    await insertAuditLog(admin, workspaceId, requestId, "erasure_record_purge_failed", userId, {
      stage: "purge_incomplete",
      storage_deleted: storageDeleted,
      error: errorMessage,
    });

    return jsonResponse({
      success: false,
      status: "purge_incomplete",
      error: errorMessage,
      storage_deleted: storageDeleted,
    }, 500);
  }

  await insertAuditLog(admin, workspaceId, requestId, "erasure_purge_finalized", userId, {
    stage: "purged",
    storage_deleted: storageDeleted,
  });

  return jsonResponse({
    success: true,
    status: "purged",
    storage_deleted: storageDeleted,
    deleted_counts: normalizedResult?.deleted_counts ?? {},
  });
});