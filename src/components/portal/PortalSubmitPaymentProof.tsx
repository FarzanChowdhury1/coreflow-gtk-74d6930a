import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { portalAction } from "@/lib/portal-api";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  outstandingBalance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

const METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "bkash_manual", label: "bKash" },
  { value: "nagad_manual", label: "Nagad" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

export function PortalSubmitPaymentProof({
  invoiceId, invoiceNumber, outstandingBalance, open, onOpenChange, onSubmitted,
}: Props) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState<string>(outstandingBalance > 0 ? String(outstandingBalance) : "");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setFile(null); setAmount(outstandingBalance > 0 ? String(outstandingBalance) : "");
    setMethod("bank_transfer"); setReference(""); setNotes(""); setDone(false);
  };

  const handleSubmit = async () => {
    if (!file) { toast({ title: "Select a proof file", variant: "destructive" }); return; }
    if (file.size > MAX_BYTES) { toast({ title: "File too large (max 10MB)", variant: "destructive" }); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }

    setBusy(true);
    try {
      // 1. Get signed upload URL
      const { data: u, error: uErr } = await portalAction<any>("get_proof_upload_url", {
        invoice_id: invoiceId,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });
      if (uErr || !u?.upload_url) throw new Error(uErr || "Could not get upload URL");

      // 2. Upload to signed URL
      const up = await fetch(u.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        body: file,
      });
      if (!up.ok) throw new Error("Upload failed");

      // 3. Register submission
      const { data: r, error: sErr } = await portalAction<any>("submit_payment_proof", {
        invoice_id: invoiceId,
        storage_path: u.storage_path,
        declared_amount: amt,
        declared_method: method,
        declared_reference: reference || null,
        notes: notes || null,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (sErr || !r?.success) throw new Error(sErr || "Could not record submission");

      setDone(true);
      onSubmitted?.();
      toast({ title: "Proof submitted", description: "Your service provider will reconcile it shortly." });
    } catch (e: any) {
      const msg = typeof e?.message === "string" && e.message.length < 200 ? e.message : "We could not submit your proof. Please check your file and try again.";
      toast({ title: "Submission failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Payment Proof</DialogTitle>
          <DialogDescription>
            For invoice <span className="font-medium text-foreground">{invoiceNumber}</span>. Upload your bank receipt, bKash/Nagad screenshot, or other proof of payment.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <p className="text-sm font-medium">Proof received</p>
            <p className="text-xs text-muted-foreground">Status: Pending review</p>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Amount (BDT)</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reference / Transaction ID</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TX1234567" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Proof file (PDF or image, max 10MB)</Label>
              <Input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} />
              {file && <p className="text-xs text-muted-foreground">{file.name} · {(file.size/1024).toFixed(0)} KB</p>}
            </div>
          </div>
        )}

        {!done && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy || !file}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Submit Proof
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
