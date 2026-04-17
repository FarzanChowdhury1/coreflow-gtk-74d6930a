/**
 * Shared PDF export utilities for CoreFlow documents (proposals, invoices).
 * Uses jsPDF + jspdf-autotable for reliable client-side PDF generation.
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

export interface PdfDocumentData {
  // Identity
  workspaceName: string;
  currency: string;

  // Document header
  documentType: "Proposal" | "Invoice";
  documentTitle: string;
  documentRef: string; // e.g. "v2" or "INV-0042"
  status?: string;
  date: string; // formatted date string
  validUntil?: string;

  // Client
  clientCompanyName: string;
  clientCompanyBin?: string;
  clientContactName?: string;

  // Line items
  lineItems: PdfLineItem[];

  // Totals
  subtotal: number;
  taxes: PdfTaxEntry[];
  grandTotal: number;

  // Optional
  notes?: string;
}

// ── Helpers ─────────────────────────────────────────────────────

// CoreFlow is Bangladesh-only — all exported amounts are BDT.
function fmt(value: number, _currency: string): string {
  return `৳${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Main generator ──────────────────────────────────────────────

export function generateDocumentPdf(data: PdfDocumentData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ─── Header bar ──────────────────────────────────────────────
  doc.setFillColor(17, 24, 39); // slate-900
  doc.rect(0, 0, pageWidth, 38, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(data.workspaceName, margin, 16);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(data.documentType.toUpperCase(), margin, 26);

  // Status badge on right
  if (data.status) {
    const statusText = data.status.toUpperCase();
    doc.setFontSize(10);
    const sw = doc.getTextWidth(statusText) + 8;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(pageWidth - margin - sw, 10, sw, 8, 1.5, 1.5, "F");
    doc.setTextColor(17, 24, 39);
    doc.text(statusText, pageWidth - margin - sw + 4, 16);
  }

  y = 48;

  // ─── Document info columns ───────────────────────────────────
  doc.setTextColor(107, 114, 128); // gray-500
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");

  // Left column - document info
  const leftCol = margin;
  const rightCol = pageWidth / 2 + 5;

  doc.text("DOCUMENT", leftCol, y);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  y += 5;
  doc.text(data.documentTitle, leftCol, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(`Ref: ${data.documentRef}`, leftCol, y);

  // Right column - client info
  let ry = 48;
  doc.setFontSize(8);
  doc.text("PREPARED FOR", rightCol, ry);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  ry += 5;
  doc.text(data.clientCompanyName, rightCol, ry);
  ry += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  if (data.clientCompanyBin) {
    doc.text(`BIN: ${data.clientCompanyBin}`, rightCol, ry);
    ry += 4;
  }
  if (data.clientContactName) {
    doc.text(`Attn: ${data.clientContactName}`, rightCol, ry);
  }

  y += 8;

  // Date row
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Date: ${data.date}`, leftCol, y);
  if (data.validUntil) {
    doc.text(`Valid Until: ${data.validUntil}`, rightCol, y);
  }

  y += 8;

  // ─── Divider ─────────────────────────────────────────────────
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // ─── Line items table ────────────────────────────────────────
  const tableHead = [["#", "Description", "Qty", "Unit Price", "Amount"]];
  const tableBody = data.lineItems.map((item, i) => [
    String(i + 1),
    item.description,
    String(item.quantity),
    fmt(item.unit_price, data.currency),
    fmt(item.amount, data.currency),
  ]);

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: margin, right: margin },
    theme: "plain",
    headStyles: {
      fillColor: [243, 244, 246], // gray-100
      textColor: [75, 85, 99], // gray-600
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 3,
    },
    bodyStyles: {
      textColor: [17, 24, 39],
      fontSize: 9,
      cellPadding: 3,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: contentWidth - 10 - 20 - 32 - 32 },
      2: { cellWidth: 20, halign: "right" },
      3: { cellWidth: 32, halign: "right" },
      4: { cellWidth: 32, halign: "right" },
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251], // gray-50
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ─── Totals block ────────────────────────────────────────────
  const totalsX = pageWidth - margin - 80;
  const totalsW = 80;

  const drawTotalRow = (label: string, value: string, bold = false) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(bold ? 17 : 107, bold ? 24 : 114, bold ? 39 : 128);
    doc.text(label, totalsX, y);
    doc.setTextColor(17, 24, 39);
    doc.text(value, totalsX + totalsW, y, { align: "right" });
    y += 5;
  };

  drawTotalRow("Subtotal", fmt(data.subtotal, data.currency));

  for (const tax of data.taxes) {
    drawTotalRow(`${tax.name} (${(tax.rate_bps / 100).toFixed(1)}%)`, fmt(tax.amount, data.currency));
  }

  // Grand total with highlight
  y += 1;
  doc.setFillColor(243, 244, 246);
  doc.roundedRect(totalsX - 3, y - 4, totalsW + 6, 8, 1, 1, "F");
  drawTotalRow("Grand Total", fmt(data.grandTotal, data.currency), true);

  // ─── Notes ───────────────────────────────────────────────────
  if (data.notes) {
    y += 8;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(107, 114, 128);
    doc.text("NOTES", margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    const splitNotes = doc.splitTextToSize(data.notes, contentWidth);
    doc.text(splitNotes, margin, y);
  }

  // ─── Footer ──────────────────────────────────────────────────
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(156, 163, 175);
  doc.text(
    `Generated by CoreFlow · ${new Date().toLocaleDateString()}`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" }
  );

  return doc;
}

// ── Convenience download helper ─────────────────────────────────

export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}
