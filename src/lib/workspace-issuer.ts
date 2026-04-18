/**
 * Helpers for assembling the workspace document-issuer identity used by
 * formal PDFs (proposals/invoices). Reads from public.workspaces.doc_*
 * columns and resolves the optional logo from the workspace-files bucket
 * into a data URL that jsPDF can embed.
 *
 * All fields are optional — missing values are simply omitted by the
 * PDF engine. We never fabricate issuer data.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { PdfBankDetails } from "./pdf-export";

type Workspace = Tables<"workspaces"> & {
  // The doc_* columns may not yet exist in the generated types. Cast access.
  [key: string]: any;
};

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
  workspace: Workspace | null | undefined
): Promise<ResolvedIssuerIdentity> {
  const fallbackName = workspace?.name || "CoreFlow";
  if (!workspace) {
    return { workspaceName: fallbackName };
  }

  const logoPath = nonEmpty(workspace.doc_logo_storage_path);
  const issuerLogoDataUrl = logoPath ? await loadLogoDataUrl(logoPath) : undefined;

  const bank: PdfBankDetails = {
    account_name: nonEmpty(workspace.doc_bank_account_name),
    account_number: nonEmpty(workspace.doc_bank_account_number),
    bank_name: nonEmpty(workspace.doc_bank_name),
    branch: nonEmpty(workspace.doc_bank_branch),
    instructions: nonEmpty(workspace.doc_payment_instructions),
  };
  const hasBank = Object.values(bank).some(Boolean);

  return {
    workspaceName: fallbackName,
    issuerRegisteredName: nonEmpty(workspace.doc_registered_name),
    issuerTradeName: nonEmpty(workspace.doc_trade_name),
    workspaceAddress: nonEmpty(workspace.doc_address),
    workspacePhone: nonEmpty(workspace.doc_phone),
    workspaceEmail: nonEmpty(workspace.doc_email) || nonEmpty(workspace.portal_support_email),
    workspaceBin: nonEmpty(workspace.doc_bin),
    issuerLogoDataUrl,
    bank: hasBank ? bank : undefined,
  };
}
