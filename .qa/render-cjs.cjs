// Compile pdf-export.ts to JS in-memory with a tiny patch: replace the default
// jsPDF import with a named one so Node CJS resolves it correctly.
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
  // Resolve relative requires from project root
  const req = (id) => require(id);
  new Function('module','exports','require','__dirname','__filename', out)(m, m.exports, req, __dirname, rel);
  return m.exports;
}

const eng = loadTs('src/lib/pdf-export.ts');
const { generateDocumentPdf } = eng;
console.log('engine fn:', typeof generateDocumentPdf);

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json'), 'utf8'));
fs.mkdirSync('/tmp/pdfqa', { recursive: true });
for (const [name, data] of Object.entries(fixtures)) {
  try {
    const doc = generateDocumentPdf(data);
    fs.writeFileSync(`/tmp/pdfqa/${name}`, Buffer.from(doc.output('arraybuffer')));
    console.log('wrote', name);
  } catch (e) { console.log('FAIL', name, e.message); }
}
