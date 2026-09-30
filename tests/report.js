// Feature report: runs every suite and writes tests/report.md — one row per feature (does JARVIS understand it,
// does it work in the real page), then the deep end-to-end checks, the server API checks, the opt-in live checks
// and a checklist for what only a person can verify. Run: npm run test:report   (add --live for the laptop checks)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const live = process.argv.includes('--live');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-report-'));
const env = Object.assign({}, process.env, { JARVIS_REPORT_DIR: dir });
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (live || f !== 'live.test.js')).sort();
// coverage.test.js writes the feature list the page sweep uses, so it runs first.
files.sort((a, b) => (b === 'coverage.test.js') - (a === 'coverage.test.js'));
const suites = [];
for (const f of files) {
  process.stdout.write('running ' + f.padEnd(22));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', env, timeout: f === 'e2e.test.js' ? 600000 : 180000 });
  const lines = String(r.stdout || '').split(/\r?\n/).filter(l => l.trim());
  const summary = lines.filter(l => /\d+\/\d+/.test(l) && !/^FAIL/.test(l)).join(' · ') || lines.slice(-1)[0] || '';
  suites.push({ f, ok: r.status === 0, summary, fails: lines.filter(l => /^FAIL/.test(l)), s: Math.round((Date.now() - t0) / 1000) });
  console.log((r.status === 0 ? '✓ ' : '✗ ') + summary + ' (' + suites[suites.length - 1].s + 's)');
}
const load = n => { try { return JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8')); } catch { return null; } };
const cov = load('coverage') || [], api = load('api') || [], e2e = load('e2e'), liv = load('live');
const features = JSON.parse(fs.readFileSync(path.join(__dirname, '.features.json'), 'utf8'));
const mark = ok => ok === undefined ? '–' : ok ? '✓' : '✗';
const esc = s => String(s).replace(/\|/g, '\\|');

const out = [];
const allOk = suites.every(s => s.ok);
out.push('# JARVIS feature report', '', '_Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' by `npm run test:report`' + (live ? ' --live' : '') + '._', '');
out.push(allOk ? '**Every suite passed.**' : '**Some checks failed — see ✗ below.**', '');
out.push('## Suites', '', '| Suite | Result | Time |', '|---|---|---|');
for (const s of suites) out.push('| `' + s.f + '` | ' + (s.ok ? '✓ ' : '✗ ') + esc(s.summary) + ' | ' + s.s + 's |');
out.push('');

// ---- one row per feature
out.push('## Features', '', 'Understood = every test phrase reaches the right command. In the page = the example phrase, run through the real chat in a headless browser (laptop actions faked), answered without errors.', '');
const byArea = {};
for (const f of features) (byArea[f.area] = byArea[f.area] || []).push(f);
let nF = 0, nOk = 0;
for (const [area, list] of Object.entries(byArea)) {
  out.push('### ' + area, '', '| Command | Example | Understood | In the page |', '|---|---|---|---|');
  for (const f of list) {
    const c = cov.filter(x => x.feature === area + ' · ' + f.intent);
    const understood = c.length ? c.every(x => x.ok) : undefined;
    const sw = e2e && e2e.find(x => x.feature === 'Sweep · ' + area && x.desc.startsWith(f.intent + ' '));
    const inPage = sw ? sw.ok : undefined;
    nF++; if (understood && inPage !== false) nOk++;
    out.push('| ' + f.intent + ' | “' + esc(f.example) + '” | ' + mark(understood) + ' | ' + mark(inPage) + ' |');
  }
  out.push('');
}
out.splice(out.indexOf('## Features') + 4, 0, '**' + nOk + ' of ' + nF + ' commands pass.**', '');

// ---- deep checks
const group = (title, rows, intro) => {
  if (!rows || !rows.length) return;
  out.push('## ' + title, '', intro, '');
  const g = {};
  for (const r of rows) (g[r.feature] = g[r.feature] || []).push(r);
  for (const [k, list] of Object.entries(g)) out.push('- **' + k + '** — ' + list.map(r => mark(r.ok) + ' ' + r.desc).join(' · '));
  out.push('');
};
group('End-to-end checks', e2e && e2e.filter(x => !/^Sweep/.test(x.feature)),
  'Real flows in the page, checking the resulting state (to-do saved, reminder at the right time, app closed on the fake laptop, plan verified…).');
group('Server API checks', api, 'Every route of a real server.js, isolated in a temp home (your ~/jarvis is never touched), AI offline.');
if (live) group('Live laptop checks', liv, 'Run on your real laptop; every change was restored.');
else out.push('## Live laptop checks', '', 'Not run. `npm run test:report -- --live` also sets volume/brightness and opens/closes Notepad on this laptop, restoring everything.', '');

// ---- what needs a person
out.push('## Check by hand', '', 'These need your hardware, voice or phone — no automated test can prove them:', '',
  '- [ ] **Microphone:** click 🎙, say “what time is it” — it answers.',
  '- [ ] **Wake word:** turn on WAKE WORD, say “Jarvis, open notepad”.',
  '- [ ] **Spoken replies:** Settings → Speak replies on; a reply is read aloud (try the FRIDAY voice too).',
  '- [ ] **Telugu / Kannada:** switch to తె or ಕ and speak a command.',
  '- [ ] **Windows Hello:** Settings → turn on Windows Hello; “shut down” asks for fingerprint/face/PIN (then cancel).',
  '- [ ] **Phone:** Settings → Phone; a test notification arrives on ntfy, and an authenticator code unlocks a command.',
  '- [ ] **Global hotkey:** select text in another app, press Ctrl+Shift+J — the JARVIS bar opens with it.',
  '- [ ] **Screen reading:** open an error message, say “read my screen”.',
  '- [ ] **AI answers:** with Ollama running, ask “explain deadlock” and “what does <your pdf> say about …”.', '');

// ---- honest notes
out.push('## Known limitations found while testing', '',
  '- **Undo** reverses removals and changes (deleted/cleared to-dos, moved/renamed files, volume, brightness, dark mode), not additions — “undo” right after adding a to-do says there is nothing to undo.',
  '- **Git with no project folder:** the git commands fall back to the JARVIS program folder itself. Add a project folder (Settings) before using git commands.',
  '- **“Open the best page” / YouTube** search the web even when Online tools is off (they open the browser anyway).',
  '- The **power, lock, display, clipboard, keyboard and window** routes are never called by the automated tests — they are exercised with fakes in the page; the Windows Hello guard only protects them once Hello is enrolled.', '');

fs.writeFileSync(path.join(__dirname, 'report.md'), out.join('\n'));
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log('\nwrote tests/report.md — ' + nOk + '/' + nF + ' commands pass' + (allOk ? ', all suites green' : ', some suites failed'));
process.exitCode = allOk ? 0 : 1;
