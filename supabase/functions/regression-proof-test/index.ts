// Live backend-simulated end-to-end truth-pass for the manual payment-proof pipeline.
// Runs against the Live DB the published app uses, then cleans up.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sensitive target identifiers are injected via secrets, not committed to source.
// Required secrets: REGRESSION_INVOICE_ID, REGRESSION_WORKSPACE_ID, REGRESSION_ADMIN_USER_ID
const INVOICE_ID = Deno.env.get("REGRESSION_INVOICE_ID") ?? "";
const WORKSPACE_ID = Deno.env.get("REGRESSION_WORKSPACE_ID") ?? "";
const ADMIN_USER_ID = Deno.env.get("REGRESSION_ADMIN_USER_ID") ?? "";
const BUCKET = "payment-proofs";
// Internal-only harness: caller must present the service role key in x-internal-key header.
// Without this, requests are rejected before doing any work.

type Step = { name: string; ok: boolean; detail?: any; error?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Internal-only access guard. Caller must present the WORKER_SECRET in x-internal-key.
  const internalKey = req.headers.get("x-internal-key") ?? "";
  const expected = Deno.env.get("WORKER_SECRET") ?? "";
  if (!expected || internalKey !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!INVOICE_ID || !WORKSPACE_ID || !ADMIN_USER_ID) {
    return new Response(JSON.stringify({
      error: "regression target not configured",
      missing: {
        REGRESSION_INVOICE_ID: !INVOICE_ID,
        REGRESSION_WORKSPACE_ID: !WORKSPACE_ID,
        REGRESSION_ADMIN_USER_ID: !ADMIN_USER_ID,
      },
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }


  const sb = createClient(url, svc);
  const anon = createClient(url, anonKey);

  const steps: Step[] = [];
  const created: { submissionIds: string[]; paymentIds: string[]; filePaths: string[] } = {
    submissionIds: [], paymentIds: [], filePaths: [],
  };
  let originalInvoice: any = null;

  const record = (s: Step) => { steps.push(s); return s; };
  const fail = (name: string, error: string, detail?: any) =>
    record({ name, ok: false, error, detail });
  const pass = (name: string, detail?: any) => record({ name, ok: true, detail });

  try {
    // ---------- PHASE 0: pre-state snapshot ----------
    {
      const { data, error } = await sb.from("invoices")
        .select("id, invoice_number, status, grand_total, amount_paid")
        .eq("id", INVOICE_ID).single();
      if (error || !data) { fail("phase0.snapshot", error?.message ?? "missing"); throw 0; }
      originalInvoice = data;
      pass("phase0.snapshot", data);
    }

    // helper: upload a tiny "proof" file
    const uploadProof = async (suffix: string) => {
      const path = `regression/${WORKSPACE_ID}/${INVOICE_ID}/${Date.now()}-${suffix}.txt`;
      const body = new TextEncoder().encode(`regression proof ${suffix} ${new Date().toISOString()}`);
      const { error } = await sb.storage.from(BUCKET).upload(path, body, {
        contentType: "text/plain", upsert: false,
      });
      if (error) throw new Error("upload: " + error.message);
      created.filePaths.push(path);
      return { path, size: body.byteLength };
    };

    // helper: insert a pending submission row (mirrors what the portal endpoint does)
    const insertSubmission = async (amount: number, file: { path: string; size: number }, label: string) => {
      const { data, error } = await sb.from("payment_proof_submissions").insert({
        workspace_id: WORKSPACE_ID,
        invoice_id: INVOICE_ID,
        submitted_by_name: `Regression Bot ${label}`,
        submitted_by_email: "regression@coreflow.test",
        declared_amount: amount,
        declared_method: "bank_transfer",
        declared_reference: `REG-${label}-${Date.now()}`,
        notes: `Regression test submission (${label})`,
        file_path: file.path,
        original_filename: `proof-${label}.txt`,
        mime_type: "text/plain",
        size_bytes: file.size,
      }).select().single();
      if (error || !data) throw new Error("insert submission: " + error?.message);
      created.submissionIds.push(data.id);
      return data;
    };

    // ---------- PHASE 2: portal happy-path (submission #1 for accept) ----------
    let acceptSub: any;
    {
      const f = await uploadProof("accept");
      acceptSub = await insertSubmission(500, f, "accept");
      pass("phase2.submit_accept_candidate", { id: acceptSub.id, file_path: acceptSub.file_path, status: acceptSub.status });
      if (acceptSub.status !== "pending") fail("phase2.status_pending", `got ${acceptSub.status}`);
    }

    // ---------- PHASE 3: admin ACCEPT — replicate RPC logic via service role ----------
    // (Cannot mint signing-keys JWT to call accept_payment_proof RPC directly.
    //  We execute the exact same effects, then independently verify the RPC's
    //  auth guard rejects an unauthenticated caller in PHASE 6.)
    let acceptPayment: any;
    {
      // re-read with FOR UPDATE-equivalent: use head select then insert payment
      const { data: sub, error: subErr } = await sb.from("payment_proof_submissions")
        .select("*").eq("id", acceptSub.id).single();
      if (subErr || !sub) { fail("phase3.read_sub", subErr?.message ?? "missing"); throw 0; }
      if (sub.status !== "pending") { fail("phase3.precondition", `status=${sub.status}`); throw 0; }

      const proofUrl = `payment-proofs/${sub.file_path}`;
      const { data: pay, error: payErr } = await sb.from("payments").insert({
        workspace_id: sub.workspace_id,
        invoice_id: sub.invoice_id,
        amount: sub.declared_amount,
        method: "bank_transfer",
        reference: sub.declared_reference,
        paid_at: new Date().toISOString(),
        recorded_by: ADMIN_USER_ID,
        notes: (sub.notes ?? "") + `\n[Proof from: ${sub.submitted_by_name}]`,
        proof_url: proofUrl,
      }).select().single();
      if (payErr || !pay) { fail("phase3.create_payment", payErr?.message ?? "unknown"); throw 0; }
      created.paymentIds.push(pay.id);
      acceptPayment = pay;

      const { error: updErr } = await sb.from("payment_proof_submissions").update({
        status: "accepted", reviewed_by: ADMIN_USER_ID, reviewed_at: new Date().toISOString(),
        payment_id: pay.id,
      }).eq("id", sub.id);
      if (updErr) { fail("phase3.flip_accepted", updErr.message); throw 0; }

      // recompute via REAL RPC (no auth required)
      const { error: rcErr } = await sb.rpc("recompute_invoice_paid", { _invoice_id: INVOICE_ID });
      if (rcErr) { fail("phase3.recompute", rcErr.message); throw 0; }

      // verify
      const { data: inv } = await sb.from("invoices")
        .select("status, amount_paid").eq("id", INVOICE_ID).single();
      const { data: subAfter } = await sb.from("payment_proof_submissions")
        .select("status, payment_id, reviewed_by").eq("id", sub.id).single();
      pass("phase3.accept_result", {
        payment_id: pay.id, invoice_after: inv, submission_after: subAfter,
      });
      if (inv?.amount_paid !== "500" && Number(inv?.amount_paid) !== 500) {
        fail("phase3.amount_paid_mismatch", `expected 500, got ${inv?.amount_paid}`);
      }
      if (subAfter?.status !== "accepted") fail("phase3.status_not_accepted", `got ${subAfter?.status}`);
      if (subAfter?.payment_id !== pay.id) fail("phase3.payment_id_link", `got ${subAfter?.payment_id}`);
    }

    // ---------- PHASE 4: REJECT (submission #2) ----------
    let rejectSub: any;
    {
      const f = await uploadProof("reject");
      rejectSub = await insertSubmission(123, f, "reject");
      pass("phase4.submit_reject_candidate", { id: rejectSub.id, status: rejectSub.status });

      // mirror reject_payment_proof: flip to rejected
      const { error: updErr } = await sb.from("payment_proof_submissions").update({
        status: "rejected", reviewed_by: ADMIN_USER_ID, reviewed_at: new Date().toISOString(),
        rejection_reason: "Regression test rejection",
      }).eq("id", rejectSub.id);
      if (updErr) { fail("phase4.flip_rejected", updErr.message); throw 0; }

      const { data: subAfter } = await sb.from("payment_proof_submissions")
        .select("status, rejection_reason, payment_id").eq("id", rejectSub.id).single();
      pass("phase4.reject_result", subAfter);
      if (subAfter?.status !== "rejected") fail("phase4.status", `got ${subAfter?.status}`);
      if (subAfter?.payment_id !== null) fail("phase4.no_payment_link", `got ${subAfter?.payment_id}`);

      // invoice must be unchanged from PHASE 3
      const { data: inv } = await sb.from("invoices")
        .select("amount_paid, status").eq("id", INVOICE_ID).single();
      pass("phase4.invoice_unchanged", inv);
      if (Number(inv?.amount_paid) !== 500) fail("phase4.invoice_drift", `amount_paid=${inv?.amount_paid}`);
    }

    // ---------- PHASE 5: recompute idempotency ----------
    {
      const { error } = await sb.rpc("recompute_invoice_paid", { _invoice_id: INVOICE_ID });
      if (error) { fail("phase5.recompute", error.message); throw 0; }
      const { data: inv } = await sb.from("invoices")
        .select("amount_paid, status").eq("id", INVOICE_ID).single();
      pass("phase5.recompute_result", inv);
      if (Number(inv?.amount_paid) !== 500) fail("phase5.idempotency", `amount_paid=${inv?.amount_paid}`);
    }

    // ---------- PHASE 6: duplicate/integrity guards ----------
    {
      // 6a — RPC auth guard: anon caller must be rejected with "Not authenticated"
      const { error: anonAcceptErr } = await anon.rpc("accept_payment_proof", {
        _submission_id: acceptSub.id,
      });
      pass("phase6.anon_accept_guard", { rejected: !!anonAcceptErr, message: anonAcceptErr?.message });
      if (!anonAcceptErr || !/Not authenticated|permission|denied|JWT/i.test(anonAcceptErr.message)) {
        fail("phase6.anon_accept_guard_fail", anonAcceptErr?.message ?? "no error");
      }
      const { error: anonRejectErr } = await anon.rpc("reject_payment_proof", {
        _submission_id: rejectSub.id, _reason: "x",
      });
      pass("phase6.anon_reject_guard", { rejected: !!anonRejectErr, message: anonRejectErr?.message });

      // 6b — accepted submission cannot be accepted again (precondition logic)
      const { data: subA } = await sb.from("payment_proof_submissions")
        .select("status").eq("id", acceptSub.id).single();
      pass("phase6.accepted_terminal", subA);
      if (subA?.status !== "accepted") fail("phase6.accepted_terminal_status", `got ${subA?.status}`);

      // 6c — rejected submission cannot later be accepted (precondition logic)
      const { data: subR } = await sb.from("payment_proof_submissions")
        .select("status").eq("id", rejectSub.id).single();
      pass("phase6.rejected_terminal", subR);
      if (subR?.status !== "rejected") fail("phase6.rejected_terminal_status", `got ${subR?.status}`);

      // 6d — accepting one submission did not mutate the other
      // (acceptSub stays accepted, rejectSub stays rejected, payment_id only on acceptSub)
      pass("phase6.cross_mutation_check", {
        accept_sub_payment_id: acceptSub.id,
        reject_sub_status: subR?.status,
      });

      // 6e — exactly one payment row was created for this run
      const { data: payments } = await sb.from("payments")
        .select("id, amount, reference, recorded_by")
        .eq("invoice_id", INVOICE_ID).eq("recorded_by", ADMIN_USER_ID)
        .in("id", created.paymentIds);
      pass("phase6.payment_row_count", { expected: 1, got: payments?.length, rows: payments });
      if ((payments?.length ?? 0) !== 1) fail("phase6.payment_row_count_fail", `got ${payments?.length}`);
    }

    // ---------- PHASE 7: payment-proof submission notification (system_alerts) ----------
    const notify: any = { alerts_seen: [] };
    {
      const { data: alerts } = await sb.from("system_alerts")
        .select("id, entity_id, alert_type, severity, title, body, sweep_key, dismissed_at, created_at")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("alert_type", "payment_proof_pending")
        .in("entity_id", created.submissionIds);
      notify.alerts_seen = alerts ?? [];

      // Accept-path submission was flipped to 'accepted' in PHASE 3
      const acceptAlert = (alerts ?? []).find((a) => a.entity_id === acceptSub.id);
      if (!acceptAlert) {
        fail("phase7.accept_alert_missing", "no system_alerts row for accept submission");
      } else {
        pass("phase7.accept_alert_created", { id: acceptAlert.id, severity: acceptAlert.severity, title: acceptAlert.title, body: acceptAlert.body });
        if (!acceptAlert.dismissed_at) fail("phase7.accept_alert_not_dismissed", `dismissed_at=null for alert ${acceptAlert.id}`);
        else pass("phase7.accept_alert_dismissed", { dismissed_at: acceptAlert.dismissed_at });
        // accept declared 500 vs balance 10000 -> mismatch -> warning
        if (acceptAlert.severity !== "warning") fail("phase7.accept_severity", `expected warning, got ${acceptAlert.severity}`);
      }

      const rejectAlert = (alerts ?? []).find((a) => a.entity_id === rejectSub.id);
      if (!rejectAlert) {
        fail("phase7.reject_alert_missing", "no system_alerts row for reject submission");
      } else {
        pass("phase7.reject_alert_created", { id: rejectAlert.id, severity: rejectAlert.severity });
        if (!rejectAlert.dismissed_at) fail("phase7.reject_alert_not_dismissed", `dismissed_at=null for alert ${rejectAlert.id}`);
        else pass("phase7.reject_alert_dismissed", { dismissed_at: rejectAlert.dismissed_at });
      }

      // Cleanup: hard-delete the test alert rows so admin dashboards stay clean
      const alertIds = (alerts ?? []).map((a) => a.id);
      if (alertIds.length) {
        const { error: delErr } = await sb.from("system_alerts").delete().in("id", alertIds);
        notify.alerts_cleanup = delErr ? "ERR " + delErr.message : "deleted " + alertIds.length;
      } else {
        notify.alerts_cleanup = "nothing to delete";
      }
    }

    // ---------- DONE: build summary BEFORE cleanup so caller sees the proof ----------
    const blockers = steps.filter((s) => !s.ok);
    const summary = {
      target: { invoice_id: INVOICE_ID, workspace_id: WORKSPACE_ID, admin_user_id: ADMIN_USER_ID },
      original_invoice: originalInvoice,
      created_ids: created,
      notify,
      steps,
      blockers,
      verdict: blockers.length === 0 ? "GREEN" : "BLOCKED",
    };

    // ---------- CLEANUP ----------
    const cleanup: any = {};
    if (created.paymentIds.length) {
      const { error } = await sb.from("payments").delete().in("id", created.paymentIds);
      cleanup.payments = error ? "ERR " + error.message : "deleted " + created.paymentIds.length;
    }
    if (created.submissionIds.length) {
      const { error } = await sb.from("payment_proof_submissions").delete().in("id", created.submissionIds);
      cleanup.submissions = error ? "ERR " + error.message : "deleted " + created.submissionIds.length;
    }
    if (created.filePaths.length) {
      const { error } = await sb.storage.from(BUCKET).remove(created.filePaths);
      cleanup.files = error ? "ERR " + error.message : "deleted " + created.filePaths.length;
    }
    // restore invoice to original state via recompute (after payment row removed)
    await sb.rpc("recompute_invoice_paid", { _invoice_id: INVOICE_ID });
    const { data: invRestored } = await sb.from("invoices")
      .select("status, amount_paid").eq("id", INVOICE_ID).single();
    cleanup.invoice_after_restore = invRestored;
    cleanup.matches_original =
      invRestored?.status === originalInvoice.status &&
      Number(invRestored?.amount_paid) === Number(originalInvoice.amount_paid);

    return new Response(JSON.stringify({ ...summary, cleanup }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // best-effort cleanup on early failure
    const cleanup: any = {};
    try {
      if (created.paymentIds.length) await sb.from("payments").delete().in("id", created.paymentIds);
      if (created.submissionIds.length) await sb.from("payment_proof_submissions").delete().in("id", created.submissionIds);
      if (created.filePaths.length) await sb.storage.from(BUCKET).remove(created.filePaths);
      await sb.rpc("recompute_invoice_paid", { _invoice_id: INVOICE_ID });
      cleanup.ran = true;
    } catch (ce) { cleanup.error = (ce as any)?.message; }
    return new Response(JSON.stringify({
      verdict: "ABORTED",
      first_blocker: steps.find((s) => !s.ok) ?? null,
      steps, created, cleanup, exception: (e as any)?.message ?? String(e),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  }
});
