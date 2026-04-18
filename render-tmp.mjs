import fs from 'node:fs';
import { build } from 'esbuild';
await build({
  entryPoints: ['src/lib/pdf-export.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: '/tmp/pdf-engine.cjs',
  external: [],
  logLevel: 'silent',
});
const { generateDocumentPdf } = await import('/tmp/pdf-engine.cjs');
function save(doc, name) {
  const buf = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(`/tmp/pdfqa/${name}`, buf);
  console.log('wrote', name, buf.length);
}
const fixtures = JSON.parse(fs.readFileSync('.qa/fixtures.json','utf8'));
for (const [name, data] of Object.entries(fixtures)) {
  save(generateDocumentPdf(data), name + '.pdf');
}
