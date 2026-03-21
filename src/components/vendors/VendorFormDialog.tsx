import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Vendor } from "@/pages/Vendors";

const CATEGORIES = ["general", "freelancer", "software", "media", "logistics", "consulting", "other"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendor: Vendor | null;
  workspaceId: string;
  onSaved: () => void;
}

export function VendorFormDialog({ open, onOpenChange, vendor, workspaceId, onSaved }: Props) {
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("general");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(vendor?.name || "");
      setContactName(vendor?.contact_name || "");
      setEmail(vendor?.email || "");
      setPhone(vendor?.phone || "");
      setCategory(vendor?.category || "general");
      setNotes(vendor?.notes || "");
      setSaving(false);
    }
  }, [open, vendor]);
  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Vendor name is required"); return; }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      name: name.trim(),
      contact_name: contactName || null,
      email: email || null,
      phone: phone || null,
      category,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = vendor
      ? await supabase.from("vendors").update(payload).eq("id", vendor.id)
      : await supabase.from("vendors").insert(payload);
    setSaving(false);
    if (error) { toast.error("Failed to save vendor"); return; }
    toast.success(vendor ? "Vendor updated" : "Vendor created");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{vendor ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Contact Name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
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
