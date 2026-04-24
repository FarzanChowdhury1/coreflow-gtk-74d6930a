globalThis.window = globalThis;
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTs(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace('import jsPDF from "jspdf";', 'const { jsPDF } = require("jspdf");')
    .replace('import autoTable from "jspdf-autotable";', 'const autoTable = require("jspdf-autotable").default;');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  new Function('module','exports','require','__dirname','__filename', out)(m, m.exports, require, __dirname, rel);
  return m.exports;
}
const { generateDocumentPdf } = loadTs('src/lib/pdf-export.ts');
fs.mkdirSync('/tmp/pdfqa', { recursive: true });
const doc = generateDocumentPdf({
  workspaceName: 'CoreFlow HQ', issuerRegisteredName: 'CoreFlow HQ',
  workspaceAddress: 'Dhaka, Bangladesh', workspaceEmail: 'hello@coreflow.test',
  workspacePhone: '+880 1700 000000', workspaceBin: '000123456-0101',
  currency: 'BDT', documentType: 'Invoice', documentLabel: 'TAX INVOICE',
  documentTitle: 'INV-000001', documentRef: 'INV-000001', status: 'issued',
  date: '23 Apr 2026', dueDateLabel: 'DUE DATE',
  clientCompanyName: 'Meridian Creative Agency',
  clientCompanyBin: '987654321-0202', clientCompanyAddress: 'Gulshan-2, Dhaka',
  lineItems: [{ description: 'Mushak truth-pass test service', quantity: 1, unit_price: 10000, amount: 10000 }],
  subtotal: 10000, taxes: [], grandTotal: 10000,
  notes: 'Top-level invoice notes — should appear in NOTES block.',
  termsLabel: 'Notes',
  mushak: { challan_no: 'CH-2025-001', vat_reg_no: '1234567890123', hs_code: '8523',
    buyer_address: '123 Buyer Road, Banani, Dhaka 1213',
    notes: 'Mushak inline note — should appear inside Mushak block.' },
});
fs.writeFileSync('/tmp/pdfqa/mushak-invoice.pdf', Buffer.from(doc.output('arraybuffer')));
console.log('wrote mushak-invoice.pdf');
