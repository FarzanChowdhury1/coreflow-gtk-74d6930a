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
import { companySchema } from "@/lib/validations";
import { PhoneInputIntl } from "@/components/ui/phone-input-intl";
import { SocialLinksEditor } from "@/components/clients/SocialLinksEditor";
import {
  cleanSocialsForSave,
  normalizeSocials,
  validateSocialEntry,
  type SocialEntry,
} from "@/lib/socials";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export function CompanyFormDialog({ open, onOpenChange, company }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    legal_name: "",
    bin: "",
    address: "",
    phone: "",
    notes: "",
  });
  const [socials, setSocials] = useState<SocialEntry[]>([]);
  const [socialErrors, setSocialErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (company) {
      setForm({
        legal_name: company.legal_name,
        bin: company.bin || "",
        address: company.address || "",
        phone: (company as any).phone || "",
        notes: company.notes || "",
      });
      setSocials(normalizeSocials((company as any).socials));
    } else {
      setForm({ legal_name: "", bin: "", address: "", phone: "", notes: "" });
      setSocials([]);
    }
    setErrors({});
    setSocialErrors({});
  }, [company, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = companySchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as string;
        fieldErrors[path] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    // Validate socials per-entry
    const sErrs: Record<number, string> = {};
    socials.forEach((s, i) => {
      const msg = validateSocialEntry(s);
      if (msg) sErrs[i] = msg;
    });
    if (Object.keys(sErrs).length > 0) {
      setSocialErrors(sErrs);
      return;
    }
    setSocialErrors({});

    if (!currentWorkspace) return;
    setLoading(true);

    const payload = {
      legal_name: result.data.legal_name,
      bin: result.data.bin || null,
      address: result.data.address || null,
      phone: result.data.phone || null,
      notes: result.data.notes || null,
      socials: cleanSocialsForSave(socials),
      workspace_id: currentWorkspace.id,
    } as any;

    if (company) {
      const { error } = await supabase
        .from("companies")
        .update(payload)
        .eq("id", company.id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Company updated" });
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        onOpenChange(false);
      }
    } else {
      const { error } = await supabase.from("companies").insert(payload);
      if (error) {
        toast({
          title: "Creation failed",
          description: error.message.includes("companies_bin_length")
            ? "BIN must be exactly 13 alphanumeric characters"
            : error.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Company created" });
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        onOpenChange(false);
      }
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{company ? "Edit Company" : "Add Company"}</DialogTitle>
          <DialogDescription>
            {company
              ? "Update this company's details."
              : "Add a client company. You can link contacts, proposals, and invoices to it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Legal Name *</label>
            <input
              type="text"
              value={form.legal_name}
              onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Company legal name"
            />
            {errors.legal_name && <p className="mt-1 text-xs text-destructive">{errors.legal_name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                BIN
              </label>
              <input
                type="text"
                value={form.bin}
                onChange={(e) => setForm((f) => ({ ...f, bin: e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 13) }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Optional"
                maxLength={13}
              />
              {errors.bin && <p className="mt-1 text-xs text-destructive">{errors.bin}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                13-character Business ID Number (optional)
              </p>
            </div>
            <PhoneInputIntl
              label="Phone"
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              error={errors.phone}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Business address"
            />
          </div>
          <SocialLinksEditor value={socials} onChange={setSocials} errors={socialErrors} />
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
              {loading ? "Saving..." : company ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
