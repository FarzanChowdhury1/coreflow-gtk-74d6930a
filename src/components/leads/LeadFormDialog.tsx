import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { leadSchema, type LeadFormData } from "@/lib/validations";
import { trackFirstEvent } from "@/lib/events";
import type { Tables } from "@/integrations/supabase/types";

type Lead = Tables<"leads">;
type Company = Tables<"companies">;
type Contact = Tables<"contacts">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  companies: Company[];
  contacts: Contact[];
}

export function LeadFormDialog({ open, onOpenChange, lead, companies, contacts }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    title: "",
    status: "new" as const,
    source: "",
    estimated_value: "",
    company_id: "",
    contact_id: "",
    notes: "",
    next_follow_up: "",
  });

  useEffect(() => {
    if (lead) {
      setForm({
        title: lead.title,
        status: lead.status as any,
        source: lead.source || "",
        estimated_value: lead.estimated_value?.toString() || "",
        company_id: lead.company_id || "",
        contact_id: lead.contact_id || "",
        notes: lead.notes || "",
        next_follow_up: lead.next_follow_up ? lead.next_follow_up.split("T")[0] : "",
      });
    } else {
      setForm({
        title: "", status: "new", source: "", estimated_value: "",
        company_id: "", contact_id: "", notes: "", next_follow_up: "",
      });
    }
    setErrors({});
  }, [lead, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = leadSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as string;
        fieldErrors[path] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    if (!currentWorkspace || !user) return;
    setLoading(true);

    const basePayload = {
      title: result.data.title,
      status: result.data.status as any,
      source: result.data.source || null,
      estimated_value: result.data.estimated_value ?? null,
      company_id: result.data.company_id || null,
      contact_id: result.data.contact_id || null,
      notes: result.data.notes || null,
      next_follow_up: result.data.next_follow_up || null,
      workspace_id: currentWorkspace.id,
    };

    if (lead) {
      // Do NOT overwrite owner_id on update — preserve original owner
      const { error } = await supabase.from("leads").update(basePayload).eq("id", lead.id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Lead updated" });
        queryClient.invalidateQueries({ queryKey: ["leads"] });
        onOpenChange(false);
      }
    } else {
      const { error } = await supabase.from("leads").insert({ ...basePayload, owner_id: user.id });
      if (error) {
        toast({ title: "Creation failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Lead created" });
        trackFirstEvent("lead.first_created", currentWorkspace.id, user.id);
        queryClient.invalidateQueries({ queryKey: ["leads"] });
        onOpenChange(false);
      }
    }

    setLoading(false);
  };

  const filteredContacts = form.company_id
    ? contacts.filter((c) => c.company_id === form.company_id)
    : contacts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit Lead" : "New Lead"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Lead title"
            />
            {errors.title && <p className="mt-1 text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
                <option value="converted">Converted</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Source</label>
              <input
                type="text"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Referral"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Estimated Value (BDT)</label>
              <input
                type="number"
                value={form.estimated_value}
                onChange={(e) => setForm((f) => ({ ...f, estimated_value: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Next Follow-up</label>
              <input
                type="date"
                value={form.next_follow_up}
                onChange={(e) => setForm((f) => ({ ...f, next_follow_up: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Company</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value, contact_id: "" }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legal_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Contact</label>
              <select
                value={form.contact_id}
                onChange={(e) => setForm((f) => ({ ...f, contact_id: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None</option>
                {filteredContacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
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
              rows={3}
              placeholder="Internal notes..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : lead ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
