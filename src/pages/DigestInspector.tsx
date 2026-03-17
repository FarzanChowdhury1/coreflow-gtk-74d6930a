import { useState, useCallback, useEffect } from "react";
import {
  FileSearch, Bell, Play, Eye, RefreshCw,
  CheckCircle2, XCircle, Loader2, Clock, History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

const COOLDOWN_SECONDS = 5 * 60;

/* ------------------------------------------------------------------ */
/* Digest Control Panel                                                */
/* ------------------------------------------------------------------ */

interface DigestResult {
  success: boolean;
  mode: string;
  executed_at: string;
  digest: {
    overdue_invoices: number;
    overdue_followups: number;
    upcoming_renewals: number;
  };
  error?: string;
  cooldown_remaining_seconds?: number;
}

function DigestControls({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<"run" | "preview" | null>(null);
  const [lastResult, setLastResult] = useState<DigestResult | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    if (!cooldownEnd) { setCooldownLeft(0); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setCooldownLeft(remaining);
      if (remaining <= 0) setCooldownEnd(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  const triggerDigest = useCallback(
    async (mode: "run" | "preview") => {
      if (mode === "run" && cooldownEnd && Date.now() < cooldownEnd) return;
      setRunning(mode);
      setLastResult(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-digest-trigger`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ workspace_id: workspaceId, mode }),
          }
        );

        const json = await res.json();

        if (json.error === "cooldown") {
          const remaining = json.cooldown_remaining_seconds || COOLDOWN_SECONDS;
          setCooldownEnd(Date.now() + remaining * 1000);
          setLastResult({
            success: false, mode, executed_at: new Date().toISOString(),
            digest: { overdue_invoices: 0, overdue_followups: 0, upcoming_renewals: 0 },
            error: json.message,
          });
          toast({ title: "Cooldown active", description: json.message, variant: "destructive" });
          // Refresh run log to show the rejection
          queryClient.invalidateQueries({ queryKey: ["digest-runs", workspaceId] });
          return;
        }

        if (!res.ok) throw new Error(json.error || "Request failed");

        setLastResult(json);
        if (mode === "run") setCooldownEnd(Date.now() + COOLDOWN_SECONDS * 1000);

        toast({
          title: mode === "run" ? "Digest executed" : "Preview generated",
          description: `Overdue invoices: ${json.digest?.overdue_invoices ?? 0}, Follow-ups: ${json.digest?.overdue_followups ?? 0}, Renewals: ${json.digest?.upcoming_renewals ?? 0}`,
        });

        // Refresh inspector data + run log
        queryClient.invalidateQueries({ queryKey: ["digest-runs", workspaceId] });
        if (mode === "run") {
          queryClient.invalidateQueries({ queryKey: ["digest-notifications", workspaceId] });
          queryClient.invalidateQueries({ queryKey: ["all-system-alerts", workspaceId] });
        }
      } catch (err: any) {
        setLastResult({
          success: false, mode, executed_at: new Date().toISOString(),
          digest: { overdue_invoices: 0, overdue_followups: 0, upcoming_renewals: 0 },
          error: err.message,
        });
        toast({ title: "Digest failed", description: err.message, variant: "destructive" });
      } finally {
        setRunning(null);
      }
    },
    [workspaceId, queryClient, cooldownEnd]
  );

  const runDisabled = running !== null || cooldownLeft > 0;

  return (
    <Card className="border-primary/20">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium text-foreground">Digest Controls</span>
          <div className="flex items-center gap-2">
            {cooldownLeft > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {Math.floor(cooldownLeft / 60)}:{String(cooldownLeft % 60).padStart(2, "0")}
              </span>
            )}
            <Button size="sm" variant="outline" disabled={running !== null} onClick={() => triggerDigest("preview")}>
              {running === "preview" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
              Preview
            </Button>
            <Button size="sm" disabled={runDisabled} onClick={() => triggerDigest("run")}
              title={cooldownLeft > 0 ? "Cooldown active — please wait" : undefined}>
              {running === "run" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
              Run Now
            </Button>
          </div>
        </div>

        {lastResult && (
          <div className="rounded-md border px-3 py-2 text-xs space-y-1 bg-muted/30">
            <div className="flex items-center gap-1.5">
              {lastResult.success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
              <span className="font-medium text-foreground">
                {lastResult.success ? (lastResult.mode === "run" ? "Executed" : "Preview") : "Failed"}
              </span>
              <span className="text-muted-foreground ml-auto">{format(new Date(lastResult.executed_at), "HH:mm:ss")}</span>
            </div>
            {lastResult.success && (
              <div className="flex gap-3 text-muted-foreground">
                <span>Overdue invoices: {lastResult.digest.overdue_invoices}</span>
                <span>Follow-ups: {lastResult.digest.overdue_followups}</span>
                <span>Renewals: {lastResult.digest.upcoming_renewals}</span>
              </div>
            )}
            {lastResult.error && <p className="text-destructive">{lastResult.error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Digest Run History                                                   */
/* ------------------------------------------------------------------ */

function DigestRunHistory({ workspaceId }: { workspaceId: string }) {
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

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge variant="secondary" className="text-green-700 bg-green-100">success</Badge>;
    if (status === "cooldown_rejected") return <Badge variant="secondary">cooldown</Badge>;
    return <Badge variant="destructive">{status}</Badge>;
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <History className="h-4 w-4" /> Digest Run Log
        {!isLoading && <Badge variant="secondary">{runs.length}</Badge>}
      </h2>
      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No manual digest runs recorded yet.</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
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
                  <td className="px-3 py-2">{statusBadge(r.status)}</td>
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
/* Worker Run History (automated jobs)                                  */
/* ------------------------------------------------------------------ */

function WorkerRunHistory() {
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

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge variant="secondary" className="text-green-700 bg-green-100">success</Badge>;
    return <Badge variant="destructive">{status}</Badge>;
  };

  const workerLabel = (name: string) => {
    if (name === "daily_digest") return "Daily Digest";
    if (name === "asset_cleanup") return "Asset Cleanup";
    return name;
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Server className="h-4 w-4" /> Scheduled Worker Runs
        {!isLoading && <Badge variant="secondary">{runs.length}</Badge>}
      </h2>
      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No automated worker runs recorded yet.</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[650px]">
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
              {runs.map((r: any) => {
                const summary = r.summary || {};
                const summaryParts: string[] = [];
                // daily_digest summary
                if (summary.workspaces_with_items !== undefined) {
                  summaryParts.push(`${summary.workspaces_with_items}/${summary.total_workspaces || '?'} ws`);
                }
                // asset_cleanup summary
                if (summary.storage_blobs_deleted !== undefined) {
                  summaryParts.push(`${summary.storage_blobs_deleted} blobs`);
                }
                if (summary.file_rows_purged !== undefined) {
                  summaryParts.push(`${summary.file_rows_purged} files`);
                }
                if (summary.portal_tokens_purged !== undefined && summary.portal_tokens_purged > 0) {
                  summaryParts.push(`${summary.portal_tokens_purged} tokens`);
                }
                if (summary.short_links_purged !== undefined && summary.short_links_purged > 0) {
                  summaryParts.push(`${summary.short_links_purged} links`);
                }

                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 text-foreground font-medium text-xs">{workerLabel(r.worker_name)}</td>
                    <td className="px-3 py-2">{statusBadge(r.status)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.started_at), "dd MMM HH:mm:ss")}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={summaryParts.join(", ")}>
                      {summaryParts.length > 0 ? summaryParts.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-destructive max-w-[200px] truncate" title={r.error_message || ""}>
                      {r.error_message || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared Skeleton                                                     */
/* ------------------------------------------------------------------ */

function SectionSkeleton({ rows = 3, height = "h-12" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2" style={{ minHeight: `${rows * 56}px` }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${height} w-full`} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function DigestInspector() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();

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

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["digest-notifications", currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ["all-system-alerts", currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ["short-links", currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ["digest-runs", currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ["worker-runs"] });
  }, [queryClient, currentWorkspace?.id]);

  const isAdmin = currentRole === "admin";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileSearch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Digest & Alerts Inspector</h1>
        </div>
        <Button size="sm" variant="ghost" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="space-y-8">
        {isAdmin && currentWorkspace?.id && (
          <DigestControls workspaceId={currentWorkspace.id} />
        )}

        {/* Digest Run Log — admin only */}
        {isAdmin && currentWorkspace?.id && (
          <DigestRunHistory workspaceId={currentWorkspace.id} />
        )}

        {/* Scheduled Worker Runs — admin only */}
        {isAdmin && <WorkerRunHistory />}

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
