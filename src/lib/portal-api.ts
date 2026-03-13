/**
 * Portal API client — all portal requests go through Edge Functions.
 * 
 * Session strategy (dual-layer for cross-site cookie resilience):
 * 1. Primary: httpOnly cookie (coreflow_portal_session) — set by portal-verify
 * 2. Fallback: Authorization Bearer header using JWT stored in sessionStorage
 *    (needed in incognito / third-party-cookie-restricted contexts where the
 *     cross-site cookie from supabase.co is blocked by the browser)
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const SESSION_STORAGE_KEY = "coreflow_portal_jwt";

// --------------- Session token helpers ---------------

function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(jwt: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, jwt);
  } catch {
    // sessionStorage blocked — cookie-only mode
  }
}

function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --------------- Fetch wrapper ---------------

async function portalFetch(
  fn: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  // Always attach stored token as Authorization header (fallback for blocked cookies)
  const jwt = getStoredToken();
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  return fetch(`${FUNCTIONS_BASE}/${fn}`, {
    ...options,
    credentials: "include", // still try cookies for primary path
    headers,
  });
}

// --------------- Types ---------------

export interface PortalSessionInfo {
  workspace_id: string;
  company_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
}

// --------------- API methods ---------------

/**
 * Verify a portal token and establish a session.
 * On success, stores the JWT in sessionStorage for cross-site fallback.
 */
export async function portalVerifyToken(
  token: string
): Promise<{ success: boolean; session?: PortalSessionInfo; error?: string }> {
  const res = await portalFetch("portal-verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

  const data = await res.json();

  if (!res.ok) {
    return { success: false, error: data.error || "Verification failed" };
  }

  // Store JWT for Authorization header fallback
  if (data.portal_jwt) {
    storeToken(data.portal_jwt);
  }

  return {
    success: true,
    session: {
      workspace_id: data.workspace_id,
      company_id: data.company_id,
      contact_id: data.contact_id,
      contact_name: data.contact_name,
      contact_email: data.contact_email,
      company_name: data.company_name,
    },
  };
}

/**
 * Check session status — tries cookie first, then Authorization header.
 */
export async function portalGetSessionStatus(): Promise<{
  authenticated: boolean;
  session?: PortalSessionInfo;
}> {
  try {
    const res = await portalFetch("portal-session-status", { method: "GET" });
    if (!res.ok) return { authenticated: false };
    const data = await res.json();
    return { authenticated: true, session: data };
  } catch {
    return { authenticated: false };
  }
}

/**
 * Restore session from sessionStorage without network call.
 * Parses the JWT payload to extract session info.
 * Returns null if no stored token or token is expired.
 */
export function portalRestoreLocalSession(): PortalSessionInfo | null {
  const jwt = getStoredToken();
  if (!jwt) return null;

  try {
    const payloadB64 = jwt.split(".")[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(atob(payloadB64));

    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearStoredToken();
      return null;
    }

    return {
      workspace_id: payload.workspace_id,
      company_id: payload.company_id,
      contact_id: payload.contact_id,
      contact_name: payload.contact_name,
      contact_email: payload.contact_email,
      company_name: payload.company_name,
    };
  } catch {
    clearStoredToken();
    return null;
  }
}

/**
 * End the portal session (clear cookie + sessionStorage).
 */
export async function portalLogout(): Promise<void> {
  clearStoredToken();
  await portalFetch("portal-verify", { method: "DELETE" });
}

/**
 * Fetch a portal resource (proposals, invoices, payments).
 */
export async function portalGetResource<T = unknown>(
  resource: string
): Promise<{ data: T; error?: string }> {
  const res = await portalFetch("portal-data", {
    method: "POST",
    body: JSON.stringify({ resource }),
  });

  const json = await res.json();

  if (!res.ok) {
    return { data: [] as unknown as T, error: json.error };
  }

  return { data: json.data ?? json };
}

/**
 * Perform a portal action (respond to proposal, get line items).
 */
export async function portalAction<T = unknown>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<{ data: T; error?: string }> {
  const res = await portalFetch("portal-data", {
    method: "POST",
    body: JSON.stringify({ action, ...params }),
  });

  const json = await res.json();

  if (!res.ok) {
    return { data: null as unknown as T, error: json.error };
  }

  return { data: json };
}
