import fs from 'node:fs';
globalThis.window = globalThis;

import jsPDFNs from 'jspdf';
const jsPDF = jsPDFNs.jsPDF || jsPDFNs.default || jsPDFNs;
console.log('jsPDF type:', typeof jsPDF);

import autoTableNs from 'jspdf-autotable';
const autoTable = autoTableNs.default || autoTableNs;

// Inline a require-like loader for the engine: the engine imports jspdf as default.
// Instead of editing source, replicate the engine via dynamic import using a
// vite-free path: import the .ts directly via tsx.
const eng = await import('/dev-server/src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;
console.log('engine fn type:', typeof generateDocumentPdf);

function save(doc, name) {
  const buf = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(`/tmp/pdfqa/${name}`, buf);
  console.log('wrote', name, buf.length);
}

save(generateDocumentPdf({
  workspaceName: 'DARVIZ Labs',
  workspaceAddress: 'Banani, Dhaka 1213, Bangladesh',
  workspaceEmail: 'hello@darviz.io',
  workspacePhone: '+880 1700 000000',
  workspaceBin: '000123456-0101',
  currency: 'BDT',
  documentType: 'Proposal',
  documentLabel: 'QUOTATION',
  documentTitle: 'Brand Refresh Engagement',
  documentRef: 'v3',
  status: 'sent',
  date: '18 Apr 2026',
  validUntil: '02 May 2026',
  dueDateLabel: 'VALID UNTIL',
  clientCompanyName: 'Acme Bangladesh Ltd.',
  clientCompanyBin: '987654321-0202',
  clientCompanyAddress: 'House 12, Road 7, Gulshan-1, Dhaka 1212',
  clientContactName: 'Nadia Rahman',
  lineItems: [
    { description: 'Brand discovery workshop (2 days, on-site)', quantity: 1, unit_price: 85000, amount: 85000 },
    { description: 'Visual identity system (logo, type, color)', quantity: 1, unit_price: 240000, amount: 240000 },
    { description: 'Brand guidelines document (PDF + Figma)', quantity: 1, unit_price: 65000, amount: 65000 },
    { description: 'Launch collateral pack (social, email, print)', quantity: 4, unit_price: 22500, amount: 90000 },
  ],
  subtotal: 480000,
  taxes: [{ name: 'VAT', rate_bps: 1500, amount: 72000 }],
  grandTotal: 552000,
  notes: 'Pricing valid for 14 days. 50% advance required to commence; balance on delivery. Two rounds of revision included per deliverable; additional rounds billed at BDT 8,000/hr.',
  termsLabel: 'Notes & Terms',
}), 'proposal.pdf');

save(generateDocumentPdf({
  workspaceName: 'DARVIZ Labs',
  workspaceAddress: 'Banani, Dhaka 1213, Bangladesh',
  workspaceEmail: 'hello@darviz.io',
  workspacePhone: '+880 1700 000000',
  workspaceBin: '000123456-0101',
  currency: 'BDT',
  documentType: 'Invoice',
  documentLabel: 'TAX INVOICE',
  documentTitle: 'INV-2026-0042',
  documentRef: 'INV-2026-0042',
  status: 'partially paid',
  date: '10 Apr 2026',
  validUntil: '24 Apr 2026',
  dueDateLabel: 'DUE DATE',
  clientCompanyName: 'Acme Bangladesh Ltd.',
  clientCompanyBin: '987654321-0202',
  clientCompanyAddress: 'House 12, Road 7, Gulshan-1, Dhaka 1212',
  lineItems: [
    { description: 'Brand discovery workshop (2 days, on-site)', quantity: 1, unit_price: 85000, amount: 85000 },
    { description: 'Visual identity system', quantity: 1, unit_price: 240000, amount: 240000 },
    { description: 'Guidelines document', quantity: 1, unit_price: 65000, amount: 65000 },
  ],
  subtotal: 390000,
  taxes: [{ name: 'VAT', rate_bps: 1500, amount: 58500 }],
  grandTotal: 448500,
  amountPaid: 200000,
  amountDue: 248500,
  notes: 'Please reference invoice number on bank transfer. Late payments incur 1.5%/month service charge per agreement.',
  termsLabel: 'Notes',
  mushak: { challan_no: 'CHL-2026-0042', vat_reg_no: '000123456-0101', hs_code: '9983.99', notes: 'Issued under VAT and SD Act 2012, Rule 40.' },
}), 'invoice-mushak.pdf');

save(generateDocumentPdf({
  workspaceName: 'DARVIZ Labs',
  currency: 'BDT',
  documentType: 'Invoice',
  documentTitle: 'INV-2026-0050',
  documentRef: 'INV-2026-0050',
  status: 'sent',
  date: '15 Apr 2026',
  validUntil: '29 Apr 2026',
  dueDateLabel: 'DUE DATE',
  clientCompanyName: 'Beta Traders',
  lineItems: [
    { description: 'Monthly retainer — April 2026', quantity: 1, unit_price: 120000, amount: 120000 },
  ],
  subtotal: 120000,
  taxes: [],
  grandTotal: 120000,
  mushak: null,
}), 'invoice-plain.pdf');

const many = Array.from({ length: 40 }, (_, i) => ({
  description: `Line item ${i + 1} — service rendered for engagement, batch ${Math.floor(i / 5) + 1}, with a longer description that should wrap nicely inside the description column without breaking the table layout`,
  quantity: (i % 5) + 1,
  unit_price: 5000 + i * 250,
  amount: ((i % 5) + 1) * (5000 + i * 250),
}));
const sub = many.reduce((s, x) => s + x.amount, 0);
save(generateDocumentPdf({
  workspaceName: 'DARVIZ Labs',
  workspaceAddress: 'Banani, Dhaka 1213, Bangladesh',
  workspaceBin: '000123456-0101',
  currency: 'BDT',
  documentType: 'Invoice',
  documentTitle: 'INV-2026-0099',
  documentRef: 'INV-2026-0099',
  status: 'sent',
  date: '15 Apr 2026',
  validUntil: '30 Apr 2026',
  dueDateLabel: 'DUE DATE',
  clientCompanyName: 'Long Engagement Ltd.',
  clientCompanyAddress: 'Plot 3, Sector 7, Uttara, Dhaka',
  clientCompanyBin: '111222333-0303',
  lineItems: many,
  subtotal: sub,
  taxes: [{ name: 'VAT', rate_bps: 1500, amount: sub * 0.15 }],
  grandTotal: sub * 1.15,
  notes: 'Long engagement — see line items.',
  termsLabel: 'Notes',
}), 'invoice-multipage.pdf');

console.log('done');
