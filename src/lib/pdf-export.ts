/**
 * Shared formal A4 PDF export engine for CoreFlow commercial documents
 * (proposals/quotations and invoices). Uses jsPDF + jspdf-autotable.
 *
 * Design goals:
 *  - True A4 portrait, generous margins, print-safe
 *  - Strong header band, issuer + client blocks, document meta strip
 *  - Professional table that paginates cleanly
 *  - Totals block, signature/issuer area, page numbers in footer
 *  - Truthful: only renders fields when source data exists
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Shared types ────────────────────────────────────────────────

export interface PdfLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface PdfTaxEntry {
  name: string;
  rate_bps: number;
  amount: number;
}

export interface PdfMushak63 {
  challan_no?: string;
  hs_code?: string;
  vat_reg_no?: string;
  buyer_address?: string;
  notes?: string;
  [key: string]: any;
}

export interface PdfBankDetails {
  account_name?: string;
  account_number?: string;
  bank_name?: string;
  branch?: string;
  instructions?: string;
}

export interface PdfDocumentData {
  // Issuer identity — `workspaceName` remains the safe fallback label.
  // When `issuerRegisteredName` is provided it is used as the primary issuer
  // name on formal documents, with `issuerTradeName` shown as a secondary line.
  workspaceName: string;
  issuerRegisteredName?: string;
  issuerTradeName?: string;
  workspaceBin?: string;
  workspaceAddress?: string;
  workspaceEmail?: string;
  workspacePhone?: string;
  // Optional logo, pre-loaded as a data URL (PNG/JPEG). Rendered top-left.
  issuerLogoDataUrl?: string;
  // Optional bank/remit block — only rendered when at least one field present.
  bank?: PdfBankDetails;

  currency: string;

  // Document header
  documentType: "Proposal" | "Invoice";
  documentLabel?: string; // e.g. "QUOTATION" or "TAX INVOICE"
  documentTitle: string;
  documentRef: string; // e.g. "v2" or "INV-0042"
  status?: string;
  date: string; // formatted issue date
  validUntil?: string; // proposals: validity; invoices: due date
  dueDateLabel?: string; // override label for validUntil row

  // Client
  clientCompanyName: string;
  clientCompanyBin?: string;
  clientCompanyAddress?: string;
  clientContactName?: string;

  // Line items
  lineItems: PdfLineItem[];

  // Totals
  subtotal: number;
  taxes: PdfTaxEntry[];
  grandTotal: number;
  amountPaid?: number;
  amountDue?: number;

  // Optional blocks
  notes?: string;
  termsLabel?: string; // e.g. "Terms & Conditions" or "Notes"
  mushak?: PdfMushak63 | null;
  signatureLabel?: string; // e.g. "Authorised Signatory"
}

// ── Currency formatting ─────────────────────────────────────────
// CoreFlow is Bangladesh-only today. We avoid the ৳ glyph because
// jsPDF's built-in helvetica font does not include Bengali glyphs
// and renders them as tofu/boxes in print. Use ISO code prefix.

function formatAmount(value: number, currency: string): string {
  const code = (currency || "BDT").toUpperCase();
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = value < 0 ? "-" : "";
  return `${sign}${code} ${formatted}`;
}

// ── Layout constants ────────────────────────────────────────────

const MARGIN = 18; // mm — print-safe
const HEADER_BAND_HEIGHT = 22; // mm
const FOOTER_HEIGHT = 14; // mm
const COLOR_NAVY: [number, number, number] = [15, 23, 42]; // slate-900
const COLOR_INK: [number, number, number] = [17, 24, 39];
const COLOR_MUTED: [number, number, number] = [107, 114, 128];
const COLOR_RULE: [number, number, number] = [226, 232, 240];
const COLOR_BAND_BG: [number, number, number] = [248, 250, 252];

// ── Main generator ──────────────────────────────────────────────

export function generateDocumentPdf(data: PdfDocumentData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  // Force zero character spacing — guards against accumulated tracking
  // that can make bold helvetica render with visible inter-letter gaps
  // (e.g. "BIL L TO") in some rasterizers.
  if (typeof (doc as any).setCharSpace === "function") {
    (doc as any).setCharSpace(0);
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  // ─── Header band ─────────────────────────────────────────────
  doc.setFillColor(...COLOR_NAVY);
  doc.rect(0, 0, pageWidth, HEADER_BAND_HEIGHT, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(data.workspaceName, MARGIN, 13);

  const docLabel = (data.documentLabel || data.documentType).toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(docLabel, pageWidth - MARGIN, 13, { align: "right" });

  // Reference line under header band
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Ref: ${data.documentRef}`, pageWidth - MARGIN, 18, { align: "right" });

  let y = HEADER_BAND_HEIGHT + 8;

  // ─── Issuer + Client blocks (two columns) ────────────────────
  const colGap = 8;
  const colWidth = (contentWidth - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + colGap;

  const drawLabel = (label: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, x, yy);
  };

  const drawLine = (text: string, x: number, yy: number, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 9.5);
    doc.setTextColor(...(opts?.color ?? COLOR_INK));
    doc.text(text, x, yy);
  };

  // FROM block
  drawLabel("FROM", leftX, y);
  let ly = y + 5;
  drawLine(data.workspaceName, leftX, ly, { bold: true, size: 11 });
  ly += 5;
  if (data.workspaceAddress) {
    const lines = doc.splitTextToSize(data.workspaceAddress, colWidth);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(lines, leftX, ly);
    ly += lines.length * 4;
  }
  if (data.workspacePhone) {
    drawLine(data.workspacePhone, leftX, ly, { color: COLOR_MUTED, size: 9 });
    ly += 4;
  }
  if (data.workspaceEmail) {
    drawLine(data.workspaceEmail, leftX, ly, { color: COLOR_MUTED, size: 9 });
    ly += 4;
  }
  if (data.workspaceBin) {
    drawLine(`BIN: ${data.workspaceBin}`, leftX, ly, { color: COLOR_MUTED, size: 9 });
    ly += 4;
  }

  // BILL TO block
  drawLabel(data.documentType === "Invoice" ? "BILL TO" : "PREPARED FOR", rightX, y);
  let ry = y + 5;
  drawLine(data.clientCompanyName, rightX, ry, { bold: true, size: 11 });
  ry += 5;
  if (data.clientCompanyAddress) {
    const lines = doc.splitTextToSize(data.clientCompanyAddress, colWidth);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(lines, rightX, ry);
    ry += lines.length * 4;
  }
  if (data.clientContactName) {
    drawLine(`Attn: ${data.clientContactName}`, rightX, ry, { color: COLOR_MUTED, size: 9 });
    ry += 4;
  }
  if (data.clientCompanyBin) {
    drawLine(`BIN: ${data.clientCompanyBin}`, rightX, ry, { color: COLOR_MUTED, size: 9 });
    ry += 4;
  }

  y = Math.max(ly, ry) + 4;

  // ─── Document meta strip ─────────────────────────────────────
  // Wrap-aware: each cell can wrap to multiple lines so long titles
  // (e.g. proposal titles, invoice numbers) are never silently clipped.
  const metaItems: Array<{ label: string; value: string }> = [
    { label: "DOCUMENT", value: data.documentTitle },
    { label: "DATE", value: data.date },
  ];
  if (data.validUntil) {
    metaItems.push({
      label: (data.dueDateLabel || (data.documentType === "Invoice" ? "DUE DATE" : "VALID UNTIL")).toUpperCase(),
      value: data.validUntil,
    });
  }
  if (data.status) {
    metaItems.push({ label: "STATUS", value: data.status.toUpperCase() });
  }

  const cellW = contentWidth / metaItems.length;
  const cellInnerW = cellW - 8;

  // Pre-compute wrapped lines per cell to size the strip.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const wrappedValues = metaItems.map((item) =>
    doc.splitTextToSize(item.value || "—", cellInnerW) as string[]
  );
  const maxLines = Math.max(1, ...wrappedValues.map((l) => l.length));
  const valueLineH = 4.2;
  const metaH = Math.max(14, 7 + maxLines * valueLineH + 3);

  doc.setFillColor(...COLOR_BAND_BG);
  doc.setDrawColor(...COLOR_RULE);
  doc.setLineWidth(0.2);
  doc.roundedRect(MARGIN, y, contentWidth, metaH, 1.5, 1.5, "FD");

  metaItems.forEach((item, i) => {
    const x = MARGIN + i * cellW + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(item.label, x, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_INK);
    doc.text(wrappedValues[i], x, y + 10);
  });

  y += metaH + 6;

  // ─── Line items table ────────────────────────────────────────
  const tableHead = [["#", "Description", "Qty", "Unit Price", "Amount"]];
  const tableBody = data.lineItems.map((item, i) => [
    String(i + 1),
    item.description,
    item.quantity.toLocaleString("en-US"),
    formatAmount(item.unit_price, data.currency),
    formatAmount(item.amount, data.currency),
  ]);

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_HEIGHT + 6 },
    theme: "plain",
    // Keep each row intact across page breaks — prevents the phantom
    // "row 0" continuation artifact when a long description wraps near
    // the bottom of a page.
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: 3,
      textColor: COLOR_INK,
      lineColor: COLOR_RULE,
      lineWidth: 0.1,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: COLOR_NAVY,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      cellPadding: 3.5,
      halign: "left",
    },
    bodyStyles: {
      textColor: COLOR_INK,
      fontSize: 9.5,
      cellPadding: 3.5,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: contentWidth - 10 - 18 - 34 - 34 },
      2: { cellWidth: 18, halign: "right" },
      3: { cellWidth: 34, halign: "right" },
      4: { cellWidth: 34, halign: "right" },
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ─── Totals block (right-aligned) ────────────────────────────
  const totalsW = 78;
  const totalsX = pageWidth - MARGIN - totalsW;

  // If close to footer, push totals + everything that follows to a new page.
  const estimatedTotalsHeight =
    14 + data.taxes.length * 5 + (data.amountPaid && data.amountPaid > 0 ? 10 : 0) + 12;
  if (y + estimatedTotalsHeight > pageHeight - FOOTER_HEIGHT - 10) {
    doc.addPage();
    y = MARGIN;
  }

  const drawTotalRow = (label: string, value: string, opts?: { bold?: boolean; emphasis?: boolean }) => {
    if (opts?.emphasis) {
      doc.setFillColor(...COLOR_NAVY);
      doc.roundedRect(totalsX - 2, y - 4.5, totalsW + 4, 8.5, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setTextColor(...(opts?.bold ? COLOR_INK : COLOR_MUTED));
    }
    doc.setFont("helvetica", opts?.bold || opts?.emphasis ? "bold" : "normal");
    doc.setFontSize(opts?.emphasis ? 10.5 : 9.5);
    doc.text(label, totalsX, y);
    if (!opts?.emphasis) doc.setTextColor(...COLOR_INK);
    doc.text(value, totalsX + totalsW, y, { align: "right" });
    y += opts?.emphasis ? 7 : 5.5;
  };

  drawTotalRow("Subtotal", formatAmount(data.subtotal, data.currency));
  for (const tax of data.taxes) {
    drawTotalRow(
      `${tax.name} (${(tax.rate_bps / 100).toFixed(2)}%)`,
      formatAmount(tax.amount, data.currency)
    );
  }
  // Thin rule
  doc.setDrawColor(...COLOR_RULE);
  doc.setLineWidth(0.3);
  doc.line(totalsX, y - 3, totalsX + totalsW, y - 3);
  y += 1;

  drawTotalRow("Grand Total", formatAmount(data.grandTotal, data.currency), { emphasis: true });

  if (data.documentType === "Invoice" && typeof data.amountPaid === "number" && data.amountPaid > 0) {
    drawTotalRow("Amount Paid", formatAmount(data.amountPaid, data.currency));
    const due = typeof data.amountDue === "number" ? data.amountDue : data.grandTotal - data.amountPaid;
    drawTotalRow("Amount Due", formatAmount(due, data.currency), { bold: true });
  }

  y += 6;

  // ─── Mushak 6.3 block (invoices only, when populated) ───────
  if (data.documentType === "Invoice" && data.mushak && hasMushakContent(data.mushak)) {
    if (y + 28 > pageHeight - FOOTER_HEIGHT - 6) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFillColor(...COLOR_BAND_BG);
    doc.setDrawColor(...COLOR_RULE);
    doc.roundedRect(MARGIN, y, contentWidth, 26, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text("MUSHAK 6.3 (VAT CHALLAN)", MARGIN + 4, y + 5);

    const m = data.mushak;
    const cells: Array<[string, string]> = [];
    if (m.challan_no) cells.push(["Challan No", String(m.challan_no)]);
    if (m.vat_reg_no) cells.push(["VAT Reg. No", String(m.vat_reg_no)]);
    if (m.hs_code) cells.push(["HS Code", String(m.hs_code)]);

    const colW = contentWidth / Math.max(cells.length, 1);
    cells.forEach((c, i) => {
      const cx = MARGIN + i * colW + 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(c[0], cx, y + 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...COLOR_INK);
      doc.text(c[1], cx, y + 17);
    });

    if (m.notes) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_MUTED);
      const n = doc.splitTextToSize(m.notes, contentWidth - 8);
      doc.text(n[0], MARGIN + 4, y + 23);
    }

    y += 30;
  }

  // ─── Notes / Terms block ─────────────────────────────────────
  if (data.notes) {
    if (y + 18 > pageHeight - FOOTER_HEIGHT - 30) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text((data.termsLabel || "NOTES").toUpperCase(), MARGIN, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    const splitNotes = doc.splitTextToSize(data.notes, contentWidth);
    doc.text(splitNotes, MARGIN, y);
    y += splitNotes.length * 4 + 6;
  }

  // ─── Signature / issuer area ─────────────────────────────────
  // Always reserve a clean signature area near the bottom of the
  // last content page, but if not enough room remains, push to a new page.
  const sigBlockHeight = 26;
  if (y + sigBlockHeight > pageHeight - FOOTER_HEIGHT - 6) {
    doc.addPage();
    y = pageHeight - FOOTER_HEIGHT - sigBlockHeight - 6;
  } else {
    y = Math.max(y, pageHeight - FOOTER_HEIGHT - sigBlockHeight - 6);
  }

  const sigW = 70;
  const sigX = pageWidth - MARGIN - sigW;
  doc.setDrawColor(...COLOR_INK);
  doc.setLineWidth(0.3);
  doc.line(sigX, y + 14, sigX + sigW, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(data.signatureLabel || `For ${data.workspaceName}`, sigX, y + 19);
  doc.text("Authorised Signatory", sigX, y + 23);

  // ─── Footer + page numbers across all pages ──────────────────
  finalisePages(doc, data.workspaceName);

  return doc;
}

function hasMushakContent(m: PdfMushak63): boolean {
  return Boolean(m.challan_no || m.vat_reg_no || m.hs_code || m.notes);
}

function finalisePages(doc: jsPDF, workspaceName: string) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generated = `Generated by CoreFlow on ${new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Top thin rule on continuation pages (page > 1)
    if (i > 1) {
      doc.setDrawColor(...COLOR_RULE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, MARGIN - 4, pageWidth - MARGIN, MARGIN - 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(`${workspaceName} — continued`, MARGIN, MARGIN - 6);
    }
    // Footer rule
    doc.setDrawColor(...COLOR_RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, pageHeight - FOOTER_HEIGHT + 2, pageWidth - MARGIN, pageHeight - FOOTER_HEIGHT + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(generated, MARGIN, pageHeight - 6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 6, { align: "right" });
  }
}

// ── Convenience download helper ─────────────────────────────────

export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}
