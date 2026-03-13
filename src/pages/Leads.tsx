import { useState } from "react";
import { Inbox, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/integrations/supabase/types";

type Lead = Tables<"leads">;

const statusColors: Record<string, string> = {
  new: "bg-secondary text-secondary-foreground",
  contacted: "bg-primary/15 text-primary",
  qualified: "bg-success/15 text-success",
  unqualified: "bg-destructive/15 text-destructive",
  converted: "bg-accent text-accent-foreground",
};

export default function Leads() {
  const { currentWorkspace } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const workspaceId = currentWorkspace?.id;

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const filteredLeads = leads.filter((l) =>
    l.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getCompanyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.legal_name ?? "—" : "—";

  const getContactName = (id: string | null) =>
    id ? contacts.find((c) => c.id === id)?.full_name ?? "—" : "—";

  const formatFollowUp = (date: string | null) => {
    if (!date) return "—";
    const d = new Date(date);
    const now = new Date();
    const isOverdue = d < now;
    return (
      <span className={isOverdue ? "text-destructive font-medium" : ""}>
        {d.toLocaleDateString()}
        {isOverdue && " (overdue)"}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Lead Inbox</h1>
        </div>
        <Button size="sm" onClick={() => { setEditingLead(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Lead
        </Button>
      </div>

      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
      ) : filteredLeads.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p>No leads yet. Capture your first lead to start tracking momentum.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Value</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Follow-up</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{lead.title}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className={statusColors[lead.status] || ""}>
                      {lead.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{getCompanyName(lead.company_id)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{getContactName(lead.contact_id)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.estimated_value ? `${lead.currency} ${Number(lead.estimated_value).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatFollowUp(lead.next_follow_up)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditingLead(lead); setDialogOpen(true); }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeadFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        lead={editingLead}
        companies={companies}
        contacts={contacts}
      />
    </div>
  );
}
