import { useState, useEffect, useRef } from "react";
import { Inbox, Plus, Search, FileText, Calendar, Archive, RotateCcw, Download } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { Button } from "@/components/ui/button";
import { LeadTasksPanel } from "@/components/leads/LeadTasksPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceCompanies, useWorkspaceContacts } from "@/hooks/use-workspace-queries";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { ProposalFormDialog } from "@/components/proposals/ProposalFormDialog";
import type { ProposalFormPrefill } from "@/components/proposals/ProposalFormDialog";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [proposalPrefill, setProposalPrefill] = useState<ProposalFormPrefill | null>(null);
  const [meetingContext, setMeetingContext] = useState<{ lead_id?: string; company_id?: string; contact_id?: string } | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const workspaceId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  // Deep-link from search: ?highlight=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hId = params.get("highlight");
    if (hId) {
      setHighlightId(hId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Scroll to highlighted lead when data loads
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      // Clear highlight after 3s
      const t = setTimeout(() => setHighlightId(null), 3000);
      return () => clearTimeout(t);
    }
  }, [highlightId, leads]);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", workspaceId, showArchived],
    queryFn: async () => {
      if (!workspaceId) return [];
      let query = supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (!showArchived) {
        query = query.is("deleted_at", null);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });

  const { data: companies = [] } = useWorkspaceCompanies(workspaceId);
  const { data: contacts = [] } = useWorkspaceContacts(workspaceId);

  const filteredLeads = leads.filter((l) =>
    l.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeLeads = filteredLeads.filter((l) => !l.deleted_at);
  const archivedLeads = filteredLeads.filter((l) => l.deleted_at);

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

  const handleArchive = async (lead: Lead) => {
    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", lead.id);
    if (error) {
      toast.error("Failed to archive lead");
    } else {
      toast.success("Lead archived");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    }
  };

  const handleRestore = async (lead: Lead) => {
    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: null } as any)
      .eq("id", lead.id);
    if (error) {
      toast.error("Failed to restore lead");
    } else {
      toast.success("Lead restored");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    }
  };

  const renderLeadRow = (lead: Lead) => {
    const isArchived = !!lead.deleted_at;
    return (
      <tr
        key={lead.id}
        ref={lead.id === highlightId ? highlightRef : undefined}
        className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isArchived ? "opacity-60" : ""} ${lead.id === highlightId ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{lead.title}</span>
            {isArchived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
          </div>
          {!isArchived && workspaceId && (
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
          {(isAdmin || lead.owner_id === user?.id) && (
            <>
              {isArchived ? (
                <Button variant="ghost" size="sm" onClick={() => handleRestore(lead)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                </Button>
              ) : (
                <>
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
                  {isAdmin && lead.status !== "converted" && lead.status !== "unqualified" && lead.company_id && (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleArchive(lead)}
                    title="Archive this lead"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </>
          )}
        </td>
      </tr>
    );
  };

  const displayLeads = showArchived ? filteredLeads : activeLeads;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Lead Inbox</h1>
          <PageInfoButton
            title="Lead Inbox"
            description="Track new business opportunities from initial contact through qualification and conversion."
            actions={["Create and manage leads", "Convert qualified leads into proposals", "Schedule meetings from lead context", "Archive inactive leads to keep views clean"]}
            audience="Sales team and admins managing the pipeline."
            note="Non-admin members see only leads they own or are linked to via company access."
          />
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportToCSV(
                  displayLeads,
                  [
                    { key: "title", label: "Title" },
                    { key: "status", label: "Status" },
                    { key: "source", label: "Source" },
                    { key: "estimated_value", label: "Est. Value" },
                    { key: "currency", label: "Currency" },
                    { key: "next_follow_up", label: "Next Follow-Up", format: (v: any) => v ? new Date(v).toLocaleDateString() : "" },
                    { key: "created_at", label: "Created", format: (v: any) => new Date(v).toLocaleDateString() },
                  ],
                  "leads-export"
                )
              }
            >
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
          <Button size="sm" onClick={() => { setEditingLead(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New Lead
          </Button>
        </div>
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        {isAdmin
          ? "Track new business opportunities from first contact to conversion. Archived leads are hidden from active views but preserved for reference."
          : "Leads assigned to you or linked to your projects appear here."}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
            {showArchived && archivedLeads.length > 0 && (
              <span className="text-xs">({archivedLeads.length})</span>
            )}
          </label>
        )}
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
      ) : displayLeads.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">
            {showArchived ? "No leads found" : "No active leads"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {showArchived
              ? "No leads match your current filters."
              : "Leads track new business opportunities from first contact to conversion. Add your first lead to start managing your sales pipeline."}
          </p>
          {!showArchived && (
            <Button size="sm" onClick={() => { setEditingLead(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add First Lead
            </Button>
          )}
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
              {displayLeads.map(renderLeadRow)}
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
