import { useState, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editMeeting?: any;
  defaultContext?: {
    company_id?: string;
    contact_id?: string;
    lead_id?: string;
    project_id?: string;
  };
}

export function MeetingFormDialog({ open, onOpenChange, onSaved, editMeeting, defaultContext }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const wsId = currentWorkspace?.id;

  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState<"internal" | "client">("client");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [time, setTime] = useState("10:00");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [contactId, setContactId] = useState("__none__");
  const [leadId, setLeadId] = useState("__none__");
  const [projectId, setProjectId] = useState("__none__");
  const [saving, setSaving] = useState(false);

  // Load companies for linking
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data } = await supabase.from("companies").select("id, legal_name")
        .eq("workspace_id", wsId).is("deleted_at", null).order("legal_name");
      return data || [];
    },
    enabled: !!wsId && open,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data } = await supabase.from("projects").select("id, name")
        .eq("workspace_id", wsId).is("deleted_at", null).order("name");
      return data || [];
    },
    enabled: !!wsId && open,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["leads-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const { data } = await supabase.from("leads").select("id, title")
        .eq("workspace_id", wsId).is("deleted_at", null).order("title");
      return data || [];
    },
    enabled: !!wsId && open,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts-picker", wsId, companyId],
    queryFn: async () => {
      if (!wsId) return [];
      let q = supabase.from("contacts").select("id, full_name")
        .eq("workspace_id", wsId).is("deleted_at", null).order("full_name");
      if (companyId) q = q.eq("company_id", companyId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!wsId && open,
  });

  useEffect(() => {
    if (open) {
      if (editMeeting) {
        setTitle(editMeeting.title);
        setMeetingType(editMeeting.meeting_type);
        setDate(new Date(editMeeting.starts_at));
        setTime(format(new Date(editMeeting.starts_at), "HH:mm"));
        setEndTime(editMeeting.ends_at ? format(new Date(editMeeting.ends_at), "HH:mm") : "");
        setLocation(editMeeting.location || "");
        setAttendees(editMeeting.attendees || "");
        setDescription(editMeeting.description || "");
        setCompanyId(editMeeting.company_id || "__none__");
        setContactId(editMeeting.contact_id || "__none__");
        setLeadId(editMeeting.lead_id || "__none__");
        setProjectId(editMeeting.project_id || "__none__");
      } else {
        setTitle("");
        setMeetingType("client");
        setDate(new Date());
        setTime("10:00");
        setEndTime("");
        setLocation("");
        setAttendees("");
        setDescription("");
        setCompanyId(defaultContext?.company_id || "__none__");
        setContactId(defaultContext?.contact_id || "__none__");
        setLeadId(defaultContext?.lead_id || "__none__");
        setProjectId(defaultContext?.project_id || "__none__");
      }
    }
  }, [open, editMeeting, defaultContext]);

  const handleSave = async () => {
    if (!title.trim() || !date || !wsId || !user) return;
    setSaving(true);
    try {
      const [h, m] = time.split(":").map(Number);
      const startsAt = new Date(date);
      startsAt.setHours(h, m, 0, 0);

      let endsAt: string | null = null;
      if (endTime) {
        const [eh, em] = endTime.split(":").map(Number);
        const end = new Date(date);
        end.setHours(eh, em, 0, 0);
        endsAt = end.toISOString();
      }

      const record = {
        title: title.trim(),
        meeting_type: meetingType as any,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt,
        location: location.trim() || null,
        attendees: attendees.trim() || null,
        description: description.trim() || null,
        company_id: companyId || null,
        contact_id: contactId || null,
        lead_id: leadId || null,
        project_id: projectId || null,
        workspace_id: wsId,
      };

      if (editMeeting) {
        const { error } = await supabase.from("meetings" as any)
          .update({ ...record, updated_at: new Date().toISOString() } as any)
          .eq("id", editMeeting.id);
        if (error) throw error;
        toast.success("Meeting updated");
      } else {
        const { error } = await supabase.from("meetings" as any)
          .insert({ ...record, created_by: user.id } as any);
        if (error) throw error;
        toast.success("Meeting scheduled");
      }
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save meeting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editMeeting ? "Edit Meeting" : "Schedule Meeting"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Project kickoff call" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={meetingType} onValueChange={(v) => setMeetingType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client Meeting</SelectItem>
                  <SelectItem value="internal">Internal Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Office / Zoom link" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "dd MMM yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Start Time *</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>End Time</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Attendees</Label>
            <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Names or emails, comma separated" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description / Agenda</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Meeting agenda or notes…" rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !date}>
            {saving ? "Saving…" : editMeeting ? "Update" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
