import fs from 'node:fs';
globalThis.window = globalThis;
import jsPDFNs from 'jspdf';
const jsPDF = jsPDFNs.jsPDF || jsPDFNs.default || jsPDFNs;
import autoTableNs from 'jspdf-autotable';
const autoTable = autoTableNs.default || autoTableNs;

const eng = await import('/dev-server/src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;

fs.mkdirSync('/tmp/pdfqa', { recursive: true });

function save(doc, name) {
  const buf = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(`/tmp/pdfqa/${name}`, buf);
  console.log('wrote', name, buf.length);
}

// Mirror what invoice-pdf.ts builds for the actual issued INV-000001 + buyer_address + notes
save(generateDocumentPdf({
  workspaceName: 'CoreFlow HQ',
  issuerRegisteredName: 'CoreFlow HQ',
  workspaceAddress: 'Dhaka, Bangladesh',
  workspaceEmail: 'hello@coreflow.test',
  workspacePhone: '+880 1700 000000',
  workspaceBin: '000123456-0101',
  currency: 'BDT',
  documentType: 'Invoice',
  documentLabel: 'TAX INVOICE',
  documentTitle: 'INV-000001',
  documentRef: 'INV-000001',
  status: 'issued',
  date: '23 Apr 2026',
  dueDateLabel: 'DUE DATE',
  clientCompanyName: 'Meridian Creative Agency',
  clientCompanyBin: '987654321-0202',
  clientCompanyAddress: 'Gulshan-2, Dhaka 1212',
  lineItems: [
    { description: 'Mushak truth-pass test service', quantity: 1, unit_price: 10000, amount: 10000 },
  ],
  subtotal: 10000,
  taxes: [],
  grandTotal: 10000,
  notes: 'Top-level invoice notes — should appear in the NOTES block at the bottom.',
  termsLabel: 'Notes',
  mushak: {
    challan_no: 'CH-2025-001',
    vat_reg_no: '1234567890123',
    hs_code: '8523',
    buyer_address: '123 Buyer Road, Banani, Dhaka 1213',
    notes: 'Mushak inline note — should appear inside the Mushak block.',
  },
}), 'mushak-invoice.pdf');
