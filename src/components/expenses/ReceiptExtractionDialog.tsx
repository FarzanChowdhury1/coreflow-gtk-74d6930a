import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, AlertTriangle, CheckCircle2, RotateCw, X, FileText, Sparkles } from "lucide-react";
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
}

function ConfidenceBadge({ value }: { value: number | undefined }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const variant = pct >= 85 ? "secondary" : pct >= 60 ? "outline" : "destructive";
  return <Badge variant={variant} className="text-[10px] ml-2">{pct}%</Badge>;
}

export function ReceiptExtractionDialog({
  open, onOpenChange, workspaceId, defaultCurrency, onExpenseCreated, initialJob,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
    } else if (initialJob) {
      setJob(initialJob);
    }
  }, [open, defaultCurrency, initialJob]);

  // Seed editable fields when extraction completes
  useEffect(() => {
    if (!norm) return;
    if (norm.vendor_name) setDescription(norm.invoice_or_receipt_number
      ? `${norm.vendor_name} — ${norm.invoice_or_receipt_number}`
      : norm.vendor_name);
    if (norm.total_amount !== null) setAmount(String(norm.total_amount));
    if (norm.currency) setCurrency(norm.currency);
    if (norm.expense_date) setExpenseDate(norm.expense_date);
    if (norm.paid_date) setPaidDate(norm.paid_date);
    if (norm.category && EXPENSE_CATEGORIES.includes(norm.category)) setCategory(norm.category);
    if (norm.payment_status) setPaymentStatus(norm.payment_status);
    if (norm.notes) setNotes(norm.notes);
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
      await approveExtractionAndCreateExpense({
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
        notes: notes.trim() || null,
      });
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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRetry} disabled={busy || job.retry_count >= 3}>
                <RotateCw className="h-3 w-3 mr-1" /> Retry ({job.retry_count}/3)
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancel} disabled={busy}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        )}

        {showForm && (
          <div className="space-y-4">
            {/* Status banner */}
            {job.status === "review_required" ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">Review required before creating expense</p>
                  <p className="text-muted-foreground">Confidence {Math.round((job.overall_confidence ?? 0) * 100)}%. Verify each field below.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">High-confidence extraction ({Math.round((job.overall_confidence ?? 0) * 100)}%)</p>
                  <p className="text-muted-foreground">Review the fields below, then approve to create the expense.</p>
                </div>
              </div>
            )}

            {/* Warnings */}
            {norm && norm.warnings.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-medium text-foreground mb-1">Warnings to verify</p>
                <ul className="list-disc pl-5 space-y-0.5 text-xs text-muted-foreground">
                  {norm.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {/* Preview column */}
              <div className="rounded-md border bg-muted/30 p-2 min-h-[260px] flex items-center justify-center">
                {previewUrl ? (
                  job.source_mime_type === "application/pdf" ? (
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center text-primary">
                      <FileText className="h-10 w-10 mb-2" />
                      <span className="text-xs">Open PDF preview</span>
                    </a>
                  ) : (
                    <img src={previewUrl} alt="Receipt" className="max-h-[400px] object-contain rounded" />
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Loading preview…</p>
                )}
              </div>

              {/* Form column */}
              <div className="space-y-3">
                <div>
                  <Label className="flex items-center">Description * <ConfidenceBadge value={confidence.vendor_name} /></Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="flex items-center">Amount * <ConfidenceBadge value={confidence.total_amount} /></Label>
                    <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label className="flex items-center">Currency * <ConfidenceBadge value={confidence.currency} /></Label>
                    <Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="flex items-center">Expense Date * <ConfidenceBadge value={confidence.expense_date} /></Label>
                    <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
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
                {paymentStatus === "paid" && (
                  <div>
                    <Label className="flex items-center">Paid Date <ConfidenceBadge value={confidence.paid_date} /></Label>
                    <Input type="date" value={paidDate || expenseDate} onChange={(e) => setPaidDate(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label>Notes</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
            </div>

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
        )}
      </DialogContent>
    </Dialog>
  );
}
