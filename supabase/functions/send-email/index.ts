import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --------------- URL trust boundary ---------------

/**
 * Resolve the trusted application base URL.
 * Priority: APP_BASE_URL env var > validated Origin header.
 * Rejects untrusted origins to prevent phishing links in emails.
 */
function resolveBaseUrl(req: Request): string | null {
  // 1. Explicit server-side config (highest trust)
  const configured = Deno.env.get("APP_BASE_URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  // 2. Derive from request Origin header with strict validation
  const origin = req.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    return origin.replace(/\/+$/, "");
  }

  return null;
}

const ALLOWED_ORIGIN_PATTERNS = [
  // Lovable preview/published domains
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  // Custom domains (must be HTTPS)
  /^https:\/\/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/,
  // Local development
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Must be http or https
    if (!["http:", "https:"].includes(url.protocol)) return false;
    // Must match at least one pattern
    return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
  } catch {
    return false;
  }
}

// --------------- Main handler ---------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // ---- Auth verification ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Not authenticated" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ success: false, error: "Invalid auth" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { type, workspace_id } = body;

    if (!type || !workspace_id) {
      return jsonResponse(
        { success: false, error: "Missing type or workspace_id" },
        400
      );
    }

    // ---- Resolve trusted base URL ----
    const baseUrl = resolveBaseUrl(req);
    if (!baseUrl) {
      return jsonResponse(
        {
          success: false,
          status: "rejected",
          error:
            "Cannot determine a trusted application URL. Set the APP_BASE_URL secret to enable email sending.",
        },
        400
      );
    }

    // ---- Verify admin access ----
    const { data: membership } = await adminClient
      .from("workspace_memberships")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || membership.role !== "admin") {
      return jsonResponse(
        { success: false, error: "Admin access required" },
        403
      );
    }

    // ---- Lookup shared context ----
    const { data: workspace } = await adminClient
      .from("workspaces")
      .select("name")
      .eq("id", workspace_id)
      .single();
    const workspaceName = workspace?.name || "CoreFlow";

    const { data: profile } = await adminClient
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .single();
    const inviterName = profile?.full_name || "A team member";

    // ---- Build email based on type ----
    let recipientEmail: string;
    let subject: string;
    let htmlBody: string;
    let entityType: string;
    let entityId: string;

    if (type === "invite") {
      const { invite_id } = body;
      if (!invite_id) {
        return jsonResponse(
          { success: false, error: "Missing invite_id" },
          400
        );
      }

      const { data: invite } = await adminClient
        .from("workspace_invites")
        .select("email, token, role, status")
        .eq("id", invite_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (!invite) {
        return jsonResponse(
          { success: false, error: "Invite not found" },
          404
        );
      }
      if (invite.status !== "pending") {
        return jsonResponse({
          success: false,
          error: "Invite is no longer pending",
        });
      }

      recipientEmail = invite.email;
      // URL constructed server-side from trusted base + DB token
      const inviteUrl = `${baseUrl}/invite?token=${encodeURIComponent(invite.token)}`;
      const roleName = invite.role === "admin" ? "Admin" : "Team Member";

      subject = `You're invited to join ${workspaceName} on CoreFlow`;
      htmlBody = renderInviteEmail({
        workspaceName,
        inviterName,
        recipientEmail,
        inviteUrl,
        roleName,
      });
      entityType = "workspace_invite";
      entityId = invite_id;
    } else if (type === "portal") {
      const { contact_id, portal_token } = body;
      if (!contact_id || !portal_token) {
        return jsonResponse(
          { success: false, error: "Missing contact_id or portal_token" },
          400
        );
      }

      // Validate portal_token exists in DB for this workspace + contact
      const { data: tokenRow } = await adminClient
        .from("portal_tokens")
        .select("id, token, company_id, contact_id")
        .eq("workspace_id", workspace_id)
        .eq("contact_id", contact_id)
        .eq("token", portal_token)
        .is("revoked_at", null)
        .single();

      if (!tokenRow) {
        return jsonResponse(
          { success: false, error: "Portal token not found or revoked" },
          404
        );
      }

      const { data: contact } = await adminClient
        .from("contacts")
        .select("full_name, email, company_id")
        .eq("id", contact_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (!contact) {
        return jsonResponse(
          { success: false, error: "Contact not found" },
          404
        );
      }
      if (!contact.email) {
        return jsonResponse({
          success: false,
          error: "Contact has no email address",
        });
      }

      let companyName = "";
      if (contact.company_id) {
        const { data: company } = await adminClient
          .from("companies")
          .select("legal_name")
          .eq("id", contact.company_id)
          .single();
        companyName = company?.legal_name || "";
      }

      recipientEmail = contact.email;
      // URL constructed server-side from trusted base + validated DB token
      const portalUrl = `${baseUrl}/portal?token=${encodeURIComponent(tokenRow.token)}`;

      subject = `Your client portal access${companyName ? ` — ${companyName}` : ""}`;
      htmlBody = renderPortalEmail({
        contactName: contact.full_name,
        companyName,
        portalUrl,
        workspaceName,
      });
      entityType = "portal_token";
      entityId = contact_id;
    } else {
      return jsonResponse(
        { success: false, error: "Invalid email type. Use 'invite' or 'portal'." },
        400
      );
    }

    // ---- Send via Resend ----
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const senderEmail = Deno.env.get("SENDER_EMAIL") || "onboarding@resend.dev";
    const senderName = Deno.env.get("SENDER_NAME") || "CoreFlow";

    let status = "sent";
    let errorMessage: string | null = null;
    let providerMessageId: string | null = null;

    if (!resendKey) {
      status = "skipped";
      errorMessage =
        "Email sending is not configured yet. Add a RESEND_API_KEY secret to enable outbound email delivery.";
    } else {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${senderName} <${senderEmail}>`,
            to: [recipientEmail],
            subject,
            html: htmlBody,
          }),
        });

        const result = await res.json();
        if (!res.ok) {
          status = "failed";
          errorMessage =
            result.message || `Provider error (${res.status})`;
        } else {
          providerMessageId = result.id || null;
        }
      } catch (err) {
        status = "failed";
        errorMessage =
          err instanceof Error ? err.message : "Unknown send error";
      }
    }

    // ---- Log the attempt ----
    await adminClient.from("email_logs").insert({
      workspace_id,
      email_type: type,
      recipient_email: recipientEmail,
      subject,
      status,
      error_message: errorMessage,
      provider_message_id: providerMessageId,
      entity_type: entityType,
      entity_id: entityId,
      triggered_by: user.id,
    });

    if (status === "skipped") {
      return jsonResponse({
        success: false,
        status: "skipped",
        error: errorMessage,
      });
    }

    if (status === "failed") {
      return jsonResponse(
        { success: false, status: "failed", error: errorMessage },
        502
      );
    }

    return jsonResponse({
      success: true,
      status: "sent",
      provider_message_id: providerMessageId,
    });
  } catch (err) {
    console.error("send-email error:", err);
    return jsonResponse(
      {
        success: false,
        error: "Internal server error",
      },
      500
    );
  }
});

// ============================================================
// Email templates
// ============================================================

interface InviteTemplateData {
  workspaceName: string;
  inviterName: string;
  recipientEmail: string;
  inviteUrl: string;
  roleName: string;
}

function renderInviteEmail(d: InviteTemplateData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invitation to ${esc(d.workspaceName)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f5;padding:40px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%">
<tr><td style="padding:40px 32px">
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b">You're invited to join ${esc(d.workspaceName)}</h1>
  <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3f3f46">${esc(d.inviterName)} has invited you to collaborate on <strong>${esc(d.workspaceName)}</strong> as a <strong>${esc(d.roleName)}</strong>.</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#71717a">CoreFlow is where your team manages proposals, projects, invoices, and client relationships.</p>
  <table cellpadding="0" cellspacing="0" role="presentation"><tr><td style="border-radius:6px;background:#18181b">
    <a href="${esc(d.inviteUrl)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:6px">Accept Invitation</a>
  </td></tr></table>
  <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;word-break:break-all">Or copy this link:<br>${esc(d.inviteUrl)}</p>
</td></tr>
<tr><td style="padding:0 32px 32px">
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 16px">
  <p style="margin:0;font-size:12px;color:#a1a1aa">Sent by CoreFlow on behalf of ${esc(d.workspaceName)}. If you didn't expect this, you can safely ignore it.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

interface PortalTemplateData {
  contactName: string;
  companyName: string;
  portalUrl: string;
  workspaceName: string;
}

function renderPortalEmail(d: PortalTemplateData): string {
  const greeting = d.contactName ? `Hi ${esc(d.contactName)},` : "Hello,";
  const companyLine = d.companyName
    ? ` for <strong>${esc(d.companyName)}</strong>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Client Portal Access</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f5;padding:40px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%">
<tr><td style="padding:40px 32px">
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b">Your Client Portal Access</h1>
  <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3f3f46">${greeting}</p>
  <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3f3f46">You've been given access to a secure client portal${companyLine} where you can:</p>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;line-height:1.8;color:#3f3f46">
    <li>View and respond to proposals</li>
    <li>Check invoices and payment history</li>
    <li>Access project updates</li>
  </ul>
  <table cellpadding="0" cellspacing="0" role="presentation"><tr><td style="border-radius:6px;background:#18181b">
    <a href="${esc(d.portalUrl)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:6px">Open Portal</a>
  </td></tr></table>
  <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;word-break:break-all">Or copy this link:<br>${esc(d.portalUrl)}</p>
</td></tr>
<tr><td style="padding:0 32px 32px">
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 16px">
  <p style="margin:0;font-size:12px;color:#a1a1aa">Sent by ${esc(d.workspaceName)} via CoreFlow. This link is unique to you — please do not forward it.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
