import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtVerify } from "https://deno.land/x/jose@v5.2.2/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PORTAL_JWT_SECRET = Deno.env.get("PORTAL_JWT_SECRET")!;
const COOKIE_NAME = "coreflow_portal_session";

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(PORTAL_JWT_SECRET);
}

// --------------- Origin / CORS helpers ---------------

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

interface PortalSession {
  workspace_id: string;
  company_id: string;
  contact_id: string;
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

  // Authenticate via JWT cookie
  const cookies = parseCookies(req.headers.get("Cookie"));
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return jsonResponse({ error: "Not authenticated" }, 401, hdrs);
  }

  let sess: PortalSession;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "coreflow-portal",
    });
    sess = {
      workspace_id: payload.workspace_id as string,
      company_id: payload.company_id as string,
      contact_id: payload.contact_id as string,
    };
  } catch (_err) {
    return jsonResponse({ error: "Session expired or invalid" }, 401, hdrs);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();

    // --------------- Data resources ---------------
    if (body.resource) {
      return await handleResource(supabase, sess, body.resource, hdrs);
    }

    // --------------- Mutations (require origin validation) ---------------
    if (body.action) {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse({ error: "Forbidden" }, 403, hdrs);
      }
      return await handleAction(supabase, sess, body, hdrs);
    }

    return jsonResponse({ error: "Invalid request" }, 400, hdrs);
  } catch (_err) {
    return jsonResponse({ error: "Internal error" }, 500, hdrs);
  }
});

// --------------- Resource handlers ---------------

async function handleResource(
  supabase: ReturnType<typeof createClient>,
  session: PortalSession,
  resource: string,
  hdrs: Record<string, string>
): Promise<Response> {
  switch (resource) {
    case "proposals": {
      const { data } = await supabase
        .from("proposals")
        .select("*, proposal_versions(*)")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      return jsonResponse({ data: data || [] }, 200, hdrs);
    }

    case "invoices": {
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null)
        .neq("status", "draft")
        .order("created_at", { ascending: false });
      return jsonResponse({ data: data || [] }, 200, hdrs);
    }

    case "payments": {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null);

      if (!invoices || invoices.length === 0) {
        return jsonResponse({ data: [] }, 200, hdrs);
      }

      const invoiceIds = invoices.map((i: { id: string }) => i.id);
      const invoiceMap = Object.fromEntries(
        invoices.map((i: { id: string; invoice_number: string }) => [i.id, i.invoice_number])
      );

      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .in("invoice_id", invoiceIds)
        .eq("workspace_id", session.workspace_id)
        .order("paid_at", { ascending: false });

      const enriched = (payments || []).map((p: Record<string, unknown>) => ({
        ...p,
        invoice_number: invoiceMap[p.invoice_id as string] || "—",
      }));

      return jsonResponse({ data: enriched }, 200, hdrs);
    }

    default:
      return jsonResponse({ error: "Unknown resource" }, 400, hdrs);
  }
}

// --------------- Action handlers ---------------

async function handleAction(
  supabase: ReturnType<typeof createClient>,
  session: PortalSession,
  body: Record<string, unknown>,
  hdrs: Record<string, string>
): Promise<Response> {
  switch (body.action) {
    case "get_line_items": {
      const versionId = body.version_id as string;
      if (!versionId) return jsonResponse({ error: "version_id required" }, 400, hdrs);

      const { data: version } = await supabase
        .from("proposal_versions")
        .select("id, proposal_id")
        .eq("id", versionId)
        .single();

      if (!version) return jsonResponse({ error: "Version not found" }, 404, hdrs);

      const { data: proposal } = await supabase
        .from("proposals")
        .select("company_id")
        .eq("id", version.proposal_id)
        .single();

      if (!proposal || proposal.company_id !== session.company_id) {
        return jsonResponse({ error: "Access denied" }, 403, hdrs);
      }

      const { data: items } = await supabase
        .from("proposal_line_items")
        .select("*")
        .eq("version_id", versionId)
        .order("sort_order");

      return jsonResponse({ data: items || [] }, 200, hdrs);
    }

    case "respond_proposal": {
      const versionId = body.version_id as string;
      const decision = body.decision as string;

      if (!versionId || !decision) {
        return jsonResponse({ error: "version_id and decision required" }, 400, hdrs);
      }
      if (decision !== "approved" && decision !== "rejected") {
        return jsonResponse({ error: "Invalid decision" }, 400, hdrs);
      }

      const { data: version } = await supabase
        .from("proposal_versions")
        .select("id, proposal_id, status")
        .eq("id", versionId)
        .single();

      if (!version) return jsonResponse({ error: "Version not found" }, 404, hdrs);
      if (version.status !== "sent") {
        return jsonResponse({ error: "Proposal is not awaiting response" }, 400, hdrs);
      }

      const { data: proposal } = await supabase
        .from("proposals")
        .select("company_id")
        .eq("id", version.proposal_id)
        .single();

      if (!proposal || proposal.company_id !== session.company_id) {
        return jsonResponse({ error: "Access denied" }, 403, hdrs);
      }

      const { error: updateErr } = await supabase
        .from("proposal_versions")
        .update({ status: decision })
        .eq("id", versionId);

      if (updateErr) {
        return jsonResponse({ error: "Update failed" }, 500, hdrs);
      }

      return jsonResponse({ success: true, new_status: decision }, 200, hdrs);
    }

    default:
      return jsonResponse({ error: "Unknown action" }, 400, hdrs);
  }
}
