import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Mail, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ---------- helpers ---------- */

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "sent":
      return <Badge className="bg-success/15 text-success border-success/30">Sent</Badge>;
    case "skipped":
      return <Badge variant="outline" className="text-warning border-warning/30">Skipped</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function ConfigIndicator({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <span className="text-sm font-mono">{label}</span>
      <span className="text-xs text-muted-foreground ml-auto">
        {ok ? "configured" : "missing"}
      </span>
    </div>
  );
}

/* ---------- page ---------- */

export default function EmailHealth() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;

  // --- Config status ---
  const configQuery = useQuery({
    queryKey: ["email-health-config", wsId],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-health?workspace_id=${wsId}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) throw new Error(`Config check failed: ${res.status}`);
      return (await res.json()) as {
        config: Record<string, boolean>;
      };
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });

  // --- Email logs ---
  const logsQuery = useQuery({
    queryKey: ["email-health-logs", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_logs")
        .select("id, email_type, recipient_email, subject, status, error_message, provider_message_id, created_at")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
    refetchInterval: 15_000,
  });

  // --- Smoke test: invite ---
  const [sendingInvite, setSendingInvite] = useState(false);
  const [selectedInviteId, setSelectedInviteId] = useState("");

  const pendingInvitesQuery = useQuery({
    queryKey: ["email-health-pending-invites", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_invites")
        .select("id, email, role, status")
        .eq("workspace_id", wsId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  // --- Smoke test: portal ---
  const [sendingPortal, setSendingPortal] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");

  // Query contacts who have active portal tokens via the email-health edge function
  // (portal_tokens has deny-all RLS — raw tokens must never reach the browser)
  const portalContactsQuery = useQuery({
    queryKey: ["email-health-portal-contacts", wsId],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-health?workspace_id=${wsId}&list=portal_contacts`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) throw new Error(`Failed to load portal contacts: ${res.status}`);
      return (await res.json()) as {
        contacts: Array<{ contact_id: string; full_name: string; email: string }>;
      };
    },
    enabled: !!wsId,
  });

  const handleSendTestInvite = async () => {
    if (!wsId || !selectedInviteId) return;
    setSendingInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: { type: "invite", workspace_id: wsId, invite_id: selectedInviteId },
      });
      if (error) throw error;
      if (data?.status === "skipped") {
        toast.warning("Email skipped — RESEND_API_KEY not configured");
      } else if (data?.status === "failed") {
        toast.error(`Email failed: ${data.error}`);
      } else if (data?.success) {
        toast.success("Invite email sent successfully");
      } else {
        toast.error(data?.error || "Unknown error");
      }
      logsQuery.refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to send test invite");
    } finally {
      setSendingInvite(false);
    }
  };

  const handleSendTestPortal = async () => {
    if (!wsId || !selectedContactId) return;
    setSendingPortal(true);
    try {
      // Only pass contact_id — the backend resolves the active token server-side
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          type: "portal",
          workspace_id: wsId,
          contact_id: selectedContactId,
        },
      });
      if (error) throw error;
      if (data?.status === "skipped") {
        toast.warning("Email skipped — RESEND_API_KEY not configured");
      } else if (data?.status === "failed") {
        toast.error(`Email failed: ${data.error}`);
      } else if (data?.success) {
        toast.success("Portal email sent successfully");
      } else {
        toast.error(data?.error || "Unknown error");
      }
      logsQuery.refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to send test portal email");
    } finally {
      setSendingPortal(false);
    }
  };

  const config = configQuery.data?.config;
  const allConfigured = config && Object.values(config).every(Boolean);
  const resendMissing = config && !config.RESEND_API_KEY;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Mail className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Email Health</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Config status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuration Status</CardTitle>
            <CardDescription>Required secrets for email delivery (values are never exposed)</CardDescription>
          </CardHeader>
          <CardContent>
            {configQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : configQuery.isError ? (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                Failed to check config
              </div>
            ) : config ? (
              <div className="space-y-1">
                <ConfigIndicator ok={config.RESEND_API_KEY} label="RESEND_API_KEY" />
                <ConfigIndicator ok={config.APP_BASE_URL} label="APP_BASE_URL" />
                <ConfigIndicator ok={config.SENDER_EMAIL} label="SENDER_EMAIL" />
                <ConfigIndicator ok={config.SENDER_NAME} label="SENDER_NAME" />

                <div className="mt-4 pt-3 border-t">
                  {allConfigured ? (
                    <div className="flex items-center gap-2 text-success text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4" />
                      All email configuration is in place
                    </div>
                  ) : resendMissing ? (
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-destructive mb-1">RESEND_API_KEY is required</p>
                      <p>Email delivery is disabled. Invite and portal emails will be logged as "skipped" until the API key is configured.</p>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-warning mb-1">Partial configuration</p>
                      <p>RESEND_API_KEY is set but optional settings are missing. Emails will send from the default sender.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => configQuery.refetch()}
              disabled={configQuery.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${configQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {/* Smoke tests */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Smoke Test</CardTitle>
            <CardDescription>Send a real email using existing invites or portal tokens</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Invite test */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Test Invite Email</label>
              <div className="flex gap-2">
                <Select value={selectedInviteId} onValueChange={setSelectedInviteId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select pending invite…" />
                  </SelectTrigger>
                  <SelectContent>
                    {pendingInvitesQuery.data?.length === 0 && (
                      <SelectItem value="__none" disabled>No pending invites</SelectItem>
                    )}
                    {pendingInvitesQuery.data?.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.email} ({inv.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleSendTestInvite}
                  disabled={!selectedInviteId || sendingInvite}
                >
                  {sendingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Portal test */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Test Portal Email</label>
              <div className="flex gap-2">
                <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select contact with token…" />
                  </SelectTrigger>
                  <SelectContent>
                    {portalContactsQuery.data?.contacts?.length === 0 && (
                      <SelectItem value="__none" disabled>No active tokens</SelectItem>
                    )}
                    {portalContactsQuery.data?.contacts?.map((c) => (
                      <SelectItem key={c.contact_id} value={c.contact_id}>
                        {c.email ? `${c.full_name || "?"} <${c.email}>` : c.full_name || c.contact_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleSendTestPortal}
                  disabled={!selectedContactId || sendingPortal}
                >
                  {sendingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email logs */}
      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Recent Email Logs</CardTitle>
            <CardDescription>Last 50 email attempts across invite and portal flows</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logsQuery.refetch()}
            disabled={logsQuery.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${logsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {logsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : logsQuery.isError ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4" />
              Failed to load email logs
            </div>
          ) : logsQuery.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No email logs yet. Send a test email to see results here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Provider ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logsQuery.data?.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {log.email_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">
                        {log.recipient_email}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">
                        {log.subject || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={log.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                        {log.error_message || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate text-muted-foreground">
                        {log.provider_message_id || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
