// Read-only Phase-0 probe against the Live DB the published app uses.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, svc);

  const probe: any = { url, checks: {} };

  // 1. payment_proof_submissions table
  const { error: tErr, count: tCount } = await sb
    .from("payment_proof_submissions").select("*", { count: "exact", head: true });
  probe.checks.table_payment_proof_submissions = {
    exists: !tErr, error: tErr?.message, row_count: tCount,
  };

  // 2. payment-proofs storage bucket
  const { data: bucket, error: bErr } = await sb.storage.getBucket("payment-proofs");
  probe.checks.bucket_payment_proofs = {
    exists: !bErr && !!bucket, error: bErr?.message, public: bucket?.public,
  };

  // 3. RPCs (call with a bogus uuid; we only care whether the function is found)
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const probeRpc = async (name: string, args: any) => {
    const { error } = await sb.rpc(name, args);
    return {
      exists: !error || !/Could not find the function|does not exist/i.test(error.message),
      reached_with_error: error?.message ?? null,
    };
  };
  probe.checks.rpc_accept_payment_proof   = await probeRpc("accept_payment_proof",   { _submission_id: fakeId });
  probe.checks.rpc_reject_payment_proof   = await probeRpc("reject_payment_proof",   { _submission_id: fakeId, _reason: "x" });
  probe.checks.rpc_recompute_invoice_paid = await probeRpc("recompute_invoice_paid", { _invoice_id: fakeId });

  // 4. Workspace inventory (so we know which workspace to use for any future Live test)
  const { data: ws } = await sb.from("workspaces")
    .select("id, name, deleted_at").is("deleted_at", null).order("name");
  probe.checks.live_active_workspaces = ws;

  // 5. Disposable invoice candidate inventory (any invoice with outstanding balance)
  const { data: invs } = await sb.from("invoices")
    .select("id, invoice_number, workspace_id, status, grand_total, amount_paid, currency")
    .is("deleted_at", null)
    .in("status", ["issued", "partially_paid"])
    .order("created_at", { ascending: false }).limit(10);
  probe.checks.candidate_invoices_with_balance = invs;

  return new Response(JSON.stringify(probe, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
