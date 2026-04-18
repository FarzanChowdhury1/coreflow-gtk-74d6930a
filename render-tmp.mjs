import fs from 'node:fs';
import { build } from 'esbuild';
await build({
  entryPoints: ['src/lib/pdf-export.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: '/tmp/pdf-engine.cjs',
  mainFields: ['main'],
  conditions: ['node','require','default'],
  logLevel: 'silent',
});
let src = fs.readFileSync('/tmp/pdf-engine.cjs','utf8');
src = src.replace(/import_jspdf\.default/g, 'import_jspdf.jsPDF');
src = src.replace(/import_jspdf_autotable\.default/g, 'import_jspdf_autotable.autoTable');
fs.writeFileSync('/tmp/pdf-engine.cjs', src);
const mod = await import('/tmp/pdf-engine.cjs?t=' + Date.now());
const { generateDocumentPdf } = mod;
function save(doc, name) {
  const buf = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(`/tmp/pdfqa/${name}`, buf);
  console.log('wrote', name, buf.length);
}
const fixtures = JSON.parse(fs.readFileSync('.qa/fixtures.json','utf8'));
for (const [name, data] of Object.entries(fixtures)) {
  save(generateDocumentPdf(data), name + '.pdf');
}
