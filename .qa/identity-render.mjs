import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try { globalThis.navigator = dom.window.navigator; } catch {}
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Image = dom.window.Image;
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
fs.mkdirSync('/tmp/pdfqa', { recursive: true });

// Use the browser ESM build directly to avoid the node CJS shim.
const jspdfMod = await import('jspdf/dist/jspdf.es.min.js');
const jsPDF = jspdfMod.jsPDF || jspdfMod.default;
globalThis.jsPDF = jsPDF;

await import('jspdf-autotable');

// Now load the engine; patch its jspdf import via a tiny shim file.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Read the engine source and eval it inline with our jsPDF + autoTable.
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
const tsSrc = readFileSync('/dev-server/src/lib/pdf-export.ts', 'utf8');
const jsSrc = ts.transpileModule(tsSrc, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

// Replace bare imports with global hooks.
const patched = jsSrc
  .replace(/import\s+jsPDF\s+from\s+["']jspdf["'];?/g, 'const jsPDF = globalThis.jsPDF;')
  .replace(/import\s+autoTable\s+from\s+["']jspdf-autotable["'];?/g, 'const autoTable = globalThis.__autoTable;');

// Pull autoTable as a global
const at = await import('jspdf-autotable');
globalThis.__autoTable = at.default || at.autoTable || at;

const mod = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));
const { generateDocumentPdf } = mod;

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
  issuerRegisteredName: 'DARVIZ Labs Limited', issuerTradeName: 'DARVIZ',
  workspaceAddress: 'House 12, Road 4, Banani, Dhaka 1213, Bangladesh',
  workspacePhone: '+880 1700 123456', workspaceEmail: 'billing@darviz.io', workspaceBin: '000123456-0101',
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

console.log('OK');
