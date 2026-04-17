import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { trackFirstEvent } from "@/lib/events";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES, type Expense } from "@/pages/Expenses";

const PAYMENT_METHODS = ["bank_transfer", "cash", "credit_card", "mobile_banking", "cheque", "other"];

interface AttachedReceiptContext {
  jobId: string;
  fileId: string | null;
  fileName: string | null;
  previewUrl?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expense: Expense | null;
  workspaceId: string;
  currency: string;
  onSaved: () => void;
  /** Optional initial values prefilled from a low-confidence/skipped extraction */
  initialValues?: Partial<{
    description: string;
    amount: string;
    expense_date: string;
    category: string;
    notes: string;
    external_account_number: string;
    due_date: string;
  }>;
  /** Optional banner indicating an attached receipt from the scan flow */
  attachedReceipt?: AttachedReceiptContext | null;
}

export function ExpenseFormDialog({ open, onOpenChange, expense, workspaceId, currency, onSaved, initialValues, attachedReceipt }: Props) {
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [category, setCategory] = useState("general");
  const [vendorId, setVendorId] = useState("none");
  const [projectId, setProjectId] = useState("none");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paidDate, setPaidDate] = useState("");
  const [notes, setNotes] = useState("");
  const [externalAccountNumber, setExternalAccountNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription(expense?.description || initialValues?.description || "");
      setAmount(expense?.amount?.toString() || initialValues?.amount || "");
      setExpenseDate(expense?.expense_date || initialValues?.expense_date || new Date().toISOString().split("T")[0]);
      setCategory(expense?.category || initialValues?.category || "general");
      setVendorId(expense?.vendor_id || "none");
      setProjectId(expense?.project_id || "none");
      setPaymentMethod(expense?.payment_method || "bank_transfer");
      setPaymentStatus((expense as any)?.payment_status || "paid");
      setPaidDate((expense as any)?.paid_date || "");
      setNotes(expense?.notes || initialValues?.notes || "");
      setExternalAccountNumber((expense as any)?.external_account_number || initialValues?.external_account_number || "");
      setDueDate((expense as any)?.due_date || initialValues?.due_date || "");
      setSaving(false);
    }
  }, [open, expense, initialValues]);
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-list", workspaceId],
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("workspace_id", workspaceId).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-list", workspaceId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("workspace_id", workspaceId).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  const handleSubmit = async () => {
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!amount || Number(amount) <= 0) { toast.error("Valid amount is required"); return; }
    setSaving(true);
    const payload: any = {
      workspace_id: workspaceId,
      description: description.trim(),
      amount: Number(amount),
      currency,
      expense_date: expenseDate,
      category,
      vendor_id: vendorId === "none" ? null : vendorId,
      project_id: projectId === "none" ? null : projectId,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      paid_date: paymentStatus === "paid" ? (paidDate || expenseDate) : null,
      notes: notes || null,
      external_account_number: externalAccountNumber.trim() || null,
      due_date: dueDate || null,
      recorded_by: user!.id,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = expense
      ? await supabase.from("expenses").update(payload).eq("id", expense.id).select("id").single()
      : await supabase.from("expenses").insert(payload).select("id").single();
    if (error) { setSaving(false); toast.error("Failed to save expense"); return; }

    // If a receipt was attached via the scan flow, relink the file to this expense
    if (!expense && saved && attachedReceipt?.fileId) {
      try {
        await supabase.from("files")
          .update({ owner_type: "expense", owner_id: saved.id, updated_at: new Date().toISOString() })
          .eq("id", attachedReceipt.fileId);
      } catch (e) {
        console.warn("Could not relink attached receipt file:", e);
      }
    }

    setSaving(false);
    toast.success(expense ? "Expense updated" : "Expense recorded");
    if (!expense && user?.id) trackFirstEvent("expense.first_created", workspaceId, user.id);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {attachedReceipt && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Receipt attached: <span className="text-foreground font-medium">{attachedReceipt.fileName || "image"}</span>. It will be linked to this expense once saved.
            </div>
          )}
          <div><Label>Description *</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount ({currency}) *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Date *</Label><Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {vendors.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (overhead)</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Payment Status</Label>
              <Select value={paymentStatus} onValueChange={(v) => { setPaymentStatus(v); if (v === "unpaid") setPaidDate(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid (Payable)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentStatus === "paid" && (
              <div><Label>Paid Date</Label><Input type="date" value={paidDate || expenseDate} onChange={(e) => setPaidDate(e.target.value)} /></div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Account / Customer No.</Label><Input value={externalAccountNumber} onChange={(e) => setExternalAccountNumber(e.target.value)} placeholder="e.g. utility account number" /></div>
            <div><Label>Bill Due Date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
