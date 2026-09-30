// Runs every tests/*.test.js file and prints one summary line each. Run: npm test  (or: node tests/run-all.js)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
// live.test.js acts on the real laptop, so it only runs on request (npm run test:live).
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f !== 'live.test.js').sort();
let failed = 0;
for (const f of files) {
  // The browser end-to-end suite drives every feature through the real page, so it gets longer.
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: f === 'e2e.test.js' ? 600000 : 120000 });
  const lines = String(r.stdout || '').split(/\r?\n/).filter(l => l.trim() && !/^\[/.test(l));
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? '✓ ' : '✗ ') + f.padEnd(22) + (lines.filter(l => /\d+\/\d+/.test(l)).join(' · ') || lines.slice(-1)[0] || ''));
  if (!ok) lines.filter(l => /^FAIL/.test(l)).slice(0, 10).forEach(l => console.log('    ' + l));
}
console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${files.length} suites passed`);
process.exitCode = failed ? 1 : 0;
