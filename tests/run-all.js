// Runs every tests/*.test.js file and prints one summary line each. Run: npm test  (or: node tests/run-all.js)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
// live.test.js acts on the real laptop, so it only runs on request (npm run test:live).
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f !== 'live.test.js').sort();
let failed = 0;
const skipped = [];
for (const f of files) {
  // The browser end-to-end suite drives every feature through the real page, so it gets longer.
  const timeoutMs = f === 'e2e.test.js' ? 600000 : f === 'api.test.js' ? 300000 : 120000;
  const startedAt = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: timeoutMs });
  const elapsedMs = Date.now() - startedAt;
  const lines = String(r.stdout || '').split(/\r?\n/).filter(l => l.trim() && !/^\[/.test(l));
  const ok = r.status === 0;
  // A suite that exits cleanly because it could not run here ("e2e: skipped — no Edge or Chrome found") ran no
  // checks, so it is shown as skipped, never as a ✓.
  const skip = ok && lines.find(l => /^[\w-]+: skipped\b/.test(l));
  if (!ok) failed++;
  if (skip) skipped.push(f + ' (' + skip.replace(/^[\w-]+: skipped\W*/, '') + ')');
  console.log((!ok ? '✗ ' : skip ? '– ' : '✓ ') + f.padEnd(22) + (skip || lines.filter(l => /\d+\/\d+/.test(l)).join(' · ') || lines.slice(-1)[0] || ''));
  if (!ok) {
    if (r.error) console.log('    runner error: ' + r.error.message);
    if (r.error && (r.error.code === 'ETIMEDOUT' || /timed out/i.test(r.error.message))) {
      console.log('    timed out after ' + Math.round(elapsedMs / 1000) + 's (limit ' + Math.round(timeoutMs / 1000) + 's)');
    } else if (r.signal) {
      console.log('    child process ended by signal: ' + r.signal);
    } else if (r.status !== null) {
      console.log('    exit code: ' + r.status);
    }
    const diagnostics = [...lines.filter(l => /^(FAIL|Error:|AssertionError|TypeError:|ReferenceError:|\s+at )/.test(l)),
      ...String(r.stderr || '').split(/\r?\n/).filter(l => l.trim())];
    [...new Set(diagnostics)].slice(0, 12).forEach(l => console.log('    ' + l));
  }
}
const ran = files.length - skipped.length;
console.log(failed ? `\n${failed} suite(s) failed` : skipped.length ? `\n${ran} suites passed · ${skipped.length} NOT RUN: ${skipped.join('; ')}` : `\nAll ${files.length} suites passed`);
// JARVIS_REQUIRE_ALL=1 (e.g. before a release): a suite that couldn't run counts as a failure.
if (!failed && skipped.length && process.env.JARVIS_REQUIRE_ALL === '1') { console.log('JARVIS_REQUIRE_ALL=1: skipped suites count as failures'); failed = skipped.length; }
process.exitCode = failed ? 1 : 0;
