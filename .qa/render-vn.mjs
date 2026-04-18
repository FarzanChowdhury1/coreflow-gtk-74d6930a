import { createServer } from 'vite';
import fs from 'node:fs';
globalThis.window = globalThis;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

// Pre-warm the jspdf module via Vite's loader and overwrite its default with the real constructor.
const jspdfMod = await server.ssrLoadModule('jspdf');
const Ctor = jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default;
// Sanity
console.log('jsPDF ctor probe:', typeof Ctor, Ctor && Ctor.name);
// Vite SSR module records are sealed-ish; fix by reassigning .default if writable.
try {
  Object.defineProperty(jspdfMod, 'default', { value: Ctor, writable: true, configurable: true });
} catch (e) { console.log('defineProperty failed', e.message); }
console.log('jspdfMod.default after patch:', typeof jspdfMod.default);

const eng = await server.ssrLoadModule('/src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;

function save(doc, name) {
  fs.writeFileSync(`/tmp/pdfqa/${name}`, Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', name);
}

const fixtures = JSON.parse(fs.readFileSync('.qa/fixtures.json', 'utf8'));
for (const [name, data] of Object.entries(fixtures)) {
  try { save(generateDocumentPdf(data), name); } catch (e) { console.log('FAIL', name, e.message); }
}
await server.close();
