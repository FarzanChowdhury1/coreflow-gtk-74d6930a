import { useCallback, useMemo } from "react";
import {
  Activity, Server, History, Mail, RefreshCw, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Navigate } from "react-router-dom";

/* ------------------------------------------------------------------ */
/* Shared                                                               */
/* ------------------------------------------------------------------ */

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" style={{ minHeight: `${rows * 48}px` }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return <Badge variant="secondary" className="text-green-700 bg-green-100">success</Badge>;
  if (status === "cooldown_rejected")
    return <Badge variant="secondary">cooldown</Badge>;
  if (status === "failed")
    return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Scheduled Worker Runs                                                */
/* ------------------------------------------------------------------ */

function WorkerRunsSection() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["worker-runs"],
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const workerLabel = (name: string) => {
    if (name === "daily_digest") return "Daily Digest";
    if (name === "asset_cleanup") return "Asset Cleanup";
    return name;
  };

  const summarize = (summary: any) => {
    if (!summary || typeof summary !== "object") return "—";
    const parts: string[] = [];
    if (summary.workspaces_with_items !== undefined)
      parts.push(`${summary.workspaces_with_items}/${summary.total_workspaces ?? "?"} ws`);
    if (summary.storage_blobs_deleted !== undefined)
      parts.push(`${summary.storage_blobs_deleted} blobs`);
    if (summary.file_rows_purged)
      parts.push(`${summary.file_rows_purged} files`);
    if (summary.portal_tokens_purged)
      parts.push(`${summary.portal_tokens_purged} tokens`);
    if (summary.short_links_purged)
      parts.push(`${summary.short_links_purged} links`);
    if (summary.notifications_purged && typeof summary.notifications_purged === "object") {
      const np = summary.notifications_purged;
      const total = (np.purged_info || 0) + (np.purged_warning || 0) + (np.purged_critical || 0);
      if (total > 0) parts.push(`${total} notifs`);
    }
    if (summary.ops_logs_purged && typeof summary.ops_logs_purged === "object") {
      const ol = summary.ops_logs_purged;
      const total = (ol.purged_digest_runs || 0) + (ol.purged_worker_runs || 0) + (ol.purged_email_logs || 0);
      if (total > 0) parts.push(`${total} ops logs`);
    }
    return parts.length > 0 ? parts.join(", ") : "—";
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Server className="h-4 w-4" /> Scheduled Worker Runs
        {!isLoading && <Badge variant="secondary">{runs.length}</Badge>}
      </h2>
      {isLoading ? (
        <SectionSkeleton rows={4} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No automated worker runs recorded yet.</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Worker</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Started</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-foreground font-medium text-xs">{workerLabel(r.worker_name)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(r.started_at), "dd MMM HH:mm:ss")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={summarize(r.summary)}>
                    {summarize(r.summary)}
                  </td>
                  <td className="px-3 py-2 text-xs text-destructive max-w-[200px] truncate" title={r.error_message || ""}>
                    {r.error_message || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Manual Digest Runs                                                   */
/* ------------------------------------------------------------------ */

function DigestRunsSection({ workspaceId }: { workspaceId: string }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["digest-runs", workspaceId],
    enabled: !!workspaceId,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("digest_runs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("executed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <History className="h-4 w-4" /> Manual Digest Runs
        {!isLoading && <Badge variant="secondary">{runs.length}</Badge>}
      </h2>
      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No manual digest runs recorded yet.</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Time</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Mode</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Invoices</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Follow-ups</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Renewals</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(r.executed_at), "dd MMM HH:mm:ss")}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs">{r.mode}</Badge>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{r.overdue_invoices_count}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.overdue_followups_count}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.upcoming_renewals_count}</td>
                  <td className="px-3 py-2 text-xs text-destructive max-w-[200px] truncate" title={r.error_message || ""}>
                    {r.error_message || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Email Logs                                                           */
/* ------------------------------------------------------------------ */

function EmailLogsSection({ workspaceId }: { workspaceId: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["email-logs", workspaceId],
    enabled: !!workspaceId,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_logs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4" /> Email Logs
        {!isLoading && <Badge variant="secondary">{logs.length}</Badge>}
      </h2>
      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No email logs recorded yet. Email observability will populate here once email sending is active.</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Recipient</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Subject</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Sent</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l: any) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-xs text-foreground font-medium">{l.email_type}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[160px]" title={l.recipient_email}>
                    {l.recipient_email}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[180px]" title={l.subject || ""}>
                    {l.subject || "—"}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(l.created_at), "dd MMM HH:mm")}
                  </td>
                  <td className="px-3 py-2 text-xs text-destructive max-w-[160px] truncate" title={l.error_message || ""}>
                    {l.error_message || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                            */
/* ------------------------------------------------------------------ */

export default function OpsHealth() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["worker-runs"] });
    queryClient.invalidateQueries({ queryKey: ["digest-runs", currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ["email-logs", currentWorkspace?.id] });
  }, [queryClient, currentWorkspace?.id]);

  if (currentRole !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Ops / System Health</h1>
        </div>
        <Button size="sm" variant="ghost" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Retention: worker &amp; digest runs kept 90 days · email logs kept 180 days · older entries purged automatically.
      </p>

      <div className="space-y-8">
        <WorkerRunsSection />

        {currentWorkspace?.id && (
          <DigestRunsSection workspaceId={currentWorkspace.id} />
        )}

        {currentWorkspace?.id && (
          <EmailLogsSection workspaceId={currentWorkspace.id} />
        )}
      </div>
    </div>
  );
}
