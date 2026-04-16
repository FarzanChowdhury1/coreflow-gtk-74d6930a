import { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Video, Building2, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-blue-500",
  completed: "bg-green-500",
  cancelled: "bg-muted-foreground/40",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  client: Building2,
  internal: Video,
};

interface MeetingCalendarViewProps {
  meetings: any[];
  onOpenDetail: (id: string) => void;
  onEdit: (meeting: any) => void;
}

export function MeetingCalendarView({ meetings, onOpenDetail, onEdit }: MeetingCalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const meetingsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of meetings) {
      const key = format(new Date(m.starts_at), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [meetings]);

  const selectedDayMeetings = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, "yyyy-MM-dd");
    return meetingsByDate.get(key) || [];
  }, [selectedDate, meetingsByDate]);

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {format(currentMonth, "MMMM yyyy")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date()); }}
          >
            Today
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {weekDays.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayMeetings = meetingsByDate.get(key) || [];
            const inMonth = isSameMonth(day, currentMonth);
            const today = isToday(day);
            const selected = selectedDate && isSameDay(day, selectedDate);

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "relative min-h-[72px] sm:min-h-[88px] border-b border-r p-1 text-left transition-colors hover:bg-muted/50",
                  !inMonth && "bg-muted/20 text-muted-foreground/40",
                  selected && "bg-accent/40 ring-1 ring-primary/30",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                    today && "bg-primary text-primary-foreground",
                    !today && inMonth && "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>

                {/* Meeting dots/chips */}
                {dayMeetings.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {dayMeetings.slice(0, 3).map((m: any) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight bg-muted/60"
                        title={`${format(new Date(m.starts_at), "h:mm a")} — ${m.title}`}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[m.status] || "bg-muted-foreground")} />
                        <span className="truncate">{m.title}</span>
                      </div>
                    ))}
                    {dayMeetings.length > 3 && (
                      <span className="text-[10px] text-muted-foreground px-1">+{dayMeetings.length - 3} more</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail panel */}
      {selectedDate && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium text-foreground mb-3">
            {format(selectedDate, "EEEE, d MMMM yyyy")}
            {selectedDayMeetings.length > 0 && (
              <span className="text-muted-foreground font-normal ml-2">
                ({selectedDayMeetings.length} meeting{selectedDayMeetings.length !== 1 ? "s" : ""})
              </span>
            )}
          </h4>

          {selectedDayMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedDayMeetings
                .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
                .map((m: any) => {
                  const TypeIcon = TYPE_ICONS[m.meeting_type] || Calendar;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 cursor-pointer"
                      onClick={() => onOpenDetail(m.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[m.status] || "bg-muted-foreground")} />
                        <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(m.starts_at), "h:mm a")}
                            {m.ends_at && ` – ${format(new Date(m.ends_at), "h:mm a")}`}
                            {m.companies?.legal_name && ` · ${m.companies.legal_name}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px] capitalize">{m.status}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); onEdit(m); }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
