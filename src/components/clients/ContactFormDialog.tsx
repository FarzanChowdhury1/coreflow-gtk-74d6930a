import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { contactSchema } from "@/lib/validations";
import { PhoneInputIntl } from "@/components/ui/phone-input-intl";
import {
  PHONE_LABEL_OPTIONS,
  normalizePhones,
  type ContactPhone,
  type PhoneLabel,
} from "@/lib/phone";
import { SocialLinksEditor } from "@/components/clients/SocialLinksEditor";
import {
  cleanSocialsForSave,
  normalizeSocials,
  validateSocialEntry,
  type SocialEntry,
} from "@/lib/socials";
import type { Tables } from "@/integrations/supabase/types";
import { Plus, X } from "lucide-react";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  companies: Company[];
}

const MAX_PHONES = 10;

export function ContactFormDialog({ open, onOpenChange, contact, companies }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    designation: "",
    company_id: "",
    notes: "",
    lifecycle_status: "active" as string,
  });
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [socials, setSocials] = useState<SocialEntry[]>([]);
  const [socialErrors, setSocialErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (contact) {
      // Prefer new phones JSONB; fall back to legacy phone/alt_phone if empty.
      let initialPhones = normalizePhones((contact as any).phones);
      if (initialPhones.length === 0) {
        const legacy: ContactPhone[] = [];
        if (contact.phone) legacy.push({ label: "primary", number: contact.phone });
        if ((contact as any).alt_phone) legacy.push({ label: "alternate", number: (contact as any).alt_phone });
        initialPhones = legacy;
      }
      setPhones(initialPhones);
      setSocials(normalizeSocials((contact as any).socials));
      setForm({
        full_name: contact.full_name,
        email: contact.email || "",
        designation: contact.designation || "",
        company_id: contact.company_id || "",
        notes: contact.notes || "",
        lifecycle_status: (contact as any).lifecycle_status || "active",
      });
    } else {
      setPhones([]);
      setSocials([]);
      setForm({
        full_name: "",
        email: "",
        designation: "",
        company_id: "",
        notes: "",
        lifecycle_status: "active",
      });
    }
    setErrors({});
    setSocialErrors({});
  }, [contact, open]);

  const updatePhone = (idx: number, patch: Partial<ContactPhone>) => {
    setPhones((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const removePhone = (idx: number) => {
    setPhones((prev) => prev.filter((_, i) => i !== idx));
  };
  const addPhone = () => {
    if (phones.length >= MAX_PHONES) return;
    const usedLabels = new Set(phones.map((p) => p.label));
    const nextLabel: PhoneLabel =
      (PHONE_LABEL_OPTIONS.find((o) => !usedLabels.has(o.value))?.value as PhoneLabel) ?? "other";
    setPhones((prev) => [...prev, { label: nextLabel, number: "" }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Drop empty entries before validation/save
    const cleanedPhones = phones.filter((p) => p.number && p.number.trim().length > 0);
    const primary = cleanedPhones[0]?.number ?? "";
    const alternate = cleanedPhones[1]?.number ?? "";

    const result = contactSchema.safeParse({
      full_name: form.full_name,
      email: form.email,
      phone: primary,
      alt_phone: alternate,
      designation: form.designation,
      company_id: form.company_id,
      notes: form.notes,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as string;
        fieldErrors[path] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    // Per-phone validation (covers entries 3+ as well)
    const phoneErrors: Record<string, string> = {};
    cleanedPhones.forEach((p, i) => {
      // Reuse internationalPhoneSchema via contactSchema indirectly; here we
      // do a quick targeted check using the same validator by re-parsing.
      const r = contactSchema.shape.phone.safeParse(p.number);
      if (!r.success) phoneErrors[`phone_${i}`] = "Invalid phone number";
    });
    if (Object.keys(phoneErrors).length > 0) {
      setErrors(phoneErrors);
      return;
    }

    if (!currentWorkspace) return;
    setLoading(true);

    const payload = {
      full_name: result.data.full_name,
      email: result.data.email || null,
      // legacy columns are auto-synced by DB trigger from phones[],
      // but we also send them explicitly for environments where the
      // trigger hasn't run yet. The trigger overwrites with phones[].
      phone: primary || null,
      alt_phone: alternate || null,
      phones: cleanedPhones,
      designation: result.data.designation || null,
      company_id: result.data.company_id || null,
      notes: result.data.notes || null,
      workspace_id: currentWorkspace.id,
      lifecycle_status: form.lifecycle_status,
    } as any;

    if (contact) {
      const { error } = await supabase.from("contacts").update(payload).eq("id", contact.id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Contact updated" });
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
        onOpenChange(false);
      }
    } else {
      const { error } = await supabase.from("contacts").insert(payload);
      if (error) {
        toast({
          title: "Creation failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Contact created" });
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
        onOpenChange(false);
      }
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <DialogDescription>
            {contact
              ? "Update this contact's details. You can add multiple phone numbers."
              : "Add a contact person. You can add multiple phone numbers and link them to a client company."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Full Name *</label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Contact name"
            />
            {errors.full_name && <p className="mt-1 text-xs text-destructive">{errors.full_name}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="contact@company.com"
            />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
          </div>

          {/* Phone numbers — true multi-value */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">Phone numbers</label>
              {phones.length < MAX_PHONES && (
                <button
                  type="button"
                  onClick={addPhone}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add phone
                </button>
              )}
            </div>
            {phones.length === 0 && (
              <button
                type="button"
                onClick={addPhone}
                className="w-full rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
              >
                + Add a phone number
              </button>
            )}
            <div className="space-y-2">
              {phones.map((p, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex gap-2">
                    <select
                      value={p.label}
                      onChange={(e) => updatePhone(i, { label: e.target.value as PhoneLabel })}
                      className="h-10 w-[110px] shrink-0 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {PHONE_LABEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <PhoneInputIntl
                      value={p.number}
                      onChange={(v) => updatePhone(i, { number: v })}
                      className="flex-1"
                      error={errors[`phone_${i}`] || (i === 0 ? errors.phone : i === 1 ? errors.alt_phone : undefined)}
                    />
                    <button
                      type="button"
                      onClick={() => removePhone(i)}
                      className="h-10 w-10 shrink-0 rounded-md border text-muted-foreground hover:text-destructive flex items-center justify-center"
                      aria-label="Remove phone"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
            <select
              value={form.lifecycle_status}
              onChange={(e) => setForm((f) => ({ ...f, lifecycle_status: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="left_company">Left Company</option>
              <option value="bounced">Bounced / Unreachable</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Designation</label>
              <input
                type="text"
                value={form.designation}
                onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Director"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Company</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legal_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="Internal notes..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : contact ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
