import { useState } from "react";
import { Calendar, Clock, CheckCircle2, XCircle, MessageSquare, Plus, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface MeetingRequestsReviewProps {
  onScheduleMeeting: (prefill: { title: string; companyId: string; contactId: string; requestId: string }) => void;
}

export function MeetingRequestsReview({ onScheduleMeeting }: MeetingRequestsReviewProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "accepted" | "declined"; req: any } | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: requests = [] } = useQuery({
    queryKey: ["meeting-requests", wsId],
    queryFn: async () => {
      const { data } = await supabase
        .from("meeting_requests")
        .select("*, companies(legal_name), contacts(full_name, email)")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data || []) as any[];
    },
    enabled: !!wsId,
  });

  const pendingRequests = requests.filter((r: any) => r.status === "pending");
  const resolvedRequests = requests.filter((r: any) => r.status !== "pending");

  const handleAction = async () => {
    if (!actionTarget || !wsId) return;
    setLoading(true);

    const { error } = await supabase
      .from("meeting_requests")
      .update({
        status: actionTarget.action,
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionTarget.id)
      .eq("workspace_id", wsId);

    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      if (actionTarget.action === "accepted") {
        // Open the meeting form with prefilled data and the request ID for linkage
        onScheduleMeeting({
          title: actionTarget.req.title,
          companyId: actionTarget.req.company_id,
          contactId: actionTarget.req.contact_id,
          requestId: actionTarget.id,
        });
      }
      toast({
        title: actionTarget.action === "accepted" ? "Request accepted" : "Request declined",
        description: actionTarget.action === "accepted"
          ? "Create the meeting using the form that opened. The request is marked as accepted."
          : "The client will see this request as declined.",
      });
      queryClient.invalidateQueries({ queryKey: ["meeting-requests"] });
    }
    setLoading(false);
    setActionTarget(null);
  };

  if (requests.length === 0) return null;

  const statusStyles: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    accepted: "bg-primary/15 text-primary",
    scheduled: "bg-emerald-500/15 text-emerald-600",
    declined: "bg-destructive/15 text-destructive",
  };

  return (
    <div className="space-y-4">
      {pendingRequests.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-warning" />
              Client Meeting Requests ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingRequests.map((r: any) => (
                <div key={r.id} className="rounded-md border px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{r.title}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {(r as any).companies?.legal_name || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(r as any).contacts?.full_name || "—"}
                        </span>
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {r.preferred_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(r.preferred_date + "T00:00:00"), "dd MMM yyyy")}
                          </span>
                        )}
                        {r.preferred_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {r.preferred_time}
                          </span>
                        )}
                        <span>Submitted {format(new Date(r.created_at), "dd MMM")}</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-warning/15 text-warning shrink-0">Pending</Badge>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => setActionTarget({ id: r.id, action: "accepted", req: r })}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Schedule
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActionTarget({ id: r.id, action: "declined", req: r })}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {resolvedRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Past Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {resolvedRequests.slice(0, 10).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {(r as any).companies?.legal_name || "—"} · {format(new Date(r.created_at), "dd MMM yyyy")}
                    </p>
                  </div>
                  <Badge variant="secondary" className={statusStyles[r.status] || ""}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!actionTarget} onOpenChange={(o) => { if (!o) setActionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionTarget?.action === "accepted" ? "Accept Meeting Request" : "Decline Meeting Request"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionTarget?.action === "accepted"
                ? `This will mark the request as accepted. The meeting creation form will open so you can create the actual meeting for "${actionTarget?.req?.title}".`
                : `This will mark the request "${actionTarget?.req?.title}" as declined.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              disabled={loading}
              className={actionTarget?.action === "declined" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {loading ? "Processing..." : actionTarget?.action === "accepted" ? "Accept" : "Decline"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
