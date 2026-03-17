import { useEffect, useState, useCallback, useMemo } from "react";
import { Bell, Menu, Search, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { sortByPriority } from "@/lib/notification-utils";

interface Props {
  onMenuClick: () => void;
}

type Severity = "info" | "warning" | "critical";

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "critical") return <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  return null;
}

export function AppTopBar({ onMenuClick }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const fetchRecent = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);
    setNotifications(data || []);
  }, [user]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("topbar-notif-" + user.id)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as any, ...prev].slice(0, 8));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const sorted = useMemo(() => sortByPriority(notifications), [notifications]);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleClick = async (n: any) => {
    if (!n.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            aria-label="Search"
            className="h-9 w-48 md:w-64 rounded-md border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <FeedbackDialog />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="View notifications">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => { setOpen(false); navigate("/notifications"); }}>
                View all
              </Button>
            </div>
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications</div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y">
                {sorted.map((n) => {
                  const severity = (n.severity || "info") as Severity;
                  return (
                    <button
                      key={n.id}
                      className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors ${!n.is_read ? "bg-primary/5" : ""}`}
                      onClick={() => handleClick(n)}
                    >
                      <div className="flex items-start gap-2">
                        <SeverityIcon severity={severity} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                            <span className="text-xs font-medium text-foreground truncate">{n.title}</span>
                          </div>
                          {n.body && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{n.body}</p>}
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{format(new Date(n.created_at), "dd MMM HH:mm")}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground" aria-hidden="true">
          A
        </div>
      </div>
    </header>
  );
}
