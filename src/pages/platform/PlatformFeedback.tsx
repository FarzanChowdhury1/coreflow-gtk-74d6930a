import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface FeedbackRow {
  id: string;
  workspace_id: string;
  submitted_by: string;
  submitter_role: string | null;
  category: string;
  priority: string;
  title: string;
  description: string | null;
  current_route: string | null;
  status: string;
  founder_notes: string | null;
  created_at: string;
  workspace_name?: string;
  submitter_name?: string;
  submitter_email?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  p0: "bg-destructive/10 text-destructive border-destructive/30",
  p1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  p2: "bg-muted text-muted-foreground",
};

const STATUS_OPTIONS = ["new", "reviewed", "accepted", "closed"] as const;

export default function PlatformFeedback() {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [selected, setSelected] = useState<FeedbackRow | null>(null);
  const [founderNotes, setFounderNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("beta_feedback" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (filterPriority !== "all") query = query.eq("priority", filterPriority);
    if (filterStatus !== "all") query = query.eq("status", filterStatus);
    if (filterCategory !== "all") query = query.eq("category", filterCategory);

    const { data, error } = await query;
    if (error) {
      toast({ title: "Error loading feedback", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    let rows = (data || []) as unknown as FeedbackRow[];

    // Enrich with workspace names
    const wsIds = [...new Set(rows.map((r) => r.workspace_id))];
    if (wsIds.length > 0) {
      const { data: workspaces } = await supabase
        .from("workspaces")
        .select("id, name")
        .in("id", wsIds);
      const wsMap = new Map((workspaces || []).map((w: any) => [w.id, w.name]));
      rows.forEach((r) => { r.workspace_name = wsMap.get(r.workspace_id) || "Unknown"; });
    }

    // Enrich with submitter names
    const userIds = [...new Set(rows.map((r) => r.submitted_by))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const nameMap = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
      rows.forEach((r) => { r.submitter_name = nameMap.get(r.submitted_by) || "Unknown"; });
    }

    // Client-side workspace filter (since platform admin sees all)
    if (filterWorkspace !== "all") {
      rows = rows.filter((r) => r.workspace_id === filterWorkspace);
    }

    setFeedback(rows);
    setLoading(false);
  }, [filterPriority, filterStatus, filterCategory, filterWorkspace]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  const workspaces = [...new Map(feedback.map((f) => [f.workspace_id, f.workspace_name || "Unknown"])).entries()];

  const openDetail = (row: FeedbackRow) => {
    setSelected(row);
    setFounderNotes(row.founder_notes || "");
  };

  const updateFeedback = async (id: string, updates: Record<string, any>) => {
    setSaving(true);
    const { error } = await supabase
      .from("beta_feedback" as any)
      .update(updates as any)
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setFeedback((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
      );
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, ...updates } : prev);
      }
      toast({ title: "Updated" });
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Platform Feedback Inbox</h1>
            <p className="text-sm text-muted-foreground">Cross-workspace pilot feedback — metadata only</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterWorkspace} onValueChange={setFilterWorkspace}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Workspace" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              {workspaces.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="p0">P0 — Blocker</SelectItem>
              <SelectItem value="p1">P1 — Serious</SelectItem>
              <SelectItem value="p2">P2 — Polish</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="ui_ux">UI/UX</SelectItem>
              <SelectItem value="feature_request">Feature Request</SelectItem>
              <SelectItem value="performance">Performance</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : feedback.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            No feedback found.
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Submitter</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedback.map((f) => (
                  <TableRow
                    key={f.id}
                    className="cursor-pointer"
                    onClick={() => openDetail(f)}
                  >
                    <TableCell>
                      <Badge variant="outline" className={PRIORITY_COLORS[f.priority] || ""}>
                        {(f.priority || "p2").toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{f.workspace_name}</TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{f.title}</p>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{f.category}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{f.submitter_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{f.submitter_role || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{f.current_route || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(f.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell><Badge variant="outline">{f.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Detail Sheet */}
        <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent className="sm:max-w-lg overflow-y-auto">
            {selected && (
              <>
                <SheetHeader>
                  <SheetTitle>{selected.title}</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Workspace:</span><br />{selected.workspace_name}</div>
                    <div><span className="text-muted-foreground">Submitter:</span><br />{selected.submitter_name}</div>
                    <div><span className="text-muted-foreground">Role:</span><br />{selected.submitter_role || "—"}</div>
                    <div><span className="text-muted-foreground">Route:</span><br /><code className="text-xs">{selected.current_route || "—"}</code></div>
                    <div><span className="text-muted-foreground">Priority:</span><br />
                      <Badge variant="outline" className={PRIORITY_COLORS[selected.priority] || ""}>{selected.priority.toUpperCase()}</Badge>
                    </div>
                    <div><span className="text-muted-foreground">Category:</span><br /><Badge variant="secondary">{selected.category}</Badge></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Date:</span><br />{new Date(selected.created_at).toLocaleString()}</div>
                  </div>

                  {selected.description && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                      <p className="text-sm bg-muted/50 rounded-md p-3">{selected.description}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Status</p>
                    <Select
                      value={selected.status}
                      onValueChange={(v) => updateFeedback(selected.id, { status: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Founder Notes</p>
                    <Textarea
                      value={founderNotes}
                      onChange={(e) => setFounderNotes(e.target.value)}
                      rows={4}
                      placeholder="Internal notes for triage..."
                    />
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={saving || founderNotes === (selected.founder_notes || "")}
                      onClick={() => updateFeedback(selected.id, { founder_notes: founderNotes })}
                    >
                      {saving ? "Saving…" : "Save Notes"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
