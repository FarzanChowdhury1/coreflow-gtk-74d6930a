import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Archive, RotateCcw, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type Lead = Tables<"leads">;

interface LeadMobileCardsProps {
  leads: Lead[];
  statusColors: Record<string, string>;
  getCompanyName: (id: string | null) => string;
  getContactName: (id: string | null) => string;
  isAdmin: boolean;
  userId?: string;
  onEdit: (lead: Lead) => void;
  onArchive: (lead: Lead) => void;
  onRestore: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onMeeting: (lead: Lead) => void;
}

export function LeadMobileCards({
  leads,
  statusColors,
  getCompanyName,
  getContactName,
  isAdmin,
  userId,
  onEdit,
  onArchive,
  onRestore,
  onConvert,
  onMeeting,
}: LeadMobileCardsProps) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {leads.map((lead) => {
        const isArchived = !!lead.deleted_at;
        const canAct = isAdmin || lead.owner_id === userId;
        return (
          <div
            key={lead.id}
            className={`rounded-lg border bg-card p-4 space-y-2 ${isArchived ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{lead.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {getCompanyName(lead.company_id)}
                  {lead.contact_id ? ` · ${getContactName(lead.contact_id)}` : ""}
                </p>
              </div>
              <Badge variant="secondary" className={`shrink-0 text-[10px] ${statusColors[lead.status] || ""}`}>
                {lead.status}
              </Badge>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {lead.estimated_value && (
                <span>{formatCurrency(Number(lead.estimated_value))}</span>
              )}
              {lead.next_follow_up && (
                <span className={new Date(lead.next_follow_up) < new Date() ? "text-destructive font-medium" : ""}>
                  Follow-up: {new Date(lead.next_follow_up).toLocaleDateString()}
                </span>
              )}
            </div>

            {canAct && (
              <div className="flex flex-wrap gap-1 pt-1 border-t">
                {isArchived ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRestore(lead)}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onMeeting(lead)}>
                      <Calendar className="h-3 w-3 mr-1" /> Meet
                    </Button>
                    {isAdmin && lead.status !== "converted" && lead.status !== "unqualified" && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={() => onConvert(lead)}>
                        <FileText className="h-3 w-3 mr-1" /> Convert
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(lead)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => onArchive(lead)}>
                      <Archive className="h-3 w-3 mr-1" /> Archive
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
