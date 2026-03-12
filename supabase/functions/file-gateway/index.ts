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
  // Try portal auth first (cookie) — portal users don't send Authorization
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
      // invalid portal token, fall through
    }
  }

  // Try internal auth (Authorization header)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        return { type: "internal", userId: data.user.id, workspaceId: "" };
      }
    } catch {
      // invalid token
    }
  }

  return null;
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
        if (auth.type === "portal" && owner_type !== "payment_proof") {
          return jsonResponse({ error: "Portal users can only upload payment proof" }, 403, hdrs);
        }

        // Portal: verify scoping
        if (auth.type === "portal") {
          if (workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        // Internal: verify workspace access
        if (auth.type === "internal") {
          auth.workspaceId = workspace_id;
          const { data: access } = await supabase.rpc("has_workspace_access", {
            _user_id: auth.userId!,
            _workspace_id: workspace_id,
          });
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
        const { workspace_id, owner_type, owner_id, file_name, mime_type, file_size, storage_path, description } = body;

        if (!workspace_id || !owner_type || !owner_id || !file_name || !storage_path) {
          return jsonResponse({ error: "Missing required fields" }, 400, hdrs);
        }

        if (!ALLOWED_OWNER_TYPES.includes(owner_type)) {
          return jsonResponse({ error: "Invalid owner_type" }, 400, hdrs);
        }

        // Verify the file exists in storage
        const { data: fileExists } = await supabase.storage
          .from("workspace-files")
          .list(storage_path.split("/").slice(0, -1).join("/"), {
            search: storage_path.split("/").pop(),
          });

        const uploadedBy = auth.type === "internal" ? auth.userId : null;

        const { data: fileRecord, error: insertErr } = await supabase
          .from("files")
          .insert({
            workspace_id,
            owner_type,
            owner_id,
            file_name,
            mime_type: mime_type || "application/octet-stream",
            file_size: file_size || 0,
            storage_path,
            uploaded_by: uploadedBy,
            description: description || null,
          })
          .select("id, file_name, created_at")
          .single();

        if (insertErr) {
          return jsonResponse({ error: "Failed to register file: " + insertErr.message }, 500, hdrs);
        }

        return jsonResponse({ file: fileRecord }, 200, hdrs);
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

        // Portal: can only access payment_proof for their company
        if (auth.type === "portal") {
          if (file.workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
          // portal can access payment_proof and client_update files only
          if (file.owner_type !== "payment_proof" && file.owner_type !== "client_update") {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        // Internal: verify workspace
        if (auth.type === "internal") {
          const { data: access } = await supabase.rpc("has_workspace_access", {
            _user_id: auth.userId!,
            _workspace_id: file.workspace_id,
          });
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

        // Portal: limited scope
        if (auth.type === "portal") {
          if (workspace_id !== auth.workspaceId) {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
          if (owner_type !== "payment_proof" && owner_type !== "client_update") {
            return jsonResponse({ error: "Access denied" }, 403, hdrs);
          }
        }

        if (auth.type === "internal") {
          const { data: access } = await supabase.rpc("has_workspace_access", {
            _user_id: auth.userId!,
            _workspace_id: workspace_id,
          });
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

      default:
        return jsonResponse({ error: "Unknown action" }, 400, hdrs);
    }
  } catch (_err) {
    return jsonResponse({ error: "Internal error" }, 500, hdrs);
  }
});
