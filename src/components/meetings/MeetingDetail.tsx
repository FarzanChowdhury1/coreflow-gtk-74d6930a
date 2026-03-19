import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileAttachments } from "@/components/files/FileAttachments";
import { Calendar, Clock, MapPin, Users, Building2, FolderKanban, Save, Inbox } from "lucide-react";

interface Props {
  meetingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelled: "bg-muted text-muted-foreground",
};

export function MeetingDetail({ meetingId, open, onOpenChange, onUpdated }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const [meeting, setMeeting] = useState<any>(null);
  const [minutes, setMinutes] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchMeeting = useCallback(async () => {
    if (!meetingId) return;
    const { data } = await supabase
      .from("meetings" as any)
      .select("*, companies(legal_name), contacts(full_name), leads(title), projects(name)")
      .eq("id", meetingId)
      .single();
    if (data) {
      setMeeting(data);
      setMinutes((data as any).minutes || "");
      setStatus((data as any).status);
      setDirty(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (open && meetingId) fetchMeeting();
  }, [open, meetingId, fetchMeeting]);

  const handleSave = async () => {
    if (!meetingId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("meetings" as any)
        .update({ minutes, status: status as any, updated_at: new Date().toISOString() } as any)
        .eq("id", meetingId);
      if (error) throw error;
      toast.success("Meeting updated");
      setDirty(false);
      onUpdated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!meeting) return null;

  const m = meeting as any;
  const isAdmin = currentRole === "admin";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">{m.title}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge className={STATUS_STYLES[m.status] || ""}>{m.status}</Badge>
            <Badge variant="outline" className="text-xs capitalize">{m.meeting_type}</Badge>
          </div>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Details */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {format(new Date(m.starts_at), "EEEE, dd MMM yyyy")}
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {format(new Date(m.starts_at), "h:mm a")}
              {m.ends_at && ` – ${format(new Date(m.ends_at), "h:mm a")}`}
            </div>
            {m.location && (
              <div className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {m.location}
              </div>
            )}
            {m.attendees && (
              <div className="flex items-start gap-2 text-foreground">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                <span>{m.attendees}</span>
              </div>
            )}
          </div>

          {/* Linked entities */}
          <div className="flex flex-wrap gap-2">
            {m.companies?.legal_name && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Building2 className="h-3 w-3" /> {m.companies.legal_name}
              </Badge>
            )}
            {m.projects?.name && (
              <Badge variant="secondary" className="text-xs gap-1">
                <FolderKanban className="h-3 w-3" /> {m.projects.name}
              </Badge>
            )}
            {m.leads?.title && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Inbox className="h-3 w-3" /> {m.leads.title}
              </Badge>
            )}
            {m.contacts?.full_name && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Users className="h-3 w-3" /> {m.contacts.full_name}
              </Badge>
            )}
          </div>

          {/* Description */}
          {m.description && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-1">Agenda</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{m.description}</p>
            </div>
          )}

          {/* Status change */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-1">Status</h4>
            <Select value={status} onValueChange={(v) => { setStatus(v); setDirty(true); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Meeting minutes */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-1">Meeting Minutes</h4>
            <p className="text-xs text-muted-foreground mb-2">
              Record key discussion points, decisions, and action items from this meeting.
            </p>
            <Textarea
              value={minutes}
              onChange={(e) => { setMinutes(e.target.value); setDirty(true); }}
              placeholder="Type meeting notes here…"
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          {dirty && (
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          )}

          {/* File attachments (recordings, transcripts) */}
          {currentWorkspace && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-foreground mb-1">Recordings & Transcripts</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Attach meeting recordings, transcript files, or related documents.
              </p>
              <FileAttachments
                workspaceId={currentWorkspace.id}
                ownerType="meeting"
                ownerId={m.id}
                canUpload={true}
                canDelete={isAdmin}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
