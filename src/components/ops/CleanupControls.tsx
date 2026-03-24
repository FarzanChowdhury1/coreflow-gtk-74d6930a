import { useState, useCallback } from "react";
import { Search, Play, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface PreviewData {
  stale_files_count: number;
  read_notifications_count: number;
}

interface RunResult {
  storage_blobs_deleted: number;
  file_rows_purged: number;
  notifications_purged: number;
}

export default function CleanupControls() {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "run" | null>(null);

  const callCleanup = useCallback(
    async (mode: "preview" | "run") => {
      if (!currentWorkspace?.id) {
        toast.error("No workspace selected");
        return;
      }

      setLoading(mode);
      if (mode === "run") setPreviewData(null);
      setRunResult(null);

      try {
        const wsId = currentWorkspace.id;
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-cleanup-trigger?mode=${mode}&workspace_id=${wsId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ workspace_id: wsId }),
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
          setPreviewData({
            stale_files_count: json.stale_files_count ?? 0,
            read_notifications_count: json.read_notifications_count ?? 0,
          });
          toast.success("Preview loaded");
        } else {
          setRunResult({
            storage_blobs_deleted: json.storage_blobs_deleted ?? 0,
            file_rows_purged: json.file_rows_purged ?? 0,
            notifications_purged: json.notifications_purged ?? 0,
          });
          toast.success("Cleanup completed");
          queryClient.invalidateQueries({ queryKey: ["worker-runs"] });
        }
      } catch {
        toast.error("Network error");
      } finally {
        setLoading(null);
      }
    },
    [queryClient, currentWorkspace?.id]
  );

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" /> Asset Cleanup Controls
        <Badge variant="outline" className="text-xs">admin · this workspace</Badge>
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
            5-minute cooldown · scoped to current workspace
          </span>
        </div>

        {/* Preview result */}
        {previewData && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Candidates (read-only preview — nothing deleted):
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Stale files</p>
                <p className="text-base font-semibold text-foreground">{previewData.stale_files_count}</p>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Read notifications</p>
                <p className="text-base font-semibold text-foreground">{previewData.read_notifications_count}</p>
              </div>
            </div>
          </div>
        )}

        {/* Run result */}
        {runResult && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-primary">
              Cleanup completed:
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Blobs deleted", value: runResult.storage_blobs_deleted },
                { label: "File rows", value: runResult.file_rows_purged },
                { label: "Notifications", value: runResult.notifications_purged },
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
