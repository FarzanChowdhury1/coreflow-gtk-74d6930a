/**
 * Proposal-specific PDF export logic.
 * Gathers data from Supabase and delegates to the shared formal A4 engine.
 */
import { supabase } from "@/integrations/supabase/client";
import { generateDocumentPdf, downloadPdf } from "./pdf-export";
import type { PdfLineItem, PdfTaxEntry } from "./pdf-export";
import { format } from "date-fns";

export interface ProposalPdfOptions {
  proposalId: string;
  versionId: string;
  workspaceName: string;
  workspaceCurrency?: string;
}

export async function exportProposalPdf(opts: ProposalPdfOptions) {
  // Fetch proposal with company (incl. address & BIN where present)
  const { data: proposal, error: pErr } = await supabase
    .from("proposals")
    .select("*, companies(legal_name, bin, address)")
    .eq("id", opts.proposalId)
    .single();
  if (pErr || !proposal) throw new Error(pErr?.message || "Proposal not found");

  const { data: version, error: vErr } = await supabase
    .from("proposal_versions")
    .select("*")
    .eq("id", opts.versionId)
    .single();
  if (vErr || !version) throw new Error(vErr?.message || "Version not found");

  const { data: lineItems = [] } = await supabase
    .from("proposal_line_items")
    .select("*")
    .eq("version_id", opts.versionId)
    .order("sort_order", { ascending: true });

  // Build tax breakdown
  const taxConfig: Array<{ name: string; rate_bps: number }> = Array.isArray(version.tax_config)
    ? (version.tax_config as any[]).map((t: any) => ({
        name: t.name || "Tax",
        rate_bps: Number(t.rate_bps) || 0,
      }))
    : [];

  const subtotal = (lineItems || []).reduce((s, li) => s + Number(li.amount), 0);
  const taxes: PdfTaxEntry[] = taxConfig.map((t) => ({
    ...t,
    amount: subtotal * (t.rate_bps / 10000),
  }));
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  const grandTotal = subtotal + taxTotal;

  const currency = version.currency || opts.workspaceCurrency || "BDT";
  const company = proposal.companies as any;

  const pdfLineItems: PdfLineItem[] = (lineItems || []).map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unit_price: Number(li.unit_price),
    amount: Number(li.amount),
  }));

  const doc = generateDocumentPdf({
    workspaceName: opts.workspaceName,
    currency,
    documentType: "Proposal",
    documentLabel: "QUOTATION",
    documentTitle: proposal.title,
    documentRef: `v${version.version_number}`,
    status: version.status,
    date: format(new Date(version.created_at), "dd MMM yyyy"),
    validUntil: version.valid_until
      ? format(new Date(version.valid_until), "dd MMM yyyy")
      : undefined,
    dueDateLabel: "VALID UNTIL",
    clientCompanyName: company?.legal_name || "—",
    clientCompanyBin: company?.bin || undefined,
    clientCompanyAddress: company?.address || undefined,
    lineItems: pdfLineItems,
    subtotal,
    taxes,
    grandTotal,
    notes: version.notes || proposal.notes || undefined,
    termsLabel: "Notes & Terms",
  });

  const safeName = proposal.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
  downloadPdf(doc, `${safeName} v${version.version_number}.pdf`);
}
