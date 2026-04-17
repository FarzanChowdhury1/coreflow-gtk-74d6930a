// Provider-abstracted bill/receipt extraction (staged pipeline).
//
// Pipeline:
//   1. classify     → doc_type / language / layout (cheap call)
//   2. strategy     → choose model based on classification
//   3. extract      → vision call returns normalized internal schema only
//   4. validate     → server-side checks; downgrade confidence on conflicts
//
// Endpoints:
//   POST { action: "start", job_id }
//   POST { action: "retry", job_id }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FAST_MODEL = "google/gemini-2.5-flash";
const STRONG_MODEL = "google/gemini-2.5-pro";
const CLASSIFIER_MODEL = "google/gemini-2.5-flash-lite";
const MAX_RETRIES = 3;
const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Internal normalized schema ----------
interface NormalizedExtraction {
  vendor_name: string | null;
  invoice_or_receipt_number: string | null;
  customer_or_account_number: string | null;
  expense_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  amount_subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: "paid" | "unpaid" | null;
  category: string | null;
  notes: string | null;
  raw_text: string | null;
  evidence: Record<string, string>;
  field_confidence: Record<string, number>;
  overall_confidence: number;
  warnings: string[];
}

interface ValidatorOutput {
  total_check: "ok" | "mismatch" | "unknown";
  date_check: "ok" | "implausible" | "unknown";
  currency_check: "ok" | "unknown";
  payment_status_check: "evidenced" | "stripped" | "unknown";
  hallucination_flags: string[];
  confidence_adjustments: Record<string, number>;
  rejected_fields: string[];
}

const ALLOWED_CATEGORIES = [
  "general", "salary", "rent", "utilities", "software", "marketing",
  "travel", "equipment", "consulting", "media_buying", "logistics", "other",
];

// ---------- BD vendor heuristics (rules layer, no fake values) ----------
const BD_VENDOR_PATTERNS: Array<{ pattern: RegExp; canonical: string; defaultCategory: string }> = [
  { pattern: /\b(desco|dhaka\s+electric)\b/i, canonical: "DESCO", defaultCategory: "utilities" },
  { pattern: /\b(dpdc|dhaka\s+power)\b/i, canonical: "DPDC", defaultCategory: "utilities" },
  { pattern: /\b(wasa)\b/i, canonical: "Dhaka WASA", defaultCategory: "utilities" },
  { pattern: /\b(titas\s+gas|titas)\b/i, canonical: "Titas Gas", defaultCategory: "utilities" },
  { pattern: /\b(btcl)\b/i, canonical: "BTCL", defaultCategory: "utilities" },
  { pattern: /\b(grameenphone|gp)\b/i, canonical: "Grameenphone", defaultCategory: "utilities" },
  { pattern: /\b(robi|airtel)\b/i, canonical: "Robi", defaultCategory: "utilities" },
  { pattern: /\b(banglalink)\b/i, canonical: "Banglalink", defaultCategory: "utilities" },
  { pattern: /\b(teletalk)\b/i, canonical: "Teletalk", defaultCategory: "utilities" },
  { pattern: /\b(rebpb|palli\s+bidyut)\b/i, canonical: "Palli Bidyut", defaultCategory: "utilities" },
];

function applyVendorHeuristics(n: NormalizedExtraction): NormalizedExtraction {
  const haystack = [n.vendor_name, n.notes, n.raw_text].filter(Boolean).join(" ");
  if (!haystack) return n;
  for (const { pattern, canonical, defaultCategory } of BD_VENDOR_PATTERNS) {
    if (pattern.test(haystack)) {
      const out = { ...n };
      // Only override vendor name if model didn't return one or returned a noisy variant
      if (!n.vendor_name || n.vendor_name.length < 3 ||
          (n.field_confidence.vendor_name ?? 0) < 0.7) {
        out.vendor_name = canonical;
        out.field_confidence = { ...n.field_confidence, vendor_name: Math.max(n.field_confidence.vendor_name ?? 0, 0.85) };
        out.evidence = { ...n.evidence, vendor_name: `Matched provider: ${canonical}` };
      }
      // Only set category if model didn't choose one
      if (!n.category) {
        out.category = defaultCategory;
        out.field_confidence = { ...out.field_confidence, category: 0.8 };
      }
      return out;
    }
  }
  return n;
}

// ---------- Stage A: classifier tool schema ----------
const CLASSIFIER_TOOL = {
  type: "function" as const,
  function: {
    name: "classify_document",
    description: "Classify the uploaded document for routing.",
    parameters: {
      type: "object",
      properties: {
        doc_type: {
          type: "string",
          enum: ["utility_bill", "restaurant_receipt", "invoice", "payment_slip", "unknown"],
        },
        language: { type: "string", enum: ["english", "bangla", "mixed"] },
        layout: { type: "string", enum: ["simple", "dense_table", "form_like"] },
        is_legible: { type: "boolean" },
      },
      required: ["doc_type", "language", "layout", "is_legible"],
      additionalProperties: false,
    },
  },
};

// ---------- Stage C: extraction tool schema ----------
const EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "record_receipt_extraction",
    description: "Record structured fields from a bill/receipt image. Return null when not clearly visible — never guess.",
    parameters: {
      type: "object",
      properties: {
        vendor_name: { type: ["string", "null"] },
        invoice_or_receipt_number: { type: ["string", "null"] },
        customer_or_account_number: { type: ["string", "null"], description: "Customer/account/meter/SIM number for utility bills" },
        expense_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD bill issue date" },
        due_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD payment due date" },
        paid_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD if explicitly stamped paid" },
        amount_subtotal: { type: ["number", "null"] },
        tax_amount: { type: ["number", "null"] },
        total_amount: { type: ["number", "null"], description: "Final amount payable, after tax" },
        currency: { type: ["string", "null"], description: "ISO 4217 (BDT, USD, etc.)" },
        payment_status: { type: ["string", "null"], enum: ["paid", "unpaid", null] },
        category: { type: ["string", "null"], description: `One of: ${ALLOWED_CATEGORIES.join(", ")}` },
        notes: { type: ["string", "null"] },
        raw_text: { type: ["string", "null"], description: "Plain-text transcription of the visible bill content (header, totals, account info). Used as evidence." },
        evidence: {
          type: "object",
          description: "For each non-null field, include the exact short text snippet from the document that justifies the value.",
          additionalProperties: { type: "string" },
        },
        field_confidence: {
          type: "object",
          description: "Confidence 0..1 per field. Required for every non-null field.",
          additionalProperties: { type: "number" },
        },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["field_confidence", "warnings", "evidence"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT =
  `You are a strict bill/receipt extractor. Read only what is clearly visible in the image.
Hard rules:
- Never invent values. If unsure, return null. Do NOT fabricate dates, totals, vendor names.
- Provide field_confidence 0..1 for every non-null field.
- For every non-null field also provide a short evidence snippet (≤80 chars) copied from the document.
- ISO 4217 currencies (BDT, USD, ...). For BD utility bills currency is almost always BDT.
- ISO YYYY-MM-DD dates. Reject any date not actually printed.
- Numeric amounts: numbers only, no symbols, no thousands separators.
- payment_status="paid" only if the document explicitly shows "PAID" stamp/receipt; otherwise null.
- category MUST be one of: ${ALLOWED_CATEGORIES.join(", ")}.
- Use raw_text to transcribe the key visible lines (vendor header, account line, total line). Keep it short.
- Add concise warnings for ambiguities or unreadable sections — do not spam.`;

// ---------- helpers ----------
function clamp01(n: unknown): number {
  const x = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  return trimmed;
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function dedupeWarnings(ws: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of ws) {
    const key = w.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(w.length > 140 ? w.slice(0, 140) + "…" : w);
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeProviderArgs(args: Record<string, unknown>): NormalizedExtraction {
  const fc = (args.field_confidence as Record<string, unknown>) || {};
  const fieldConfidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(fc)) fieldConfidence[k] = clamp01(v);

  const ev = (args.evidence as Record<string, unknown>) || {};
  const evidence: Record<string, string> = {};
  for (const [k, v] of Object.entries(ev)) {
    if (typeof v === "string" && v.trim()) evidence[k] = v.trim().slice(0, 120);
  }

  const currency = typeof args.currency === "string" ? args.currency.trim().toUpperCase() : null;
  const validCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;

  const category = typeof args.category === "string" ? args.category.trim().toLowerCase() : null;
  const validCategory = category && ALLOWED_CATEGORIES.includes(category) ? category : null;

  const paymentStatusRaw = typeof args.payment_status === "string" ? args.payment_status.toLowerCase() : null;
  const paymentStatus =
    paymentStatusRaw === "paid" || paymentStatusRaw === "unpaid" ? paymentStatusRaw : null;

  const warnings = Array.isArray(args.warnings)
    ? (args.warnings as unknown[]).filter((w) => typeof w === "string") as string[]
    : [];

  // Truthful overall: mean of present field scores (no inflation)
  const presentScores = Object.values(fieldConfidence).filter((n) => isFinite(n));
  const overall = presentScores.length === 0
    ? 0
    : presentScores.reduce((a, b) => a + b, 0) / presentScores.length;

  return {
    vendor_name: typeof args.vendor_name === "string" ? args.vendor_name.trim() || null : null,
    invoice_or_receipt_number: typeof args.invoice_or_receipt_number === "string"
      ? args.invoice_or_receipt_number.trim() || null : null,
    customer_or_account_number: typeof args.customer_or_account_number === "string"
      ? args.customer_or_account_number.trim() || null : null,
    expense_date: toIsoDate(args.expense_date),
    due_date: toIsoDate(args.due_date),
    paid_date: toIsoDate(args.paid_date),
    amount_subtotal: toNumberOrNull(args.amount_subtotal),
    tax_amount: toNumberOrNull(args.tax_amount),
    total_amount: toNumberOrNull(args.total_amount),
    currency: validCurrency,
    payment_status: paymentStatus,
    category: validCategory,
    notes: typeof args.notes === "string" ? args.notes.trim().slice(0, 500) || null : null,
    raw_text: typeof args.raw_text === "string" ? args.raw_text.trim().slice(0, 4000) || null : null,
    evidence,
    field_confidence: fieldConfidence,
    overall_confidence: clamp01(overall),
    warnings,
  };
}

// ---------- Stage D: validator ----------
function validate(n: NormalizedExtraction): { normalized: NormalizedExtraction; validator: ValidatorOutput } {
  const out: NormalizedExtraction = {
    ...n,
    field_confidence: { ...n.field_confidence },
    warnings: [...n.warnings],
  };
  const v: ValidatorOutput = {
    total_check: "unknown",
    date_check: "unknown",
    currency_check: "unknown",
    payment_status_check: "unknown",
    hallucination_flags: [],
    confidence_adjustments: {},
    rejected_fields: [],
  };

  const reject = (field: keyof NormalizedExtraction, reason: string) => {
    (out as any)[field] = null;
    delete out.field_confidence[field as string];
    v.rejected_fields.push(field as string);
    v.hallucination_flags.push(reason);
  };
  const downgrade = (field: string, factor: number) => {
    if (out.field_confidence[field] !== undefined) {
      const before = out.field_confidence[field];
      const after = clamp01(before * factor);
      out.field_confidence[field] = after;
      v.confidence_adjustments[field] = after - before;
    }
  };

  // total = subtotal + tax (±5%)
  if (out.amount_subtotal !== null && out.tax_amount !== null && out.total_amount !== null) {
    const sum = +(out.amount_subtotal + out.tax_amount).toFixed(2);
    const tolerance = Math.max(0.05, out.total_amount * 0.05);
    if (Math.abs(sum - out.total_amount) <= tolerance) {
      v.total_check = "ok";
    } else {
      v.total_check = "mismatch";
      out.warnings.push(`Subtotal + tax (${sum}) doesn't match total (${out.total_amount}).`);
      downgrade("total_amount", 0.7);
      downgrade("amount_subtotal", 0.7);
      downgrade("tax_amount", 0.7);
    }
  }

  // Date plausibility
  if (out.expense_date) {
    const d = new Date(out.expense_date + "T00:00:00Z");
    const year = d.getUTCFullYear();
    const now = new Date();
    if (year < 2000 || year > now.getUTCFullYear() + 1) {
      reject("expense_date", `Implausible date year ${year}`);
      v.date_check = "implausible";
    } else if (d.getTime() > now.getTime() + 86400000 * 2) {
      reject("expense_date", "Date is in the future");
      v.date_check = "implausible";
    } else {
      v.date_check = "ok";
    }
  }

  // Currency normalization
  if (out.currency) {
    if (/^[A-Z]{3}$/.test(out.currency)) {
      v.currency_check = "ok";
    } else {
      reject("currency", "Invalid currency code");
    }
  }

  // payment_status only if evidenced
  if (out.payment_status === "paid") {
    const evidenceText = (out.evidence.payment_status || "").toLowerCase();
    const rawTextLower = (out.raw_text || "").toLowerCase();
    const hasPaidEvidence = /\bpaid\b|\breceived\b|\bsettled\b|payment\s+received/.test(evidenceText) ||
                            /\bpaid\b|payment\s+received|\breceipt\b/.test(rawTextLower);
    if (!hasPaidEvidence) {
      reject("payment_status", "No explicit 'paid' evidence in document");
      v.payment_status_check = "stripped";
    } else {
      v.payment_status_check = "evidenced";
    }
  }

  // Hallucination: total absurdly large or all fields null
  if (out.total_amount !== null && out.total_amount > 10_000_000_000) {
    reject("total_amount", "Implausibly large total");
  }

  // Recompute overall after adjustments
  const present = Object.values(out.field_confidence).filter((x) => isFinite(x));
  out.overall_confidence = present.length === 0 ? 0 : clamp01(present.reduce((a, b) => a + b, 0) / present.length);

  // Add warnings for missing critical fields (evidence-based)
  if (out.total_amount === null) out.warnings.push("Total amount could not be confidently extracted.");
  if (out.currency === null) out.warnings.push("Currency could not be determined.");
  if (out.expense_date === null) out.warnings.push("Bill date could not be confidently extracted.");
  if (out.vendor_name === null) out.warnings.push("Vendor/provider could not be identified.");

  out.warnings = dedupeWarnings(out.warnings);
  return { normalized: out, validator: v };
}

// ---------- Provider calls ----------
async function callGateway(model: string, body: Record<string, unknown>): Promise<unknown> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const resp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...body }),
  });
  if (resp.status === 429) throw new Error("RATE_LIMITED");
  if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gateway error ${resp.status}: ${t.slice(0, 400)}`);
  }
  return resp.json();
}

async function classify(base64: string, mime: string): Promise<{ doc_type: string; language: string; layout: string; is_legible: boolean }> {
  try {
    const raw = await callGateway(CLASSIFIER_MODEL, {
      messages: [
        { role: "system", content: "Classify the document. Be conservative — use 'unknown' if unclear." },
        {
          role: "user",
          content: [
            { type: "text", text: "Classify this document." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
      tools: [CLASSIFIER_TOOL],
      tool_choice: { type: "function", function: { name: "classify_document" } },
    });
    const args = (raw as any)?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no classify result");
    const parsed = JSON.parse(args);
    return {
      doc_type: parsed.doc_type ?? "unknown",
      language: parsed.language ?? "english",
      layout: parsed.layout ?? "simple",
      is_legible: parsed.is_legible !== false,
    };
  } catch {
    // Classification failure is non-fatal; default to safe routing
    return { doc_type: "unknown", language: "english", layout: "simple", is_legible: true };
  }
}

function chooseExtractionModel(c: { doc_type: string; language: string; layout: string }): string {
  if (c.doc_type === "utility_bill" || c.language === "bangla" || c.language === "mixed" || c.layout === "dense_table") {
    return STRONG_MODEL;
  }
  return FAST_MODEL;
}

async function extract(base64: string, mime: string, model: string, hint: string): Promise<{ raw: unknown; normalized: NormalizedExtraction }> {
  const raw = await callGateway(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract structured fields from this bill/receipt. Context hint: ${hint}` },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "function", function: { name: "record_receipt_extraction" } },
  });
  const toolCall = (raw as any)?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error("Provider returned no structured tool call");
  let args: Record<string, unknown>;
  try { args = JSON.parse(toolCall.function.arguments); }
  catch { throw new Error("Provider returned invalid JSON in tool call"); }
  return { raw, normalized: normalizeProviderArgs(args) };
}

// ---------- Auth ----------
async function getCallerUserId(req: Request, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

// ---------- Main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let payload: { action?: string; job_id?: string };
  try { payload = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { action, job_id } = payload;
  if (!action || !job_id || typeof job_id !== "string") return json({ error: "action and job_id required" }, 400);
  if (action !== "start" && action !== "retry") return json({ error: "Unsupported action" }, 400);

  const userId = await getCallerUserId(req, supabase);
  if (!userId) return json({ error: "Not authenticated" }, 401);

  const { data: job, error: jobErr } = await supabase
    .from("expense_extraction_jobs")
    .select("*")
    .eq("id", job_id)
    .maybeSingle();
  if (jobErr || !job) return json({ error: "Job not found" }, 404);

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", job.workspace_id)
    .maybeSingle();
  if (!membership || membership.role !== "admin") return json({ error: "Forbidden: workspace admin only" }, 403);

  if (action === "start" && !["uploaded", "failed"].includes(job.status)) {
    return json({ error: `Cannot start extraction from status ${job.status}` }, 409);
  }
  if (action === "retry") {
    if (!["failed", "extracted", "review_required"].includes(job.status)) {
      return json({ error: `Cannot retry from status ${job.status}` }, 409);
    }
    if ((job.retry_count ?? 0) >= MAX_RETRIES) return json({ error: "Max retries exceeded" }, 429);
  }

  const { data: rl } = await supabase.rpc("rate_limit_extraction_start", {
    _workspace_id: job.workspace_id,
    _user_id: userId,
  });
  const rlRow = Array.isArray(rl) ? rl[0] : rl;
  if (rlRow && rlRow.allowed === false) {
    return json({ error: rlRow.reason ?? "Rate limit exceeded", retry_after_seconds: rlRow.retry_after_seconds ?? 300 }, 429);
  }

  if (!job.source_storage_path) return json({ error: "Job has no source file" }, 400);
  if (!job.source_mime_type || !SUPPORTED_MIME_TYPES.includes(job.source_mime_type)) {
    return json({
      error: `Unsupported file type: ${job.source_mime_type}. Only PNG, JPG, and WebP are supported.`,
    }, 415);
  }

  const startedAt = new Date().toISOString();
  await supabase
    .from("expense_extraction_jobs")
    .update({
      status: "processing",
      extraction_started_at: startedAt,
      retry_count: action === "retry" ? (job.retry_count ?? 0) + 1 : job.retry_count ?? 0,
      failure_reason: null,
    })
    .eq("id", job_id);

  await supabase.from("audit_logs").insert({
    workspace_id: job.workspace_id,
    actor_id: userId,
    action: action === "retry" ? "expense_extraction_retried" : "expense_extraction_started",
    entity_type: "expense_extraction_job",
    entity_id: job_id,
    metadata: { provider: job.provider },
  });

  try {
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("workspace-files")
      .download(job.source_storage_path);
    if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message ?? "unknown"}`);
    const arr = new Uint8Array(await fileBlob.arrayBuffer());
    if (arr.byteLength === 0) throw new Error("Source file is empty");
    if (arr.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB extraction limit");

    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < arr.length; i += CHUNK) binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
    const base64 = btoa(binary);

    // Stage A: classify
    const cls = await classify(base64, job.source_mime_type);

    // Stage B: pick model
    const model = chooseExtractionModel(cls);
    const hint = `doc_type=${cls.doc_type}; language=${cls.language}; layout=${cls.layout}.`;

    // Stage C: extract
    const { raw, normalized: rawExtracted } = await extract(base64, job.source_mime_type, model, hint);

    // Apply rules-layer vendor heuristics
    const heuristic = applyVendorHeuristics(rawExtracted);

    // Stage D: validate
    const { normalized, validator } = validate(heuristic);

    // Decide review_required
    const criticalMissing =
      normalized.total_amount === null ||
      normalized.currency === null ||
      normalized.expense_date === null ||
      normalized.vendor_name === null;
    const reviewRequired =
      criticalMissing ||
      validator.rejected_fields.length > 0 ||
      validator.total_check === "mismatch" ||
      normalized.overall_confidence < 0.85;

    const now = new Date().toISOString();
    await supabase
      .from("expense_extraction_jobs")
      .update({
        status: reviewRequired ? "review_required" : "extracted",
        raw_payload_json: raw,
        normalized_data_json: normalized,
        overall_confidence: normalized.overall_confidence,
        review_required: reviewRequired,
        extracted_at: now,
        failure_reason: null,
        provider_model: model,
        doc_type: cls.doc_type,
        language: cls.language,
        layout: cls.layout,
        raw_text: normalized.raw_text,
        validator_output: validator,
      })
      .eq("id", job_id);

    await supabase.from("audit_logs").insert({
      workspace_id: job.workspace_id,
      actor_id: userId,
      action: reviewRequired ? "expense_extraction_review_required" : "expense_extraction_succeeded",
      entity_type: "expense_extraction_job",
      entity_id: job_id,
      metadata: {
        overall_confidence: normalized.overall_confidence,
        doc_type: cls.doc_type,
        language: cls.language,
        layout: cls.layout,
        model,
        rejected_fields: validator.rejected_fields,
        warnings_count: normalized.warnings.length,
      },
    });

    return json({ ok: true, status: reviewRequired ? "review_required" : "extracted", normalized, validator, classification: cls });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("expense_extraction_jobs")
      .update({ status: "failed", failure_reason: msg.slice(0, 1000) })
      .eq("id", job_id);

    await supabase.from("audit_logs").insert({
      workspace_id: job.workspace_id,
      actor_id: userId,
      action: "expense_extraction_failed",
      entity_type: "expense_extraction_job",
      entity_id: job_id,
      metadata: { error: msg.slice(0, 500) },
    });

    const status = msg === "RATE_LIMITED" ? 429 : msg === "CREDITS_EXHAUSTED" ? 402 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
