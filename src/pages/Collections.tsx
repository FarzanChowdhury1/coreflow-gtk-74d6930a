import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Clock, DollarSign, Flag, Inbox } from "lucide-react";
import { toast } from "sonner";

type CaseStatus =
  | "new"
  | "contacted"
  | "promised"
  | "partial"
  | "escalated"
  | "recovered"
  | "closed";
type CasePriority = "low" | "medium" | "high";

interface CollectionItem {
  invoice_id: string;
  invoice_number: string;
  company_id: string;
  company_name: string;
  amount_due: number;
  due_date: string;
  days_overdue: number;
  derived_priority: CasePriority;
  case_id: string | null;
  status: CaseStatus;
  priority: CasePriority;
  owner_id: string | null;
  next_action_at: string | null;
  last_note: string | null;
  recovered_amount: number;
  updated_at: string | null;
}

interface OverviewSummary {
  total_overdue: number;
  overdue_count: number;
  high_priority_count: number;
  recovered_period: number;
  at_risk_amount: number;
  runway_months: number | null;
  collection_rate: number | null;
  as_of: string;
}

interface OverviewPayload {
  summary: OverviewSummary;
  items: CollectionItem[];
}

const STATUS_OPTIONS: { value: CaseStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "promised", label: "Promised" },
  { value: "partial", label: "Partial" },
  { value: "escalated", label: "Escalated" },
  { value: "recovered", label: "Recovered" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: { value: CasePriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_TONE: Record<CaseStatus, string> = {
  new: "bg-muted text-foreground border-border",
  contacted: "bg-primary/10 text-primary border-primary/30",
  promised: "bg-warning/15 text-warning border-warning/30",
  partial: "bg-warning/15 text-warning border-warning/30",
  escalated: "bg-destructive/15 text-destructive border-destructive/30",
  recovered: "bg-success/15 text-success border-success/30",
  closed: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_TONE: Record<CasePriority, string> = {
  high: "bg-destructive/15 text-destructive border-destructive/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-muted text-muted-foreground border-border",
};

function formatCurrency(amount: number, currency = "BDT") {
  try {
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export default function Collections() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? "";
  const isAdmin = currentRole === "admin";
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<CollectionItem | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<OverviewPayload>({
    queryKey: ["collections-overview", workspaceId],
    enabled: !!workspaceId && isAdmin,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_collections_overview" as any, {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data ?? { summary: null, items: [] }) as OverviewPayload;
    },
  });

  const summary = data?.summary;
  const items = useMemo(() => data?.items ?? [], [data]);

  const upsert = useMutation({
    mutationFn: async (input: {
      invoice_id: string;
      status: CaseStatus;
      priority: CasePriority;
      owner_id: string | null;
      next_action_at: string | null;
      last_note: string | null;
      recovered_amount: number;
    }) => {
      const { error } = await supabase.rpc("upsert_collections_case" as any, {
        _workspace_id: workspaceId,
        _invoice_id: input.invoice_id,
        _status: input.status,
        _priority: input.priority,
        _owner_id: input.owner_id,
        _next_action_at: input.next_action_at,
        _last_note: input.last_note,
        _recovered_amount: input.recovered_amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Case updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["collections-overview", workspaceId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update case"),
  });

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground">
              Collections is an admin-only surface. Ask a workspace admin for access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections Control Center</h1>
          <p className="text-sm text-muted-foreground">
            Work the overdue queue. Priority is auto-suggested from amount, age, runway and collection rate.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryTile
          icon={DollarSign}
          label="Total overdue"
          value={summary ? formatCurrency(summary.total_overdue) : "—"}
          loading={isLoading}
        />
        <SummaryTile
          icon={Clock}
          label="Overdue invoices"
          value={summary ? String(summary.overdue_count) : "—"}
          loading={isLoading}
        />
        <SummaryTile
          icon={Flag}
          label="High priority"
          value={summary ? String(summary.high_priority_count) : "—"}
          loading={isLoading}
          tone="destructive"
        />
        <SummaryTile
          icon={AlertTriangle}
          label="At-risk amount"
          value={summary ? formatCurrency(summary.at_risk_amount) : "—"}
          loading={isLoading}
          tone="warning"
        />
        <SummaryTile
          icon={CheckCircle2}
          label="Recovered (30d)"
          value={summary ? formatCurrency(summary.recovered_period) : "—"}
          loading={isLoading}
          tone="success"
        />
      </div>

      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overdue queue</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Could not load the collections queue. Try refreshing.
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-md border bg-muted/20 px-3 py-10 text-center">
              <Inbox className="mx-auto mb-2 h-6 w-6 text-success/70" />
              <p className="text-sm font-medium">No overdue invoices</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Nothing to chase right now. New overdue invoices will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Amount due</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Days late</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next action</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.invoice_id}>
                      <TableCell className="font-mono text-xs">{it.invoice_number}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{it.company_name}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(it.amount_due)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {it.due_date}
                      </TableCell>
                      <TableCell className="text-right text-xs">{it.days_overdue}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={PRIORITY_TONE[it.priority]}>
                          {it.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_TONE[it.status]}>
                          {it.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {it.next_action_at ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>
                          Update
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CaseEditorDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSubmit={(values) => editing && upsert.mutate({ invoice_id: editing.invoice_id, ...values })}
        saving={upsert.isPending}
      />
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  loading,
  tone,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  loading?: boolean;
  tone?: "destructive" | "warning" | "success";
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning"
      : tone === "success"
      ? "text-success"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneClass}`} />
        </div>
        <div className={`mt-2 text-xl font-semibold ${toneClass}`}>
          {loading ? <Skeleton className="h-6 w-20" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function CaseEditorDialog({
  item,
  onClose,
  onSubmit,
  saving,
}: {
  item: CollectionItem | null;
  onClose: () => void;
  onSubmit: (values: {
    status: CaseStatus;
    priority: CasePriority;
    owner_id: string | null;
    next_action_at: string | null;
    last_note: string | null;
    recovered_amount: number;
  }) => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<CaseStatus>(item?.status ?? "new");
  const [priority, setPriority] = useState<CasePriority>(item?.priority ?? "medium");
  const [nextAction, setNextAction] = useState<string>(item?.next_action_at ?? "");
  const [note, setNote] = useState<string>(item?.last_note ?? "");
  const [recovered, setRecovered] = useState<string>(
    item?.recovered_amount ? String(item.recovered_amount) : "",
  );

  // Reset when a new item opens
  useMemo(() => {
    if (item) {
      setStatus(item.status);
      setPriority(item.priority);
      setNextAction(item.next_action_at ?? "");
      setNote(item.last_note ?? "");
      setRecovered(item.recovered_amount ? String(item.recovered_amount) : "");
    }
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update collections case</DialogTitle>
          <DialogDescription>
            {item ? `${item.invoice_number} · ${item.company_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as CaseStatus)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as CasePriority)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Next action date</label>
            <Input
              type="date"
              className="mt-1"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Recovered so far</label>
            <Input
              type="number"
              inputMode="decimal"
              className="mt-1"
              placeholder="0"
              value={recovered}
              onChange={(e) => setRecovered(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Last note</label>
            <Textarea
              className="mt-1"
              rows={3}
              placeholder="Spoke to finance, will pay by Friday…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={() =>
              onSubmit({
                status,
                priority,
                owner_id: null,
                next_action_at: nextAction || null,
                last_note: note || null,
                recovered_amount: Number(recovered) || 0,
              })
            }
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
