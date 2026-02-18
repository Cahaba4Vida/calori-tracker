const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

const conflictTargets = [
  'app.js',
  'index.html',
  'styles.css',
  'netlify/functions/demo-openai.js',
  'netlify/functions/voice-food-add.js'
];

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

for (const file of conflictTargets) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  assert(!text.includes('<<<<<<< '), `${file} should not contain unresolved merge marker <<<<<<<`);
  assert(!text.includes('\n=======\n'), `${file} should not contain unresolved merge marker =======`);
  assert(!text.includes('>>>>>>> '), `${file} should not contain unresolved merge marker >>>>>>>`);
}

assert(!app.includes('function showEstimateModal('), 'legacy estimate modal renderer should be removed');
assert(!app.includes('function hideEstimateModal('), 'legacy estimate modal hide function should be removed');
assert(!app.includes('api("/api/entries-add"'), 'api helper should not receive /api-prefixed path');
assert(app.includes("await api('entries-add'"), 'entries-add should use api helper canonical path');

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('Smoke checks passed.');
