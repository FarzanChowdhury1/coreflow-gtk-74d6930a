import { FileSearch, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function DigestInspector() {
  const { currentWorkspace } = useWorkspace();

  const { data: notifications = [], isLoading: loadingNotifs } = useQuery({
    queryKey: ["digest-notifications", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("workspace_id", currentWorkspace!.id)
        .ilike("title", "%Digest%")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: alerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ["all-system-alerts", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_alerts")
        .select("*")
        .eq("workspace_id", currentWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: shortLinks = [], isLoading: loadingLinks } = useQuery({
    queryKey: ["short-links", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("short_links")
        .select("*")
        .eq("workspace_id", currentWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  function SectionSkeleton() {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div>
      {/* Shell renders immediately */}
      <div className="mb-6 flex items-center gap-3">
        <FileSearch className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Digest & Alerts Inspector</h1>
      </div>

      <div className="space-y-8">
        {/* Digest Notifications */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4" /> Digest Notifications
            {!loadingNotifs && <Badge variant="secondary">{notifications.length}</Badge>}
          </h2>
          {loadingNotifs ? (
            <SectionSkeleton />
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No digest notifications generated yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n: any) => (
                <Card key={n.id}>
                  <CardContent className="py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{n.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(n.created_at), "dd MMM yyyy HH:mm")}
                      </span>
                    </div>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    {n.link && <p className="text-xs text-primary">{n.link}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* System Alerts */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">
            System Alerts {!loadingAlerts && <Badge variant="secondary">{alerts.length}</Badge>}
          </h2>
          {loadingAlerts ? (
            <SectionSkeleton />
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No system alerts recorded.</p>
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[550px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Title</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Severity</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{a.alert_type}</td>
                      <td className="px-3 py-2 text-foreground">{a.title}</td>
                      <td className="px-3 py-2">
                        <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>
                          {a.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {a.is_dismissed ? (
                          <span className="text-xs text-muted-foreground">dismissed</span>
                        ) : (
                          <span className="text-xs text-primary font-medium">active</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {format(new Date(a.created_at), "dd MMM HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Short Links */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">
            Generated Short Links {!loadingLinks && <Badge variant="secondary">{shortLinks.length}</Badge>}
          </h2>
          {loadingLinks ? (
            <SectionSkeleton />
          ) : shortLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No short links generated yet.</p>
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Context</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Clicks</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Expires</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {shortLinks.map((sl: any) => (
                    <tr key={sl.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{sl.code}</td>
                      <td className="px-3 py-2 text-muted-foreground">{sl.context_type || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{sl.click_count}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {format(new Date(sl.expires_at), "dd MMM yyyy")}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {format(new Date(sl.created_at), "dd MMM HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
