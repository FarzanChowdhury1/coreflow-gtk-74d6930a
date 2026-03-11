import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { contactSchema, type ContactFormData } from "@/lib/validations";
import type { Tables } from "@/integrations/supabase/types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

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

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    designation: "",
    company_id: "",
    notes: "",
  });

  useEffect(() => {
    if (contact) {
      setForm({
        full_name: contact.full_name,
        email: contact.email || "",
        phone: contact.phone || "",
        designation: contact.designation || "",
        company_id: contact.company_id || "",
        notes: contact.notes || "",
      });
    } else {
      setForm({ full_name: "", email: "", phone: "", designation: "", company_id: "", notes: "" });
    }
    setErrors({});
  }, [contact, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = contactSchema.safeParse(form);
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
      designation: result.data.designation || null,
      company_id: result.data.company_id || null,
      notes: result.data.notes || null,
      workspace_id: currentWorkspace.id,
    };

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
          description: error.message.includes("contacts_phone_international")
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
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
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Phone (International)</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="+8801712345678"
            />
            {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              Must start with + followed by country code (e.g. +880 for Bangladesh)
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Designation</label>
            <input
              type="text"
              value={form.designation}
              onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Managing Director"
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
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
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
