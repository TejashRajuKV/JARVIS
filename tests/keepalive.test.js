// Keep JARVIS running (keepalive.js + keepalive.ps1): the on/off switch with a fake Task Scheduler, and the real PowerShell script's decisions
// (-DryRun) against a temp home and a tiny fake JARVIS. Nothing is scheduled and no JARVIS is started. Run: node tests/keepalive.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { execFile } = require('child_process');
const K = require(path.join(__dirname, '..', 'keepalive.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const root = path.join(__dirname, '..');

(async () => {
  /* ---------- the switch ---------- */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-')); const dir = path.join(home, 'jarvis'); fs.mkdirSync(dir, { recursive: true });
  const calls = []; let tasks = new Set(), createCode = 0;
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === '/query') return { code: tasks.has(args[2]) ? 0 : 1, out: '', err: tasks.has(args[2]) ? '' : 'ERROR: The system cannot find the file specified.' };
    if (args[0] === '/create') { if (createCode) return { code: createCode, out: '', err: 'ERROR: Access is denied.' }; tasks.add(args[2]); return { code: 0, out: 'SUCCESS', err: '' }; }
    if (args[0] === '/delete') { const had = tasks.delete(args[2]); return { code: had ? 0 : 1, out: '', err: had ? '' : 'ERROR: The system cannot find the file specified.' }; }
    return { code: 1, out: '', err: 'x' };
  };
  const ka = K.makeKeepalive({ isWin: true, home, cwd: root, run, now: () => 1234 });
  check('status: off at first, with the 5-minute interval', (await ka.status()).on === false && (await ka.status()).minutes === 5 && (await ka.status()).supported === true);
  let r = await ka.set(true);
  const cr = calls.find(c => c[1] === '/create');
  check('on: one scheduled task for this user, every 5 minutes, started through the silent .vbs (no window), replacing an old one', r.ok && r.on && cr.includes('/sc') && cr[cr.indexOf('/sc') + 1] === 'minute' && cr[cr.indexOf('/mo') + 1] === '5' && cr.includes('/f') && cr[cr.indexOf('/tn') + 1] === 'JARVIS Keepalive' && /^wscript\.exe \/\/B ".*keepalive\.vbs"$/.test(cr[cr.indexOf('/tr') + 1]) && !cr.includes('/ru') && !cr.includes('/rl'), cr);
  check('on: it asks for no administrator rights and the switch file is written', fs.existsSync(path.join(dir, '.keepalive.json')) && (await ka.status()).on === true);
  check('on: nothing from outside ever reaches the command: every argument of every call is fixed text', calls.every(c => c.slice(1).every(a => !/[;&|`$]/.test(a.replace(/^wscript\.exe .*$/, '')))));
  r = await ka.set(false);
  check('off: the task and the switch file are removed', r.ok && r.on === false && !tasks.size && !fs.existsSync(path.join(dir, '.keepalive.json')) && (await ka.status()).on === false);
  r = await ka.set(false); check('off when it was already off is fine (no such task is not an error)', r.ok === true);
  createCode = 1; r = await ka.set(true); check('on: if Windows refuses, the reason is passed on and nothing is half-switched-on', r.ok === false && /Access is denied/.test(r.error) && !fs.existsSync(path.join(dir, '.keepalive.json'))); createCode = 0;
  await ka.set(true); tasks.clear();
  let st = await ka.status(); check('status: a switch on but a task that is gone (removed in Task Scheduler) is said plainly', st.on === false && /task is missing/.test(st.note), st);
  tasks.add('JARVIS Keepalive'); fs.rmSync(path.join(dir, '.keepalive.json')); st = await ka.status(); check('status: a task with no JARVIS switch is reported, not silently adopted', st.on === false && /Turn it on again to adopt/.test(st.note), st);
  fs.writeFileSync(path.join(dir, '.restarted.json'), JSON.stringify({ at: '2026-10-10T14:32:00', acked: false }));
  st = await ka.status(); check('status: an automatic restart is reported with its time, until acknowledged', st.restarted && st.restarted.at === Date.parse('2026-10-10T14:32:00'), st);
  ka.ack(); st = await ka.status(); check('ack: after it, the note is gone', st.restarted === null && !fs.existsSync(path.join(dir, '.restarted.json')));
  check('not Windows: unsupported, and it will not pretend', (await K.makeKeepalive({ isWin: false, home, cwd: root, run }).status()).supported === false && (await K.makeKeepalive({ isWin: false, home, cwd: root, run }).set(true)).ok === false);
  check('a missing keepalive.vbs is reported', (await K.makeKeepalive({ isWin: true, home, cwd: path.join(home, 'nowhere'), run }).set(true)).ok === false);

  /* ---------- the PowerShell script's decisions ---------- */
  const ps1 = path.join(root, 'keepalive.ps1');
  const decide = (profile, extraEnv = {}) => new Promise(res => execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-DryRun'], { windowsHide: true, timeout: 30000, env: { ...process.env, USERPROFILE: profile, ...extraEnv } }, (e, out) => res(String(out).trim())));
  const fake = await new Promise(resolve => { const s = http.createServer((q, p) => { p.setHeader('Content-Type', 'application/json'); p.end(JSON.stringify({ status: q.url === '/api/health' ? 'online' : 'x' })); }); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const fport = fake.address().port;
  const prof = n => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-')); fs.mkdirSync(path.join(p, 'jarvis'), { recursive: true }); return p; };
  const NOPORTS = { JARVIS_KEEPALIVE_PORTS: '9' };                                         // nothing answers there
  let p = prof();
  check('script: when the keep-alive switch is off it does nothing', await decide(p, NOPORTS) === 'off');
  fs.writeFileSync(path.join(p, 'jarvis', '.keepalive.json'), '{"on":true}');
  fs.writeFileSync(path.join(p, 'jarvis', '.stopped-by-user'), 'x');
  check('script: JARVIS stopped on purpose is never restarted', await decide(p, NOPORTS) === 'stopped-by-user');
  fs.rmSync(path.join(p, 'jarvis', '.stopped-by-user'));
  check('script: not running and not stopped on purpose → restart', await decide(p, NOPORTS) === 'restart');
  fs.writeFileSync(path.join(p, 'jarvis', '.jarvis.lock'), JSON.stringify({ pid: 1, port: fport }));
  check('script: a JARVIS that answers on the port in its lock file is alive (nothing is done)', await decide(p, NOPORTS) === 'alive');
  fs.rmSync(path.join(p, 'jarvis', '.jarvis.lock'));
  check('script: with no lock file it also looks at the usual ports', await decide(p, { JARVIS_KEEPALIVE_PORTS: String(fport) }) === 'alive');
  fs.writeFileSync(path.join(p, 'jarvis', '.restarted.json'), JSON.stringify({ at: new Date().toISOString().slice(0, 19), acked: false }));
  const sta = await decide(p, NOPORTS); check('script: a restart begun in the last 3 minutes is given time (no pile-up of launches)', sta === 'starting' || sta === 'restart', sta);
  fs.writeFileSync(path.join(p, 'jarvis', '.restarted.json'), JSON.stringify({ at: '2020-01-01T00:00:00', acked: false }));
  check('script: an old restart note does not hold a new restart back', await decide(p, NOPORTS) === 'restart');
  fake.close();
  check('script: the files that make it a "silent" task are there, and start.ps1 has a way to start without opening the browser', fs.existsSync(path.join(root, 'keepalive.vbs')) && /NoBrowser/.test(fs.readFileSync(path.join(root, 'start.ps1'), 'utf8')) && /stopped-by-user/.test(fs.readFileSync(path.join(root, 'stop.ps1'), 'utf8')) && /stopped-by-user/.test(fs.readFileSync(path.join(root, 'server.js'), 'utf8')));
  for (const d of [home, p]) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}

  clearInterval(keep);
  console.log(`keepalive: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
