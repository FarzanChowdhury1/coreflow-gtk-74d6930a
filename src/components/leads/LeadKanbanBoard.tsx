import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Archive, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Lead = Tables<"leads">;

const STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
type LeadStatus = (typeof STATUSES)[number];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  unqualified: "Unqualified",
  converted: "Converted",
};

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "border-t-muted-foreground/40",
  contacted: "border-t-primary/60",
  qualified: "border-t-green-500/60",
  unqualified: "border-t-destructive/60",
  converted: "border-t-accent-foreground/60",
};

interface Props {
  leads: Lead[];
  companies: { id: string; legal_name: string }[];
  contacts: { id: string; full_name: string }[];
  isAdmin: boolean;
  userId: string | undefined;
  onEdit: (lead: Lead) => void;
  onArchive: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onMeeting: (lead: Lead) => void;
}

export function LeadKanbanBoard({
  leads,
  companies,
  contacts,
  isAdmin,
  userId,
  onEdit,
  onArchive,
  onConvert,
  onMeeting,
}: Props) {
  const queryClient = useQueryClient();
  const dragItem = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const activeLeads = leads.filter((l) => !l.deleted_at);

  const columns = STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    leads: activeLeads.filter((l) => l.status === status),
  }));

  const getCompanyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.legal_name ?? "—" : "";
  const getContactName = (id: string | null) =>
    id ? contacts.find((c) => c.id === id)?.full_name ?? "—" : "";

  const canEditLead = useCallback(
    (lead: Lead) => isAdmin || lead.owner_id === userId,
    [isAdmin, userId]
  );

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    dragItem.current = leadId;
    e.dataTransfer.effectAllowed = "move";
    // For Firefox compatibility
    e.dataTransfer.setData("text/plain", leadId);
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: LeadStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = dragItem.current;
    dragItem.current = null;

    if (!leadId) return;

    const lead = activeLeads.find((l) => l.id === leadId);
    if (!lead) return;

    // No-op if same status
    if (lead.status === targetStatus) return;

    // Permission check
    if (!canEditLead(lead)) {
      toast.error("You don't have permission to update this lead");
      return;
    }

    // Optimistic update
    queryClient.setQueryData<any>(
      ["leads", lead.workspace_id, "active"],
      (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            rows: page.rows?.map((l: Lead) =>
              l.id === leadId ? { ...l, status: targetStatus } : l
            ) ?? page,
          })),
        };
      }
    );

    const { error } = await supabase
      .from("leads")
      .update({ status: targetStatus as any })
      .eq("id", leadId);

    if (error) {
      toast.error("Failed to update lead status");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    } else {
      toast.success(`Lead moved to ${STATUS_LABELS[targetStatus]}`);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
      {columns.map((col) => (
        <div
          key={col.status}
          className={`flex-1 min-w-[200px] max-w-[280px] rounded-lg border border-t-4 bg-card ${STATUS_COLORS[col.status]} ${
            dragOverCol === col.status ? "ring-2 ring-primary/40 bg-primary/5" : ""
          }`}
          onDragOver={(e) => handleDragOver(e, col.status)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, col.status)}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {col.label}
            </span>
            <Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] justify-center">
              {col.leads.length}
            </Badge>
          </div>

          <div className="p-2 space-y-2 min-h-[100px]">
            {col.leads.length === 0 && (
              <p className="text-xs text-muted-foreground/50 text-center py-6">No leads</p>
            )}
            {col.leads.map((lead) => (
              <div
                key={lead.id}
                draggable={canEditLead(lead)}
                onDragStart={(e) => handleDragStart(e, lead.id)}
                className={`rounded-md border bg-background p-2.5 shadow-sm text-sm transition-shadow ${
                  canEditLead(lead) ? "cursor-grab active:cursor-grabbing hover:shadow-md" : ""
                }`}
              >
                <p className="font-medium text-foreground text-xs leading-snug mb-1 line-clamp-2">
                  {lead.title}
                </p>
                {getCompanyName(lead.company_id) && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {getCompanyName(lead.company_id)}
                  </p>
                )}
                {getContactName(lead.contact_id) && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {getContactName(lead.contact_id)}
                  </p>
                )}
                {lead.estimated_value && (
                  <p className="text-[11px] font-medium text-primary mt-1">
                    {lead.currency} {Number(lead.estimated_value).toLocaleString()}
                  </p>
                )}
                {lead.next_follow_up && (
                  <p className={`text-[10px] mt-1 ${new Date(lead.next_follow_up) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    Follow-up: {new Date(lead.next_follow_up).toLocaleDateString()}
                    {new Date(lead.next_follow_up) < new Date() && " (overdue)"}
                  </p>
                )}

                {canEditLead(lead) && (
                  <div className="flex items-center gap-0.5 mt-2 pt-1.5 border-t">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(lead)} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onMeeting(lead)} title="Schedule meeting">
                      <Calendar className="h-3 w-3" />
                    </Button>
                    {isAdmin && lead.status !== "converted" && lead.status !== "unqualified" && lead.company_id && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-primary" onClick={() => onConvert(lead)} title="Convert to proposal">
                        <FileText className="h-3 w-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive ml-auto" onClick={() => onArchive(lead)} title="Archive">
                      <Archive className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
