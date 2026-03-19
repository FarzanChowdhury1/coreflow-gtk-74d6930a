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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface ProposalFormPrefill {
  title?: string;
  company_id?: string;
  notes?: string;
  lead_id?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: ProposalFormPrefill;
  onCreated?: () => void;
}

export function ProposalFormDialog({ open, onOpenChange, prefill, onCreated }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ title: "", company_id: "", notes: "" });
  const workspaceId = currentWorkspace?.id;

  const { data: companies = [] } = useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data } = await supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", workspaceId);
      return data || [];
    },
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (open) setForm({ title: "", company_id: "", notes: "" });
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.company_id || !workspaceId) return;
    setLoading(true);

    // Create proposal
    const { data: proposal, error: pError } = await supabase
      .from("proposals")
      .insert({
        workspace_id: workspaceId,
        company_id: form.company_id,
        title: form.title.trim(),
        notes: form.notes || null,
      })
      .select()
      .single();

    if (pError || !proposal) {
      toast({ title: "Creation failed", description: pError?.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Auto-create first version (v1, draft)
    const { error: vError } = await supabase
      .from("proposal_versions")
      .insert({
        workspace_id: workspaceId,
        proposal_id: proposal.id,
        version_number: 1,
        status: "draft",
        tax_config: [{ name: "VAT", rate_bps: 1500 }],
      });

    if (vError) {
      toast({ title: "Version creation failed", description: vError.message, variant: "destructive" });
    } else {
      toast({ title: "Proposal created with draft v1" });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["proposal_versions_latest"] });
      onOpenChange(false);
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Proposal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Proposal title"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Company *</label>
            <select
              value={form.company_id}
              onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              <option value="">Select company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.legal_name}</option>
              ))}
            </select>
            {companies.length === 0 && (
              <p className="mt-1 text-xs text-destructive">
                You need to add a company first in Client Directory.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !form.company_id}>
              {loading ? "Creating..." : "Create Proposal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
