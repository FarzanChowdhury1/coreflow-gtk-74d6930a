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
    // 1. Run all DB-heavy sweeps via RPC
    const [overdueRes, followupRes, renewalRes] = await Promise.all([
      supabase.rpc("sweep_overdue_invoices"),
      supabase.rpc("sweep_lead_followups"),
      supabase.rpc("sweep_renewal_reminders"),
    ]);

    // 2. Aggregate digest payload from RPC
    const { data: digest, error: digestErr } = await supabase.rpc(
      "aggregate_daily_digest"
    );
    if (digestErr) throw digestErr;

    const workspaces = Array.isArray(digest) ? digest : [];
    const dispatchPayloads: any[] = [];

    for (const ws of workspaces) {
      const overdueInvoices = Array.isArray(ws.overdue_invoices) ? ws.overdue_invoices : [];
      const overdueFollowups = Array.isArray(ws.overdue_followups) ? ws.overdue_followups : [];
      const upcomingRenewals = Array.isArray(ws.upcoming_renewals) ? ws.upcoming_renewals : [];

      if (overdueInvoices.length === 0 && overdueFollowups.length === 0 && upcomingRenewals.length === 0) continue;

      // Generate short_links for portal-facing invoice items
      const invoiceItems = [];
      for (const inv of overdueInvoices) {
        const portalUrl = `${supabaseUrl}/portal?invoice=${inv.invoice_id}`;
        const { data: sl } = await supabase.rpc("create_short_link", {
          _workspace_id: ws.workspace_id,
          _target_url: portalUrl,
          _context_type: "digest",
          _context_id: inv.invoice_id,
          _ttl_days: 30,
        });
        invoiceItems.push({
          invoice_number: inv.invoice_number,
          company: inv.company,
          due_date: inv.due_date,
          outstanding: inv.outstanding,
          short_link_code: sl?.code || null,
        });
      }

      // Build structured WhatsApp-template-ready payload
      const payload = {
        workspace_id: ws.workspace_id,
        workspace_name: ws.workspace_name,
        generated_at: new Date().toISOString(),
        template: "daily_digest_v1",
        sections: {
          overdue_invoices: {
            count: invoiceItems.length,
            items: invoiceItems,
          },
          lead_followups: {
            count: overdueFollowups.length,
            items: overdueFollowups.map((l: any) => ({
              title: l.title,
              company: l.company,
              due_since: l.next_follow_up,
            })),
          },
          upcoming_renewals: {
            count: upcomingRenewals.length,
            items: upcomingRenewals.map((r: any) => ({
              label: r.label,
              company: r.company,
              amount: `${r.currency} ${r.amount}`,
              next_billing_date: r.next_billing_date,
            })),
          },
        },
      };

      dispatchPayloads.push(payload);

      // Also insert a notification for workspace admins
      const { data: admins } = await supabase
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", ws.workspace_id)
        .eq("role", "admin");

      const summary = [
        invoiceItems.length > 0 ? `${invoiceItems.length} overdue invoice(s)` : null,
        overdueFollowups.length > 0 ? `${overdueFollowups.length} lead follow-up(s) due` : null,
        upcomingRenewals.length > 0 ? `${upcomingRenewals.length} renewal(s) approaching` : null,
      ].filter(Boolean).join(", ");

      if (admins) {
        for (const admin of admins) {
          await supabase.from("notifications").insert({
            workspace_id: ws.workspace_id,
            user_id: admin.user_id,
            title: "Daily Digest",
            body: summary,
            link: "/dashboard",
          });
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Best-effort worker run log
    try {
      await supabase.from("worker_runs").insert({
        worker_name: "daily_digest",
        status: "success",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        summary: {
          sweeps: {
            overdue: overdueRes.data,
            followups: followupRes.data,
            renewals: renewalRes.data,
          },
          workspaces_with_items: dispatchPayloads.length,
          total_workspaces: workspaces.length,
        },
      });
    } catch (_logErr) {
      console.warn("Failed to log worker run:", _logErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sweeps: {
          overdue: overdueRes.data,
          followups: followupRes.data,
          renewals: renewalRes.data,
        },
        dispatch_payloads: dispatchPayloads,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (_err) {
    const durationMs = Date.now() - startTime;
    const errMsg = String(_err).slice(0, 500);

    // Best-effort failure log
    try {
      await supabase.from("worker_runs").insert({
        worker_name: "daily_digest",
        status: "failed",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: errMsg,
      });
    } catch (_logErr) {
      console.warn("Failed to log worker failure:", _logErr);
    }

    // Best-effort failure alert to admins
    try {
      await supabase.rpc("create_worker_failure_alert", {
        _worker_name: "daily_digest",
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
