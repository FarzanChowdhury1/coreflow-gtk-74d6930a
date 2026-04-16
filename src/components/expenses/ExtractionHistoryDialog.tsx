import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listRecentExtractionJobs, retryReceiptExtraction, cancelExtractionJob, type ExtractionJob } from "@/lib/extraction-api";
import { format } from "date-fns";
import { Loader2, RotateCw, X, Eye, ExternalLink, History } from "lucide-react";
import { toast } from "sonner";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  uploaded: "outline",
  processing: "outline",
  extracted: "secondary",
  review_required: "outline",
  expense_created: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  extracted: "Extracted",
  review_required: "Review required",
  expense_created: "Expense created",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  onReopen: (job: ExtractionJob) => void;
}

export function ExtractionHistoryDialog({ open, onOpenChange, workspaceId, onReopen }: Props) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ["extraction-history", workspaceId],
    enabled: open && !!workspaceId,
    queryFn: () => listRecentExtractionJobs(workspaceId, 50),
  });

  const handleRetry = async (job: ExtractionJob) => {
    setBusyId(job.id);
    try {
      await retryReceiptExtraction(job.id);
      toast.success("Re-extraction triggered");
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Retry failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (job: ExtractionJob) => {
    setBusyId(job.id);
    try {
      await cancelExtractionJob(job.id);
      toast.message("Extraction cancelled");
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Cancel failed");
    } finally {
      setBusyId(null);
    }
  };

  const isReviewable = (s: string) => s === "extracted" || s === "review_required";
  const isCancellable = (s: string) => !["expense_created", "cancelled"].includes(s);
  const isRetryable = (s: string) => ["failed", "extracted", "review_required"].includes(s);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Recent receipt extractions
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No receipt extractions yet. Use <span className="font-medium text-foreground">Scan Receipt</span> to start one.
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(j.created_at), "dd MMM HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate" title={j.source_file_name ?? ""}>
                      {j.source_file_name || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[j.status] || "outline"} className="text-[10px]">
                        {STATUS_LABEL[j.status] || j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {j.overall_confidence !== null && j.overall_confidence !== undefined
                        ? `${Math.round(j.overall_confidence * 100)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={j.failure_reason ?? ""}>
                      {j.failure_reason || ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {isReviewable(j.status) && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { onReopen(j); onOpenChange(false); }}>
                            <Eye className="h-3 w-3 mr-1" /> Review
                          </Button>
                        )}
                        {j.status === "expense_created" && j.created_expense_id && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => {
                            qc.invalidateQueries({ queryKey: ["expenses"] });
                            onOpenChange(false);
                          }}>
                            <ExternalLink className="h-3 w-3 mr-1" /> Expense
                          </Button>
                        )}
                        {isRetryable(j.status) && j.retry_count < 3 && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busyId === j.id} onClick={() => handleRetry(j)}>
                            {busyId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                          </Button>
                        )}
                        {isCancellable(j.status) && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busyId === j.id} onClick={() => handleCancel(j)}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
