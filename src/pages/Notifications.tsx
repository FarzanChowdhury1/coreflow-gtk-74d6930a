import { useEffect, useState, useCallback, useMemo } from "react";
import { Bell, CheckCheck, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { sortByPriority } from "@/lib/notification-utils";

type Severity = "info" | "warning" | "critical";

const SEVERITY_CONFIG: Record<Severity, { icon: typeof Info; label: string; badgeClass: string; dotClass: string }> = {
  info: { icon: Info, label: "Info", badgeClass: "bg-muted text-muted-foreground", dotClass: "bg-primary" },
  warning: { icon: AlertTriangle, label: "Warning", badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", dotClass: "bg-yellow-500" },
  critical: { icon: AlertCircle, label: "Critical", badgeClass: "bg-destructive/10 text-destructive", dotClass: "bg-destructive" },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  if (severity === "info") return null;
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 gap-0.5 font-medium ${config.badgeClass}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

function NotificationCard({ n, onClick }: { n: any; onClick: () => void }) {
  const severity = (n.severity || "info") as Severity;
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/50 ${!n.is_read ? "border-primary/30 bg-primary/5" : ""}`}
      onClick={onClick}
    >
      <CardContent className="flex items-center justify-between py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            {!n.is_read && <span className={`h-2 w-2 rounded-full shrink-0 ${config.dotClass}`} />}
            <span className="text-sm font-medium text-foreground">{n.title}</span>
            <SeverityBadge severity={severity} />
          </div>
          {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
          {format(new Date(n.created_at), "dd MMM HH:mm")}
        </span>
      </CardContent>
    </Card>
  );
}

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState("all");

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .rpc("fetch_prioritized_notifications", { _user_id: user.id, _limit: 50 });
    setNotifications((data as any[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // Poll for new notifications every 30s (Realtime removed for security)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { fetchNotifications(); }, 30_000);
    return () => clearInterval(interval);
  }, [user, fetchNotifications]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const handleClick = (notification: any) => {
    if (!notification.is_read) markRead(notification.id);
    if (notification.link) navigate(notification.link);
  };

  const sorted = useMemo(() => sortByPriority(notifications), [notifications]);

  const filtered = useMemo(() =>
    severityFilter === "all" ? sorted : sorted.filter((n) => (n.severity || "info") === severityFilter),
    [sorted, severityFilter]
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const unreadItems = filtered.filter((n) => !n.is_read);
  const readItems = filtered.filter((n) => n.is_read);
  const showSections = unreadItems.length > 0 && readItems.length > 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Notifications</h1>
          <PageInfoButton
            title="Notifications"
            description="All your workspace alerts in one place — approval requests, overdue items, follow-up reminders, and system events."
            actions={["Review and act on pending items", "Filter by severity (critical, warning, info)", "Mark individual or all notifications as read"]}
            audience="All workspace members."
          />
          {unreadCount > 0 && (
            <Badge className="bg-primary text-primary-foreground">{unreadCount} unread</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="mr-1 h-4 w-4" /> Mark All Read
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-1.5">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={severityFilter === opt.value ? "default" : "outline"}
            size="sm"
            className="text-xs h-7 px-2.5"
            onClick={() => setSeverityFilter(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Bell className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">
            {severityFilter !== "all" ? `No ${severityFilter} notifications` : "No notifications yet"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {severityFilter !== "all"
              ? "Try a different filter to see other notifications."
              : "You'll see alerts here when approvals are needed, invoices are overdue, follow-ups are due, and more."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {unreadItems.length > 0 && showSections && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1 pb-0.5">Unread</p>
          )}
          {unreadItems.map((n) => (
            <NotificationCard key={n.id} n={n} onClick={() => handleClick(n)} />
          ))}
          {showSections && (
            <div className="flex items-center gap-3 py-2">
              <Separator className="flex-1" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Earlier</span>
              <Separator className="flex-1" />
            </div>
          )}
          {readItems.map((n) => (
            <NotificationCard key={n.id} n={n} onClick={() => handleClick(n)} />
          ))}
        </div>
      )}
    </div>
  );
}
