import { useState, useMemo } from "react";
import { Store, Plus, Archive, ArchiveRestore, Pencil, Download } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { VendorFormDialog } from "@/components/vendors/VendorFormDialog";

export interface Vendor {
  id: string;
  workspace_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

const CATEGORIES = ["general", "freelancer", "software", "media", "logistics", "consulting", "other"];

export default function Vendors() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const isAdmin = currentRole === "admin";
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", currentWorkspace?.id, showArchived],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      let q = supabase
        .from("vendors")
        .select("*")
        .eq("workspace_id", currentWorkspace!.id)
        .order("name");
      if (!showArchived) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return vendors;
    const s = search.toLowerCase();
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(s) ||
        v.contact_name?.toLowerCase().includes(s) ||
        v.category?.toLowerCase().includes(s)
    );
  }, [vendors, search]);

  const toggleArchive = async (v: Vendor) => {
    const { error } = await supabase
      .from("vendors")
      .update({ deleted_at: v.deleted_at ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", v.id);
    if (error) { toast.error("Failed to update vendor"); return; }
    toast.success(v.deleted_at ? "Vendor restored" : "Vendor archived");
    queryClient.invalidateQueries({ queryKey: ["vendors"] });
  };

  const handleExport = () => {
    exportToCSV(filtered, [
      { key: "name", label: "Vendor Name" },
      { key: "category", label: "Category" },
      { key: "contact_name", label: "Contact" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "notes", label: "Notes" },
    ], "vendors");
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Store className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Vendors</h1>
        <PageInfoButton
          title="Vendors"
          description="Your directory of external suppliers, freelancers, and service providers. Link vendors to expenses and subscriptions for better cost tracking."
          actions={["Add and manage vendor contacts", "Link vendors to expenses and subscriptions", "Archive inactive vendors"]}
          audience="Admins managing business relationships and costs."
        />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">External suppliers and service providers your business works with.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input placeholder="Search vendors…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        {isAdmin && (
          <>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Add Vendor
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Switch id="show-archived-vendors" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived-vendors" className="text-xs">Show archived</Label>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {search ? "No vendors match your search." : "No vendors yet. Add your first vendor to start tracking supplier relationships."}
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => (
            <Card key={v.id} className={v.deleted_at ? "opacity-60" : ""}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-card-foreground">{v.name}</p>
                    {v.contact_name && <p className="text-xs text-muted-foreground">{v.contact_name}</p>}
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{v.category || "general"}</Badge>
                </div>
                {(v.email || v.phone) && (
                  <p className="text-xs text-muted-foreground">{[v.email, v.phone].filter(Boolean).join(" · ")}</p>
                )}
                {v.deleted_at && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                {isAdmin && (
                  <div className="flex gap-1 pt-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditing(v); setFormOpen(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggleArchive(v)}>
                      {v.deleted_at ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <VendorFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          vendor={editing}
          workspaceId={currentWorkspace!.id}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["vendors"] }); setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
