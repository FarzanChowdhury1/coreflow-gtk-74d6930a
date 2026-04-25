// One-off backend regression test for the manual payment-proof settlement pipeline.
// SECURITY: This function MUST only run in the disposable regression workspace.
// It uses the service-role key but explicitly impersonates a workspace admin
// (Farzan) for accept/reject RPC calls so auth.uid() resolves correctly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REGRESSION_WS = "23860f1b-546a-498e-afcc-f47c03502b4d";
const ADMIN_USER    = "53298133-37ba-4420-b45a-9dbdf0cf4a01";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, svc);
  const results: any[] = [];
  const note = (step: string, ok: boolean, detail: any) => results.push({ step, ok, detail });

  try {
    // diagnostics: list all workspaces visible to this DB
    const { data: ws } = await sb.from("workspaces").select("id, name, deleted_at").order("name");
    note("all_workspaces", true, ws);
    return new Response(JSON.stringify({ ok: true, diagnostic: true, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // unreachable below — kept for the full pipeline run
    // deno-lint-ignore no-unreachable
    const co: any = { id: "" };

    const ts = new Date().toISOString().slice(11,19).replace(/:/g,"");

    // seed two invoices
    const { data: invs, error: invErr } = await sb.from("invoices").insert([
      { workspace_id: REGRESSION_WS, company_id: co.id, invoice_number: `REG-PROOF-A-${ts}`,
        status: "issued", issue_date: new Date().toISOString().slice(0,10),
        currency: "BDT", subtotal: 3000, tax_total: 0, grand_total: 3000, amount_paid: 0 },
      { workspace_id: REGRESSION_WS, company_id: co.id, invoice_number: `REG-PROOF-B-${ts}`,
        status: "issued", issue_date: new Date().toISOString().slice(0,10),
        currency: "BDT", subtotal: 2000, tax_total: 0, grand_total: 2000, amount_paid: 0 },
    ]).select("id, invoice_number");
    if (invErr) throw new Error("seed invoices: " + (invErr as any)?.message);
    const invA = invs![0].id, invB = invs![1].id;
    note("seed_invoices", true, { invA, invB });

    // seed three submissions
    const { data: subs, error: sErr } = await sb.from("payment_proof_submissions").insert([
      { workspace_id: REGRESSION_WS, invoice_id: invA, submitted_by_name: "Test Client",
        submitted_by_email: "client@test.local", declared_amount: 3000,
        declared_method: "bank_transfer", declared_reference: "BACKEND-A",
        notes: "happy path", file_path: `${REGRESSION_WS}/${invA}/proof-a.pdf`,
        original_filename: "proof-a.pdf", mime_type: "application/pdf", size_bytes: 1024,
        status: "pending" },
      { workspace_id: REGRESSION_WS, invoice_id: invB, submitted_by_name: "Test Client",
        submitted_by_email: "client@test.local", declared_amount: 2000,
        declared_method: "bkash_manual", declared_reference: "BACKEND-B",
        notes: "reject path", file_path: `${REGRESSION_WS}/${invB}/proof-b.jpg`,
        original_filename: "proof-b.jpg", mime_type: "image/jpeg", size_bytes: 2048,
        status: "pending" },
      { workspace_id: REGRESSION_WS, invoice_id: invB, submitted_by_name: "Test Client",
        submitted_by_email: "client@test.local", declared_amount: 500,
        declared_method: "cash", declared_reference: "BACKEND-C",
        notes: "partial path", file_path: `${REGRESSION_WS}/${invB}/proof-c.png`,
        original_filename: "proof-c.png", mime_type: "image/png", size_bytes: 512,
        status: "pending" },
    ]).select("id");
    if (sErr) throw new Error("seed submissions: " + (sErr as any)?.message);
    const [sub1, sub2, sub3] = subs!.map((r:any)=>r.id);
    note("seed_submissions", true, { sub1, sub2, sub3 });

    // helper: call accept/reject RPC as the admin via PostgREST with a forged JWT-like header.
    // Service role can call RPCs; SECURITY DEFINER funcs read auth.uid() from request.jwt.claim.sub.
    // We pass it via x-supabase-auth-uid emulation by issuing the RPC under a session that sets
    // the claim. The supabase-js client honours the Authorization header; we mint a JWT by signing
    // a payload with the JWT secret. Simpler: use a stored proc wrapper; but we don't have one.
    // Instead, issue a raw SQL call through the REST `/rest/v1/rpc/<fn>` with both apikey and a
    // service_role authorization, then set the claim by calling sb.rpc with `setAuth(adminJwt)`.
    // We synthesize a short-lived JWT for the admin user using the JWT secret.

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) throw new Error("SUPABASE_JWT_SECRET not configured");

    // Mint HS256 JWT for admin
    const enc = new TextEncoder();
    const b64u = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const header = b64u(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));
    const now = Math.floor(Date.now()/1000);
    const payload = b64u(enc.encode(JSON.stringify({
      sub: ADMIN_USER, role: "authenticated", aud: "authenticated",
      iat: now, exp: now + 300,
    })));
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)));
    const adminJwt = `${header}.${payload}.${b64u(sig)}`;

    const sbAdmin = createClient(url, svc, {
      global: { headers: { Authorization: `Bearer ${adminJwt}` } },
    });

    // 1. Accept sub1 (happy)
    {
      const { data, error } = await sbAdmin.rpc("accept_payment_proof", { _submission_id: sub1 });
      note("accept_sub1", !error && !!data, { data, error: error?.message });
    }
    {
      const { data: inv } = await sb.from("invoices").select("status, amount_paid").eq("id", invA).single();
      note("recompute_inv_a", inv?.status === "paid" && Number(inv?.amount_paid) === 3000, inv);
    }

    // 2. Reject sub2
    {
      const { error } = await sbAdmin.rpc("reject_payment_proof", { _submission_id: sub2, _reason: "amount mismatch" });
      note("reject_sub2", !error, { error: error?.message });
    }
    {
      const { data: inv } = await sb.from("invoices").select("status, amount_paid").eq("id", invB).single();
      note("inv_b_after_reject", inv?.status === "issued" && Number(inv?.amount_paid) === 0, inv);
    }

    // 3. Duplicate accept guard
    {
      const { data, error } = await sbAdmin.rpc("accept_payment_proof", { _submission_id: sub1 });
      note("dup_accept_sub1", !!error && !data, { blocked_by: error?.message });
    }

    // 4. Accept-after-reject guard
    {
      const { data, error } = await sbAdmin.rpc("accept_payment_proof", { _submission_id: sub2 });
      note("accept_after_reject_sub2", !!error && !data, { blocked_by: error?.message });
    }

    // 5. Partial accept (sub3)
    {
      const { data, error } = await sbAdmin.rpc("accept_payment_proof", { _submission_id: sub3 });
      note("accept_sub3", !error && !!data, { data, error: error?.message });
    }
    {
      const { data: inv } = await sb.from("invoices").select("status, amount_paid").eq("id", invB).single();
      note("recompute_inv_b", inv?.status === "partially_paid" && Number(inv?.amount_paid) === 500, inv);
    }

    // 6. Submission isolation
    {
      const { data: s } = await sb.from("payment_proof_submissions")
        .select("status, payment_id").eq("id", sub2).single();
      note("sub2_isolation", s?.status === "rejected" && s?.payment_id === null, s);
    }

    // 7. Audit coverage
    const { data: audit } = await sb.from("audit_logs")
      .select("action, entity_type, entity_id")
      .eq("workspace_id", REGRESSION_WS)
      .gte("created_at", new Date(Date.now()-5*60*1000).toISOString());
    note("audit_rows", (audit?.length ?? 0) > 0, { count: audit?.length, sample: audit?.slice(0,5) });

    return new Response(JSON.stringify({ ok: true, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), results }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
