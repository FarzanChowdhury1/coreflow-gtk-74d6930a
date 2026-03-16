import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Users } from "lucide-react";

interface InviteInfo {
  valid: boolean;
  error?: string;
  invite_id?: string;
  workspace_name?: string;
  role?: string;
  email?: string;
}

export default function InviteAccept() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Resolve invite token to get details
  useEffect(() => {
    if (!token) {
      setInviteInfo({ valid: false, error: "No invite token provided" });
      setLoading(false);
      return;
    }

    const resolve = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("resolve_invite_by_token", { _token: token });
      if (error) {
        setInviteInfo({ valid: false, error: error.message });
      } else {
        setInviteInfo(data as unknown as InviteInfo);
      }
      setLoading(false);
    };

    resolve();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    const { data, error } = await supabase.rpc("accept_invite_by_token", { _token: token });
    if (error) {
      setResult({ success: false, message: error.message });
    } else {
      const res = data as any;
      if (res.success) {
        setResult({ success: true, message: res.already_member ? "You are already a member of this workspace." : "You have joined the workspace!" });
        // Redirect to dashboard after a short delay
        setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
      } else {
        setResult({ success: false, message: res.error || "Failed to accept invite" });
      }
    }
    setAccepting(false);
  };

  const handleDecline = async () => {
    if (!inviteInfo?.invite_id) return;
    setDeclining(true);
    const { data, error } = await supabase.rpc("decline_workspace_invite", { _invite_id: inviteInfo.invite_id });
    if (error) {
      setResult({ success: false, message: error.message });
    } else {
      const res = data as any;
      if (res.success) {
        setResult({ success: true, message: "Invite declined." });
      } else {
        setResult({ success: false, message: res.error || "Failed to decline invite" });
      }
    }
    setDeclining(false);
  };

  // Still loading auth
  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // Not logged in — redirect to login with return URL
  if (!user) {
    const returnUrl = `/invite?token=${encodeURIComponent(token || "")}`;
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Workspace Invite</CardTitle>
            <CardDescription>You need to log in or sign up to accept this invite.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link to={`/login?redirect=${encodeURIComponent(returnUrl)}`}>Log In or Sign Up</Link>
            </Button>
          </CardContent>
        </Card>
        </main>
    );
  }

  // Loading invite info
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
    );
  }

  // Result after action
  if (result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-6">
            {result.success ? (
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            ) : (
              <XCircle className="h-12 w-12 text-destructive" />
            )}
            <p className="text-center text-sm text-foreground">{result.message}</p>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid invite
  if (!inviteInfo?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-6">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <p className="text-center font-medium text-foreground">Invalid Invite</p>
            <p className="text-center text-sm text-muted-foreground">{inviteInfo?.error || "This invite link is not valid."}</p>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Valid invite — show accept/decline
  const emailMatch = inviteInfo.email?.toLowerCase() === user.email?.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Join {inviteInfo.workspace_name}</CardTitle>
          <CardDescription>
            You've been invited to join as{" "}
            <span className="font-medium text-foreground">
              {inviteInfo.role === "admin" ? "Admin" : "Team Member"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!emailMatch && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              This invite was sent to <strong>{inviteInfo.email}</strong>, but you are logged in as{" "}
              <strong>{user.email}</strong>. You need to log in with the invited email to accept.
            </div>
          )}

          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Invite sent to: <strong className="text-foreground">{inviteInfo.email}</strong>
          </div>

          {emailMatch && (
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleAccept} disabled={accepting || declining}>
                {accepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Accept Invite
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleDecline} disabled={accepting || declining}>
                {declining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Decline
              </Button>
            </div>
          )}

          {!emailMatch && (
            <Button variant="outline" className="w-full" asChild>
              <Link to={`/login?redirect=${encodeURIComponent(`/invite?token=${token}`)}`}>
                Switch Account
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
