const fs = require('node:fs');
globalThis.window = globalThis;
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

// Re-implement caller path: use jsPDF directly via the exported engine.
// The engine uses `import jsPDF from "jspdf"`; tsx ESM hands it the namespace.
// Workaround: set the namespace's default to the constructor.
const ns = require('jspdf');
ns.default = jsPDF;
