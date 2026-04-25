import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Inbox, Check, X, Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  bkash_manual: "bKash",
  nagad_manual: "Nagad",
  cash: "Cash",
  cheque: "Cheque",
  mobile_banking: "Mobile Banking",
  other: "Other",
};

interface Props {
  onChanged?: () => void;
}

export function PaymentProofInbox({ onChanged }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    const { data } = await supabase
      .from("payment_proof_submissions")
      .select("*")
      .eq("workspace_id", currentWorkspace.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const rows = data || [];
    setItems(rows);
    const ids = [...new Set(rows.map((r: any) => r.invoice_id))];
    if (ids.length) {
      const { data: invs } = await supabase
        .from("invoices")
        .select("id, invoice_number, grand_total, amount_paid, currency")
        .in("id", ids);
      setInvoiceMap(Object.fromEntries((invs || []).map((i: any) => [i.id, i])));
    }
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const downloadProof = async (filePath: string) => {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(filePath, 600);
    if (error || !data) {
      toast({ title: "Could not generate download link", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const accept = async (sub: any) => {
    setBusyId(sub.id);
    try {
      const { error } = await supabase.rpc("accept_payment_proof", { _submission_id: sub.id });
      if (error) throw error;
      toast({ title: "Payment recorded", description: "Invoice updated." });
      await fetchData();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Accept failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectFor) return;
    setBusyId(rejectFor.id);
    try {
      const { error } = await supabase.rpc("reject_payment_proof", {
        _submission_id: rejectFor.id,
        _reason: rejectReason || "No reason provided",
      });
      if (error) throw error;
      toast({ title: "Submission rejected" });
      setRejectFor(null);
      setRejectReason("");
      await fetchData();
    } catch (e: any) {
      toast({ title: "Reject failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-300/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-amber-600" />
          Payment Proofs Awaiting Review
          <Badge variant="secondary">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((s) => {
          const inv = invoiceMap[s.invoice_id];
          const balance = inv ? Number(inv.grand_total) - Number(inv.amount_paid) : 0;
          const mismatch = inv && Number(s.declared_amount) !== balance;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3">
              <div className="min-w-[140px]">
                <p className="text-sm font-medium">{inv?.invoice_number || "—"}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy HH:mm")}</p>
              </div>
              <div className="min-w-[120px]">
                <p className="text-sm font-mono">৳{Number(s.declared_amount).toLocaleString("en-BD")}</p>
                {inv && <p className="text-[11px] text-muted-foreground">Bal: ৳{balance.toLocaleString("en-BD")}</p>}
              </div>
              <Badge variant="outline" className="text-xs">{METHOD_LABELS[s.declared_method] || s.declared_method}</Badge>
              <div className="text-xs text-muted-foreground min-w-[100px] truncate">
                {s.declared_reference || "—"}
              </div>
              {mismatch && (
                <Badge variant="destructive" className="text-[10px]">Amount ≠ balance</Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadProof(s.file_path)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Proof
                </Button>
                <Button size="sm" onClick={() => accept(s)} disabled={busyId === s.id}>
                  {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Accept &amp; Record
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejectFor(s)} disabled={busyId === s.id}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
              {s.notes && (
                <p className="basis-full text-xs text-muted-foreground border-t pt-2">{s.notes}</p>
              )}
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!rejectFor} onOpenChange={(o) => { if (!o) { setRejectFor(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Payment Proof</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Provide a reason. The client will see this in their portal.</p>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Reference number does not match our bank record." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={!rejectReason.trim() || !!busyId}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
