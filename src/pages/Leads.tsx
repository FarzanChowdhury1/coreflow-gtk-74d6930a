import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Inbox, Plus, Search, FileText, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadTasksPanel } from "@/components/leads/LeadTasksPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { ProposalFormDialog } from "@/components/proposals/ProposalFormDialog";
import type { ProposalFormPrefill } from "@/components/proposals/ProposalFormDialog";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type Lead = Tables<"leads">;

const statusColors: Record<string, string> = {
  new: "bg-secondary text-secondary-foreground",
  contacted: "bg-primary/15 text-primary",
  qualified: "bg-success/15 text-success",
  unqualified: "bg-destructive/15 text-destructive",
  converted: "bg-accent text-accent-foreground",
};

export default function Leads() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [proposalPrefill, setProposalPrefill] = useState<ProposalFormPrefill | null>(null);
  const [meetingContext, setMeetingContext] = useState<{ lead_id?: string; company_id?: string; contact_id?: string } | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const workspaceId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30000,
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
    staleTime: 60000,
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
    staleTime: 60000,
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

  // RLS handles scoping — non-admins see only owned/relevant leads

  return (
    <div>
      {/* Shell renders immediately */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Lead Inbox</h1>
        </div>
        <Button size="sm" onClick={() => { setEditingLead(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Lead
        </Button>
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Track new business opportunities from first contact to conversion. When a lead is ready, convert it into a proposal.
      </p>

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
        <div className="rounded-lg border bg-card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">No leads yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Leads track new business opportunities from first contact to conversion. Add your first lead to start managing your sales pipeline.
          </p>
          <Button size="sm" onClick={() => { setEditingLead(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add First Lead
          </Button>
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
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{lead.title}</div>
                    {workspaceId && (
                      <LeadTasksPanel leadId={lead.id} workspaceId={workspaceId} />
                    )}
                  </td>
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
                  <td className="px-4 py-3 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMeetingContext({
                          lead_id: lead.id,
                          company_id: lead.company_id || undefined,
                          contact_id: lead.contact_id || undefined,
                        });
                      }}
                    >
                      <Calendar className="h-3.5 w-3.5 mr-1" /> Meet
                    </Button>
                    {lead.status !== "converted" && lead.status !== "unqualified" && lead.company_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProposalPrefill({
                            title: lead.title,
                            company_id: lead.company_id!,
                            notes: lead.notes || undefined,
                            lead_id: lead.id,
                          });
                        }}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1" /> Convert
                      </Button>
                    )}
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

      <ProposalFormDialog
        open={!!proposalPrefill}
        onOpenChange={(open) => { if (!open) setProposalPrefill(null); }}
        prefill={proposalPrefill || undefined}
        onCreated={async () => {
          // Mark lead as converted
          if (proposalPrefill?.lead_id) {
            await supabase
              .from("leads")
              .update({ status: "converted" as any })
              .eq("id", proposalPrefill.lead_id);
            queryClient.invalidateQueries({ queryKey: ["leads"] });
            toast.success("Lead converted to proposal");
          }
          setProposalPrefill(null);
          navigate("/proposals");
        }}
      />

      <MeetingFormDialog
        open={!!meetingContext}
        onOpenChange={(open) => { if (!open) setMeetingContext(null); }}
        onSaved={() => setMeetingContext(null)}
        defaultContext={meetingContext || undefined}
      />
    </div>
  );
}
