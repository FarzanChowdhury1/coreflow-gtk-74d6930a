import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface FeedbackRow {
  id: string;
  category: string;
  priority: string;
  title: string;
  description: string | null;
  status: string;
  submitted_by: string;
  created_at: string;
  submitter_name?: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: "default",
  reviewed: "secondary",
  accepted: "outline",
  closed: "destructive",
};

const PRIORITY_COLORS: Record<string, string> = {
  p0: "bg-destructive/10 text-destructive border-destructive/30",
  p1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  p2: "bg-muted text-muted-foreground",
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug",
  ui_ux: "UI/UX",
  feature_request: "Feature",
  performance: "Perf",
  other: "Other",
};

export default function BetaFeedback() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchFeedback = async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    let query = supabase
      .from("beta_feedback" as any)
      .select("*")
      .eq("workspace_id", currentWorkspace.id)
      .order("created_at", { ascending: false });

    if (filterCategory !== "all") {
      query = query.eq("category", filterCategory);
    }
    if (filterPriority !== "all") {
      query = query.eq("priority", filterPriority);
    }
    if (filterStatus !== "all") {
      query = query.eq("status", filterStatus);
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: "Error loading feedback", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (data || []) as unknown as FeedbackRow[];

    // Fetch submitter names
    const userIds = [...new Set(rows.map((r) => r.submitted_by))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const nameMap = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
      rows.forEach((r) => {
        r.submitter_name = nameMap.get(r.submitted_by) || "Unknown";
      });
    }

    setFeedback(rows);
    setLoading(false);
  };

  useEffect(() => {
    fetchFeedback();
  }, [currentWorkspace?.id, filterCategory, filterPriority, filterStatus]);

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from("beta_feedback" as any)
      .update({ status: newStatus } as any)
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setFeedback((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: newStatus } : f))
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Beta Feedback</h1>
        <p className="text-sm text-muted-foreground">Review feedback submitted by team members.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="bug">Bug</SelectItem>
            <SelectItem value="ui_ux">UI/UX</SelectItem>
            <SelectItem value="feature_request">Feature Request</SelectItem>
            <SelectItem value="performance">Performance</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
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
                <TableHead>Category</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[140px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedback.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Badge variant="secondary">{CATEGORY_LABELS[f.category] || f.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{f.title}</p>
                      {f.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 max-w-md">
                          {f.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.submitter_name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(f.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[f.status] as any}>{f.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={f.status}
                      onValueChange={(v) => updateStatus(f.id, v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="reviewed">Reviewed</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
