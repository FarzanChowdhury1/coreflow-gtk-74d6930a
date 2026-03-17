import { useState, useCallback } from "react";
import { Search, Play, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface CandidateSummary {
  stale_files: number;
  expired_portal_tokens: number;
  expired_short_links: number;
}

interface RunResult {
  storage_blobs_deleted: number;
  file_rows_purged: number;
  portal_tokens_purged: number;
  short_links_purged: number;
  notifications_purged: Record<string, number>;
  ops_logs_purged: Record<string, number>;
}

export default function CleanupControls() {
  const queryClient = useQueryClient();
  const [previewData, setPreviewData] = useState<CandidateSummary | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "run" | null>(null);

  const callCleanup = useCallback(
    async (mode: "preview" | "run") => {
      setLoading(mode);
      if (mode === "run") setPreviewData(null);
      setRunResult(null);

      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-cleanup-trigger?mode=${mode}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        const json = await res.json();

        if (!res.ok) {
          if (res.status === 429) {
            toast.error(
              `Cooldown active — retry in ${json.retry_after_seconds}s`
            );
          } else {
            toast.error(json.error || "Cleanup request failed");
          }
          return;
        }

        if (mode === "preview") {
          const c = json.candidates || {};
          setPreviewData({
            stale_files: (c.stale_files || []).length,
            expired_portal_tokens: (c.expired_portal_tokens || []).length,
            expired_short_links: (c.expired_short_links || []).length,
          });
          toast.success("Preview loaded");
        } else {
          setRunResult({
            storage_blobs_deleted: json.storage_blobs_deleted ?? 0,
            file_rows_purged: json.file_rows_purged ?? 0,
            portal_tokens_purged: json.portal_tokens_purged ?? 0,
            short_links_purged: json.short_links_purged ?? 0,
            notifications_purged: json.notifications_purged ?? {},
            ops_logs_purged: json.ops_logs_purged ?? {},
          });
          toast.success("Cleanup completed");
          // Refresh worker runs table
          queryClient.invalidateQueries({ queryKey: ["worker-runs"] });
        }
      } catch {
        toast.error("Network error");
      } finally {
        setLoading(null);
      }
    },
    [queryClient]
  );

  const notifTotal = (np: Record<string, number>) =>
    (np.purged_info || 0) + (np.purged_warning || 0) + (np.purged_critical || 0);

  const opsTotal = (ol: Record<string, number>) =>
    (ol.purged_digest_runs || 0) + (ol.purged_worker_runs || 0) + (ol.purged_email_logs || 0);

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" /> Asset Cleanup Controls
        <Badge variant="outline" className="text-xs">admin</Badge>
      </h2>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={loading !== null}
            onClick={() => callCleanup("preview")}
          >
            {loading === "preview" ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-1.5" />
            )}
            Preview cleanup
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={loading !== null}
            onClick={() => callCleanup("run")}
          >
            {loading === "run" ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            Run cleanup now
          </Button>
          <span className="text-[11px] text-muted-foreground">
            5-minute cooldown between runs
          </span>
        </div>

        {/* Preview result */}
        {previewData && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Candidates (read-only preview — nothing deleted):
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Stale files", value: previewData.stale_files },
                { label: "Expired portal tokens", value: previewData.expired_portal_tokens },
                { label: "Expired short links", value: previewData.expired_short_links },
              ].map((item) => (
                <div key={item.label} className="rounded-md border bg-muted/30 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                  <p className="text-base font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Run result */}
        {runResult && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-green-700">
              Cleanup completed:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: "Blobs deleted", value: runResult.storage_blobs_deleted },
                { label: "File rows", value: runResult.file_rows_purged },
                { label: "Portal tokens", value: runResult.portal_tokens_purged },
                { label: "Short links", value: runResult.short_links_purged },
                { label: "Notifications", value: notifTotal(runResult.notifications_purged) },
                { label: "Ops logs", value: opsTotal(runResult.ops_logs_purged) },
              ].map((item) => (
                <div key={item.label} className="rounded-md border bg-muted/30 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                  <p className="text-base font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
