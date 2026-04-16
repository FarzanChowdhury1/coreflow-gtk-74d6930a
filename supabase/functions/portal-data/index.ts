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
  // Production custom domain
  if (origin === "https://coreflow.gatekeepr.live") return origin;
  const extra = Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "";
  if (extra) {
    const origins = extra.split(",").map((s) => s.trim()).filter(Boolean);
    for (const allowed of origins) {
      if (origin === allowed || origin === `https://${allowed}` || origin === `http://${allowed}`) return origin;
    }
  }
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

function extractToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.get("Cookie"));
  const cookieToken = cookies[COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
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

  const token = extractToken(req);
  if (!token) {
    return jsonResponse({ error: "Not authenticated" }, 401, hdrs);
  }

  let sess: PortalSession;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: "coreflow-portal" });
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

    if (body.resource) {
      return await handleResource(supabase, sess, body.resource, hdrs);
    }

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
        .select("id, invoice_number, currency")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null);

      if (!invoices || invoices.length === 0) {
        return jsonResponse({ data: [] }, 200, hdrs);
      }

      const invoiceIds = invoices.map((i: { id: string }) => i.id);
      const invoiceMap = Object.fromEntries(
        invoices.map((i: { id: string; invoice_number: string; currency: string }) => [
          i.id,
          { invoice_number: i.invoice_number, currency: i.currency },
        ])
      );

      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .in("invoice_id", invoiceIds)
        .eq("workspace_id", session.workspace_id)
        .order("paid_at", { ascending: false });

      const enriched = (payments || []).map((p: Record<string, unknown>) => {
        const inv = invoiceMap[p.invoice_id as string] || { invoice_number: "—", currency: "BDT" };
        return { ...p, invoice_number: inv.invoice_number, currency: inv.currency };
      });

      return jsonResponse({ data: enriched }, 200, hdrs);
    }

    case "client_updates": {
      const { data } = await supabase
        .from("client_updates")
        .select("id, title, body, published_at, project_id, projects(name)")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .eq("is_published", true)
        .is("deleted_at", null)
        .order("published_at", { ascending: false });

      const enriched = (data || []).map((u: Record<string, unknown>) => ({
        ...u,
        project_name: (u.projects as any)?.name || "Project",
      }));

      return jsonResponse({ data: enriched }, 200, hdrs);
    }

    case "documents": {
      const { data: companyFiles } = await supabase
        .from("files")
        .select("id, file_name, mime_type, file_size, created_at, owner_type, description")
        .eq("workspace_id", session.workspace_id)
        .eq("owner_type", "company")
        .eq("owner_id", session.company_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);

      const { data: invoices } = await supabase
        .from("invoices")
        .select("id")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null);

      let invoiceFiles: any[] = [];
      if (invoices && invoices.length > 0) {
        const invoiceIds = invoices.map((i: { id: string }) => i.id);
        const { data } = await supabase
          .from("files")
          .select("id, file_name, mime_type, file_size, created_at, owner_type, description")
          .eq("workspace_id", session.workspace_id)
          .eq("owner_type", "invoice")
          .in("owner_id", invoiceIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50);
        invoiceFiles = data || [];
      }

      const allFiles = [...(companyFiles || []), ...invoiceFiles]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);

      return jsonResponse({ data: allFiles }, 200, hdrs);
    }

    case "onboarding_tasks": {
      const { data } = await supabase
        .from("client_tasks")
        .select("id, title, description, status, sort_order, due_date, response_text, response_link, response_notes, revision_note, submitted_at, approved_at, project_id")
        .eq("company_id", session.company_id)
        .eq("workspace_id", session.workspace_id)
        .order("sort_order", { ascending: true });

      // Enrich with project names
      const tasks = data || [];
      const projectIds = [...new Set(tasks.filter((t: any) => t.project_id).map((t: any) => t.project_id))];
      let projectMap: Record<string, string> = {};
      if (projectIds.length > 0) {
        const { data: projects } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds);
        if (projects) {
          projectMap = Object.fromEntries(projects.map((p: any) => [p.id, p.name]));
        }
      }
      const enriched = tasks.map((t: any) => ({
        ...t,
        project_name: t.project_id ? (projectMap[t.project_id] || null) : null,
      }));
      return jsonResponse({ data: enriched }, 200, hdrs);
    }

    case "summary": {
      const [proposalsRes, invoicesRes, updatesRes, tasksRes] = await Promise.all([
        supabase
          .from("proposals")
          .select("id, proposal_versions(id, status, grand_total)")
          .eq("company_id", session.company_id)
          .eq("workspace_id", session.workspace_id)
          .is("deleted_at", null),
        supabase
          .from("invoices")
          .select("id, status, grand_total, amount_paid, due_date, currency")
          .eq("company_id", session.company_id)
          .eq("workspace_id", session.workspace_id)
          .is("deleted_at", null)
          .neq("status", "draft"),
        supabase
          .from("client_updates")
          .select("id, published_at")
          .eq("company_id", session.company_id)
          .eq("workspace_id", session.workspace_id)
          .eq("is_published", true)
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(5),
        supabase
          .from("client_tasks")
          .select("id, status")
          .eq("company_id", session.company_id)
          .eq("workspace_id", session.workspace_id),
      ]);

      const proposals = proposalsRes.data || [];
      const invoices = invoicesRes.data || [];
      const updates = updatesRes.data || [];
      const tasks = tasksRes.data || [];

      let proposals_awaiting = 0;
      for (const p of proposals) {
        const versions = (p as any).proposal_versions || [];
        if (versions.some((v: any) => v.status === "sent")) {
          proposals_awaiting++;
        }
      }

      const unpaidInvoices = invoices.filter(
        (i: any) => i.status !== "paid" && i.status !== "void"
      );
      const overdueInvoices = unpaidInvoices.filter(
        (i: any) => i.due_date && new Date(i.due_date) < new Date()
      );
      const totalOutstanding = unpaidInvoices.reduce(
        (sum: number, i: any) => sum + (Number(i.grand_total) - Number(i.amount_paid)),
        0
      );
      const currency = invoices.length > 0 ? (invoices[0] as any).currency || "BDT" : "BDT";
      const recentUpdateDate = updates.length > 0 ? (updates[0] as any).published_at : null;

      const onboarding_pending = tasks.filter(
        (t: any) => t.status === "todo" || t.status === "revision_requested"
      ).length;
      const onboarding_total = tasks.length;

      return jsonResponse({
        data: {
          proposals_awaiting,
          unpaid_invoices: unpaidInvoices.length,
          overdue_invoices: overdueInvoices.length,
          total_outstanding: totalOutstanding,
          currency,
          recent_updates: updates.length,
          recent_update_date: recentUpdateDate,
          onboarding_pending,
          onboarding_total,
        },
      }, 200, hdrs);
    }

    case "branding": {
      const { data: ws } = await supabase
        .from("workspaces")
        .select("name, portal_accent_color, portal_logo_storage_path, portal_support_email")
        .eq("id", session.workspace_id)
        .single();

      let logo_url: string | null = null;
      if (ws?.portal_logo_storage_path) {
        const { data: signedUrl } = await supabase.storage
          .from("workspace-files")
          .createSignedUrl(ws.portal_logo_storage_path, 3600);
        logo_url = signedUrl?.signedUrl || null;
      }

      return jsonResponse({
        data: {
          workspace_name: ws?.name || "",
          accent_color: ws?.portal_accent_color || null,
          logo_url,
          support_email: ws?.portal_support_email || null,
        },
      }, 200, hdrs);
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

      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        "portal_respond_proposal_internal",
        {
          _company_id: session.company_id,
          _workspace_id: session.workspace_id,
          _version_id: versionId,
          _action: decision,
        }
      );

      if (rpcErr) {
        return jsonResponse({ error: rpcErr.message || "Update failed" }, 500, hdrs);
      }

      const result = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult;
      if (!result.success) {
        return jsonResponse({ error: result.error }, 400, hdrs);
      }

      return jsonResponse({ success: true, new_status: decision }, 200, hdrs);
    }

    case "get_document_url": {
      const fileId = body.file_id as string;
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400, hdrs);

      const { data: file } = await supabase
        .from("files")
        .select("id, storage_path, owner_type, owner_id, workspace_id")
        .eq("id", fileId)
        .eq("workspace_id", session.workspace_id)
        .is("deleted_at", null)
        .single();

      if (!file) return jsonResponse({ error: "File not found" }, 404, hdrs);

      let authorized = false;
      if (file.owner_type === "company" && file.owner_id === session.company_id) {
        authorized = true;
      } else if (file.owner_type === "invoice") {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("company_id")
          .eq("id", file.owner_id)
          .eq("company_id", session.company_id)
          .single();
        authorized = !!invoice;
      }

      if (!authorized) {
        return jsonResponse({ error: "Access denied" }, 403, hdrs);
      }

      const { data: signedUrl, error: signErr } = await supabase.storage
        .from("workspace-files")
        .createSignedUrl(file.storage_path, 3600);

      if (signErr || !signedUrl) {
        return jsonResponse({ error: "Could not generate download link" }, 500, hdrs);
      }

      return jsonResponse({ url: signedUrl.signedUrl }, 200, hdrs);
    }

    case "submit_onboarding_task": {
      const taskId = body.task_id as string;
      if (!taskId) return jsonResponse({ error: "task_id required" }, 400, hdrs);

      // Verify the task belongs to this company
      const { data: task } = await supabase
        .from("client_tasks")
        .select("id, company_id, workspace_id, status")
        .eq("id", taskId)
        .single();

      if (!task || task.company_id !== session.company_id || task.workspace_id !== session.workspace_id) {
        return jsonResponse({ error: "Task not found" }, 404, hdrs);
      }

      if (task.status !== "todo" && task.status !== "revision_requested") {
        return jsonResponse({ error: "Task cannot be submitted in its current state" }, 400, hdrs);
      }

      const { error: updateErr } = await supabase
        .from("client_tasks")
        .update({
          status: "submitted",
          response_text: (body.response_text as string) || null,
          response_link: (body.response_link as string) || null,
          response_notes: (body.response_notes as string) || null,
          submitted_at: new Date().toISOString(),
          revision_note: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      if (updateErr) {
        return jsonResponse({ error: "Failed to submit" }, 500, hdrs);
      }

      return jsonResponse({ success: true }, 200, hdrs);
    }

    default:
      return jsonResponse({ error: "Unknown action" }, 400, hdrs);
  }
}
