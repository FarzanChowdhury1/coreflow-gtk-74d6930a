import { useState } from "react";
import { AlertTriangle, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export function DataErasureTab() {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wsId = currentWorkspace?.id;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: requests = [] } = useQuery({
    queryKey: ["erasure-requests", wsId],
    queryFn: async () => {
      const { data } = await supabase
        .from("data_erasure_requests")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!wsId,
  });

  const handleSubmit = async () => {
    if (!wsId || !user) return;
    setLoading(true);

    const { error } = await supabase
      .from("data_erasure_requests")
      .insert({
        workspace_id: wsId,
        requested_by: user.id,
        reason: reason.trim() || null,
        request_type: "full_erasure",
      });

    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Data erasure request submitted", description: "An admin will review your request." });
      queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
      setReason("");
    }
    setLoading(false);
    setConfirmOpen(false);
  };

  const statusColors: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    approved: "bg-primary/15 text-primary",
    completed: "bg-success/15 text-success",
    denied: "bg-destructive/15 text-destructive",
  };

  return (
    <div className="space-y-6">
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-destructive" />
            Data Erasure Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">This action cannot be undone</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Submitting a data erasure request will initiate a process to permanently delete all workspace data.
                  This includes leads, clients, invoices, payments, files, and all associated records.
                  An admin will review the request before any data is removed.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="Why are you requesting data erasure?"
              maxLength={500}
            />
          </div>

          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Request Data Erasure
          </Button>
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Request History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {requests.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {r.request_type === "full_erasure" ? "Full Data Erasure" : r.request_type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {format(new Date(r.created_at), "dd MMM yyyy")}
                      {r.reason && ` · ${r.reason}`}
                    </p>
                  </div>
                  <Badge variant="secondary" className={statusColors[r.status] || ""}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Data Erasure Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to submit a data erasure request? This will be reviewed by an admin.
              Once approved and executed, all workspace data will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={loading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {loading ? "Submitting..." : "Confirm Request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
