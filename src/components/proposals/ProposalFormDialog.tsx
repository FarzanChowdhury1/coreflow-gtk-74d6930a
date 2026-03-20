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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Search } from "lucide-react";

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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ title: "", company_id: "", notes: "" });
  const [companySearch, setCompanySearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
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
    if (open) {
      const prefillCompany = prefill?.company_id
        ? companies.find((c) => c.id === prefill.company_id)
        : null;
      setForm({
        title: prefill?.title || "",
        company_id: prefill?.company_id || "",
        notes: prefill?.notes || "",
      });
      setCompanySearch(prefillCompany?.legal_name || "");
      setShowDropdown(false);
    }
  }, [open, prefill, companies]);

  const filteredCompanies = companies.filter((c) =>
    c.legal_name.toLowerCase().includes(companySearch.toLowerCase())
  );

  const selectedCompanyName = companies.find((c) => c.id === form.company_id)?.legal_name;

  const handleCompanySelect = (id: string, name: string) => {
    setForm((f) => ({ ...f, company_id: id }));
    setCompanySearch(name);
    setShowDropdown(false);
  };

  const handleCompanySearchChange = (value: string) => {
    setCompanySearch(value);
    setShowDropdown(true);
    // Clear selection if user edits the text away from the selected company
    if (selectedCompanyName && value !== selectedCompanyName) {
      setForm((f) => ({ ...f, company_id: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.company_id || !workspaceId) return;
    setLoading(true);

    const { data: proposal, error: pError } = await supabase
      .from("proposals")
      .insert({
        workspace_id: workspaceId,
        company_id: form.company_id,
        title: form.title.trim(),
        notes: form.notes || null,
        lead_id: prefill?.lead_id || null,
      } as any)
      .select()
      .single();

    if (pError || !proposal) {
      toast({ title: "Creation failed", description: pError?.message, variant: "destructive" });
      setLoading(false);
      return;
    }

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
      onCreated?.();
      onOpenChange(false);
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Proposal</DialogTitle>
          <DialogDescription>
            Create a proposal for a client company. You can add line items and pricing after creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Website Redesign Q2 2026"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Company *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={companySearch}
                onChange={(e) => handleCompanySearchChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search companies..."
              />
              {showDropdown && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                  {filteredCompanies.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No companies found. Add one in Client Directory first.
                    </div>
                  ) : (
                    filteredCompanies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                          form.company_id === c.id ? "bg-accent font-medium" : ""
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCompanySelect(c.id, c.legal_name)}
                      >
                        <span className="text-foreground">{c.legal_name}</span>
                        {c.bin && (
                          <span className="ml-2 text-xs text-muted-foreground font-mono">{c.bin}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {form.company_id && (
              <p className="mt-1 text-xs text-muted-foreground">
                Selected: {selectedCompanyName}
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
              placeholder="Scope summary, context..."
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
