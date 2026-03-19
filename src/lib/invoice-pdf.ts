/**
 * Invoice-specific PDF export logic.
 * Gathers data from Supabase and delegates to the shared PDF generator.
 */
import { supabase } from "@/integrations/supabase/client";
import { generateDocumentPdf, downloadPdf } from "./pdf-export";
import type { PdfLineItem, PdfTaxEntry } from "./pdf-export";
import { format } from "date-fns";

export interface InvoicePdfOptions {
  invoiceId: string;
  workspaceName: string;
  workspaceCurrency?: string;
}

export async function exportInvoicePdf(opts: InvoicePdfOptions) {
  const [invRes, liRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, companies(legal_name, bin)")
      .eq("id", opts.invoiceId)
      .single(),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", opts.invoiceId)
      .order("sort_order", { ascending: true }),
  ]);

  if (invRes.error || !invRes.data) throw new Error(invRes.error?.message || "Invoice not found");
  const invoice = invRes.data;
  const items = liRes.data || [];

  const company = invoice.companies as any;
  const currency = invoice.currency || opts.workspaceCurrency || "BDT";

  // Tax breakdown — invoice uses { label, bps } format
  const taxConfig: Array<{ name: string; rate_bps: number }> = Array.isArray(invoice.tax_config)
    ? (invoice.tax_config as any[]).map((t: any) => ({
        name: t.label || t.name || "Tax",
        rate_bps: Number(t.bps || t.rate_bps) || 0,
      }))
    : [];

  const subtotal = items.reduce((s, li) => s + Number(li.amount), 0);
  const taxes: PdfTaxEntry[] = taxConfig.map((t) => ({
    ...t,
    amount: subtotal * (t.rate_bps / 10000),
  }));

  const pdfLineItems: PdfLineItem[] = items.map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unit_price: Number(li.unit_price),
    amount: Number(li.amount),
  }));

  // Build status label with payment info
  let statusLabel = invoice.status?.replace("_", " ");
  if (invoice.status === "partially_paid" && Number(invoice.amount_paid) > 0) {
    statusLabel = `partially paid`;
  }

  const doc = generateDocumentPdf({
    workspaceName: opts.workspaceName,
    currency,
    documentType: "Invoice",
    documentTitle: invoice.invoice_number,
    documentRef: invoice.invoice_number,
    status: statusLabel,
    date: invoice.issue_date
      ? format(new Date(invoice.issue_date), "dd MMM yyyy")
      : format(new Date(invoice.created_at), "dd MMM yyyy"),
    validUntil: invoice.due_date
      ? format(new Date(invoice.due_date), "dd MMM yyyy")
      : undefined,
    clientCompanyName: company?.legal_name || "—",
    clientCompanyBin: company?.bin,
    lineItems: pdfLineItems,
    subtotal,
    taxes,
    grandTotal: Number(invoice.grand_total) || subtotal + taxes.reduce((s, t) => s + t.amount, 0),
    notes: invoice.notes || undefined,
  });

  downloadPdf(doc, `${invoice.invoice_number}.pdf`);
}
