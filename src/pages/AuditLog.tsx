import { Shield } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { format } from "date-fns";

const ACTION_COLORS: Record<string, string> = {
  approval_submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  approval_step_approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  approval_granted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  approval_rejected: "bg-destructive/10 text-destructive",
};

export default function AuditLog() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const pag = usePaginatedQuery({
    table: "audit_logs",
    queryKey: ["audit-logs", workspaceId ?? ""],
    workspaceId,
  });

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Audit Log</h1>
        <PageInfoButton
          title="Audit Log"
          description="A chronological record of important actions taken in your workspace — approvals, status changes, and system events."
          actions={["Review who did what and when", "Filter by action type or entity", "Use for compliance and accountability tracking"]}
          audience="Admins monitoring workspace activity."
        />
        <Badge variant="secondary">{pag.totalCount} records</Badge>
      </div>

      {pag.isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : pag.rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p>No audit records yet. Actions will be logged as you use the system.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.rows.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), "dd MMM yyyy HH:mm:ss")}
                  </TableCell>
                  <TableCell className="text-foreground">
                    {log.actor_name || "System"}
                  </TableCell>
                  <TableCell>
                    <Badge className={ACTION_COLORS[log.action] || "bg-muted text-muted-foreground"}>
                      {log.action.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.entity_type?.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <span className="text-xs text-muted-foreground font-mono">
                        {JSON.stringify(log.metadata).slice(0, 80)}
                        {JSON.stringify(log.metadata).length > 80 ? "…" : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PaginationControls
        page={pag.page}
        totalPages={pag.totalPages}
        totalCount={pag.totalCount}
        hasNext={pag.hasNext}
        hasPrev={pag.hasPrev}
        onNext={pag.nextPage}
        onPrev={pag.prevPage}
        isFetching={pag.isFetching}
        pageSize={pag.PAGE_SIZE}
      />
    </div>
  );
}
