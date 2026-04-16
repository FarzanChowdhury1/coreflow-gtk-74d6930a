import { useState, useCallback } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Calendar, Search, Video, Building2, Clock, FileText, Download, AlertTriangle, LayoutList, CalendarDays } from "lucide-react";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { MeetingDetail } from "@/components/meetings/MeetingDetail";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { guardedExportToCSV } from "@/lib/guarded-export";
import { MeetingCalendarView } from "@/components/meetings/MeetingCalendarView";

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelled: "bg-muted text-muted-foreground",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  client: Building2,
  internal: Video,
};

export default function Meetings() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editMeeting, setEditMeeting] = useState<any>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const { data: meetings = [], isLoading, isError: meetingsError } = useQuery({
    queryKey: ["meetings", wsId, statusFilter],
    queryFn: async () => {
      if (!wsId) return [];
      let q = supabase
        .from("meetings" as any)
        .select("*, companies(legal_name), projects(name)")
        .eq("workspace_id", wsId)
        .order("starts_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      const { data } = await q;
      return (data || []) as any[];
    },
    enabled: !!wsId,
  });

  const filtered = meetings.filter((m: any) =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    (m.companies?.legal_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
  }, [queryClient]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  // Separate upcoming/today vs past
  const upcoming = filtered.filter((m: any) => !isPast(new Date(m.starts_at)) || isToday(new Date(m.starts_at)));
  const past = filtered.filter((m: any) => isPast(new Date(m.starts_at)) && !isToday(new Date(m.starts_at)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Meetings</h1>
            <PageInfoButton
              title="Meetings"
              description="Schedule internal and client meetings, record minutes, and attach recordings or transcripts."
              actions={["Schedule meetings linked to leads, clients, or projects", "Record meeting minutes after the meeting", "Attach recording or transcript files"]}
              audience="Anyone scheduling or participating in meetings."
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule meetings, record minutes, and attach recordings or transcripts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              wsId && guardedExportToCSV(wsId,
                filtered.map((m: any) => ({
                  title: m.title,
                  type: m.meeting_type,
                  status: m.status,
                  starts_at: m.starts_at ? format(new Date(m.starts_at), "yyyy-MM-dd HH:mm") : "",
                  company: m.companies?.legal_name || "",
                  project: m.projects?.name || "",
                  location: m.location || "",
                })),
                [
                  { key: "title", label: "Title" },
                  { key: "type", label: "Type" },
                  { key: "status", label: "Status" },
                  { key: "starts_at", label: "Date/Time" },
                  { key: "company", label: "Company" },
                  { key: "project", label: "Project" },
                  { key: "location", label: "Location" },
                ],
                "meetings-export"
              )
            }
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button onClick={() => { setEditMeeting(null); setShowForm(true); }} className="gap-1.5">
            <Plus className="h-4 w-4" /> Schedule Meeting
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search meetings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex rounded-md border bg-muted/30 p-0.5">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setViewMode("list")}
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setViewMode("calendar")}
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {meetingsError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load meetings. Try refreshing the page.</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Loading meetings…</p>
      ) : viewMode === "calendar" ? (
        <MeetingCalendarView
          meetings={filtered}
          onOpenDetail={openDetail}
          onEdit={(m) => { setEditMeeting(m); setShowForm(true); }}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">
            {(search || statusFilter !== "all") ? "No meetings match your filters" : "No meetings yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {(search || statusFilter !== "all")
              ? "Try adjusting your search or status filter."
              : "Meetings help you keep track of discussions, decisions, and follow-up actions. Add meetings here so your team can review what was discussed and what needs to happen next."}
          </p>
          {!(search || statusFilter !== "all") && (
            <Button size="sm" onClick={() => { setEditMeeting(null); setShowForm(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Schedule First Meeting
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Upcoming & Today
              </h3>
              <MeetingTable meetings={upcoming} onOpen={openDetail} onEdit={(m) => { setEditMeeting(m); setShowForm(true); }} />
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Past Meetings</h3>
              <MeetingTable meetings={past} onOpen={openDetail} onEdit={(m) => { setEditMeeting(m); setShowForm(true); }} />
            </div>
          )}
        </div>
      )}

      <MeetingFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onSaved={invalidate}
        editMeeting={editMeeting}
      />

      <MeetingDetail
        meetingId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdated={invalidate}
      />
    </div>
  );
}

function MeetingTable({ meetings, onOpen, onEdit }: { meetings: any[]; onOpen: (id: string) => void; onEdit: (m: any) => void }) {
  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table className="min-w-[600px]">
        <TableHeader>
          <TableRow>
            <TableHead>Meeting</TableHead>
            <TableHead>Date & Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Context</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Minutes</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {meetings.map((m: any) => {
            const TypeIcon = TYPE_ICONS[m.meeting_type] || Calendar;
            const hasMinutes = !!m.minutes;
            return (
              <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpen(m.id)}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">{m.title}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <div>{format(new Date(m.starts_at), "dd MMM yyyy")}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(m.starts_at), "h:mm a")}
                    {m.ends_at && ` – ${format(new Date(m.ends_at), "h:mm a")}`}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">{m.meeting_type}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.companies?.legal_name || m.projects?.name || "—"}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLES[m.status] || ""}>{m.status}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  {hasMinutes && <FileText className="h-4 w-4 text-primary mx-auto" />}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm" variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onEdit(m); }}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
