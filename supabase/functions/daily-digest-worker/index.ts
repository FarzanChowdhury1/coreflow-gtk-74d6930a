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

    // 1. Run all sweeps first (DB-heavy, via RPC)
    const [overdueRes, followupRes, renewalRes] = await Promise.all([
      supabase.rpc("sweep_overdue_invoices"),
      supabase.rpc("sweep_lead_followups"),
      supabase.rpc("sweep_renewal_reminders"),
    ]);

    // 2. Aggregate digest payload
    const { data: digest, error: digestErr } = await supabase.rpc(
      "aggregate_daily_digest"
    );
    if (digestErr) throw digestErr;

    // 3. For each workspace with actionable items, create a notification
    //    for admin users (WhatsApp-ready digest record)
    const workspaces = Array.isArray(digest) ? digest : [];
    let notified = 0;

    for (const ws of workspaces) {
      const hasOverdue =
        Array.isArray(ws.overdue_invoices) && ws.overdue_invoices.length > 0;
      const hasFollowups =
        Array.isArray(ws.overdue_followups) && ws.overdue_followups.length > 0;
      const hasRenewals =
        Array.isArray(ws.upcoming_renewals) && ws.upcoming_renewals.length > 0;

      if (!hasOverdue && !hasFollowups && !hasRenewals) continue;

      // Build digest body
      const parts: string[] = [];
      if (hasOverdue)
        parts.push(`${ws.overdue_invoices.length} overdue invoice(s)`);
      if (hasFollowups)
        parts.push(`${ws.overdue_followups.length} lead follow-up(s) due`);
      if (hasRenewals)
        parts.push(
          `${ws.upcoming_renewals.length} project(s) ending within 7 days`
        );

      const body = parts.join(", ");

      // Get admin users for this workspace
      const { data: admins } = await supabase
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", ws.workspace_id)
        .eq("role", "admin");

      if (admins) {
        for (const admin of admins) {
          await supabase.from("notifications").insert({
            workspace_id: ws.workspace_id,
            user_id: admin.user_id,
            title: "Daily Digest",
            body,
            link: "/dashboard",
          });
          notified++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sweeps: {
          overdue: overdueRes.data,
          followups: followupRes.data,
          renewals: renewalRes.data,
        },
        digest_workspaces: workspaces.length,
        notifications_sent: notified,
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
