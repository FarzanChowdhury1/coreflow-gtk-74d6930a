/**
 * Helpers for assembling the workspace document-issuer identity used by
 * formal PDFs (proposals/invoices). The sensitive issuer fields (banking,
 * BIN, registered address, contact info) are stored on `public.workspaces`
 * but are admin-only via column-level GRANTs. They are read here via the
 * SECURITY DEFINER `get_workspace_doc_identity(workspace_id)` RPC, which
 * itself enforces `has_workspace_role(..., 'admin')`.
 *
 * Non-admin callers simply get an issuer with only the workspace display
 * name — we never fabricate issuer data.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PdfBankDetails } from "./pdf-export";

interface WorkspaceLike {
  id?: string | null;
  name?: string | null;
}

export interface ResolvedIssuerIdentity {
  workspaceName: string;
  issuerRegisteredName?: string;
  issuerTradeName?: string;
  workspaceAddress?: string;
  workspacePhone?: string;
  workspaceEmail?: string;
  workspaceBin?: string;
  issuerLogoDataUrl?: string;
  bank?: PdfBankDetails;
}

function nonEmpty(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t.length ? t : undefined;
}

async function loadLogoDataUrl(storagePath: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.storage
      .from("workspace-files")
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) return undefined;

    const res = await fetch(data.signedUrl);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g)$/i.test(blob.type)) return undefined;

    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function resolveWorkspaceIssuer(
  workspace: WorkspaceLike | null | undefined
): Promise<ResolvedIssuerIdentity> {
  const fallbackName = workspace?.name || "CoreFlow";
  if (!workspace?.id) {
    return { workspaceName: fallbackName };
  }

  // Admin-only RPC. Returns 0 rows for non-admins -> degrade gracefully.
  const { data, error } = await supabase
    .rpc("get_workspace_doc_identity" as any, { _workspace_id: workspace.id });
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return { workspaceName: fallbackName };
  }
  const ident: any = Array.isArray(data) ? data[0] : data;

  const logoPath = nonEmpty(ident.doc_logo_storage_path);
  const issuerLogoDataUrl = logoPath ? await loadLogoDataUrl(logoPath) : undefined;

  const bank: PdfBankDetails = {
    account_name: nonEmpty(ident.doc_bank_account_name),
    account_number: nonEmpty(ident.doc_bank_account_number),
    bank_name: nonEmpty(ident.doc_bank_name),
    branch: nonEmpty(ident.doc_bank_branch),
    instructions: nonEmpty(ident.doc_payment_instructions),
  };
  const hasBank = Object.values(bank).some(Boolean);

  return {
    workspaceName: fallbackName,
    issuerRegisteredName: nonEmpty(ident.doc_registered_name),
    issuerTradeName: nonEmpty(ident.doc_trade_name),
    workspaceAddress: nonEmpty(ident.doc_address),
    workspacePhone: nonEmpty(ident.doc_phone),
    workspaceEmail: nonEmpty(ident.doc_email),
    workspaceBin: nonEmpty(ident.doc_bin),
    issuerLogoDataUrl,
    bank: hasBank ? bank : undefined,
  };
}
