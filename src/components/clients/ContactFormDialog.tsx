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
import { contactSchema, type ContactFormData } from "@/lib/validations";
import type { Tables } from "@/integrations/supabase/types";
import { Plus, X } from "lucide-react";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

const COUNTRY_CODES = [
  { code: "+880", label: "🇧🇩 +880", country: "Bangladesh" },
  { code: "+91", label: "🇮🇳 +91", country: "India" },
  { code: "+1", label: "🇺🇸 +1", country: "US/Canada" },
  { code: "+44", label: "🇬🇧 +44", country: "UK" },
  { code: "+971", label: "🇦🇪 +971", country: "UAE" },
  { code: "+966", label: "🇸🇦 +966", country: "Saudi Arabia" },
  { code: "+65", label: "🇸🇬 +65", country: "Singapore" },
  { code: "+60", label: "🇲🇾 +60", country: "Malaysia" },
  { code: "+86", label: "🇨🇳 +86", country: "China" },
  { code: "+81", label: "🇯🇵 +81", country: "Japan" },
];

function parsePhoneCountryCode(phone: string): { countryCode: string; localNumber: string } {
  if (!phone) return { countryCode: "+880", localNumber: "" };
  // Try matching longest codes first
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    if (phone.startsWith(cc.code)) {
      return { countryCode: cc.code, localNumber: phone.slice(cc.code.length) };
    }
  }
  // Fallback: if starts with +, take first few digits as code
  if (phone.startsWith("+")) {
    return { countryCode: "+880", localNumber: phone.replace(/^\+\d{1,3}/, "") };
  }
  return { countryCode: "+880", localNumber: phone };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  companies: Company[];
}

export function ContactFormDialog({ open, onOpenChange, contact, companies }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAltPhone, setShowAltPhone] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone_code: "+880",
    phone_local: "",
    alt_phone_code: "+880",
    alt_phone_local: "",
    designation: "",
    company_id: "",
    notes: "",
  });

  useEffect(() => {
    if (contact) {
      const parsed = parsePhoneCountryCode(contact.phone || "");
      const altParsed = parsePhoneCountryCode((contact as any).alt_phone || "");
      const hasAlt = !!(contact as any).alt_phone;
      setShowAltPhone(hasAlt);
      setForm({
        full_name: contact.full_name,
        email: contact.email || "",
        phone_code: parsed.countryCode,
        phone_local: parsed.localNumber,
        alt_phone_code: altParsed.countryCode,
        alt_phone_local: altParsed.localNumber,
        designation: contact.designation || "",
        company_id: contact.company_id || "",
        notes: contact.notes || "",
      });
    } else {
      setShowAltPhone(false);
      setForm({
        full_name: "", email: "",
        phone_code: "+880", phone_local: "",
        alt_phone_code: "+880", alt_phone_local: "",
        designation: "", company_id: "", notes: "",
      });
    }
    setErrors({});
  }, [contact, open]);

  const buildPhone = (code: string, local: string) => {
    const cleaned = local.replace(/[^0-9]/g, "");
    return cleaned ? `${code}${cleaned}` : "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const phone = buildPhone(form.phone_code, form.phone_local);
    const alt_phone = showAltPhone ? buildPhone(form.alt_phone_code, form.alt_phone_local) : "";

    const result = contactSchema.safeParse({
      full_name: form.full_name,
      email: form.email,
      phone,
      alt_phone,
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

    if (!currentWorkspace) return;
    setLoading(true);

    const payload = {
      full_name: result.data.full_name,
      email: result.data.email || null,
      phone: result.data.phone || null,
      alt_phone: result.data.alt_phone || null,
      designation: result.data.designation || null,
      company_id: result.data.company_id || null,
      notes: result.data.notes || null,
      workspace_id: currentWorkspace.id,
    } as any;

    if (contact) {
      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", contact.id);
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
          description: error.message.includes("phone")
            ? "Phone must be in international format (e.g. +8801712345678)"
            : error.message,
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

  const PhoneInput = ({
    codeValue,
    localValue,
    onCodeChange,
    onLocalChange,
    label,
    error,
  }: {
    codeValue: string;
    localValue: string;
    onCodeChange: (v: string) => void;
    onLocalChange: (v: string) => void;
    label: string;
    error?: string;
  }) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
      <div className="flex gap-2">
        <select
          value={codeValue}
          onChange={(e) => onCodeChange(e.target.value)}
          className="h-10 w-[120px] shrink-0 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {COUNTRY_CODES.map((cc) => (
            <option key={cc.code} value={cc.code}>{cc.label}</option>
          ))}
        </select>
        <input
          type="tel"
          value={localValue}
          onChange={(e) => onLocalChange(e.target.value.replace(/[^0-9]/g, ""))}
          className="h-10 flex-1 rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="1712345678"
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <DialogDescription>
            {contact
              ? "Update this contact's details."
              : "Add a person at a client company. They can receive portal links and communications."}
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

          <PhoneInput
            codeValue={form.phone_code}
            localValue={form.phone_local}
            onCodeChange={(v) => setForm((f) => ({ ...f, phone_code: v }))}
            onLocalChange={(v) => setForm((f) => ({ ...f, phone_local: v }))}
            label="Phone"
            error={errors.phone}
          />

          {showAltPhone ? (
            <div className="relative">
              <PhoneInput
                codeValue={form.alt_phone_code}
                localValue={form.alt_phone_local}
                onCodeChange={(v) => setForm((f) => ({ ...f, alt_phone_code: v }))}
                onLocalChange={(v) => setForm((f) => ({ ...f, alt_phone_local: v }))}
                label="Alternate Phone"
                error={errors.alt_phone}
              />
              <button
                type="button"
                onClick={() => {
                  setShowAltPhone(false);
                  setForm((f) => ({ ...f, alt_phone_local: "" }));
                }}
                className="absolute top-0 right-0 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAltPhone(true)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Add alternate phone
            </button>
          )}

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
                  <option key={c.id} value={c.id}>{c.legal_name}</option>
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
