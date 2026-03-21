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
import { toast } from "sonner";
import { EXPENSE_CATEGORIES, type Expense } from "@/pages/Expenses";

const PAYMENT_METHODS = ["bank_transfer", "cash", "credit_card", "mobile_banking", "cheque", "other"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expense: Expense | null;
  workspaceId: string;
  currency: string;
  onSaved: () => void;
}

export function ExpenseFormDialog({ open, onOpenChange, expense, workspaceId, currency, onSaved }: Props) {
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [category, setCategory] = useState("general");
  const [vendorId, setVendorId] = useState("none");
  const [projectId, setProjectId] = useState("none");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription(expense?.description || "");
      setAmount(expense?.amount?.toString() || "");
      setExpenseDate(expense?.expense_date || new Date().toISOString().split("T")[0]);
      setCategory(expense?.category || "general");
      setVendorId(expense?.vendor_id || "none");
      setProjectId(expense?.project_id || "none");
      setPaymentMethod(expense?.payment_method || "bank_transfer");
      setNotes(expense?.notes || "");
      setSaving(false);
    }
  }, [open, expense]);
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
    const payload = {
      workspace_id: workspaceId,
      description: description.trim(),
      amount: Number(amount),
      currency,
      expense_date: expenseDate,
      category,
      vendor_id: vendorId === "none" ? null : vendorId,
      project_id: projectId === "none" ? null : projectId,
      payment_method: paymentMethod,
      notes: notes || null,
      recorded_by: user!.id,
      updated_at: new Date().toISOString(),
    };
    const { error } = expense
      ? await supabase.from("expenses").update(payload).eq("id", expense.id)
      : await supabase.from("expenses").insert(payload);
    setSaving(false);
    if (error) { toast.error("Failed to save expense"); return; }
    toast.success(expense ? "Expense updated" : "Expense recorded");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
