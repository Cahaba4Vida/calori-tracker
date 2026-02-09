const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

assert(!app.includes('function showEstimateModal('), 'legacy estimate modal renderer should be removed');
assert(!app.includes('function hideEstimateModal('), 'legacy estimate modal hide function should be removed');
assert(!app.includes('api("/api/entries-add"'), 'api helper should not receive /api-prefixed path');
assert(app.includes("await api('entries-add'"), 'entries-add should use api helper canonical path');

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('Smoke checks passed.');
