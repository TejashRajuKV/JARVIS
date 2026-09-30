// Runs every tests/*.test.js file and prints one summary line each. Run: npm test  (or: node tests/run-all.js)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
// live.test.js acts on the real laptop, so it only runs on request (npm run test:live).
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f !== 'live.test.js').sort();
let failed = 0;
const skipped = [];
for (const f of files) {
  // The browser end-to-end suite drives every feature through the real page, so it gets longer.
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: f === 'e2e.test.js' ? 600000 : 120000 });
  const lines = String(r.stdout || '').split(/\r?\n/).filter(l => l.trim() && !/^\[/.test(l));
  const ok = r.status === 0;
  // A suite that exits cleanly because it could not run here ("e2e: skipped — no Edge or Chrome found") ran no
  // checks, so it is shown as skipped, never as a ✓.
  const skip = ok && lines.find(l => /^[\w-]+: skipped\b/.test(l));
  if (!ok) failed++;
  if (skip) skipped.push(f + ' (' + skip.replace(/^[\w-]+: skipped\W*/, '') + ')');
  console.log((!ok ? '✗ ' : skip ? '– ' : '✓ ') + f.padEnd(22) + (skip || lines.filter(l => /\d+\/\d+/.test(l)).join(' · ') || lines.slice(-1)[0] || ''));
  if (!ok) lines.filter(l => /^FAIL/.test(l)).slice(0, 10).forEach(l => console.log('    ' + l));
}
const ran = files.length - skipped.length;
console.log(failed ? `\n${failed} suite(s) failed` : skipped.length ? `\n${ran} suites passed · ${skipped.length} NOT RUN: ${skipped.join('; ')}` : `\nAll ${files.length} suites passed`);
// JARVIS_REQUIRE_ALL=1 (e.g. before a release): a suite that couldn't run counts as a failure.
if (!failed && skipped.length && process.env.JARVIS_REQUIRE_ALL === '1') { console.log('JARVIS_REQUIRE_ALL=1: skipped suites count as failures'); failed = skipped.length; }
process.exitCode = failed ? 1 : 0;
