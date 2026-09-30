// Start-with-Windows (autostart.js). Run: node tests/autostart.test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { makeAutostart } = require(path.join(__dirname, '..', 'autostart.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// Real temp home so the state file behaves; fake filesystem view for the Startup .lnk.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-autostart-'));
const files = new Map(); // full path -> target text
const WIN = { isWin: true, home: tmp,
  run: (file, args) => { calls.push([file, args.join(' ')]); files.set(lnk(), 'jarvis-silent.vbs'); },
  exists: p => files.has(p) || fs.existsSync(p),
  readlink: p => files.get(p) || '',
  unlink: p => { files.delete(p); try { fs.rmSync(path.join(tmp, 'jarvis', '.autostart.json'), { force: true }); } catch {} } };
const lnk = () => path.join(tmp, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'JARVIS.lnk');
let calls = [];

(async () => {
  // off by default
  calls = [];
  let A = makeAutostart(WIN);
  let st = await A.status();
  check('reports supported on Windows', st.supported === true && st.on === false, st);
  check('nothing ran yet', calls.length === 0);

  // enable
  const on = await A.set(true);
  check('enable ok', on.ok === true && on.on === true, on);
  check('enable runs powershell once', calls.length === 1 && /powershell/.test(calls[0][0]) && /jarvis-silent\.vbs/.test(calls[0][1]), calls);
  st = await A.status();
  check('status on after enable', st.on === true && !st.foreign, st);

  // enable again is idempotent (still fine, still ours)
  await A.set(true);
  check('re-enable still ok', (await A.status()).on === true && !(await A.status()).foreign);

  // foreign shortcut is reported but never touched
  files.set(lnk(), 'C:\\other\\thing.exe');
  st = await A.status();
  check('foreign shortcut → on + foreign', st.on === true && st.foreign === true && st.target === 'C:\\other\\thing.exe', st);
  const fr = await A.set(false);
  check('disable does not delete a foreign shortcut', files.get(lnk()) === 'C:\\other\\thing.exe' && fr.on === true && fr.foreign === true, fr);

  // disable (ours again)
  files.set(lnk(), 'jarvis-silent.vbs');
  const off = await A.set(false);
  check('disable ok', off.ok === true && off.on === false, off);
  check('shortcut removed', !files.has(lnk()));
  check('status off after disable', (await A.status()).on === false);

  // removed outside JARVIS → honest "off" with a note
  await A.set(true);
  files.delete(lnk());
  st = await A.status();
  check('removed externally → off with note', st.on === false && /removed outside/i.test(st.note || ''), st);
  const re = await A.set(false);
  check('disable after external removal is ok', re.ok === true && re.on === false, re);

  // non-Windows
  A = makeAutostart({ ...WIN, isWin: false });
  check('non-Windows: unsupported, set refused', (await A.status()).supported === false && (await A.set(true)).ok === false);

  // missing launcher script → refused
  A = makeAutostart({ ...WIN, scriptName: 'nope-does-not-exist.vbs' });
  const r = await A.set(true);
  check('missing launcher → refused with message', r.ok === false && /not found/.test(r.error), r);
  console.log(total + '/' + total + ' autostart checks passed');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  suite crashed — ' + e.message); process.exitCode = 1; });

process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
