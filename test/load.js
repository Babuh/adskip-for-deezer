// The extension files are plain scripts that attach themselves to a global
// AdSkip object, the way the browser loads them. This runs them the same way.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXTENSION = path.join(__dirname, '..', 'extension');

function source(file) {
  return fs.readFileSync(path.join(EXTENSION, file), 'utf8');
}

function load(...files) {
  for (const file of files) vm.runInThisContext(source(file), { filename: file });
  return globalThis.AdSkip;
}

module.exports = { load, source };
