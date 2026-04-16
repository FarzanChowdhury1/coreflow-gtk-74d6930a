// Provider-abstracted bill/receipt extraction.
// Current backend: Lovable AI Gateway (Gemini vision).
// Returns a normalized internal schema — never Gemini-specific shapes.
//
// Endpoints:
//   POST { action: "start", job_id }   → runs extraction, persists raw + normalized
//   POST { action: "retry", job_id }   → re-runs extraction (bumps retry_count)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash"; // vision-capable, fast, cost-effective
const MAX_RETRIES = 3;
const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

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
  expense_date: string | null;       // ISO YYYY-MM-DD
  paid_date: string | null;          // ISO YYYY-MM-DD
  amount_subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  currency: string | null;           // ISO 4217
  payment_status: "paid" | "unpaid" | null;
  category: string | null;
  notes: string | null;
  field_confidence: Record<string, number>; // 0..1 per field key
  overall_confidence: number;         // 0..1
  warnings: string[];
}

const ALLOWED_CATEGORIES = [
  "general", "salary", "rent", "utilities", "software", "marketing",
  "travel", "equipment", "consulting", "media_buying", "logistics", "other",
];

// ---------- Gemini-shape → normalized shape adapter ----------
// Tool-calling schema we send to ANY provider; provider-specific code only lives
// in the function body that builds the request.
const EXTRACTION_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "record_receipt_extraction",
    description: "Record the structured fields extracted from a bill or receipt image. Return null when not confidently inferable; do not invent values.",
    parameters: {
      type: "object",
      properties: {
        vendor_name: { type: ["string", "null"] },
        invoice_or_receipt_number: { type: ["string", "null"] },
        expense_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD of the receipt/invoice" },
        paid_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD if explicitly shown as paid" },
        amount_subtotal: { type: ["number", "null"] },
        tax_amount: { type: ["number", "null"] },
        total_amount: { type: ["number", "null"], description: "Final amount paid/due, after tax" },
        currency: { type: ["string", "null"], description: "ISO 4217 3-letter code (e.g. BDT, USD)" },
        payment_status: { type: ["string", "null"], enum: ["paid", "unpaid", null] },
        category: { type: ["string", "null"], description: `One of: ${ALLOWED_CATEGORIES.join(", ")}` },
        notes: { type: ["string", "null"], description: "Short memo line if any" },
        field_confidence: {
          type: "object",
          description: "Confidence 0..1 per field key. Required for every non-null field.",
          additionalProperties: { type: "number" },
        },
        warnings: {
          type: "array",
          items: { type: "string" },
          description: "Ambiguities, conflicts, or items the human reviewer should verify",
        },
      },
      required: ["field_confidence", "warnings"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT =
  `You are a strict bill/receipt extractor. Read the attached document image and return only what is clearly visible.
Rules:
- Never invent values. If a field is not clearly present or you are unsure, set it to null.
- Provide a confidence score 0..1 for every non-null field in field_confidence.
- Use ISO 4217 currency codes (BDT, USD, EUR, GBP, etc.). If only a symbol appears, infer cautiously and lower confidence.
- Use ISO YYYY-MM-DD dates.
- Numeric amounts: numbers only, no currency symbols, no thousands separators.
- payment_status: only set to "paid" if the document explicitly shows a paid stamp/receipt; otherwise null.
- category must be one of: ${ALLOWED_CATEGORIES.join(", ")} (or null).
- Add a warning for any conflict (e.g. subtotal+tax != total), unreadable section, or low-confidence guess.`;

function clamp01(n: unknown): number {
  const x = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Accept YYYY-MM-DD only — reject anything ambiguous
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

function normalizeProviderArgs(args: Record<string, unknown>): NormalizedExtraction {
  const fc = (args.field_confidence as Record<string, unknown>) || {};
  const fieldConfidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(fc)) fieldConfidence[k] = clamp01(v);

  const currency = typeof args.currency === "string" ? args.currency.trim().toUpperCase() : null;
  const validCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;

  const category = typeof args.category === "string" ? args.category.trim().toLowerCase() : null;
  const validCategory = category && ALLOWED_CATEGORIES.includes(category) ? category : null;

  const paymentStatusRaw = typeof args.payment_status === "string" ? args.payment_status.toLowerCase() : null;
  const paymentStatus =
    paymentStatusRaw === "paid" || paymentStatusRaw === "unpaid" ? paymentStatusRaw : null;

  const warnings = Array.isArray(args.warnings)
    ? (args.warnings as unknown[]).filter((w) => typeof w === "string").slice(0, 20) as string[]
    : [];

  // Derive overall_confidence as the mean of present field scores (truthful, not invented)
  const presentScores = Object.values(fieldConfidence).filter((n) => isFinite(n));
  const overall = presentScores.length === 0
    ? 0
    : presentScores.reduce((a, b) => a + b, 0) / presentScores.length;

  return {
    vendor_name: typeof args.vendor_name === "string" ? args.vendor_name.trim() || null : null,
    invoice_or_receipt_number: typeof args.invoice_or_receipt_number === "string"
      ? args.invoice_or_receipt_number.trim() || null : null,
    expense_date: toIsoDate(args.expense_date),
    paid_date: toIsoDate(args.paid_date),
    amount_subtotal: toNumberOrNull(args.amount_subtotal),
    tax_amount: toNumberOrNull(args.tax_amount),
    total_amount: toNumberOrNull(args.total_amount),
    currency: validCurrency,
    payment_status: paymentStatus,
    category: validCategory,
    notes: typeof args.notes === "string" ? args.notes.trim().slice(0, 500) || null : null,
    field_confidence: fieldConfidence,
    overall_confidence: clamp01(overall),
    warnings,
  };
}

// Cross-field sanity warnings (computed server-side, not invented by the model)
function appendSanityWarnings(n: NormalizedExtraction): NormalizedExtraction {
  const ws = [...n.warnings];
  if (n.amount_subtotal !== null && n.tax_amount !== null && n.total_amount !== null) {
    const sum = +(n.amount_subtotal + n.tax_amount).toFixed(2);
    if (Math.abs(sum - n.total_amount) > 0.05) {
      ws.push(`Subtotal (${n.amount_subtotal}) + tax (${n.tax_amount}) ≠ total (${n.total_amount}).`);
    }
  }
  if (n.total_amount !== null && n.total_amount > 1_000_000_000) {
    ws.push("Total amount unusually large — please verify.");
  }
  if (n.currency === null) ws.push("Currency could not be determined — please set manually.");
  if (n.expense_date === null) ws.push("Expense date could not be determined — please set manually.");
  if (n.total_amount === null) ws.push("Total amount could not be determined — please set manually.");
  return { ...n, warnings: ws };
}

// ---------- Provider call: Lovable AI Gateway / Gemini vision ----------
async function callGeminiExtractor(
  base64Data: string,
  mimeType: string,
  model: string,
): Promise<{ raw: unknown; normalized: NormalizedExtraction }> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the structured fields from this receipt/bill." },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL_SCHEMA],
    tool_choice: { type: "function", function: { name: "record_receipt_extraction" } },
  };

  const resp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 429) throw new Error("RATE_LIMITED");
  if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gateway error ${resp.status}: ${t.slice(0, 500)}`);
  }

  const raw = await resp.json();
  const choice = raw?.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    throw new Error("Provider returned no structured tool call");
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("Provider returned invalid JSON in tool call");
  }

  const normalized = appendSanityWarnings(normalizeProviderArgs(args));
  return { raw, normalized };
}

// ---------- Auth helper ----------
async function getCallerUserId(req: Request, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let payload: { action?: string; job_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, job_id } = payload;
  if (!action || !job_id || typeof job_id !== "string") {
    return json({ error: "action and job_id required" }, 400);
  }
  if (action !== "start" && action !== "retry") {
    return json({ error: "Unsupported action" }, 400);
  }

  const userId = await getCallerUserId(req, supabase);
  if (!userId) return json({ error: "Not authenticated" }, 401);

  // Load job
  const { data: job, error: jobErr } = await supabase
    .from("expense_extraction_jobs")
    .select("*")
    .eq("id", job_id)
    .maybeSingle();
  if (jobErr || !job) return json({ error: "Job not found" }, 404);

  // Authorize: workspace admin only
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", job.workspace_id)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    return json({ error: "Forbidden: workspace admin only" }, 403);
  }

  // State guards
  if (action === "start" && !["uploaded", "failed"].includes(job.status)) {
    return json({ error: `Cannot start extraction from status ${job.status}` }, 409);
  }
  if (action === "retry") {
    if (!["failed", "extracted", "review_required"].includes(job.status)) {
      return json({ error: `Cannot retry from status ${job.status}` }, 409);
    }
    if ((job.retry_count ?? 0) >= MAX_RETRIES) {
      return json({ error: "Max retries exceeded" }, 429);
    }
  }

  if (!job.source_storage_path) return json({ error: "Job has no source file" }, 400);
  if (!job.source_mime_type || !SUPPORTED_MIME_TYPES.includes(job.source_mime_type)) {
    return json({ error: `Unsupported file type: ${job.source_mime_type}` }, 415);
  }

  // Mark processing
  const startedAt = new Date().toISOString();
  await supabase
    .from("expense_extraction_jobs")
    .update({
      status: "processing",
      extraction_started_at: startedAt,
      retry_count: action === "retry" ? (job.retry_count ?? 0) + 1 : job.retry_count ?? 0,
      failure_reason: null,
      provider_model: DEFAULT_MODEL,
    })
    .eq("id", job_id);

  await supabase.from("audit_logs").insert({
    workspace_id: job.workspace_id,
    actor_id: userId,
    action: action === "retry" ? "expense_extraction_retried" : "expense_extraction_started",
    entity_type: "expense_extraction_job",
    entity_id: job_id,
    metadata: { provider: job.provider, model: DEFAULT_MODEL },
  });

  try {
    // Download file from storage
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("workspace-files")
      .download(job.source_storage_path);
    if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message ?? "unknown"}`);

    const arr = new Uint8Array(await fileBlob.arrayBuffer());
    if (arr.byteLength === 0) throw new Error("Source file is empty");
    if (arr.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB extraction limit");

    // Base64 encode (chunked to avoid stack overflow)
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < arr.length; i += CHUNK) {
      binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);

    const { raw, normalized } = await callGeminiExtractor(base64, job.source_mime_type, DEFAULT_MODEL);

    // Decide review_required: any warning, missing critical field, or overall < 0.85 → review
    const criticalMissing =
      normalized.total_amount === null ||
      normalized.currency === null ||
      normalized.expense_date === null ||
      normalized.vendor_name === null;
    const reviewRequired =
      criticalMissing || normalized.warnings.length > 0 || normalized.overall_confidence < 0.85;

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
      })
      .eq("id", job_id);

    await supabase.from("audit_logs").insert({
      workspace_id: job.workspace_id,
      actor_id: userId,
      action: "expense_extraction_succeeded",
      entity_type: "expense_extraction_job",
      entity_id: job_id,
      metadata: {
        overall_confidence: normalized.overall_confidence,
        review_required: reviewRequired,
        warnings_count: normalized.warnings.length,
      },
    });

    return json({ ok: true, status: reviewRequired ? "review_required" : "extracted", normalized });
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
