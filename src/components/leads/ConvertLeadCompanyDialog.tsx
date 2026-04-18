import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Search, Plus, Building2 } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;
type Lead = Tables<"leads">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  companies: Company[];
  /** Called with the resolved company_id once user picks/creates a company. */
  onResolved: (companyId: string) => void;
}

/**
 * In-flow company resolver for converting a no-company lead → proposal.
 * Two modes: pick existing OR create a minimal new company inline.
 * Keeps proposals commercially clean (always company-bound).
 */
export function ConvertLeadCompanyDialog({
  open,
  onOpenChange,
  lead,
  companies,
  onResolved,
}: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("pick");
      setSearch("");
      setNewName(lead?.title ? `${lead.title} (Client)` : "");
    }
  }, [open, lead]);

  const filtered = useMemo(
    () =>
      companies
        .filter((c) => !c.deleted_at)
        .filter((c) => c.legal_name.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 25),
    [companies, search]
  );

  const handlePick = (id: string) => {
    onResolved(id);
    onOpenChange(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !currentWorkspace) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("companies")
      .insert({ workspace_id: currentWorkspace.id, legal_name: name })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(error?.message || "Failed to create company");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    toast.success("Company created");
    onResolved(data.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a company for this proposal</DialogTitle>
          <DialogDescription>
            This lead has no linked company. Proposals must be tied to a company so
            invoices and documents stay clean. Pick an existing company or create
            one now.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md border bg-muted/40 p-0.5">
          <Button
            type="button"
            variant={mode === "pick" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 h-7"
            onClick={() => setMode("pick")}
          >
            Pick existing
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 h-7"
            onClick={() => setMode("create")}
          >
            Create new
          </Button>
        </div>

        {mode === "pick" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies..."
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border bg-popover">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  No companies match. Switch to “Create new”.
                </div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handlePick(c.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors border-b last:border-0"
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-foreground truncate">{c.legal_name}</span>
                    {c.bin && (
                      <span className="ml-auto text-xs text-muted-foreground font-mono">
                        {c.bin}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Company name *
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Legal name"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                You can add address, BIN, contacts, and other details later from
                Client Directory.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={creating || !newName.trim()}
                onClick={handleCreate}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {creating ? "Creating..." : "Create & continue"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
