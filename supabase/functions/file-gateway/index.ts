import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtVerify } from "https://deno.land/x/jose@v5.2.2/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PORTAL_JWT_SECRET = Deno.env.get("PORTAL_JWT_SECRET")!;
const COOKIE_NAME = "coreflow_portal_session";
const UPLOAD_EXPIRY_SECONDS = 7200; // 2 hours

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(PORTAL_JWT_SECRET);
}

// --------------- CORS ---------------

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.endsWith(".lovable.app")) return origin;
  if (origin.endsWith(".lovableproject.com")) return origin;
  if (origin === "http://localhost:8080" || origin === "http://localhost:5173") return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed || "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}

const ALLOWED_OWNER_TYPES = ["project", "invoice", "company", "payment_proof", "client_update"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
];

// --------------- Auth helpers ---------------

interface AuthResult {
  type: "internal" | "portal";
  userId?: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
}

async function authenticateRequest(req: Request, supabase: ReturnType<typeof createClient>): Promise<AuthResult | null> {
  // IMPORTANT: Check internal auth (Bearer token) FIRST so that internal users
  // are not misclassified as portal users when a portal cookie also exists.
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        return { type: "internal", userId: data.user.id, workspaceId: "" };
      }
    } catch {
      // invalid token, fall through to portal auth
    }
  }

  // Fallback: Try portal auth (cookie) only when no valid internal token
  const cookies = parseCookies(req.headers.get("Cookie"));
  const portalToken = cookies[COOKIE_NAME];
  if (portalToken) {
    try {
      const { payload } = await jwtVerify(portalToken, getJwtSecret(), { issuer: "coreflow-portal" });
      return {
        type: "portal",
        workspaceId: payload.workspace_id as string,
        companyId: payload.company_id as string,
        contactId: payload.contact_id as string,
      };
    } catch {
      // invalid portal token
    }
  }

  return null;
}

// --------------- Direct access-check helpers ---------------
// NOTE: We cannot use has_workspace_access / has_workspace_role / is_project_member RPCs
// because those security-definer functions compare _user_id against auth.uid().
// The edge function uses the service-role client, so auth.uid() is NULL and the checks
// always return false. Instead we query the underlying tables directly.

async function checkWorkspaceAccess(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function checkWorkspaceRole(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string,
  role: string
): Promise<boolean> {
  const { data } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("role", role)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function checkProjectMember(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  projectId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("project_members")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// --------------- Storage verification helpers ---------------

/**
 * Verify that an uploaded object actually exists in storage and return its authoritative metadata.
 * Uses the storage admin API to list the folder and find the file by name.
 */
async function getStorageObjectMeta(
  supabase: ReturnType<typeof createClient>,
  storagePath: string
): Promise<{ size: number; mimeType: string } | null> {
  const parts = storagePath.split("/");
  const fileName = parts.pop()!;
  const folder = parts.join("/");

  const { data: objects, error } = await supabase.storage
    .from("workspace-files")
    .list(folder, { search: fileName, limit: 1 });

  if (error || !objects || objects.length === 0) {
    return null;
  }

  const obj = objects[0];
  // obj.metadata contains { size, mimetype, ... } from storage
  const meta = obj.metadata as Record<string, unknown> | undefined;
  const size = (meta?.size as number) ?? (obj as any).size ?? 0;
  const mimeType = (meta?.mimetype as string) ?? (meta?.mimeType as string) ?? "application/octet-stream";

  return { size, mimeType };
}

// --------------- Handler ---------------

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const hdrs = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: hdrs });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, hdrs);
  }

  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: "Forbidden" }, 403, hdrs);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { action } = body;

    if (!action) {
      return jsonResponse({ error: "action required" }, 400, hdrs);
    }

    const auth = await authenticateRequest(req, supabase);
    if (!auth) {
      return jsonResponse({ error: "Not authenticated" }, 401, hdrs);
    }

    switch (action) {
      case "get_upload_url": {
        const { workspace_id, owner_type, owner_id, file_name, mime_type } = body;

        if (!workspace_id || !owner_type || !owner_id || !file_name || !mime_type) {
          return jsonResponse({ error: "Missing required fields" }, 400, hdrs);
        }

        if (!ALLOWED_OWNER_TYPES.includes(owner_type)) {
          return jsonResponse({ error: "Invalid owner_type" }, 400, hdrs);
        }

        if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
          return jsonResponse({ error: "File type not allowed" }, 400, hdrs);
        }

        // Portal users can only upload payment_proof
        if (auth.type === "portal") {
          if (owner_type !== "payment_proof") {
            return jsonResponse({ error: "Portal users can only upload payment proof" }, 403, hdrs);
          }
          if (workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }

          // CRITICAL: Validate owner_id belongs to an invoice scoped to this portal session's company
          const { data: invoice } = await supabase
            .from("invoices")
            .select("id")
            .eq("id", owner_id)
            .eq("company_id", auth.companyId!)
            .eq("workspace_id", auth.workspaceId)
            .is("deleted_at", null)
            .single();

          if (!invoice) {
            return jsonResponse({ error: "Invalid target: owner_id must reference an invoice belonging to your company" }, 403, hdrs);
          }
        }

        // Internal: verify workspace access
        if (auth.type === "internal") {
          auth.workspaceId = workspace_id;
          const access = await checkWorkspaceAccess(supabase, auth.userId!, workspace_id);
          if (!access) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        // Deterministic storage path
        const storagePath = `${workspace_id}/${owner_type}/${owner_id}/${crypto.randomUUID()}_${file_name}`;

        // Generate signed upload URL (2-hour expiry)
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from("workspace-files")
          .createSignedUploadUrl(storagePath);

        if (uploadErr || !uploadData) {
          return jsonResponse({ error: "Failed to generate upload URL" }, 500, hdrs);
        }

        return jsonResponse({
          upload_url: uploadData.signedUrl,
          token: uploadData.token,
          storage_path: storagePath,
          expires_in: UPLOAD_EXPIRY_SECONDS,
        }, 200, hdrs);
      }

      case "register_file": {
        const { workspace_id, owner_type, owner_id, file_name, storage_path, description } = body;

        if (!workspace_id || !owner_type || !owner_id || !file_name || !storage_path) {
          return jsonResponse({ error: "Missing required fields" }, 400, hdrs);
        }

        if (!ALLOWED_OWNER_TYPES.includes(owner_type)) {
          return jsonResponse({ error: "Invalid owner_type" }, 400, hdrs);
        }

        // Portal users: strict scoping — same guards as get_upload_url
        if (auth.type === "portal") {
          if (workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
          if (owner_type !== "payment_proof") {
            return jsonResponse({ error: "Portal users can only register payment proof files" }, 403, hdrs);
          }
          const { data: invoice } = await supabase
            .from("invoices")
            .select("id")
            .eq("id", owner_id)
            .eq("company_id", auth.companyId!)
            .eq("workspace_id", auth.workspaceId)
            .is("deleted_at", null)
            .single();
          if (!invoice) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        // CRITICAL: Verify the uploaded object exists in storage and get authoritative metadata
        const storageMeta = await getStorageObjectMeta(supabase, storage_path);
        if (!storageMeta) {
          return jsonResponse({
            error: "Uploaded file not found in storage. Upload must complete before registration.",
          }, 400, hdrs);
        }

        // Use authoritative size and mime_type from storage, NOT client-provided values
        const authoritativeSize = storageMeta.size;
        const authoritativeMimeType = storageMeta.mimeType;

        const uploadedBy = auth.type === "internal" ? auth.userId : null;

        const { data: fileRecord, error: insertErr } = await supabase
          .from("files")
          .insert({
            workspace_id,
            owner_type,
            owner_id,
            file_name,
            mime_type: authoritativeMimeType,
            file_size: authoritativeSize,
            storage_path,
            uploaded_by: uploadedBy,
            description: description || null,
          })
          .select("id, file_name, file_size, mime_type, created_at")
          .single();

        if (insertErr) {
          return jsonResponse({ error: "Failed to register file: " + insertErr.message }, 500, hdrs);
        }

        return jsonResponse({
          file: fileRecord,
          _meta: {
            source: "storage_authoritative",
            authoritative_size: authoritativeSize,
            authoritative_mime_type: authoritativeMimeType,
          },
        }, 200, hdrs);
      }

      case "get_download_url": {
        const { file_id } = body;

        if (!file_id) {
          return jsonResponse({ error: "file_id required" }, 400, hdrs);
        }

        const { data: file } = await supabase
          .from("files")
          .select("storage_path, workspace_id, owner_type, owner_id, file_name")
          .eq("id", file_id)
          .is("deleted_at", null)
          .single();

        if (!file) {
          return jsonResponse({ error: "File not found" }, 404, hdrs);
        }

        // Portal: strict company-scoped access
        if (auth.type === "portal") {
          if (file.workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }

          // Portal can only access payment_proof and client_update files
          if (file.owner_type !== "payment_proof" && file.owner_type !== "client_update") {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }

          // For payment_proof: verify the invoice belongs to this portal session's company
          if (file.owner_type === "payment_proof") {
            const { data: invoice } = await supabase
              .from("invoices")
              .select("id")
              .eq("id", file.owner_id)
              .eq("company_id", auth.companyId!)
              .eq("workspace_id", auth.workspaceId)
              .is("deleted_at", null)
              .single();

            if (!invoice) {
              return jsonResponse({ error: "Access denied" }, 403, hdrs);
            }
          }

          // For client_update: verify the update is published and belongs to this company
          if (file.owner_type === "client_update") {
            const { data: update } = await supabase
              .from("client_updates")
              .select("id")
              .eq("id", file.owner_id)
              .eq("company_id", auth.companyId!)
              .eq("workspace_id", auth.workspaceId)
              .eq("is_published", true)
              .is("deleted_at", null)
              .single();

            if (!update) {
              return jsonResponse({ error: "Access denied" }, 403, hdrs);
            }
          }
        }

        // Internal: verify workspace
        if (auth.type === "internal") {
          const access = await checkWorkspaceAccess(supabase, auth.userId!, file.workspace_id);
          if (!access) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        const { data: urlData, error: urlErr } = await supabase.storage
          .from("workspace-files")
          .createSignedUrl(file.storage_path, 3600); // 1 hour download URL

        if (urlErr || !urlData) {
          return jsonResponse({ error: "Failed to generate download URL" }, 500, hdrs);
        }

        return jsonResponse({
          download_url: urlData.signedUrl,
          file_name: file.file_name,
        }, 200, hdrs);
      }

      case "list_files": {
        const { workspace_id, owner_type, owner_id } = body;

        if (!workspace_id || !owner_type || !owner_id) {
          return jsonResponse({ error: "Missing required fields" }, 400, hdrs);
        }

        // Portal: limited scope with company verification
        if (auth.type === "portal") {
          if (workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
          if (owner_type !== "payment_proof" && owner_type !== "client_update") {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
          // Verify owner_id belongs to this company
          if (owner_type === "payment_proof") {
            const { data: invoice } = await supabase
              .from("invoices")
              .select("id")
              .eq("id", owner_id)
              .eq("company_id", auth.companyId!)
              .is("deleted_at", null)
              .single();
            if (!invoice) {
              return jsonResponse({ error: "Access denied" }, 403, hdrs);
            }
          }
          if (owner_type === "client_update") {
            const { data: update } = await supabase
              .from("client_updates")
              .select("id")
              .eq("id", owner_id)
              .eq("company_id", auth.companyId!)
              .eq("is_published", true)
              .is("deleted_at", null)
              .single();
            if (!update) {
              return jsonResponse({ error: "Access denied" }, 403, hdrs);
            }
          }
        }

        if (auth.type === "internal") {
          const access = await checkWorkspaceAccess(supabase, auth.userId!, workspace_id);
          if (!access) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        const { data: files } = await supabase
          .from("files")
          .select("id, file_name, mime_type, file_size, description, created_at")
          .eq("workspace_id", workspace_id)
          .eq("owner_type", owner_type)
          .eq("owner_id", owner_id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        return jsonResponse({ data: files || [] }, 200, hdrs);
      }

      case "delete_file": {
        // Soft-delete a file (internal users only, workspace-scoped)
        const { file_id } = body;
        if (!file_id) {
          return jsonResponse({ error: "file_id required" }, 400, hdrs);
        }

        if (auth.type !== "internal") {
          return jsonResponse({ error: "Portal users cannot delete files" }, 403, hdrs);
        }

        const { data: file } = await supabase
          .from("files")
          .select("workspace_id")
          .eq("id", file_id)
          .is("deleted_at", null)
          .single();

        if (!file) {
          return jsonResponse({ error: "File not found" }, 404, hdrs);
        }

        const access = await checkWorkspaceAccess(supabase, auth.userId!, file.workspace_id);
        if (!access) {
          return jsonResponse({ error: "Access denied" }, 403, hdrs);
        }

        const { error: delErr } = await supabase
          .from("files")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", file_id);

        if (delErr) {
          return jsonResponse({ error: "Delete failed" }, 500, hdrs);
        }

        return jsonResponse({ success: true }, 200, hdrs);
      }

      // --------------- Internal mutation endpoints ---------------

      case "create_client_update": {
        if (auth.type !== "internal") {
          return jsonResponse({ error: "Not allowed" }, 403, hdrs);
        }

        const { workspace_id, project_id, title, body: updateBody, file_id } = body;
        if (!workspace_id || !project_id || !title) {
          return jsonResponse({ error: "workspace_id, project_id, title required" }, 400, hdrs);
        }

        // Verify workspace access
        const access = await checkWorkspaceAccess(supabase, auth.userId!, workspace_id);
        if (!access) {
          return jsonResponse({ error: "Access denied" }, 403, hdrs);
        }

        // Verify project membership (team members) or admin role
        const isAdmin = await checkWorkspaceRole(supabase, auth.userId!, workspace_id, "admin");

        if (!isAdmin) {
          const isMember = await checkProjectMember(supabase, auth.userId!, project_id);
          if (!isMember) {
            return jsonResponse({ error: "Access denied: not a member of this project" }, 403, hdrs);
          }
        }

        // Get project to find company_id
        const { data: project } = await supabase
          .from("projects")
          .select("company_id")
          .eq("id", project_id)
          .eq("workspace_id", workspace_id)
          .is("deleted_at", null)
          .single();

        if (!project) {
          return jsonResponse({ error: "Project not found" }, 404, hdrs);
        }

        const { data: record, error: insertErr } = await supabase
          .from("client_updates")
          .insert({
            workspace_id,
            project_id,
            company_id: project.company_id,
            author_id: auth.userId!,
            title: title.trim(),
            body: updateBody?.trim() || null,
            file_id: file_id || null,
            is_published: false,
          })
          .select("id, title, created_at")
          .single();

        if (insertErr) {
          return jsonResponse({ error: "Failed to create update: " + insertErr.message }, 500, hdrs);
        }

        return jsonResponse({ update: record }, 200, hdrs);
      }

      case "toggle_publish_client_update": {
        if (auth.type !== "internal") {
          return jsonResponse({ error: "Not allowed" }, 403, hdrs);
        }

        const { update_id } = body;
        if (!update_id) {
          return jsonResponse({ error: "update_id required" }, 400, hdrs);
        }

        // Fetch the update
        const { data: existing } = await supabase
          .from("client_updates")
          .select("workspace_id, project_id, is_published, author_id")
          .eq("id", update_id)
          .is("deleted_at", null)
          .single();

        if (!existing) {
          return jsonResponse({ error: "Update not found" }, 404, hdrs);
        }

        // Verify access: admin can toggle any, team member can toggle their own if project member
        const { data: isAdmin } = await supabase.rpc("has_workspace_role", {
          _user_id: auth.userId!,
          _workspace_id: existing.workspace_id,
          _role: "admin",
        });

        if (!isAdmin) {
          if (existing.author_id !== auth.userId) {
            return jsonResponse({ error: "Access denied: can only manage your own updates" }, 403, hdrs);
          }
          const { data: isMember } = await supabase.rpc("is_project_member", {
            _user_id: auth.userId!,
            _project_id: existing.project_id,
          });
          if (!isMember) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        const newPublished = !existing.is_published;
        const { error: updateErr } = await supabase
          .from("client_updates")
          .update({
            is_published: newPublished,
            published_at: newPublished ? new Date().toISOString() : null,
          })
          .eq("id", update_id);

        if (updateErr) {
          return jsonResponse({ error: "Update failed" }, 500, hdrs);
        }

        return jsonResponse({ success: true, is_published: newPublished }, 200, hdrs);
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400, hdrs);
    }
  } catch (_err) {
    return jsonResponse({ error: "Internal error" }, 500, hdrs);
  }
});
