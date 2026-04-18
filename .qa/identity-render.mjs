import { createServer } from 'vite';
import fs from 'node:fs';
globalThis.window = globalThis;
fs.mkdirSync('/tmp/pdfqa', { recursive: true });

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const jspdfMod = await server.ssrLoadModule('jspdf');
const Ctor = jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default;
try { Object.defineProperty(jspdfMod, 'default', { value: Ctor, writable: true, configurable: true }); } catch {}

const eng = await server.ssrLoadModule('/src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;

function save(doc, name) {
  fs.writeFileSync(`/tmp/pdfqa/${name}`, Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', name);
}

const baseClient = {
  clientCompanyName: 'Acme Bangladesh Ltd.',
  clientCompanyAddress: 'House 12, Road 7, Gulshan-1, Dhaka 1212',
  clientCompanyBin: '987654321-0202',
  clientContactName: 'Nadia Rahman',
};
const baseItems = [
  { description: 'Strategy retainer (April 2026)', quantity: 1, unit_price: 250000, amount: 250000 },
  { description: 'Creative production sprint', quantity: 2, unit_price: 75000, amount: 150000 },
];
const baseTotals = { subtotal: 400000, taxes: [{ name: 'VAT', rate_bps: 1500, amount: 60000 }], grandTotal: 460000 };

save(generateDocumentPdf({
  workspaceName: 'darviz-internal',
  issuerRegisteredName: 'DARVIZ Labs Limited',
  issuerTradeName: 'DARVIZ',
  workspaceAddress: 'House 12, Road 4, Banani, Dhaka 1213, Bangladesh',
  workspacePhone: '+880 1700 123456',
  workspaceEmail: 'billing@darviz.io',
  workspaceBin: '000123456-0101',
  bank: { account_name: 'DARVIZ Labs Limited', account_number: '1234567890123', bank_name: 'BRAC Bank', branch: 'Gulshan', instructions: 'Wire reference: invoice number. Email confirmation to billing@darviz.io.' },
  currency: 'BDT', documentType: 'Invoice', documentTitle: 'INV-000042', documentRef: 'INV-000042',
  status: 'sent', date: '18 Apr 2026', validUntil: '02 May 2026', dueDateLabel: 'DUE DATE',
  ...baseClient, lineItems: baseItems, ...baseTotals,
  amountPaid: 200000, amountDue: 260000, notes: 'Thank you for your business.', termsLabel: 'Notes',
  mushak: { challan_no: 'CH-2026-042', vat_reg_no: '000123456-0101', hs_code: '9983.11' },
}), 'identity-full.pdf');

save(generateDocumentPdf({
  workspaceName: 'darviz-internal', issuerRegisteredName: 'DARVIZ Labs Limited',
  currency: 'BDT', documentType: 'Invoice', documentTitle: 'INV-000043', documentRef: 'INV-000043',
  status: 'sent', date: '18 Apr 2026', ...baseClient, lineItems: baseItems, ...baseTotals, termsLabel: 'Notes',
}), 'identity-registered-only.pdf');

save(generateDocumentPdf({
  workspaceName: 'darviz-internal', issuerRegisteredName: 'DARVIZ Labs Limited', issuerTradeName: 'DARVIZ',
  currency: 'BDT', documentType: 'Proposal', documentLabel: 'QUOTATION',
  documentTitle: 'Brand Refresh Engagement', documentRef: 'v3', status: 'sent',
  date: '18 Apr 2026', validUntil: '02 May 2026', dueDateLabel: 'VALID UNTIL',
  ...baseClient, lineItems: baseItems, ...baseTotals, termsLabel: 'Notes & Terms',
}), 'identity-registered-trade.pdf');

save(generateDocumentPdf({
  workspaceName: 'darviz-internal', currency: 'BDT', documentType: 'Invoice',
  documentTitle: 'INV-000044', documentRef: 'INV-000044', status: 'draft', date: '18 Apr 2026',
  ...baseClient, lineItems: baseItems, ...baseTotals, termsLabel: 'Notes',
}), 'identity-blank.pdf');

save(generateDocumentPdf({
  workspaceName: 'darviz-internal', issuerRegisteredName: 'DARVIZ Labs Limited',
  bank: { account_name: 'DARVIZ Labs Limited' },
  currency: 'BDT', documentType: 'Invoice', documentTitle: 'INV-000045', documentRef: 'INV-000045',
  status: 'sent', date: '18 Apr 2026', ...baseClient, lineItems: baseItems, ...baseTotals, termsLabel: 'Notes',
}), 'identity-bank-single.pdf');

save(generateDocumentPdf({
  workspaceName: 'darviz-internal', issuerRegisteredName: 'DARVIZ Labs Limited',
  bank: { account_name: 'DARVIZ Labs Limited', account_number: '1234567890123', bank_name: 'BRAC Bank' },
  currency: 'BDT', documentType: 'Proposal', documentLabel: 'QUOTATION',
  documentTitle: 'Should NOT show bank block', documentRef: 'v1', status: 'sent', date: '18 Apr 2026',
  ...baseClient, lineItems: baseItems, ...baseTotals, termsLabel: 'Notes',
}), 'identity-proposal-bank-suppressed.pdf');

await server.close();
console.log('OK');
