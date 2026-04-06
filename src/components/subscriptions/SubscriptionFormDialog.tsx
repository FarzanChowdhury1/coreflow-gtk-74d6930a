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
import { SUB_CATEGORIES, type Subscription } from "@/pages/Subscriptions";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subscription: Subscription | null;
  workspaceId: string;
  currency: string;
  onSaved: () => void;
}

export function SubscriptionFormDialog({ open, onOpenChange, subscription, workspaceId, currency, onSaved }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [intervalMonths, setIntervalMonths] = useState("1");
  const [nextBilling, setNextBilling] = useState(new Date().toISOString().split("T")[0]);
  const [category, setCategory] = useState("software");
  const [vendorId, setVendorId] = useState("none");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(subscription?.name || "");
      setAmount(subscription?.amount?.toString() || "");
      setIntervalMonths(subscription?.interval_months?.toString() || "1");
      setNextBilling(subscription?.next_billing_date || new Date().toISOString().split("T")[0]);
      setCategory(subscription?.category || "software");
      setVendorId(subscription?.vendor_id || "none");
      setNotes(subscription?.notes || "");
      setSaving(false);
    }
  }, [open, subscription]);
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-list", workspaceId],
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("workspace_id", workspaceId).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!amount || Number(amount) <= 0) { toast.error("Valid amount is required"); return; }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      name: name.trim(),
      amount: Number(amount),
      currency,
      interval_months: Number(intervalMonths),
      next_billing_date: nextBilling,
      category,
      vendor_id: vendorId === "none" ? null : vendorId,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = subscription
      ? await supabase.from("subscriptions").update(payload).eq("id", subscription.id)
      : await supabase.from("subscriptions").insert(payload);
    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    toast.success(subscription ? "Subscription updated" : "Subscription created");
    if (!subscription && user?.id) trackFirstEvent("subscription.first_created", workspaceId, user.id);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{subscription ? "Edit Subscription" : "Add Subscription"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Figma, AWS, Slack" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount ({currency}) *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Interval</Label>
              <Select value={intervalMonths} onValueChange={setIntervalMonths}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Monthly</SelectItem>
                  <SelectItem value="3">Quarterly</SelectItem>
                  <SelectItem value="6">Semi-annual</SelectItem>
                  <SelectItem value="12">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Next Billing Date</Label><Input type="date" value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} /></div>
            <div><Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {vendors.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
