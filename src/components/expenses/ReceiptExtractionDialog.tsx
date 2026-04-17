import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Upload, AlertTriangle, CheckCircle2, RotateCw, X, Sparkles, ChevronDown, FileText, PenLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startReceiptExtraction,
  retryReceiptExtraction,
  cancelExtractionJob,
  approveExtractionAndCreateExpense,
  getReceiptPreviewUrl,
  logExtractionCorrections,
  markJobUserEdited,
  type ExtractionJob,
  type NormalizedExtraction,
} from "@/lib/extraction-api";
import { EXPENSE_CATEGORIES } from "@/pages/Expenses";

const PAYMENT_METHODS = ["bank_transfer", "cash", "credit_card", "mobile_banking", "cheque", "other"];
// PDFs are intentionally not supported by the current vision provider; we reject up-front.
const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB matches edge-function limit

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  defaultCurrency: string;
  onExpenseCreated: () => void;
  /** Optional: reopen an existing extraction job (e.g. from history). */
  initialJob?: ExtractionJob | null;
  /**
   * Manual-first fallback. Called when the user opts out of OCR (or after a failed/low-confidence
   * extraction) so the parent can immediately open the manual ExpenseFormDialog with optional
   * receipt context attached. The dialog will close itself before invoking this.
   */
  onSwitchToManual?: (ctx: {
    jobId: string | null;
    fileId: string | null;
    fileName: string | null;
    initialValues?: {
      description?: string;
      amount?: string;
      expense_date?: string;
      category?: string;
      notes?: string;
      external_account_number?: string;
      due_date?: string;
    };
  }) => void;
}

// Per-field trust gate for autofill. Spec: only autofill when field_confidence >= 0.85.
const TRUST_THRESHOLD = 0.85;
// Below this overall confidence, force manual-review mode.
const LOW_CONFIDENCE_THRESHOLD = 0.7;
const MAX_VISIBLE_WARNINGS = 5;

function ConfidenceBadge({ value }: { value: number | undefined }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const variant = pct >= 85 ? "secondary" : pct >= 60 ? "outline" : "destructive";
  return <Badge variant={variant} className="text-[10px] ml-2">{pct}%</Badge>;
}

function FieldEvidence({ snippet }: { snippet: string | undefined }) {
  if (!snippet) return null;
  return (
    <p className="text-[10px] text-muted-foreground mt-0.5 italic truncate" title={snippet}>
      Evidence: "{snippet}"
    </p>
  );
}

function isPlausibleIsoDate(s: string | null | undefined): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  // Reject obvious garbage years; receipts realistically fall within this range.
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return false;
  return true;
}

export function ReceiptExtractionDialog({
  open, onOpenChange, workspaceId, defaultCurrency, onExpenseCreated, initialJob, onSwitchToManual,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const originalExtractedRef = useRef<Record<string, string | null>>({});

  // Editable form state (seeded from extraction once available)
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidDate, setPaidDate] = useState("");
  const [category, setCategory] = useState("general");
  const [vendorId, setVendorId] = useState("none");
  const [projectId, setProjectId] = useState("none");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("paid");
  const [notes, setNotes] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [rawTextOpen, setRawTextOpen] = useState(false);

  const norm = job?.normalized_data_json as NormalizedExtraction | null;
  const confidence = norm?.field_confidence ?? {};

  // Reset on close; seed from initialJob on open (reopen-from-history flow)
  useEffect(() => {
    if (!open) {
      setJob(null);
      setBusy(false);
      setPreviewUrl(null);
      setDescription("");
      setAmount("");
      setCurrency(defaultCurrency);
      setExpenseDate(new Date().toISOString().split("T")[0]);
      setPaidDate("");
      setCategory("general");
      setVendorId("none");
      setProjectId("none");
      setPaymentMethod("bank_transfer");
      setPaymentStatus("paid");
      setNotes("");
      setAccountNumber("");
      setDueDate("");
      setRawTextOpen(false);
    } else if (initialJob) {
      setJob(initialJob);
    }
  }, [open, defaultCurrency, initialJob]);

  // Seed editable fields ONLY when field confidence >= 0.85 (per spec).
  // For low overall confidence we additionally force manual-review mode and skip autofill entirely.
  useEffect(() => {
    if (!norm) return;
    const fc = norm.field_confidence ?? {};
    const overall = norm.overall_confidence ?? 0;
    const trust = (key: string) => (fc[key] ?? 0) >= TRUST_THRESHOLD;
    const lowConfidence = overall < LOW_CONFIDENCE_THRESHOLD;

    // Snapshot what the model originally produced — for correction logging on approval
    originalExtractedRef.current = {
      vendor_name: norm.vendor_name,
      invoice_or_receipt_number: norm.invoice_or_receipt_number,
      total_amount: norm.total_amount !== null ? String(norm.total_amount) : null,
      currency: norm.currency,
      expense_date: norm.expense_date,
      paid_date: norm.paid_date,
      category: norm.category,
      payment_status: norm.payment_status,
      customer_or_account_number: norm.customer_or_account_number,
      due_date: norm.due_date,
    };

    // In low-confidence mode we deliberately do NOT auto-fill anything risky —
    // the user should enter everything from the receipt themselves.
    if (lowConfidence) return;

    if (norm.vendor_name && trust("vendor_name")) {
      setDescription(norm.invoice_or_receipt_number
        ? `${norm.vendor_name} — ${norm.invoice_or_receipt_number}`
        : norm.vendor_name);
    }
    if (norm.total_amount !== null && norm.total_amount > 0 && trust("total_amount")) {
      setAmount(String(norm.total_amount));
    }
    if (norm.currency && /^[A-Z]{3}$/.test(norm.currency) && trust("currency")) {
      setCurrency(norm.currency);
    }
    if (norm.expense_date && isPlausibleIsoDate(norm.expense_date) && trust("expense_date")) {
      setExpenseDate(norm.expense_date);
    }
    if (norm.paid_date && isPlausibleIsoDate(norm.paid_date) && trust("paid_date")) {
      setPaidDate(norm.paid_date);
    }
    if (norm.category && EXPENSE_CATEGORIES.includes(norm.category) && trust("category")) {
      setCategory(norm.category);
    }
    // payment_status is NEVER auto-paid unless validator left it intact AND confidence high
    if (norm.payment_status && trust("payment_status")) setPaymentStatus(norm.payment_status);
    else setPaymentStatus("unpaid"); // safe default — user must opt-in to "paid"
    if (norm.notes) setNotes(norm.notes);
    if (norm.customer_or_account_number && trust("customer_or_account_number")) {
      setAccountNumber(norm.customer_or_account_number);
    }
    if (norm.due_date && isPlausibleIsoDate(norm.due_date) && trust("due_date")) {
      setDueDate(norm.due_date);
    }
  }, [norm]);

  // Fetch preview when job has a file
  useEffect(() => {
    let active = true;
    (async () => {
      if (job?.source_file_id) {
        const r = await getReceiptPreviewUrl(job.source_file_id);
        if (active) setPreviewUrl(r?.url ?? null);
      } else {
        setPreviewUrl(null);
      }
    })();
    return () => { active = false; };
  }, [job?.source_file_id]);

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-list", workspaceId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("workspace_id", workspaceId).is("deleted_at", null).order("name");
      return data || [];
    },
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-list", workspaceId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("workspace_id", workspaceId).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  // Auto-match vendor by name once extraction returns
  useEffect(() => {
    if (!norm?.vendor_name || vendorId !== "none" || vendors.length === 0) return;
    const target = norm.vendor_name.toLowerCase();
    const match = (vendors as any[]).find((v) => v.name.toLowerCase() === target);
    if (match) setVendorId(match.id);
  }, [norm?.vendor_name, vendors, vendorId]);

  const canApprove = useMemo(() => {
    if (!job) return false;
    if (job.status !== "extracted" && job.status !== "review_required") return false;
    if (!description.trim()) return false;
    if (!amount || Number(amount) <= 0) return false;
    if (!/^[A-Z]{3}$/.test(currency)) return false;
    if (!expenseDate) return false;
    return true;
  }, [job, description, amount, currency, expenseDate]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!user) { toast.error("Not authenticated"); return; }
    if (!SUPPORTED_TYPES.includes(f.type)) {
      toast.error("Only PNG, JPG, or WebP receipts are supported. Convert PDFs to an image first.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error("Receipt exceeds 8MB. Use a smaller file.");
      return;
    }
    setBusy(true);
    try {
      const created = await startReceiptExtraction({ workspaceId, userId: user.id, file: f });
      setJob(created);
      if (created.status === "failed") {
        toast.error(`Extraction failed: ${created.failure_reason ?? "unknown"}`);
      } else if (created.status === "review_required") {
        toast.warning("Extraction completed — please review before creating the expense.");
      } else if (created.status === "extracted") {
        toast.success("Extraction completed.");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to extract receipt");
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const updated = await retryReceiptExtraction(job.id);
      setJob(updated);
    } catch (err: any) {
      toast.error(err.message || "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!job) { onOpenChange(false); return; }
    if (job.status === "expense_created") { onOpenChange(false); return; }
    setBusy(true);
    try {
      await cancelExtractionJob(job.id);
      toast.message("Extraction cancelled");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!job || !canApprove) return;
    setBusy(true);
    try {
      // Detect user edits vs original extraction (best-effort, never blocks)
      const orig = originalExtractedRef.current;
      const finals: Record<string, string | null> = {
        vendor_name: description.split(" — ")[0] || null,
        total_amount: amount || null,
        currency: currency.toUpperCase() || null,
        expense_date: expenseDate || null,
        paid_date: paymentStatus === "paid" ? (paidDate || expenseDate) : null,
        category: category || null,
        payment_status: paymentStatus,
        customer_or_account_number: accountNumber || null,
        due_date: dueDate || null,
      };
      const userEdited = Object.keys(finals).some((k) => (orig[k] ?? "") !== (finals[k] ?? ""));

      // Account number + due date go into structured columns via a follow-up update
      // (the approval RPC's signature is fixed, so we patch the created expense row right after).
      const finalNotes = notes.trim() || null;

      const createdExpenseId = await approveExtractionAndCreateExpense({
        jobId: job.id,
        description: description.trim(),
        amount: Number(amount),
        currency: currency.toUpperCase(),
        expenseDate,
        category,
        vendorId: vendorId === "none" ? null : vendorId,
        projectId: projectId === "none" ? null : projectId,
        paymentMethod,
        paymentStatus,
        paidDate: paymentStatus === "paid" ? (paidDate || expenseDate) : null,
        notes: finalNotes,
      });

      // Persist structured utility-bill metadata to first-class columns (best-effort, non-fatal)
      if (createdExpenseId && (accountNumber.trim() || dueDate)) {
        try {
          await supabase.from("expenses").update({
            external_account_number: accountNumber.trim() || null,
            due_date: dueDate || null,
            updated_at: new Date().toISOString(),
          } as any).eq("id", createdExpenseId);
        } catch (metaErr) {
          console.warn("Could not persist structured bill metadata (non-fatal):", metaErr);
        }
      }

      // Best-effort observability + correction logging (never block on failure)
      try {
        if (userEdited) await markJobUserEdited(job.id);
        await logExtractionCorrections({
          workspaceId: workspaceId,
          jobId: job.id,
          vendorName: norm?.vendor_name ?? null,
          docType: (job as any).doc_type ?? null,
          entries: Object.keys(finals).map((k) => ({
            field_key: k,
            extracted_value: orig[k] ?? null,
            corrected_value: finals[k],
            field_confidence: norm?.field_confidence?.[k] ?? null,
          })),
        });
      } catch (logErr) {
        console.warn("Correction logging failed (non-fatal):", logErr);
      }

      toast.success("Expense created from receipt");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onExpenseCreated();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  // Manual-first fallback: hand off to parent which opens ExpenseFormDialog with attached file context.
  const handleSwitchToManual = () => {
    const ctx = {
      jobId: job?.id ?? null,
      fileId: job?.source_file_id ?? null,
      fileName: job?.source_file_name ?? null,
      initialValues: norm ? {
        description: norm.vendor_name ?? undefined,
        amount: norm.total_amount != null ? String(norm.total_amount) : undefined,
        expense_date: norm.expense_date && isPlausibleIsoDate(norm.expense_date) ? norm.expense_date : undefined,
        category: norm.category ?? undefined,
        notes: norm.notes ?? undefined,
        external_account_number: norm.customer_or_account_number ?? undefined,
        due_date: norm.due_date && isPlausibleIsoDate(norm.due_date) ? norm.due_date : undefined,
      } : undefined,
    };
    onOpenChange(false);
    if (onSwitchToManual) {
      onSwitchToManual(ctx);
    } else {
      toast.message("Manual entry — receipt remains in scan history.");
    }
  };

  const showForm = job && (job.status === "extracted" || job.status === "review_required");
  const showFailure = job?.status === "failed";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Scan Receipt → Expense
          </DialogTitle>
        </DialogHeader>

        {!job && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Upload className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-sm text-foreground font-medium">Upload a bill or receipt</p>
            <p className="text-xs text-muted-foreground mb-3">
              PNG, JPG, or WebP up to 8MB. Extraction runs server-side. Nothing is posted until you review and approve.
            </p>
            <label className="inline-flex">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFile}
                disabled={busy}
              />
              <Button asChild disabled={busy} size="sm">
                <span>{busy ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Extracting…</> : <><Upload className="h-3 w-3 mr-1" /> Choose file</>}</span>
              </Button>
            </label>
            <p className="text-[11px] text-muted-foreground mt-3">
              You can always skip this and add an expense manually.
            </p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={handleSwitchToManual}>
              <PenLine className="h-3 w-3 mr-1" /> Skip OCR — enter manually
            </Button>
          </div>
        )}

        {job && (job.status === "uploaded" || job.status === "processing") && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className="text-sm text-foreground">Extracting fields from receipt…</p>
          </div>
        )}

        {showFailure && (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Extraction failed</p>
                  <p className="text-muted-foreground text-xs mt-1">{job.failure_reason || "Unknown error"}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleRetry} disabled={busy || job.retry_count >= 3}>
                <RotateCw className="h-3 w-3 mr-1" /> Retry ({job.retry_count}/3)
              </Button>
              <Button size="sm" variant="secondary" onClick={handleSwitchToManual} disabled={busy}>
                <PenLine className="h-3 w-3 mr-1" /> Enter manually with this receipt
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancel} disabled={busy}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        )}

        {showForm && (() => {
          const overall = job.overall_confidence ?? 0;
          const isLowConfidence = overall < LOW_CONFIDENCE_THRESHOLD;
          const warnings = norm?.warnings ?? [];
          const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);
          const hiddenCount = Math.max(0, warnings.length - visibleWarnings.length);
          return (
          <div className="space-y-4">
            {/* Status banner — three honest states */}
            {isLowConfidence ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">
                    Low-confidence extraction ({Math.round(overall * 100)}%) — review manually before creating expense
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    The system did not pre-fill values it was unsure about. Enter or correct each field from the receipt before approving.
                  </p>
                </div>
              </div>
            ) : job.status === "review_required" ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">Review required before creating expense</p>
                  <p className="text-muted-foreground">Confidence {Math.round(overall * 100)}%. Verify each field below.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">High-confidence extraction ({Math.round(overall * 100)}%)</p>
                  <p className="text-muted-foreground">Review the fields below, then approve to create the expense.</p>
                </div>
              </div>
            )}

            {/* Warnings (capped to keep the UI honest, not noisy) */}
            {visibleWarnings.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-medium text-foreground mb-1">Items to verify</p>
                <ul className="list-disc pl-5 space-y-0.5 text-xs text-muted-foreground">
                  {visibleWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                {hiddenCount > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">+{hiddenCount} more — review fields manually.</p>
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {/* Preview column */}
              <div className="rounded-md border bg-muted/30 p-2 min-h-[260px] flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} alt="Receipt" className="max-h-[400px] object-contain rounded" />
                ) : (
                  <p className="text-xs text-muted-foreground">Loading preview…</p>
                )}
              </div>

              {/* Form column */}
              <div className="space-y-3">
                <div>
                  <Label className="flex items-center">Description * <ConfidenceBadge value={confidence.vendor_name} /></Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                  <FieldEvidence snippet={norm?.evidence?.vendor_name} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="flex items-center">Amount * <ConfidenceBadge value={confidence.total_amount} /></Label>
                    <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <FieldEvidence snippet={norm?.evidence?.total_amount} />
                  </div>
                  <div>
                    <Label className="flex items-center">Currency * <ConfidenceBadge value={confidence.currency} /></Label>
                    <Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                    <FieldEvidence snippet={norm?.evidence?.currency} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="flex items-center">Expense Date * <ConfidenceBadge value={confidence.expense_date} /></Label>
                    <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
                    <FieldEvidence snippet={norm?.evidence?.expense_date} />
                  </div>
                  <div>
                    <Label className="flex items-center">Category <ConfidenceBadge value={confidence.category} /></Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Vendor</Label>
                    <Select value={vendorId} onValueChange={setVendorId}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(vendors as any[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Project</Label>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (overhead)</SelectItem>
                        {(projects as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="flex items-center">Payment Status <ConfidenceBadge value={confidence.payment_status} /></Label>
                    <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="unpaid">Unpaid (Payable)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {paymentStatus === "paid" && (
                    <div>
                      <Label className="flex items-center">Paid Date <ConfidenceBadge value={confidence.paid_date} /></Label>
                      <Input type="date" value={paidDate || expenseDate} onChange={(e) => setPaidDate(e.target.value)} />
                    </div>
                  )}
                  <div>
                    <Label className="flex items-center">Due Date <ConfidenceBadge value={confidence.due_date} /></Label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    <FieldEvidence snippet={norm?.evidence?.due_date} />
                  </div>
                </div>
                <div>
                  <Label className="flex items-center">Customer / Account Number <ConfidenceBadge value={confidence.customer_or_account_number} /></Label>
                  <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. utility account / customer ID" />
                  <FieldEvidence snippet={norm?.evidence?.customer_or_account_number} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Raw OCR text — collapsible, for transparency / debugging weak extractions */}
            {(norm?.raw_text || (job as any).raw_text) && (
              <Collapsible open={rawTextOpen} onOpenChange={setRawTextOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <FileText className="h-3 w-3 mr-1" />
                    {rawTextOpen ? "Hide" : "Show"} raw extracted text
                    <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${rawTextOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                    {norm?.raw_text || (job as any).raw_text}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="flex justify-between pt-2 border-t">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleRetry} disabled={busy || job.retry_count >= 3}>
                  <RotateCw className="h-3 w-3 mr-1" /> Re-extract
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={busy}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
              </div>
              <Button size="sm" onClick={handleApprove} disabled={busy || !canApprove}>
                {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Approve & Create Expense
              </Button>
            </div>
          </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
