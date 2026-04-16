import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PortalDashboard } from "@/components/portal/PortalDashboard";
import { ShieldCheck, AlertTriangle, Building2 } from "lucide-react";
import {
  portalVerifyToken,
  portalGetSessionStatus,
  portalRestoreLocalSession,
  portalPeekBranding,
  type PortalSessionInfo,
  type PortalBranding,
} from "@/lib/portal-api";

export default function PortalEntry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [session, setSession] = useState<PortalSessionInfo | null>(null);
  const [branding, setBranding] = useState<PortalBranding | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<"token" | "session" | "">("");
  const [loading, setLoading] = useState(true);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    initializeSession();
  }, []);

  const initializeSession = async () => {
    setLoading(true);
    setError("");
    setErrorType("");

    const urlToken = searchParams.get("token");

    // Peek branding from token (non-blocking, pre-session)
    if (urlToken) {
      portalPeekBranding(urlToken).then((b) => {
        if (b) setBranding(b);
      });
    }

    // Step 1: Try restoring from sessionStorage (instant, no network)
    const localSession = portalRestoreLocalSession();
    if (localSession) {
      setSession(localSession);
      removeTokenFromUrl();
      setLoading(false);

      // Verify server-side in background (non-blocking)
      portalGetSessionStatus().then(({ authenticated, session: serverSession }) => {
        if (authenticated && serverSession) {
          setSession(serverSession); // update with fresh server data
        }
      });
      return;
    }

    // Step 2: Try cookie-based session restoration (network call)
    const { authenticated, session: cookieSession } = await portalGetSessionStatus();
    if (authenticated && cookieSession) {
      setSession(cookieSession);
      removeTokenFromUrl();
      setLoading(false);
      return;
    }

    // Step 3: If we have a token in URL, redeem it
    if (urlToken) {
      await redeemToken(urlToken);
    } else {
      setLoading(false);
    }
  };

  const removeTokenFromUrl = () => {
    const params = new URLSearchParams(searchParams);
    if (params.has("token")) {
      params.delete("token");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (newSearch ? `?${newSearch}` : "")
      );
    }
  };

  const redeemToken = async (token: string) => {
    setLoading(true);
    setError("");
    setErrorType("");
    try {
      const result = await portalVerifyToken(token);
      if (!result.success || !result.session) {
        const errMsg = result.error || "Invalid token";
        setError(errMsg);
        setErrorType("token");
        setLoading(false);
        return;
      }
      setSession(result.session);
      if (result.branding) setBranding(result.branding);
      removeTokenFromUrl();
    } catch {
      setError("Verification failed. Please try again.");
      setErrorType("token");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tokenInput.trim()) redeemToken(tokenInput.trim());
  };

  const accentColor = branding?.accent_color || undefined;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Validating access…</p>
      </main>
    );
  }

  if (session) {
    return <PortalDashboard session={session} initialBranding={branding} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.workspace_name || "Portal"}
              className="h-12 w-12 rounded-lg object-contain mx-auto"
            />
          ) : (
            <div
              className={`h-12 w-12 rounded-lg mx-auto flex items-center justify-center ${!accentColor ? 'bg-primary/10' : ''}`}
              style={accentColor ? { backgroundColor: `${accentColor}1a` } : undefined}
            >
              {accentColor ? (
                <Building2 className="h-7 w-7" style={{ color: accentColor }} />
              ) : (
                <ShieldCheck className="h-7 w-7 text-primary" />
              )}
            </div>
          )}
          <h1 className="text-2xl font-semibold text-foreground">
            {branding?.workspace_name ? `${branding.workspace_name} Portal` : "Client Portal"}
          </h1>
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
          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p>{error}</p>
                {errorType === "token" && error.includes("consumed") && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This token has already been used. Please request a new portal link from your service provider.
                  </p>
                )}
                {errorType === "session" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Your session could not be restored. This may happen in private/incognito browsing.
                    Please use the portal link provided by your service provider.
                  </p>
                )}
              </div>
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !tokenInput.trim()}
            style={accentColor ? { backgroundColor: accentColor } : undefined}
          >
            {loading ? "Validating…" : "Access Portal"}
          </Button>
        </form>

        {branding?.support_email && (
          <p className="text-center text-xs text-muted-foreground">
            Need help?{" "}
            <a href={`mailto:${branding.support_email}`} className="text-primary hover:underline">
              {branding.support_email}
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
