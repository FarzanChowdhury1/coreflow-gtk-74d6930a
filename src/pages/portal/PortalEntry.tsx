import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PortalDashboard } from "@/components/portal/PortalDashboard";
import { ShieldCheck } from "lucide-react";
import { portalVerifyToken, type PortalSessionInfo } from "@/lib/portal-api";

export default function PortalEntry() {
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<PortalSessionInfo | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoValidating, setAutoValidating] = useState(false);

  useEffect(() => {
    const urlToken = searchParams.get("token");
    if (urlToken && !session) {
      setAutoValidating(true);
      validateToken(urlToken);
    }
  }, [searchParams]);

  const validateToken = async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await portalVerifyToken(token);
      if (!result.success || !result.session) {
        setError(result.error || "Invalid token");
        return;
      }
      setSession(result.session);
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setLoading(false);
      setAutoValidating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tokenInput.trim()) validateToken(tokenInput.trim());
  };

  if (autoValidating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Validating access…</p>
      </div>
    );
  }

  if (session) {
    return <PortalDashboard session={session} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-2xl font-semibold text-foreground">Client Portal</h1>
          <p className="text-sm text-muted-foreground">
            Enter your access token or use the link provided by your service provider.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste your access token"
            className="font-mono text-sm"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !tokenInput.trim()}>
            {loading ? "Validating…" : "Access Portal"}
          </Button>
        </form>
      </div>
    </div>
  );
}
