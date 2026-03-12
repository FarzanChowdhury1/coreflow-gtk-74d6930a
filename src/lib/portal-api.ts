/**
 * Portal API client — all portal requests go through Edge Functions.
 * Session state is managed via httpOnly cookies (signed JWT, coreflow_portal_session).
 * The raw portal token is never stored client-side after verification.
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function portalFetch(
  fn: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${FUNCTIONS_BASE}/${fn}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export interface PortalSessionInfo {
  workspace_id: string;
  company_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
}

/**
 * Verify a portal token and establish a signed JWT cookie session.
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
 * Check session status via the httpOnly JWT cookie.
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
 * End the portal session (clear httpOnly cookie).
 */
export async function portalLogout(): Promise<void> {
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
