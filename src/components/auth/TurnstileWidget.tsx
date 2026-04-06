import { useEffect, useRef, useState, useCallback } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoaded?: () => void;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const SCRIPT_ID = "cf-turnstile-script";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  className?: string;
}

export function TurnstileWidget({ onVerify, onExpire, className }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(!!window.turnstile);

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onVerify(token),
      "expired-callback": () => onExpire?.(),
      theme: "auto",
      size: "normal",
    });
  }, [onVerify, onExpire]);

  useEffect(() => {
    if (!SITE_KEY) {
      // If no site key configured, pass a bypass token so forms still work
      onVerify("__bypass__");
      return;
    }

    if (window.turnstile) {
      setReady(true);
      renderWidget();
      return;
    }

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded";
      script.async = true;
      document.head.appendChild(script);
    }

    window.onTurnstileLoaded = () => {
      setReady(true);
    };

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (ready) renderWidget();
  }, [ready, renderWidget]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} className={className} />;
}

/** Hook: returns [token, TurnstileElement, resetFn] */
export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const resetRef = useRef<(() => void) | null>(null);

  const onVerify = useCallback((t: string) => setToken(t), []);
  const onExpire = useCallback(() => setToken(null), []);

  const element = SITE_KEY ? (
    <TurnstileWidget onVerify={onVerify} onExpire={onExpire} className="mt-3" />
  ) : null;

  // If no site key, always return a valid token
  const effectiveToken = SITE_KEY ? token : "__bypass__";

  return { turnstileToken: effectiveToken, TurnstileElement: element };
}
