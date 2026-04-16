// Client-side API for the bill/receipt extraction workflow.
// Provider-agnostic: shapes here mirror the normalized internal schema.

import { supabase } from "@/integrations/supabase/client";
import { uploadFile, getSignedDownloadUrl } from "@/lib/file-api";

export interface NormalizedExtraction {
  vendor_name: string | null;
  invoice_or_receipt_number: string | null;
  expense_date: string | null;
  paid_date: string | null;
  amount_subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: "paid" | "unpaid" | null;
  category: string | null;
  notes: string | null;
  field_confidence: Record<string, number>;
  overall_confidence: number;
  warnings: string[];
}

export type ExtractionStatus =
  | "uploaded"
  | "processing"
  | "extracted"
  | "review_required"
  | "expense_created"
  | "failed"
  | "cancelled";

export interface ExtractionJob {
  id: string;
  workspace_id: string;
  created_by: string;
  source_file_id: string | null;
  source_storage_path: string | null;
  source_mime_type: string | null;
  source_file_name: string | null;
  provider: string;
  provider_model: string | null;
  status: ExtractionStatus;
  raw_payload_json: unknown;
  normalized_data_json: NormalizedExtraction | null;
  overall_confidence: number | null;
  review_required: boolean;
  failure_reason: string | null;
  retry_count: number;
  extraction_started_at: string | null;
  extracted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  cancelled_at: string | null;
  created_expense_id: string | null;
  created_at: string;
  updated_at: string;
}

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Full upload + job-creation flow.
 * 1. Create job placeholder (status uploaded) so we have an id to scope the file under.
 * 2. Upload receipt file under owner_type=expense_receipt / owner_id=jobId.
 * 3. Patch the job with file_id + storage_path + mime_type + name.
 * 4. Trigger server-side extraction (action: start).
 */
export async function startReceiptExtraction(params: {
  workspaceId: string;
  userId: string;
  file: File;
}): Promise<ExtractionJob> {
  const { workspaceId, userId, file } = params;

  // Step 1: create placeholder job
  const { data: jobRow, error: jobErr } = await supabase
    .from("expense_extraction_jobs")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      provider: "lovable_ai_gemini",
      status: "uploaded",
    } as any)
    .select("*")
    .single();
  if (jobErr || !jobRow) throw new Error(jobErr?.message || "Failed to create extraction job");

  const jobId = (jobRow as any).id as string;

  // Step 2: upload file under this job
  let uploaded;
  try {
    uploaded = await uploadFile(
      { workspace_id: workspaceId, owner_type: "expense_receipt", owner_id: jobId },
      file,
      { authToken: (await supabase.auth.getSession()).data.session?.access_token },
    );
  } catch (e) {
    // Roll back to cancelled so the job doesn't dangle
    await supabase.rpc("cancel_extraction_job" as any, { _job_id: jobId });
    throw e;
  }

  // Read back canonical mime + size from files row (server-derived, trustworthy)
  const { data: fileRow } = await supabase
    .from("files")
    .select("id, file_name, mime_type, storage_path")
    .eq("id", (uploaded as any).id)
    .single();

  // Step 3: patch the job with file metadata
  await supabase
    .from("expense_extraction_jobs")
    .update({
      source_file_id: fileRow?.id ?? null,
      source_storage_path: fileRow?.storage_path ?? null,
      source_mime_type: fileRow?.mime_type ?? file.type,
      source_file_name: fileRow?.file_name ?? file.name,
    } as any)
    .eq("id", jobId);

  // Step 4: kick off extraction
  const headers = await authHeader();
  const resp = await fetch(`${FUNCTIONS_BASE}/extract-receipt`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", job_id: jobId }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    if (resp.status === 429) throw new Error("AI service rate limit reached. Try again in a minute.");
    if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
    throw new Error(errBody?.error || `Extraction failed (${resp.status})`);
  }

  // Refetch the now-updated job
  const { data: refreshed } = await supabase
    .from("expense_extraction_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  return refreshed as unknown as ExtractionJob;
}

export async function retryReceiptExtraction(jobId: string): Promise<ExtractionJob> {
  const headers = await authHeader();
  const resp = await fetch(`${FUNCTIONS_BASE}/extract-receipt`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retry", job_id: jobId }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    if (resp.status === 429) throw new Error("Rate limit reached or max retries exceeded.");
    if (resp.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(errBody?.error || `Retry failed (${resp.status})`);
  }
  const { data } = await supabase
    .from("expense_extraction_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  return data as unknown as ExtractionJob;
}

export async function cancelExtractionJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_extraction_job" as any, { _job_id: jobId });
  if (error) throw new Error(error.message);
}

export async function approveExtractionAndCreateExpense(params: {
  jobId: string;
  description: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string;
  vendorId: string | null;
  projectId: string | null;
  paymentMethod: string;
  paymentStatus: "paid" | "unpaid";
  paidDate: string | null;
  notes: string | null;
}): Promise<string> {
  const { error, data } = await supabase.rpc("approve_extraction_and_create_expense" as any, {
    _job_id: params.jobId,
    _description: params.description,
    _amount: params.amount,
    _currency: params.currency,
    _expense_date: params.expenseDate,
    _category: params.category,
    _vendor_id: params.vendorId,
    _project_id: params.projectId,
    _payment_method: params.paymentMethod,
    _payment_status: params.paymentStatus,
    _paid_date: params.paidDate,
    _notes: params.notes,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

export async function getReceiptPreviewUrl(fileId: string): Promise<{ url: string; name: string } | null> {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await getSignedDownloadUrl(fileId, { authToken: token });
    return { url: res.download_url, name: res.file_name };
  } catch {
    return null;
  }
}
