import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renewal: any | null;
  companies: { id: string; legal_name: string }[];
  projects: { id: string; name: string }[];
}

export function RenewalFormDialog({ open, onOpenChange, renewal, companies, projects }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [intervalMonths, setIntervalMonths] = useState("12");
  const [nextBillingDate, setNextBillingDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (renewal) {
      setLabel(renewal.label || "");
      setCompanyId(renewal.company_id || "");
      setProjectId(renewal.project_id || "");
      setAmount(String(renewal.amount || ""));
      setCurrency(renewal.currency || "BDT");
      setIntervalMonths(String(renewal.interval_months || "12"));
      setNextBillingDate(renewal.next_billing_date || "");
      setNotes(renewal.notes || "");
    } else {
      setLabel(""); setCompanyId(""); setProjectId(""); setAmount("");
      setCurrency("BDT"); setIntervalMonths("12"); setNextBillingDate(""); setNotes("");
    }
  }, [renewal, open]);

  const handleSave = async () => {
    if (!currentWorkspace || !label.trim() || !companyId || !nextBillingDate || !amount) {
      toast.error("Fill all required fields");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("manage_renewal", {
      _action: renewal ? "update" : "create",
      _workspace_id: currentWorkspace.id,
      _renewal_id: renewal?.id || null,
      _label: label.trim(),
      _company_id: companyId,
      _project_id: projectId || null,
      _amount: parseFloat(amount),
      _currency: currency,
      _interval_months: parseInt(intervalMonths),
      _next_billing_date: nextBillingDate,
      _notes: notes.trim() || null,
      _is_active: renewal?.is_active ?? true,
    });
    const result = data as unknown as { success: boolean; error?: string };
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Failed");
      setSaving(false);
      return;
    }
    toast.success(renewal ? "Renewal updated" : "Renewal created");
    queryClient.invalidateQueries({ queryKey: ["renewals"] });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{renewal ? "Edit Renewal" : "New Renewal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Label / Contract Name *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Annual Support Contract" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Company *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project (optional)</Label>
              <Select value={projectId || "__none__"} onValueChange={(val) => setProjectId(val === "__none__" ? "" : val)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Amount *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Interval (months)</Label>
              <Select value={intervalMonths} onValueChange={setIntervalMonths}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Monthly</SelectItem>
                  <SelectItem value="3">Quarterly</SelectItem>
                  <SelectItem value="6">Semi-annual</SelectItem>
                  <SelectItem value="12">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Next Billing Date *</Label>
            <Input type="date" value={nextBillingDate} onChange={(e) => setNextBillingDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : renewal ? "Update" : "Create"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
