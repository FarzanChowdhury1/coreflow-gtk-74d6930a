import { createServer } from 'vite';
import fs from 'node:fs';
globalThis.window = globalThis;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const eng = await server.ssrLoadModule('/src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;

function save(doc, name) {
  fs.writeFileSync(`/tmp/pdfqa/${name}`, Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', name);
}

const fixtures = JSON.parse(fs.readFileSync('.qa/fixtures.json', 'utf8'));
for (const [name, data] of Object.entries(fixtures)) save(generateDocumentPdf(data), name);

await server.close();
