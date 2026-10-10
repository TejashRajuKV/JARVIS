// Server API tests: every /api route of a REAL server.js, started isolated (temp home, no AI — tests/lib/server.js).
// Nothing here touches your own ~/jarvis, and nothing acts on the laptop: routes that would (volume, apps, power,
// clipboard, keyboard…) are only called with input the route rejects before acting, or are listed in NOT_TESTABLE
// with the reason — they are covered by the page self-test with fakes, and by `npm run test:live`.
// A gate at the end fails if any route exists that is neither tested nor listed. Run: node tests/api.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { startServer, suite, freePort, ROOT } = require('./lib/server');
const { check, done } = suite('api');

// Routes never called by this suite, and why. Each is exercised with a faked callTool in tests/e2e/selftest.js.
const NOT_TESTABLE = {
  'POST /api/quit': 'stops the JARVIS server itself (would kill the test server mid-run)',
  'POST /api/wake/front': 'moves the JARVIS window in front of your apps',
  'POST /api/tool/shutdownSystem': 'turns the laptop off (the Windows Hello guard is a no-op until Hello is enrolled)',
  'POST /api/tool/restartSystem': 'restarts the laptop', 'POST /api/tool/sleepSystem': 'puts the laptop to sleep',
  'POST /api/tool/cancelShutdown': 'power command', 'POST /api/tool/lockSystem': 'locks the screen',
  'POST /api/tool/showDesktop': 'minimises your windows', 'POST /api/tool/mediaKey': 'presses media keys',
  'POST /api/tool/pasteKeys': 'types into the focused app', 'POST /api/tool/writeClipboard': 'overwrites your clipboard',
  'POST /api/tool/readClipboard': 'reads your clipboard', 'POST /api/sys/clipHistory': 'reads your clipboard history',
  'POST /api/tool/screenshot': 'captures your screen', 'POST /api/sys/screenRead': 'OCRs your screen', 'POST /api/sys/pickFolder': 'opens the Windows folder picker on your screen',
  'POST /api/sys/browserTab': 'presses Ctrl+<n> / Ctrl+Tab in your browser',
  'POST /api/sys/displayOff': 'turns the display off', 'POST /api/sys/window': 'moves your windows',
  'POST /api/tool/openApplication': 'launches apps', 'POST /api/tool/openUrl': 'opens the browser',
  'POST /api/tool/openFile': 'opens a viewer window', 'POST /api/tool/openFolder': 'opens Explorer',
  'POST /api/tool/openKnownFolder': 'opens Explorer', 'POST /api/tool/openInEditor': 'opens VS Code',
  'POST /api/tool/codeAsk': 'drives your editor’s coding AI', 'POST /api/skill/siteOpen': 'opens the browser',
  'POST /api/tool/gitClone': 'downloads from the internet', 'POST /api/setup/pull': 'downloads an AI model (GBs)',
  'POST /api/notify/test': 'sends a phone notification', 'POST /api/phone/reply': 'sends a phone notification',
  'GET /api/update/check': 'contacts GitHub', 'POST /api/tts': 'network text-to-speech voice',
  'POST /api/llm/warm': 'loads the AI model', 'POST /api/hello/challenge': 'Windows Hello ceremony (hello.test.js)',
  'POST /api/hello/enroll': 'Windows Hello ceremony (hello.test.js)', 'POST /api/hello/verify': 'Windows Hello ceremony (hello.test.js)',
  'POST /api/hello/disable': 'Windows Hello ceremony (hello.test.js)',
  'GET /api/events': 'server-sent event stream (the page self-test listens to it)',
  'POST /api/tool/findFolderAnywhere': 'walks every drive (slow); covered by the page self-test',
  'POST /api/tool/clearSandbox': 'guarded bulk delete; deleteItem covers the same path',
  'POST /api/ocr/screen': 'captures your screen',
};

// Every route declared in the server files, as "METHOD /path" with :params, for the gate.
const ROUTE_FILES = ['server.js', 'system-tools.js', 'agent-tools.js', 'rag.js', 'skills.js', 'scheduler.js', 'backup.js', 'codetools.js',
  'hotkey.js', 'hello.js', 'applock.js', 'llm.js', 'update.js', 'tts.js', 'autostart.js', 'wakeword.js',
  'skillpack.js', 'aihealth.js', 'watchdog.js', 'nearby.js', 'csvtools.js', 'projectwiki.js', 'imagegen.js', 'pdftools.js', 'diskcare.js', 'ocr.js', 'scan.js', 'chatarchive.js', 'studyserver.js', 'keepalive.js', 'mirror.js', 'shotindex.js', 'devtools.js', 'whisper.js'];
const ROUTES = [];
for (const f of ROUTE_FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/app\.(get|post|put|delete)\(\s*(\[[^\]]*\]|'[^']*')/g)) {
    const paths = m[2].startsWith('[') ? [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]) : [m[2].slice(1, -1)];
    for (const p of paths) if (p.startsWith('/api/')) ROUTES.push(m[1].toUpperCase() + ' ' + p);
  }
}
// wttr.in's j1 shape, trimmed to what server.js reads. "/Bengaluru" → a normal city; "/" (no city) → an IP lookup that
// only found the country (whole-degree coordinates); anything else → 404, like a place wttr.in doesn't know.
function fakeWttr() {
  const hour = rain => ({ chanceofrain: String(rain), weatherDesc: [{ value: 'Light rain ' }] });
  const day = (min, max, rains) => ({ mintempC: String(min), maxtempC: String(max), hourly: rains.map(hour) });
  const body = (query, area) => ({
    current_condition: [{ temp_C: '28', FeelsLikeC: '31', weatherDesc: [{ value: 'Partly cloudy ' }], humidity: '70', windspeedKmph: '12' }],
    weather: [day(21, 29, [10, 40, 70, 20, 0]), day(20, 27, [5, 5, 5, 5, 5])],
    nearest_area: [{ areaName: [{ value: area }], region: [{ value: 'Karnataka' }], country: [{ value: 'India' }] }],
    request: [{ query }],
  });
  const srv = require('http').createServer((q, res) => {
    const city = decodeURIComponent(q.url.split('?')[0].slice(1));
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (/^bengaluru$/i.test(city)) return send(200, body('Bengaluru, India', 'Yesvantpur'));
    if (!city) return send(200, body('Lat 22.00 and Lon 79.00', 'Somewhere'));
    send(404, { error: 'Unknown location' });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() })));
}
const hit = new Set();
const routeOf = (method, p) => ROUTES.find(r => { const [m, rp] = r.split(' '); return m === method && new RegExp('^' + rp.replace(/:[^/]+/g, '[^/]+') + '$', 'i').test(p.split('?')[0]); });

(async () => {
  // A fake wttr.in (JARVIS_WTTR_URL), so the weather route's parsing is tested on a real response shape without the internet.
  const wttr = await fakeWttr();
  // the disk-care temp cleaner is pointed at a throwaway folder named Temp, never at the real %TEMP%
  const diskTemp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'api-disk-')), 'Temp'); fs.mkdirSync(diskTemp);
  const S = await startServer({ env: { JARVIS_TEMP_DIR: diskTemp, GIT_AUTHOR_NAME: 'JARVIS test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'JARVIS test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    JARVIS_WTTR_URL: wttr.url, JARVIS_WHISPER_DIR: path.join(diskTemp, '..', 'no-whisper-here'),
    npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' } });   // a fresh profile would make npm check the network for updates, which can take longer than the 4 s the dev-server checks allow
  const rec = (method, p) => { const r = routeOf(method, p); if (r) hit.add(r); };
  const post = (p, b, x) => { rec('POST', p); return S.post(p, b, x); };
  const get = (p, x) => { rec('GET', p); return S.get(p, x); };
  const del = (p, b) => { rec('DELETE', p); return S.api('DELETE', p, b); };
  const SB = S.sandbox;
  try {
    /* ---------- security ---------- */
    check('Security', 'a foreign Origin is refused', (await get('/api/health', { headers: { Origin: 'https://evil.example' } })).status === 403);
    // fetch() won't let a caller set Host, so use a raw request — this is what a DNS-rebinding page would send.
    const hostStatus = await new Promise(res => require('http').get({ host: '127.0.0.1', port: S.port, path: '/api/health', headers: { Host: 'evil.example:' + S.port } }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
    check('Security', 'a foreign Host header is refused (DNS rebinding)', hostStatus === 403, hostStatus);
    check('Security', 'state.js needs same-origin (another site can’t <script> it)', (await get('/api/state.js', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
    check('Security', 'the sandbox is the isolated temp home, not your ~/jarvis', (await get('/api/tool/sandboxInfo')).json.root === SB);
    check('Files', 'the laptop file index stays off in tests', (await get('/api/fileIndex/status')).json.ready === false);
    check('Files', 'counting folders before the index is built says so (no made-up number)', (await post('/api/tool/folderStats', { scope: 'my laptop' })).json.indexing === true);
    check('Files', '"did you mean" needs a name', (await post('/api/tool/similar', {})).status === 400);
    // routes added by the Qwen-assist / dashboard / face-greeting commits
    check('NLU assist', 'POST /api/nlu/parse needs text', (await post('/api/nlu/parse', {})).status === 400);
    check('NLU assist', 'with the AI offline it fails cleanly (the page keeps the rule engine answer)', (await post('/api/nlu/parse', { text: 'open chrome' })).status >= 400);
    { const d = await get('/api/sys/dashboard'); check('Dashboard', 'GET /api/sys/dashboard answers (or says the optional package is missing)', d.status === 200 && d.json.success === true, d.text.slice(0, 160)); }
    check('Face greeting', 'status: not enrolled in a fresh install', (await get('/api/facegreet/status')).json.enrolled === false);
    check('Face greeting', 'enrolling needs exactly 128 numbers', (await post('/api/facegreet/enroll', { descriptor: [1, 2, 3] })).status === 400 && (await post('/api/facegreet/enroll', { descriptor: Array(128).fill('x') })).status === 400);
    check('Face greeting', 'a 128-number descriptor enrolls, then status shows it', (await post('/api/facegreet/enroll', { descriptor: Array.from({ length: 128 }, (_, i) => i / 128) })).json.enrolled === true && (await get('/api/facegreet/status')).json.enrolled === true);
    // matching happens on the server; the stored fingerprint never leaves it
    { const stored = Array.from({ length: 128 }, (_, i) => i / 128);
      await del('/api/facegreet/enroll');   // (an earlier check enrolled one)
      check('Face greeting', 'match: not enrolled → enrolled false, no match', (await post('/api/facegreet/match', { descriptor: stored })).json.enrolled === false);
      await post('/api/facegreet/enroll', { descriptor: stored });
      const same = (await post('/api/facegreet/match', { descriptor: stored.map(v => v + 0.001) })).json;
      check('Face greeting', 'match: the same face (tiny difference) matches, with a distance', same.match === true && same.enrolled === true && same.distance < 0.5, same);
      const other = (await post('/api/facegreet/match', { descriptor: stored.map(v => v + 0.2) })).json;
      check('Face greeting', 'match: a different face (distance well over 0.5) does not match', other.match === false && other.distance > 0.5, other);
      check('Face greeting', 'match: the answer never contains the stored descriptor', !/\[/.test(JSON.stringify(same)) && !('descriptor' in same));
      check('Face greeting', 'match needs exactly 128 finite numbers', (await post('/api/facegreet/match', { descriptor: [1, 2] })).status === 400 && (await post('/api/facegreet/match', { descriptor: Array(128).fill(NaN) })).status === 400); }
    check('Face greeting', 'DELETE removes it', (await del('/api/facegreet/enroll')).json.enrolled === false && (await get('/api/facegreet/status')).json.enrolled === false);
    // app lock (applock.js; the full unlock ceremony is tests/applock.test.js)
    { const st = (await get('/api/lock/status')).json; check('App lock', 'off in a fresh install; reports whether Windows Hello is set up', st.enabled === false && st.active === false && st.locked === false && st.helloEnrolled === false, st); }
    check('App lock', 'cannot be turned on without Windows Hello (nothing to unlock with)', (await post('/api/lock/enable', { idleMin: 15 })).status === 400);
    check('App lock', 'unlock while the lock is off is harmless', (await post('/api/lock/unlock', {})).json.unlocked === true);
    check('App lock', 'ping and lock-now answer even when the lock is off', (await post('/api/lock/ping', {})).status === 200 && (await post('/api/lock/lock', {})).status === 200);
    check('App lock', 'disable is a no-op when it was never on', (await post('/api/lock/disable', {})).json.enabled === false);
    { const v = await post('/api/tool/toolVersion', { tool: 'node' }); check('Laptop', 'the Node.js version installed here (what JARVIS runs on)', v.json.found === true && v.json.version === process.version.slice(1), v.text); }
    check('Laptop', 'version checks only for a fixed list of tools', (await post('/api/tool/toolVersion', { tool: 'rm -rf' })).status === 400);
    { const r = await post('/api/tool/recentFiles', {}); check('Files', 'newest files in ~/jarvis, newest first', r.status === 200 && Array.isArray(r.json.files) && r.json.files.every((f, i, a) => !i || a[i - 1].modified >= f.modified), r.text); }
    { const v = (await get('/api/voice/vocab')).json; check('Voice', 'the speech fixer gets your folder names and drive letters (names only)', v.success && Array.isArray(v.names) && Array.isArray(v.drives), JSON.stringify(v).slice(0, 200)); }
    check('JARVIS Code', 'generate needs a request', (await post('/api/code/generate', {})).status === 400);
    check('JARVIS Code', 'generate with the AI offline: a clean error, nothing written', (await post('/api/code/generate', { prompt: 'make a calculator' })).status >= 400);
    check('JARVIS Code', 'apply refuses an empty file list', (await post('/api/code/apply', { files: [] })).status === 400);
    { const x = await post('/api/code/apply', { name: 'jc-test', files: [{ path: '../escape.txt', content: 'x' }, { path: 'C:\\evil.txt', content: 'x' }] });
      check('JARVIS Code', 'apply drops paths that leave the project (nothing valid → 400)', x.status === 400, x.status + ' ' + x.text); }
    { const x = await post('/api/code/apply', { name: 'jc-test', files: [{ path: 'index.html', content: '<h1>hi</h1>' }, { path: 'css/style.css', content: 'h1{}' }] });
      check('JARVIS Code', 'apply writes the files into ~/jarvis/Projects/<name> (no permission needed there)', x.status === 200 && x.json.written.length === 2 && fs.existsSync(path.join(SB, 'Projects', 'jc-test', 'css', 'style.css')), x.status + ' ' + x.text); }
    check('Files', '"did you mean" before the index is built: no guesses', (await post('/api/tool/similar', { name: 'calculater' })).json.indexing === true);
    check('Files', 'counting folders in an unknown place is a plain 404', (await post('/api/tool/folderStats', { scope: 'zz-no-such-folder-zz' })).status === 404);
    check('Security', 'malformed JSON gets a short JSON error, not a stack trace',
      await fetch(S.base + '/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S.base }, body: '{bad' }).then(async r => r.status === 400 && /Invalid JSON/.test(await r.text())));

    /* ---------- health & status ---------- */
    check('Status', 'health answers', (await get('/api/health')).status === 200);
    check('Status', 'LLM status reports the AI as unreachable (dead port), without crashing', (await get('/api/llm/status')).status < 500);
    check('Status', 'remote (Tailscale) status answers', (await get('/api/remote/status')).status < 500);
    check('Status', 'hotkey status answers', (await get('/api/hotkey/status')).status < 500);
    // Wake word in other apps: status only, and "off" — switching it on would open the microphone (tests/wakeword.test.js covers it).
    const wk = await get('/api/wake/native');
    check('Wake word', 'the other-apps wake word starts off', wk.status === 200 && wk.json.on === false, wk.json);
    // Start with Windows: the test server's home is a temp folder, so this only ever looks at a throwaway Startup folder.
    const as = await get('/api/autostart');
    check('Start with Windows', 'status answers (off in a fresh install)', as.status === 200 && as.json.on !== true, as.json);
    const asOff = await post('/api/autostart', { on: false });
    check('Start with Windows', 'switching it off when off is harmless', asOff.status === 200, asOff.json);
    const wkOff = await post('/api/wake/native', { on: false });
    check('Wake word', 'switching it off is harmless when it was off', wkOff.status === 200 && wkOff.json.on === false, wkOff.json);
    check('Status', 'update status answers (no network call)', (await get('/api/update/status')).status < 500);
    check('Status', 'Windows Hello status: off in a fresh install', (await get('/api/hello/status')).json.enrolled !== true);
    check('Status', 'setup status answers with Ollama offline', (await get('/api/setup/status')).status < 500);
    const apps = await get('/api/apps');
    check('Laptop', 'app list (allowlist + installed apps) loads', apps.status === 200, apps.status);
    check('Coding AI', 'coding-AI tool list loads', (await get('/api/codeTools')).status === 200);

    /* ---------- shared state (to-dos, reminders, settings…) ---------- */
    let r = await post('/api/state', { set: { 'jarvis.todos': [{ id: 't1', text: 'revise dbms', done: false }], 'jarvis.settings': { wakeWord: 'jarvis' } } });
    check('State', 'saving state works', r.json.success, r.json);
    const st = await get('/api/state.js');
    check('State', 'state comes back to the page (state.js)', /revise dbms/.test(st.text) && /window\.JARVIS_STATE/.test(st.text));
    check('State', 'keys outside jarvis.* are refused', (await post('/api/state', { set: { 'evil': 1 } })).status === 400);
    check('State', 'a malformed body is refused', (await post('/api/state', { set: [1] })).status === 400);

    /* ---------- files ---------- */
    r = await post('/api/tool/writeFile', { name: 'DBMS Notes.md', content: '# DBMS\nNormalization: 1NF, 2NF, 3NF.' });
    check('Files', 'write a note', r.json.success && fs.existsSync(path.join(SB, 'Notes', 'DBMS Notes.md')), r.json);
    r = await post('/api/tool/readFile', { name: 'DBMS Notes.md' });
    check('Files', 'read it back', r.json.success && /3NF/.test(r.json.content), r.json);
    check('Files', '"dbms" finds "DBMS Notes.md" (fuzzy name)', /DBMS Notes\.md$/.test((await post('/api/tool/readFile', { name: 'dbms' })).json.name || ''));
    check('Files', 'a missing file is a clean 404', (await post('/api/tool/readFile', { name: 'no-such-file-xyz' })).status === 404);
    r = await post('/api/tool/writeFile', { name: 'DBMS Notes.md', content: 'second line', append: true });
    check('Files', 'append to a note', (await post('/api/tool/readFile', { name: 'DBMS Notes.md' })).json.content.includes('second line'), r.json);
    r = await post('/api/tool/writeFile', { name: 'DBMS Notes.md', content: 'overwritten' });
    check('Files', 'writing over an existing file asks first (exists), without overwriting', r.json.exists === true && /3NF/.test(fs.readFileSync(path.join(SB, 'Notes', 'DBMS Notes.md'), 'utf8')), r.json);
    check('Files', 'invalid file names are refused', (await post('/api/tool/writeFile', { name: 'a<b>.md', content: 'x' })).status === 400);
    check('Files', 'writing outside the sandbox is refused', (await post('/api/tool/writeFile', { name: 'C:\\Windows\\evil.md', content: 'x' })).status === 400);
    check('Files', 'reading outside the sandbox is refused', (await post('/api/tool/readFile', { name: '..\\..\\..\\Windows\\win.ini' })).status === 404);
    await post('/api/config', { action: 'add', path: path.join(S.home, 'jarvis') });  // no-op attempt; config file now exists
    check('Security', 'JARVIS’s own config file can’t be read through file tools', (await post('/api/tool/readFile', { name: '.config.json' })).status === 404);
    check('Security', 'the shared state file can’t be read through file tools', (await post('/api/tool/readFile', { name: '.jarvis-state.json' })).status === 404);
    r = await post('/api/tool/createFolder', { name: 'DSA' });
    check('Files', 'create a folder', r.json.success && fs.statSync(path.join(SB, 'DSA')).isDirectory(), r.json);
    check('Files', 'creating it again says it existed', (await post('/api/tool/createFolder', { name: 'DSA' })).json.existed === true);
    check('Agent', 'agent/exists confirms the folder (used to verify steps)', (await post('/api/agent/exists', { name: 'DSA' })).json.exists === true);
    check('Agent', 'agent/exists says no for a missing one', (await post('/api/agent/exists', { name: 'nope-xyz' })).json.exists === false);
    r = await post('/api/tool/listFiles', {});
    check('Files', 'list the sandbox', r.json.success && r.json.folders.includes('DSA') && r.json.folders.includes('Notes'), r.json);
    r = await post('/api/tool/copyFile', { src: 'DBMS Notes.md', dest: 'DSA/copy.md' });
    check('Files', 'copy a file', r.json.success && fs.existsSync(path.join(SB, 'DSA', 'copy.md')), r.json);
    r = await post('/api/tool/renameFile', { oldName: 'DSA/copy.md', newName: 'DSA/renamed.md' });
    check('Files', 'rename a file', r.json.success && fs.existsSync(path.join(SB, 'DSA', 'renamed.md')), r.json);
    r = await post('/api/tool/undoMove', { from: 'DSA/copy.md', to: 'DSA/renamed.md' });
    check('Undo', 'undo a rename', r.json.success && fs.existsSync(path.join(SB, 'DSA', 'copy.md')), r.json);
    fs.mkdirSync(path.join(SB, 'Archive'), { recursive: true });
    r = await post('/api/tool/moveFile', { src: 'DSA/copy.md', dest: 'Archive' });
    check('Files', 'move a file into a folder', r.json.success && fs.existsSync(path.join(SB, 'Archive', 'copy.md')), r.json);
    r = await post('/api/tool/searchFiles', { query: 'copy' });
    check('Files', 'search files by name', r.json.success !== false && JSON.stringify(r.json).includes('copy.md'), r.json);
    r = await post('/api/tool/deleteItem', { name: 'Archive/copy.md' });
    check('Files', 'delete goes to the trash, not gone', r.json.trashed && fs.existsSync(path.join(SB, '.trash', r.json.trashName)), r.json);
    const restored = await post('/api/tool/restoreItem', { trashName: r.json.trashName, original: r.json.original });
    check('Undo', 'restore a deleted file from the trash', restored.json.success && fs.existsSync(path.join(SB, 'Archive', 'copy.md')), restored.json);
    check('Files', 'restore refuses a bad trash name', (await post('/api/tool/restoreItem', { trashName: '../../x', original: 'x' })).status === 400);
    r = await post('/api/tool/writeFile', { name: 'fresh.md', content: 'new' });
    check('Undo', 'undo creating a file (moves it to the trash)', (await post('/api/tool/undoCreate', { name: 'fresh.md' })).json.success && !fs.existsSync(path.join(SB, 'Notes', 'fresh.md')));
    check('Undo', 'restoreVersion refuses a bad backup name', (await post('/api/tool/restoreVersion', { backup: 'x/y', name: 'a.md' })).status === 400);
    const upl = await fetch(S.base + '/api/tool/upload?name=lecture.txt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: S.base }, body: 'Deadlock needs four conditions: mutual exclusion, hold and wait, no preemption, circular wait.' });
    rec('POST', '/api/tool/upload');
    const uj = await upl.json();
    check('Files', 'upload a document (drag & drop / 📎)', uj.success && fs.existsSync(path.join(SB, 'Documents', 'lecture.txt')), uj);
    check('Files', 'upload refuses other file types', (await fetch(S.base + '/api/tool/upload?name=virus.exe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: S.base }, body: 'MZ' })).status === 400);

    /* ---------- notes & PDFs (search) ---------- */
    r = await post('/api/rag/reindex', {});
    check('Notes search', 'reindex your files', r.json.success && r.json.files >= 2, r.json);
    r = await post('/api/rag/search', { query: 'what are the conditions for deadlock' });
    check('Notes search', 'a question finds the right document', r.json.success && JSON.stringify(r.json.results).includes('lecture.txt'), r.json);
    check('Notes search', 'an empty question is refused', (await post('/api/rag/search', { query: '' })).status === 400);
    check('Notes search', 'index status answers', (await get('/api/rag/status')).json.success);

    /* ---------- project folders ---------- */
    const proj = path.join(S.home, 'projects', 'AgriLoop');
    fs.mkdirSync(path.join(proj, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'backend', 'package.json'), JSON.stringify({ name: 'b', scripts: { start: 'node server.js' } }));
    fs.writeFileSync(path.join(proj, 'backend', 'server.js'), "require('http').createServer((q,s)=>s.end('ok')).listen(0,()=>console.log('listening on port '+require('http').globalAgent&&0));setInterval(()=>{},1e6);");
    r = await post('/api/config', { action: 'add', path: path.join(S.home, 'projects') });
    check('Projects', 'add a project folder', r.json.success && r.json.roots.some(x => /projects$/.test(x)), r.json);
    check('Projects', 'adding a system folder is refused', (await post('/api/config', { action: 'add', path: 'C:\\Windows' })).status >= 400);
    check('Projects', 'a relative path is refused', (await post('/api/config', { action: 'add', path: 'projects' })).status === 400);
    check('Projects', 'config lists the folder', (await get('/api/config')).json.roots.length >= 1);
    r = await post('/api/tool/locateProject', { name: 'AgriLoop' });
    // Folder names as said out loud: "dsa sprint" and a misheard "dss print" both find dsa_sprint.
    fs.mkdirSync(path.join(S.home, 'projects', 'dsa_sprint'), { recursive: true });
    const said = await post('/api/tool/locateProject', { name: 'dsa sprint' });
    check('Projects', '"dsa sprint" finds the dsa_sprint folder', said.json.success && /dsa_sprint$/.test(said.json.path), said.json);
    const misheard = await post('/api/tool/locateProject', { name: 'DSS print' });
    check('Projects', 'a misheard "DSS print" still finds dsa_sprint', misheard.json.success && /dsa_sprint$/.test(misheard.json.path), misheard.json);
    check('Projects', 'short names still need an exact match ("os" doesn’t find "ds")', (await post('/api/tool/locateProject', { name: 'os' })).status === 404);
    // Forgiving names never apply where a wrong guess would change or remove the wrong file.
    await post('/api/tool/writeFile', { name: 'report1.md', content: 'keep me' });
    check('Safety', 'deleting "report2.md" does not delete the similar "report1.md"', (await post('/api/tool/deleteItem', { name: 'report2.md' })).status === 404 && fs.existsSync(path.join(SB, 'Notes', 'report1.md')));
    const w2 = await post('/api/tool/writeFile', { name: 'report2.md', content: 'new file' });
    check('Safety', 'writing "report2.md" creates a new file — it doesn’t touch "report1.md"', w2.json.success && !w2.json.exists && /keep me/.test(fs.readFileSync(path.join(SB, 'Notes', 'report1.md'), 'utf8')), w2.json);
    check('Safety', 'renaming a file that doesn’t exist doesn’t rename a similar one', (await post('/api/tool/renameFile', { oldName: 'report3.md', newName: 'x.md' })).status === 404 && fs.existsSync(path.join(SB, 'Notes', 'report1.md')));
    check('Projects', 'locate a project by name', r.json.success && /AgriLoop$/.test(r.json.path), r.json);
    r = await post('/api/tool/startProcess', { name: 'AgriLoop', which: 'backend' });
    check('Projects', 'start the project’s backend', r.json.success && r.json.pid, r.json);
    check('Projects', 'its status says running', (await post('/api/tool/processStatus', { name: 'AgriLoop', which: 'backend' })).json.found === true);
    r = await post('/api/tool/startProcess', { name: 'AgriLoop', which: 'frontend' });
    check('Projects', 'a project with no frontend says so (not a crash)', r.status === 404 && /No frontend found/.test(r.json.error || ''), r.json);
    r = await post('/api/tool/stopProcess', { name: 'AgriLoop', which: 'backend' });
    check('Projects', 'stop the backend JARVIS started', r.json.success, r.json);
    check('Projects', 'invalid "which" is refused', (await post('/api/tool/startProcess', { name: 'AgriLoop', which: 'rm -rf' })).status === 400);
    // A start that dies on a missing package is recognised as missing dependencies (→ the agent offers npm install);
    // a missing *relative* file is a code bug and is not.
    for (const [nm, req, want] of [['DepsGone', 'left-pad-nope', true], ['CodeBug', './routes/nope', false]]) {
      fs.mkdirSync(path.join(S.home, 'projects', nm, 'backend'), { recursive: true });
      fs.writeFileSync(path.join(S.home, 'projects', nm, 'backend', 'package.json'), JSON.stringify({ name: 'b', scripts: { start: 'node app.js' } }));
      fs.writeFileSync(path.join(S.home, 'projects', nm, 'backend', 'app.js'), `require('${req}');`);
      if (!want) fs.mkdirSync(path.join(S.home, 'projects', nm, 'backend', 'node_modules'));
      r = await post('/api/tool/startProcess', { name: nm, which: 'backend' });
      check('Projects', want ? 'a crash on a missing package is reported as missing dependencies (npm install)' : 'a missing relative module is not mistaken for missing dependencies',
        r.json.success === false && (want ? r.json.missingDeps && r.json.missingDeps.command === 'npm install' && r.json.missingDeps.module === req : !r.json.missingDeps), r.json);
    }
    check('Projects', 'installDeps refuses an invalid "which"', (await post('/api/tool/installDeps', { name: 'DepsGone', which: 'x; rm' })).status === 400);
    check('Projects', 'installDeps needs a known project', (await post('/api/tool/installDeps', { name: 'NoSuchProject', which: 'backend' })).status === 404);
    // A started server counts as verified only when it really answers on its port; one that claims a port but never
    // listens is "not answering" (the agent then shows ○ not checked, never ✓).
    for (const [nm, listens] of [['Answering', true], ['Silent', false]]) {
      const port = await freePort();
      fs.mkdirSync(path.join(S.home, 'projects', nm, 'backend'), { recursive: true });
      fs.writeFileSync(path.join(S.home, 'projects', nm, 'backend', 'package.json'), JSON.stringify({ name: 'b', scripts: { start: 'node app.js' } }));
      fs.writeFileSync(path.join(S.home, 'projects', nm, 'backend', 'app.js'), listens
        ? `require('http').createServer((q, s) => s.end('ok')).listen(${port}, () => console.log('listening on port ${port}'));`
        : `console.log('listening on port ${port}'); setInterval(() => {}, 1e6);`);
      r = await post('/api/tool/startProcess', { name: nm, which: 'backend' });
      check('Projects', nm + ' backend starts and its port is read from its output', r.json.success && r.json.port === port, r.json);
      const st = await post('/api/tool/processStatus', { name: nm, which: 'backend' });
      check('Projects', listens ? 'a running server that answers on its port is reported as answering' : 'a server that claims a port but never listens is reported as not answering',
        st.json.found && st.json.alive && st.json.responding === listens, st.json);
      await post('/api/tool/stopProcess', { name: nm, which: 'backend' });
    }
    check('Projects', 'processStatus of a project with nothing running says so', (await post('/api/tool/processStatus', { name: 'DepsGone', which: 'backend' })).json.found === false);
    check('Projects', 'checkPort validates the number', (await post('/api/tool/checkPort', { port: 99999 })).status === 400);
    check('Projects', 'checkPort answers for a real port', (await post('/api/tool/checkPort', { port: S.port })).status === 200);
    check('Projects', 'portOwner answers', (await post('/api/tool/portOwner', { port: S.port })).status === 200);
    check('Projects', 'portOwner validates the number', (await post('/api/tool/portOwner', { port: -1 })).status === 400);

    /* ---------- run code ---------- */
    fs.writeFileSync(path.join(SB, 'hello.js'), 'console.log("hello from " + (40 + 2))');
    r = await post('/api/tool/runFile', { name: 'hello.js' });
    check('Code', 'run a JavaScript file and capture its output', /hello from 42/.test(JSON.stringify(r.json)), r.json);
    fs.writeFileSync(path.join(SB, 'boom.js'), 'throw new Error("kaboom")');
    r = await post('/api/tool/runFile', { name: 'boom.js' });
    check('Code', 'a crashing program reports the error and exit code', /kaboom/.test(JSON.stringify(r.json)) && /code|exit/i.test(JSON.stringify(r.json)), r.json);
    check('Code', 'checkCompiler for Python answers', typeof (await post('/api/tool/checkCompiler', { language: 'python' })).json.found === 'boolean');
    check('Code', 'checkCompiler refuses an unknown language', (await post('/api/tool/checkCompiler', { language: 'cobol' })).status === 400);
    check('Code', 'checkExtension answers', (await post('/api/tool/checkExtension', { language: 'python' })).status === 200);

    /* ---------- git (a temp repo only — never your folders) ---------- */
    const repo = path.join(SB, 'gitdemo');
    fs.mkdirSync(repo);
    let hasGit = true; try { execFileSync('git', ['init', '-q'], { cwd: repo }); } catch { hasGit = false; }
    if (hasGit) {
      fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
      check('Git', 'git status', /a\.txt/.test((await post('/api/tool/gitStatus', { repo: 'gitdemo' })).json.output || ''));
      check('Git', 'git commit', (await post('/api/tool/gitCommit', { repo: 'gitdemo', message: 'test commit' })).json.success !== false);
      check('Git', 'git log shows it', /test commit/.test((await post('/api/tool/gitLog', { repo: 'gitdemo' })).json.output || ''));
      check('Git', 'git diff answers', (await post('/api/tool/gitDiff', { repo: 'gitdemo' })).status === 200);
      check('Git', 'commit needs a message', (await post('/api/tool/gitCommit', { repo: 'gitdemo', message: ' ' })).status === 400);
    } else check('Git', 'git is installed (needed for the git commands)', false);

    /* ---------- agent ---------- */
    r = await get('/api/agent/tools');
    check('Agent', 'the tool registry loads with permission tiers', r.json.tools && r.json.tools.set_volume && r.json.intents, Object.keys(r.json));
    check('Agent', 'a valid tool call passes validation', (await post('/api/agent/validate', { tool: 'set_volume', args: { level: 30 } })).json.ok);
    check('Agent', 'an out-of-range argument is refused', !(await post('/api/agent/validate', { tool: 'set_volume', args: { level: 500 } })).json.ok);
    check('Agent', 'an unknown tool is refused', !(await post('/api/agent/validate', { tool: 'format_disk', args: {} })).json.ok);
    check('Agent', 'a yearly reminder passes validation', (await post('/api/agent/validate', { tool: 'remind', args: { text: 'pay fees', when: 'every year in july' } })).json.ok);
    check('Agent', 'permission tier: shutdown is explicit', (await post('/api/agent/tier', { intent: 'SYS_SHUTDOWN' })).json.tier === 'explicit');
    r = await post('/api/agent/plan', { text: 'set up my coding space' });
    check('Agent', 'planning with the AI offline fails cleanly (no crash)', r.status < 500 || r.json.error, r);

    /* ---------- AI routes with the AI offline: clean errors ---------- */
    check('AI', 'chat with the AI offline returns an error, not a hang', (await post('/api/chat', { messages: [{ role: 'user', content: 'hi' }] })).status >= 400);
    check('AI', 'chat needs messages', (await post('/api/chat', {})).status === 400);
    check('AI', 'summarize needs text', (await post('/api/summarize', {})).status === 400);
    check('AI', 'summarize with the AI offline errors cleanly', (await post('/api/summarize', { text: 'hello world' })).status >= 400);
    check('Language', 'translate validates the language', (await post('/api/translate', { text: 'hi', to: 'fr' })).status === 400);
    check('Skills', 'viva needs a subject', (await post('/api/skill/viva/questions', {})).status === 400);
    // Missing input gets a plain-English 4xx (the page shows it as-is), never a 500.
    for (const p of ['/api/skill/viva/grade', '/api/skill/coach', '/api/skill/fix', '/api/skill/site', '/api/skill/siteEdit', '/api/skill/siteRevert', '/api/skill/uiprompt']) {
      const x = await post(p, {});
      check('Skills', p.replace('/api/skill/', '') + ': missing input gets a plain 4xx message', x.status >= 400 && x.status < 500 && typeof x.json.error === 'string', x.status + ' ' + x.text);
    }
    r = await post('/api/skill/viva/questions', { topic: 'DBMS' });
    check('Skills', 'viva questions with the AI offline: a clean error, not a crash', r.status >= 400 && typeof r.json.error === 'string', r.status + ' ' + r.text);
    // Skill packs (SKILL.md folders): the four shipped skills load from skills-bundled; instructions are never sent to the page.
    r = await get('/api/skills');
    check('Skill packs', 'the shipped skills are listed', r.json.success && ['code-review', 'plan-then-act', 'quick', 'research'].every(n => r.json.skills.some(s => s.name === n)), r.text.slice(0, 300));
    check('Skill packs', 'the list has hints and uses but never the instructions', r.json.skills.every(s => s.hint && !('body' in s)) && !/Never add facts from memory|Answer in at most three/.test(r.text));
    check('Skill packs', 'an unknown skill is a plain 404', (await post('/api/skill/run', { skill: 'nope', input: 'x' })).status === 404);
    check('Skill packs', 'a skill with no input is a plain 400', (await post('/api/skill/run', { skill: 'quick', input: '' })).status === 400);
    r = await post('/api/skill/run', { skill: 'quick', input: 'what is dns' });
    check('Skill packs', 'running a skill with the AI offline: a clean error, not a crash', r.status >= 400 && typeof r.json.error === 'string', r.status + ' ' + r.text);
    r = await post('/api/skills/reload', {});
    check('Skill packs', 'reload rescans and reports how many', r.json.success && r.json.count >= 4 && Array.isArray(r.json.skipped), r.json);
    // "Check my AI": works with the AI offline (that is when it matters), keeps outcomes only, never the question or a key.
    r = await get('/api/ai/health');
    check('AI health', 'the report loads with the AI offline and says Ollama is not answering', r.json.success && r.json.ollama.reachable === false && r.json.verdicts.some(v => v.level === 'bad' && /not answering/.test(v.text)) && /^Something needs attention/.test(r.json.headline) && /\*\*AI health\*\*/.test(r.json.text), r.text.slice(0, 300));
    check('AI health', 'the failed chat call from above is in the history, as a kind of error and nothing more', r.json.summary.total >= 1 && r.json.summary.failed >= 1 && !/hello world/.test(r.text) && Object.keys(r.json.summary.errors).length >= 1, r.json.summary);
    r = await get('/api/ai/health?deep=1');
    check('AI health', 'the test question fails cleanly when the AI is off', r.json.success && r.json.deep && r.json.deep.ok === false && typeof r.json.deep.error === 'string', r.json.deep);
    r = await post('/api/ai/health/clear', {});
    check('AI health', 'the history can be cleared', r.json.success && (await get('/api/ai/health')).json.summary.total <= 1);
    // Nearby places: gated by Online tools like the other web lookups; bad input is refused before any network call.
    check('Nearby', 'refuses when Online tools is off', (await post('/api/tool/nearby', { place: 'majestic', category: 'cafe' })).status === 403);
    check('Nearby', 'needs a kind of place', (await post('/api/tool/nearby', { online: true, place: 'majestic' })).status === 400);
    r = await post('/api/tool/nearby', { online: true, place: 'majestic', category: 'spaceport' });
    check('Nearby', 'an unknown kind is a plain 400 that lists what it can find', r.status === 400 && /pharmacies/.test(r.json.error), r.text);
    r = await post('/api/tool/nearby', { online: true, category: 'cafe' });
    check('Nearby', 'needs a place (or coordinates)', r.status === 400 && /Near where/.test(r.json.error), r.text);
    check('Nearby', 'impossible coordinates are a 400', (await post('/api/tool/nearby', { online: true, lat: 300, lon: 5, category: 'cafe' })).status === 400);
    // CSV analysis on a real file in the sandbox: exact numbers, and nothing outside the allowed folders.
    fs.mkdirSync(path.join(S.sandbox, 'Documents'), { recursive: true });
    fs.writeFileSync(path.join(S.sandbox, 'Documents', 'api-marks.csv'), 'name,dept,marks,attendance\nAsha,CSE,82,91\nBen,CSE,67,78\nChitra,ECE,45,60\nDev,ECE,91,95\nEsha,ME,58,72\nFarid,ME,,80\nGita,CSE,73,85\nHari,ECE,39,55\n');
    r = await post('/api/csv/analyze', { name: 'api-marks.csv' });
    check('CSV', 'analyze: rows, columns, exact statistics, a digest with no row values', r.json.success && r.json.rows === 8 && r.json.cols === 4 && r.json.columns[2].mean === 65 && r.json.columns[2].missing === 1 && r.json.correlations.length === 1 && /8 rows × 4 columns/.test(r.json.digest) && !/Asha|Farid/.test(r.json.digest), r.text.slice(0, 300));
    r = await post('/api/csv/query', { name: 'api-marks.csv', groupBy: 'dept', column: 'marks' });
    check('CSV', 'average marks by department', r.json.success && r.json.groups[0].group === 'CSE' && r.json.groups[0].value === 74 && r.json.groups[1].value === 58.3333, r.text.slice(0, 300));
    r = await post('/api/csv/query', { name: 'api-marks.csv', filter: 'marks > 60 and dept = CSE', limit: 5 });
    check('CSV', 'a filter returns the matching rows', r.json.matched === 3 && r.json.rows.length === 3 && r.json.columns.join() === 'name,dept,marks,attendance', r.text.slice(0, 300));
    check('CSV', 'a bad filter is a 400 that names the real columns', (r = await post('/api/csv/query', { name: 'api-marks.csv', filter: 'mark > 5' })).status === 400 && /name, dept, marks, attendance/.test(r.json.error), r.text);
    check('CSV', 'hostile filter text is just an error', (await post('/api/csv/query', { name: 'api-marks.csv', filter: 'marks > 1; process.exit(1)' })).status === 400 && (await get('/api/health')).json.status);
    r = await post('/api/csv/chart', { name: 'api-marks.csv', column: 'marks', groupBy: 'dept', open: false });
    check('CSV', 'a chart is written into Charts/ (not opened in this test)', r.json.success && r.json.file === 'Charts/api-marks-marks-by-dept.svg' && /^<svg/.test(fs.readFileSync(path.join(S.sandbox, 'Charts', 'api-marks-marks-by-dept.svg'), 'utf8')), r.text.slice(0, 300));
    check('CSV', 'a file that does not exist is a 404; no name is a 404', (await post('/api/csv/analyze', { name: 'nope.csv' })).status === 404 && (await post('/api/csv/analyze', {})).status === 404);
    check('CSV', 'a path into a blocked area is refused as not found', (await post('/api/csv/analyze', { name: 'C:\\Windows\\System32\\drivers\\etc\\hosts' })).status === 404);
    fs.writeFileSync(path.join(S.sandbox, 'Documents', 'api-bad.csv'), 'just one line');
    check('CSV', 'a file that is not a real table is a 400 with the reason', (r = await post('/api/csv/analyze', { name: 'api-bad.csv' })).status === 400 && /header row/.test(r.json.error), r.text);
    // Project wiki: derived from a real project folder in the sandbox; nothing is invented and nothing leaves ~/jarvis unless asked.
    const wp = path.join(S.sandbox, 'Projects', 'apiwiki');
    fs.mkdirSync(path.join(wp, 'core'), { recursive: true });
    fs.writeFileSync(path.join(wp, 'main.py'), 'from core.engine import Engine\nif __name__ == "__main__":\n    Engine().run()\n');
    fs.writeFileSync(path.join(wp, 'core', 'engine.py'), '"""The engine."""\nclass Engine:\n    def run(self): pass\n');
    r = await post('/api/project/wiki', { name: 'apiwiki', ai: false, open: false });
    check('Wiki', 'a project in the sandbox gets a wiki under Wikis/ (no AI, nothing opened)', r.json.success && r.json.relDir === 'Wikis/apiwiki' && r.json.modules === 2 && r.json.sourceFiles === 2 && r.json.aiSummaries === 0 && r.json.files.includes('architecture.md') && fs.existsSync(path.join(S.sandbox, 'Wikis', 'apiwiki', 'modules', 'core.md')), r.text.slice(0, 300));
    const archText = fs.readFileSync(path.join(S.sandbox, 'Wikis', 'apiwiki', 'architecture.md'), 'utf8');
    check('Wiki', 'the diagram has the real import (root files → core) and balanced Mermaid fences', /-->\|1\|/.test(archText) && (archText.match(/^```/gm) || []).length === 2 && /The engine\./.test(fs.readFileSync(path.join(S.sandbox, 'Wikis', 'apiwiki', 'modules', 'core.md'), 'utf8')));
    check('Wiki', 'the original project is untouched', fs.readdirSync(wp).sort().join() === 'core,main.py');
    r = await post('/api/project/wiki', { name: 'apiwiki', into: 'project', ai: false, open: false });
    check('Wiki', 'into the project folder (inside ~/jarvis needs no approval) writes docs/wiki there', r.json.success && fs.existsSync(path.join(wp, 'docs', 'wiki', 'README.md')), r.text.slice(0, 200));
    check('Wiki', 'no name → 400; unknown project → 404; a whole drive → 400', (await post('/api/project/wiki', {})).status === 400 && (await post('/api/project/wiki', { name: 'no-such-project' })).status === 404 && (await post('/api/project/wiki', { name: path.parse(S.sandbox).root })).status === 400);
    check('Wiki', 'a blocked system folder is refused as not found', (await post('/api/project/wiki', { name: 'C:\\Windows\\System32' })).status === 404);
    fs.mkdirSync(path.join(S.sandbox, 'Projects', 'emptyproj'), { recursive: true });
    check('Wiki', 'a folder with no source files is a 422 that says what I look for', (r = await post('/api/project/wiki', { name: 'emptyproj', ai: false, open: false })).status === 422 && /node_modules/.test(r.json.error), r.text);
    // Images: input checks only (a real request would leave this machine); the key is stored and never shown back.
    r = await get('/api/image/status');
    check('Images', 'status names the service and says no key is saved yet', r.json.success && r.json.service.id === 'pollinations' && r.json.hasKey === false && /Images$/.test(r.json.folder), r.text.slice(0, 300));
    check('Images', 'the key can be saved from the laptop page, is never shown back, and can be removed', (r = await post('/api/image/key', { apiKey: 'sk_test_key_123' })).json.hasKey === true && !r.text.includes('sk_test_key_123') && !(await get('/api/image/status')).text.includes('sk_test_key_123') && (await get('/api/image/status')).json.hasKey === true && (await post('/api/image/key', { apiKey: '' })).json.hasKey === false && (await get('/api/image/status')).json.hasKey === false);
    check('Images', 'a key with spaces is refused; a key change from elsewhere is refused', (await post('/api/image/key', { apiKey: 'has a space' })).status === 400 && (await post('/api/image/key', { apiKey: 'abc' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
    check('Images', 'the hosted service needs Online tools', (await post('/api/image/generate', { prompt: 'a cat on the moon', service: 'pollinations' })).status === 403);
    check('Images', 'bad shape, unknown style, too-short and missing descriptions are plain 400s', (await post('/api/image/generate', { online: true, prompt: 'a cat on the moon', service: 'pollinations', shape: 'huge' })).status === 400 && /anime/.test((await post('/api/image/generate', { online: true, prompt: 'a cat on the moon', service: 'pollinations', style: 'nope' })).json.error) && (await post('/api/image/generate', { online: true, prompt: 'hi', service: 'pollinations' })).status === 400 && (await post('/api/image/generate', { online: true, service: 'pollinations' })).status === 400);
    // PDF tools on real PDFs made here: always a NEW file under ~/jarvis/PDFs, the originals are never touched.
    {
      const { PDFDocument } = require('pdf-lib');
      const mkPdf = async n => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([200, 200]); return Buffer.from(await d.save()); };
      const docsDir = path.join(S.sandbox, 'Documents');
      fs.writeFileSync(path.join(docsDir, 'api-a.pdf'), await mkPdf(2)); fs.writeFileSync(path.join(docsDir, 'api-b.pdf'), await mkPdf(3));
      fs.writeFileSync(path.join(docsDir, 'api-fake.pdf'), 'not a pdf at all'); fs.writeFileSync(path.join(docsDir, 'api-note.txt'), 'hello');
      const h = f => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(docsDir, f))).digest('hex');
      const before = [h('api-a.pdf'), h('api-b.pdf')];
      r = await post('/api/pdf/merge', { files: ['api-a.pdf', 'api-b.pdf'], open: false });
      check('PDF', 'merge: a new 5-page PDF in PDFs/, named from the inputs', r.json.success && r.json.file === 'PDFs/api-a-and-api-b-merged.pdf' && r.json.pages === 5 && (await PDFDocument.load(fs.readFileSync(r.json.path))).getPageCount() === 5, r.text.slice(0, 300));
      r = await post('/api/pdf/pages', { file: 'api-b.pdf', pages: '2-3', open: false });
      check('PDF', 'pages: pages 2-3 as a new 2-page PDF', r.json.success && r.json.pages === 2 && r.json.total === 3 && r.json.selected === '2-3' && (await PDFDocument.load(fs.readFileSync(r.json.path))).getPageCount() === 2, r.text.slice(0, 300));
      r = await post('/api/pdf/rotate', { file: 'api-b.pdf', degrees: 'right', pages: '1', open: false });
      check('PDF', 'rotate: page 1 turned 90°, the others not', r.json.success && (await PDFDocument.load(fs.readFileSync(r.json.path))).getPages().map(p => p.getRotation().angle).join() === '90,0,0', r.text.slice(0, 300));
      r = await post('/api/pdf/watermark', { file: 'api-a.pdf', text: 'DRAFT', open: false });
      check('PDF', 'watermark: both pages stamped', r.json.success && r.json.pages === 2 && r.json.file === 'PDFs/api-a-watermarked.pdf', r.text.slice(0, 300));
      r = await post('/api/pdf/make', { title: 'API Notes', text: '# Heading\n- one\n- two', open: false });
      check('PDF', 'make: a PDF from text, named from the title', r.json.success && r.json.file === 'PDFs/api-notes.pdf' && r.json.pages === 1 && r.json.replaced === 0, r.text.slice(0, 300));
      check('PDF', 'a second identical request makes a second file, not an overwrite', (await post('/api/pdf/make', { title: 'API Notes', text: '# Heading', open: false })).json.file === 'PDFs/api-notes-2.pdf');
      check('PDF', 'the original PDFs are byte-for-byte unchanged', h('api-a.pdf') === before[0] && h('api-b.pdf') === before[1]);
      check('PDF', 'refusals are plain 4xx messages: one file, missing file, not a PDF, damaged file, bad pages, bad angle, empty text', (await post('/api/pdf/merge', { files: ['api-a.pdf'] })).status === 400 && (await post('/api/pdf/pages', { file: 'nope.pdf', pages: '1' })).status === 404 && /isn’t a PDF/.test((await post('/api/pdf/pages', { file: 'api-note.txt', pages: '1' })).json.error) && /doesn’t look like a PDF/.test((await post('/api/pdf/pages', { file: 'api-fake.pdf', pages: '1' })).json.error) && /3 pages, so page 9/.test((await post('/api/pdf/pages', { file: 'api-b.pdf', pages: '9' })).json.error) && (await post('/api/pdf/rotate', { file: 'api-b.pdf', degrees: 33 })).status === 400 && (await post('/api/pdf/make', { text: '  ' })).status === 400);
      check('PDF', 'a blocked system path is "not found"', (await post('/api/pdf/pages', { file: 'C:\\Windows\\win.pdf', pages: '1' })).status === 404);
    }
    // Disk care on real folders in the test home: scans only read; every change is planned on the server, approved, applied once, and undone in one step.
    {
      const old = d => new Date(Date.now() - d * 864e5);
      const put = (f, data, ageDays) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); if (ageDays) fs.utimesSync(f, old(ageDays), old(ageDays)); return f; };
      const dl = path.join(S.home, 'Downloads');
      put(path.join(dl, 'api-report.pdf'), 'p', 5); put(path.join(dl, 'api-photo.jpg'), 'j', 5); put(path.join(dl, 'api-setup.exe'), 'e', 5); put(path.join(dl, 'api-half.crdownload'), 'h', 5); put(path.join(dl, 'api-fresh.txt'), 'f', 0);
      const foreign = { headers: { 'Sec-Fetch-Site': 'cross-site' } };
      r = await post('/api/disk/usage', {});
      check('Disk care', 'usage: drives with free space and the biggest places, read-only', r.json.success && r.json.drives.length >= 1 && r.json.drives[0].totalBytes > 0 && Array.isArray(r.json.places) && r.json.temp && typeof r.json.trashBytes === 'number', r.text.slice(0, 300));
      r = await post('/api/disk/plan', { kind: 'tidy' });
      const tidyId = r.json.planId;
      check('Disk care', 'tidy plan: the Downloads folder by default, a count per category, unfinished and brand-new files left alone; nothing has moved yet', r.json.success && r.json.count === 3 && r.json.byCategory.Documents.count === 1 && r.json.byCategory.Images.count === 1 && r.json.byCategory.Installers.count === 1 && r.json.skipped.inProgress === 1 && r.json.skipped.recent === 1 && fs.existsSync(path.join(dl, 'api-report.pdf')) && !('items' in r.json), r.text.slice(0, 400));
      check('Disk care', 'apply and undo are refused when they do not come from JARVIS on the laptop', (await post('/api/disk/apply', { planId: tidyId }, foreign)).status === 403 && (await post('/api/disk/undo', { runId: '20260101000000-abcdef' }, foreign)).status === 403 && (await post('/api/disk/applyPermanent', { planId: tidyId }, foreign)).status === 403);
      r = await post('/api/disk/apply', { planId: tidyId });
      check('Disk care', 'apply: Downloads is outside ~/jarvis, so the normal "needs your OK" answer (409) comes first and nothing moves', r.status === 409 && r.json.needsApproval === true && r.json.paths.includes(dl) && fs.existsSync(path.join(dl, 'api-report.pdf')), r.text.slice(0, 300));
      r = await post('/api/disk/apply', { planId: tidyId, approved: true });
      const tidyRun = r.json.runId;
      check('Disk care', 'apply with approval: files land in category folders and a run id is returned', r.json.success && r.json.moved === 3 && /^\d{14}-[a-f0-9]{6}$/.test(tidyRun) && fs.existsSync(path.join(dl, 'Documents', 'api-report.pdf')) && fs.existsSync(path.join(dl, 'Images', 'api-photo.jpg')) && fs.existsSync(path.join(dl, 'Installers', 'api-setup.exe')) && fs.existsSync(path.join(dl, 'api-half.crdownload')) && fs.existsSync(path.join(dl, 'api-fresh.txt')), r.text.slice(0, 300));
      check('Disk care', 'a plan can only be applied once, and a made-up plan id or a file list sent by the page does nothing', (await post('/api/disk/apply', { planId: tidyId, approved: true })).status === 410 && (await post('/api/disk/apply', { planId: 'feedfacefeedface', approved: true, items: [{ from: path.join(dl, 'api-fresh.txt') }] })).status === 410 && fs.existsSync(path.join(dl, 'api-fresh.txt')));
      r = await post('/api/disk/undo', { runId: tidyRun });
      check('Disk care', 'undo asks for approval too (it writes into Downloads) and moves nothing until it has it', r.status === 409 && !fs.existsSync(path.join(dl, 'api-report.pdf')));
      r = await post('/api/disk/undo', { runId: tidyRun, approved: true });
      check('Disk care', 'undo: all three files are back, the empty category folders are gone, and asking again is refused', r.json.success && r.json.restored === 3 && fs.existsSync(path.join(dl, 'api-report.pdf')) && !fs.existsSync(path.join(dl, 'Documents')) && (await post('/api/disk/undo', { runId: tidyRun, approved: true })).status === 409);
      check('Disk care', 'plan errors are plain: unknown folder 404, a whole drive 400, a system folder refused, JARVIS trash 400, unknown kind 400', (await post('/api/disk/plan', { kind: 'tidy', folder: 'no-such-folder-xyz' })).status === 404 && (await post('/api/disk/plan', { kind: 'tidy', folder: path.parse(S.home).root })).status === 400 && [403, 404].includes((await post('/api/disk/plan', { kind: 'tidy', folder: 'C:\\Windows\\System32' })).status) && [400, 404].includes((await post('/api/disk/plan', { kind: 'tidy', folder: path.join(S.sandbox, '.trash') })).status) && (await post('/api/disk/plan', { kind: 'nope' })).status === 400);
      // large files → the JARVIS trash → undo; and duplicates
      const docs = path.join(S.sandbox, 'Documents');
      put(path.join(docs, 'api-big-a.bin'), Buffer.alloc(3 * 1048576, 1), 30); put(path.join(docs, 'api-big-b.bin'), Buffer.alloc(2 * 1048576, 2), 30);
      put(path.join(docs, 'api-dup-1.dat'), Buffer.alloc(2 * 1048576 + 5, 9), 40); put(path.join(S.sandbox, 'Projects', 'api-dup-2.dat'), Buffer.alloc(2 * 1048576 + 5, 9), 20);
      r = await post('/api/disk/plan', { kind: 'large', minMB: 2 });
      const bigItems = r.json.items || [];
      check('Disk care', 'large files: biggest first, numbered, with size, age and path (read-only)', r.json.success && bigItems.length >= 3 && bigItems[0].n === 1 && bigItems[0].size >= bigItems[1].size && bigItems.some(i => /api-big-a\.bin$/.test(i.path)) && bigItems.every(i => i.size >= 2 * 1048576), r.text.slice(0, 300));
      const bigId = r.json.planId;
      check('Disk care', 'large files: choosing nothing, or a number that is not in the list, is a plain 400', (await post('/api/disk/apply', { planId: bigId })).status === 400 && (await post('/api/disk/apply', { planId: bigId, pick: [999] })).status === 400 && (await post('/api/disk/apply', { planId: bigId, pick: [0] })).status === 400);
      const pickN = bigItems.find(i => /api-big-a\.bin$/.test(i.path)).n;
      r = await post('/api/disk/apply', { planId: bigId, pick: [pickN] });
      const bigRun = r.json.runId;
      check('Disk care', 'large files: the picked file goes to the JARVIS trash on the same drive; the other stays', r.json.success && r.json.moved === 1 && r.json.trashNote === true && !fs.existsSync(path.join(docs, 'api-big-a.bin')) && fs.existsSync(path.join(docs, 'api-big-b.bin')) && fs.readdirSync(path.join(S.sandbox, '.trash')).some(n => n === 'diskcare-' + bigRun), r.text.slice(0, 300));
      r = await post('/api/disk/undo', { runId: bigRun });
      check('Disk care', 'large files: undo brings it back (inside ~/jarvis, so no approval is needed)', r.json.success && r.json.restored === 1 && fs.existsSync(path.join(docs, 'api-big-a.bin')) && fs.statSync(path.join(docs, 'api-big-a.bin')).size === 3 * 1048576, r.text.slice(0, 300));
      r = await post('/api/disk/plan', { kind: 'duplicates' });
      check('Disk care', 'duplicates: identical files are found by content, one copy is kept, the rest listed', r.json.success && r.json.groupCount >= 1 && r.json.extraCopies >= 1 && r.json.wasted >= 2 * 1048576 && r.json.groups.some(g => g.copies.length >= 1 && g.size === 2 * 1048576 + 5), r.text.slice(0, 400));
      const dupId = r.json.planId;
      r = await post('/api/disk/apply', { planId: dupId });
      const dupRun = r.json.runId;
      check('Disk care', 'duplicates: apply moves only the extras; exactly one of the two copies is left', r.json.success && r.json.moved === 1 && [path.join(docs, 'api-dup-1.dat'), path.join(S.sandbox, 'Projects', 'api-dup-2.dat')].filter(f => fs.existsSync(f)).length === 1, r.text.slice(0, 300));
      // similar photos with the real Windows image tools: two copies of one (tiny, padded) JPEG are the same picture
      {
        const TINYJ = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
        const padded = Buffer.concat([TINYJ, Buffer.alloc(40 * 1024, 0)]);
        fs.mkdirSync(path.join(S.sandbox, 'Images'), { recursive: true });
        fs.writeFileSync(path.join(docs, 'api-photo-a.jpg'), padded); fs.writeFileSync(path.join(S.sandbox, 'Images', 'api-photo-b.jpg'), padded);
        r = await post('/api/disk/plan', { kind: 'photos' });
        const gi = r.json.success ? r.json.groups.findIndex(g => [g.keep.path, ...g.copies.map(c => c.path)].some(p => /api-photo-/.test(p))) : -1;
        check('Disk care', 'similar photos: the same picture in two folders is one set (found by the real Windows image tools), with the size and how alike', r.json.success && gi >= 0 && r.json.groups[gi].copies.length === 1 && r.json.groups[gi].copies[0].distance === 0 && /^[a-f0-9]{16}$/.test(r.json.planId), r.text.slice(0, 500));
        if (gi >= 0) {
          check('Disk care', 'similar photos: a set number that does not exist is refused', (await post('/api/disk/apply', { planId: r.json.planId, pick: [999] })).status === 400);
          const ap = await post('/api/disk/apply', { planId: r.json.planId, pick: [gi + 1] });
          check('Disk care', 'similar photos: cleaning the chosen set moves exactly one of the two to the JARVIS trash', ap.json.success && ap.json.moved === 1 && [path.join(docs, 'api-photo-a.jpg'), path.join(S.sandbox, 'Images', 'api-photo-b.jpg')].filter(f => fs.existsSync(f)).length === 1, ap.text.slice(0, 300));
          const un = await post('/api/disk/undo', { runId: ap.json.runId });
          check('Disk care', 'similar photos: undo brings it back', un.json.success && un.json.restored === 1 && fs.existsSync(path.join(docs, 'api-photo-a.jpg')) && fs.existsSync(path.join(S.sandbox, 'Images', 'api-photo-b.jpg')), un.text.slice(0, 300));
        }
        r = await post('/api/disk/plan', { kind: 'shrink' });
        check('Disk care', 'shrink plan: only big old JPEGs qualify, so the small ones in the test home give an empty plan with the limits stated', r.json.success && r.json.count === 0 && r.json.minMB === 3 && r.json.olderDays === 90 && r.json.quality === 82 && r.json.maxSide === 2560, r.text.slice(0, 300));
        for (const f of [path.join(docs, 'api-photo-a.jpg'), path.join(S.sandbox, 'Images', 'api-photo-b.jpg')]) { try { fs.rmSync(f, { force: true }); } catch {} }
      }
      r = await post('/api/disk/plan', { kind: 'trash' });
      check('Disk care', 'trash plan: counts what is in the JARVIS trash (a permanent action, flagged as such)', r.json.success && r.json.permanent === true && r.json.count >= 1 && r.json.bytes >= 2 * 1048576, r.text.slice(0, 300));
      const trashId = r.json.planId;
      check('Disk care', 'a permanent plan cannot go through the reversible route', (await post('/api/disk/apply', { planId: trashId })).status === 400);
      r = await post('/api/disk/undo', { runId: dupRun });
      check('Disk care', 'duplicates: undo puts the extra copy back', r.json.success && r.json.restored === 1 && fs.existsSync(path.join(docs, 'api-dup-1.dat')) && fs.existsSync(path.join(S.sandbox, 'Projects', 'api-dup-2.dat')));
      // temp (only the throwaway folder named Temp) and emptying the trash: permanent
      put(path.join(diskTemp, 'api-old.tmp'), 'o'.repeat(500), 10); put(path.join(diskTemp, 'api-new.tmp'), 'n', 0); put(path.join(diskTemp, 'sub', 'api-old2.log'), 'p'.repeat(100), 6);
      r = await post('/api/disk/plan', { kind: 'temp' });
      check('Disk care', 'temp plan: only files older than 3 days in the throwaway temp folder, flagged permanent', r.json.success && r.json.count === 2 && r.json.bytes === 600 && r.json.permanent === true && r.json.olderThanDays === 3 && fs.existsSync(path.join(diskTemp, 'api-old.tmp')), r.text.slice(0, 300));
      r = await post('/api/disk/applyPermanent', { planId: r.json.planId });
      check('Disk care', 'temp apply: the old files are deleted for real, the new one and the folder stay', r.json.success && r.json.removed === 2 && r.json.bytes === 600 && !fs.existsSync(path.join(diskTemp, 'api-old.tmp')) && !fs.existsSync(path.join(diskTemp, 'sub')) && fs.existsSync(path.join(diskTemp, 'api-new.tmp')) && fs.existsSync(diskTemp), r.text.slice(0, 300));
      r = await post('/api/disk/plan', { kind: 'trash' });
      r = await post('/api/disk/applyPermanent', { planId: r.json.planId });
      check('Disk care', 'emptying the JARVIS trash removes everything in it (the trash folder itself stays)', r.json.success && r.json.removed >= 1 && fs.existsSync(path.join(S.sandbox, '.trash')) && fs.readdirSync(path.join(S.sandbox, '.trash')).length === 0, r.text.slice(0, 300));
    }
    // Service watchdog: Ollama is always listed; what to watch can only be changed from the laptop page (this harness is not it).
    r = await get('/api/watch/status');
    check('Watchdog', 'status lists Ollama and starts switched off', r.json.success && r.json.enabled === false && r.json.targets[0].id === 'ollama' && r.json.targets[0].builtin, r.text.slice(0, 300));
    check('Watchdog', 'a check round works (Ollama is down in this harness) and nothing alerts on the first look', (await post('/api/watch/check', {})).json.targets[0].up === false);
    const foreign = { headers: { 'Sec-Fetch-Site': 'cross-site' } };
    for (const p of ['add', 'remove', 'enable']) check('Watchdog', p + ' is refused when it does not come from JARVIS on the laptop', (await post('/api/watch/' + p, { target: 'localhost:5000', on: true }, foreign)).status === 403);
    check('Watchdog', 'nothing was added by the refused calls', (await get('/api/watch/status')).json.targets.length === 1);
    check('Watchdog', 'a bad address is a plain 400', (await post('/api/watch/add', { target: 'file:///etc/passwd' })).status === 400 && (await post('/api/watch/add', {})).status === 400);
    r = await post('/api/watch/add', { target: 'localhost:' + S.port, label: 'JARVIS test server' });
    check('Watchdog', 'watching a port that is open: switched on, checked at once, up', r.json.success && r.json.enabled && r.json.watching.label === 'JARVIS test server' && r.json.watching.up === true && r.json.watching.checks === 1, r.text.slice(0, 300));
    check('Watchdog', 'the same address again is not added twice', (await post('/api/watch/add', { target: 'LOCALHOST:' + S.port })).json.existed === true && (await get('/api/watch/status')).json.targets.length === 2);
    r = await post('/api/watch/add', { target: 'localhost:9' });
    check('Watchdog', 'a closed port is reported as not answering', r.json.watching.up === false && /nothing is listening/.test(r.json.watching.error), r.json.watching);
    check('Watchdog', 'Ollama cannot be removed, an unknown name is a 404', (await post('/api/watch/remove', { target: 'ollama' })).status === 404 && (await post('/api/watch/remove', { target: 'nothing' })).status === 404);
    check('Watchdog', 'remove by the name you gave it', (await post('/api/watch/remove', { target: 'JARVIS test server' })).json.removed === 'JARVIS test server' && (await get('/api/watch/status')).json.targets.length === 2);
    await post('/api/watch/remove', { target: 'localhost:9' });
    check('Watchdog', 'switch off', (await post('/api/watch/enable', { on: false })).json.enabled === false && (await get('/api/watch/status')).json.enabled === false);
    check('AI providers', 'provider list loads (keys never shown)', (await get('/api/llm/providers')).json.success);
    check('AI providers', 'adding an empty key is refused', (await post('/api/llm/providers', { apiKey: '' })).status >= 400);
    check('AI providers', 'editing a provider that doesn’t exist is a 4xx', (await post('/api/llm/providers/nope', {})).status >= 400);
    check('AI providers', 'testing a provider that doesn’t exist is a 404', (await post('/api/llm/providers/nope/test', {})).status === 404);
    r = await del('/api/llm/providers/nope');
    check('AI providers', 'deleting a provider that doesn’t exist is a harmless no-op', r.json.success && r.json.removed === false, r.json);

    /* ---------- online tools stay off unless Online tools is on ---------- */
    // "open the best page for X" / "play X on YouTube" open the browser anyway, so these two aren't Online-gated.
    check('Web', 'best-page search needs a query', (await post('/api/tool/webSearch', { q: '' })).status === 400);
    check('Web', 'YouTube top result needs a query', (await post('/api/tool/youtubeTop', { query: '' })).status === 400);
    for (const p of ['/api/tool/weather', '/api/tool/contests', '/api/tool/webAnswer', '/api/tool/research', '/api/tool/fetchPage', '/api/tool/directions', '/api/tool/distance'])
      check('Online', p.replace('/api/tool/', '') + ' refuses when Online tools is off', (await post(p, { query: 'x', city: 'x', url: 'https://example.com', from: 'a', to: 'b' })).status === 403);

    /* ---------- weather (against the fake wttr.in) ---------- */
    r = await post('/api/tool/weather', { city: 'bengaluru', online: true });
    const w = r.json;
    check('Weather', 'current weather is read from the service', w.success && w.tempC === 28 && w.feelsC === 31 && w.desc === 'Partly cloudy' && w.humidity === 70 && w.windKmph === 12, w);
    check('Weather', 'the place is the city you named (not the station suburb), with its state', w.place === 'Bengaluru, Karnataka', w.place);
    check('Weather', 'today’s range and the highest hourly chance of rain', w.minC === 21 && w.maxC === 29 && w.rainChance === 70, w);
    check('Weather', 'tomorrow’s forecast', w.tomorrow && w.tomorrow.minC === 20 && w.tomorrow.maxC === 27 && w.tomorrow.desc === 'Light rain', w.tomorrow);
    check('Weather', 'a named city is never "approximate"', w.approximate === false, w);
    r = await post('/api/tool/weather', { city: '', online: true });
    check('Weather', 'no city and an IP lookup that only found the country → approximate (JARVIS asks for your city)', r.json.success && r.json.approximate === true, r.json);
    r = await post('/api/tool/weather', { city: 'Nowhereville', online: true });
    check('Weather', 'a place the service doesn’t know is an error (the page then searches the web), never a guess', r.status === 502 && /unreachable/i.test(r.json.error || ''), r.json);

    /* ---------- backup ---------- */
    r = await post('/api/backup/export', {});
    check('Backup', 'export a backup', r.json.success && /revise dbms/.test(r.json.content), r.json.error);
    const content = r.json.content;
    check('Backup', 'preview a backup before importing', (await post('/api/backup/preview', { content })).json.success);
    check('Backup', 'a damaged backup is refused', (await post('/api/backup/preview', { content: '{"x":1}' })).status === 400);
    r = await post('/api/backup/import', { content, mode: 'merge' });
    check('Backup', 'import (merge) a backup', r.json.success, r.json);
    check('Backup', 'snapshots list includes the safety snapshot', (await get('/api/backup/snapshots')).json.success);
    rec('POST', '/api/backup/restore');
    check('Backup', 'restoring a snapshot that doesn’t exist is refused', (await S.post('/api/backup/restore', { name: 'nope.json' })).status >= 400);

    /* ---------- reminders fire on the server (tab closed) ---------- */
    await post('/api/state', { set: { 'jarvis.reminders': [{ id: 'rm1', text: 'drink water', at: Date.now() - 1000 }] } });
    let fired = false;
    // The scheduler checks every 15 s (scheduler.js), so allow one full cycle plus a margin.
    for (let i = 0; i < 36 && !fired; i++) { await new Promise(x => setTimeout(x, 500)); fired = /"id":"rm1"[^}]*"fired":true/.test((await S.get('/api/state.js')).text); }
    check('Reminders', 'a due reminder fires on the server, even with no page open', fired);

    /* ---------- phone ---------- */
    check('Phone', 'phone auth status: not configured', (await get('/api/phone/auth')).json.configured === false);
    r = await post('/api/phone/auth/setup', {});
    check('Phone', 'create the authenticator key', r.status === 200 && (await S.get('/api/phone/auth')).json.configured === true, r.json);
    check('Phone', 'a malformed code is rejected', (await post('/api/phone/auth/check', { code: '12' })).json.result === 'bad-format');
    check('Phone', 'a wrong code is rejected', (await post('/api/phone/auth/check', { code: '000000' })).json.result === 'other-key');

    /* ---------- camera pictures: scans, "what is this", room snapshots, word boxes (scan.js / ocr.js; the real-OCR checks are in tests/scan.test.js) ---------- */
    {
      const TINY = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
      const rawPost = async (p, body, site = 'same-origin') => { rec('POST', p); const x = await fetch(S.base + p, { method: 'POST', headers: { Origin: S.base, 'Sec-Fetch-Site': site, 'Content-Type': 'image/jpeg' }, body }); const t = await x.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: x.status, json: j }; };
      const st = (await get('/api/scan/status')).json;
      check('Camera', 'scan status reports what is available', st.success === true && st.maxPages === 20 && typeof st.ocr === 'boolean' && typeof st.vision === 'boolean', st);
      check('Camera', 'a scan page must be a JPEG, and from the laptop page', (await rawPost('/api/scan/page', Buffer.from('this is not a picture, only some text'))).status === 400 && (await rawPost('/api/scan/page', TINY, 'cross-site')).status === 403);
      const pg = await rawPost('/api/scan/page', TINY);
      check('Camera', 'a page is accepted and starts a scan', pg.status === 200 && pg.json.pages === 1 && /^[a-f0-9]{16}$/.test(pg.json.scan), pg.json);
      r = await post('/api/scan/finish', { scan: pg.json.scan, name: 'api scan', ocr: false });
      check('Camera', 'finishing makes a PDF in ~/jarvis/Scans', r.status === 200 && r.json.file === 'Scans/api-scan.pdf' && fs.existsSync(path.join(SB, 'Scans', 'api-scan.pdf')) && r.json.searchable === false, r.json);
      check('Camera', 'finishing needs a scan that exists; discard is harmless', (await post('/api/scan/finish', { scan: 'x' })).status === 404 && (await post('/api/scan/discard', { scan: 'x' })).json.discarded === false);
      check('Camera', 'vision: needs a JPEG; with no AI running it fails with a message', (await post('/api/vision/ask', {})).status === 400 && (await post('/api/vision/ask', { image: TINY.toString('base64'), ocr: false })).status >= 400);
      r = await rawPost('/api/room/snapshot', TINY);
      check('Camera', 'a room snapshot is kept in ~/jarvis/Watch; a non-picture is refused', r.status === 200 && /^Watch\/watch-/.test(r.json.file) && (await rawPost('/api/room/snapshot', Buffer.from('not a picture, just words in a request'))).status === 400, r.json);
      check('Camera', 'OCR with word boxes: needs an image; text that is not a picture is refused', (await post('/api/ocr/words', {})).status === 400 && (await post('/api/ocr/words', { image: Buffer.from('not a picture, only some words').toString('base64') })).status === 400);
      check('Camera', 'plain OCR needs an image; status answers', (await post('/api/ocr/image', {})).status === 400 && (await get('/api/ocr/status')).status === 200);
      check('Camera', 'phone alert: refused from another site, refused when phone alerts are off', (await post('/api/phone/alert', { text: 'x' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403 && (await post('/api/phone/alert', { text: 'Movement seen' })).status === 400);
    }

    /* ---------- chat archive: old chats saved on the laptop, searched by words and dates ---------- */
    {
      const now = Date.now();
      const chat = [{ role: 'user', text: 'Which database should I use for the attendance app?', t: now - 2 * 864e5 }, { role: 'assistant', text: 'Use SQLite: it needs no server.', t: now - 2 * 864e5 + 1000 }, { role: 'user', text: 'What is the capital of France', t: now - 3600e3 }, { role: 'assistant', text: 'Paris.', t: now - 3600e3 + 1000 }];
      check('Chat archive', 'status of a fresh install: empty', (await get('/api/chatarchive/status')).json.messages === 0);
      check('Chat archive', 'every route is for the laptop page only', (await post('/api/chatarchive/append', { items: chat }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403 && (await get('/api/chatarchive/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403 && (await post('/api/chatarchive/search', { text: 'france' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403 && (await post('/api/chatarchive/forget', { confirm: true }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
      check('Chat archive', 'backfill puts the current chat in once; a second backfill is skipped', (await post('/api/chatarchive/backfill', { items: chat })).json.stored === 4 && (await post('/api/chatarchive/backfill', { items: chat })).json.skipped === true);
      check('Chat archive', 'append adds to it; the archive is a dot-folder in ~/jarvis', (await post('/api/chatarchive/append', { items: [{ role: 'user', text: 'Remind me about the database backup', t: now - 60e3 }] })).json.stored === 1 && fs.readdirSync(path.join(S.sandbox, '.chat-archive')).some(f => /^\d{4}-\d{2}\.jsonl$/.test(f)));
      r = await post('/api/chatarchive/search', { text: 'what did I decide about the database last 5 days' });
      check('Chat archive', 'search by words and a date window finds the old chat, not the unrelated one', r.json.success && r.json.total >= 1 && r.json.exchanges.some(e => /SQLite/.test(e.assistant)) && !r.json.exchanges.some(e => /France/.test(e.user)) && r.json.terms.includes('database') && /last 5 days/.test(r.json.window.label), r.text.slice(0, 400));
      check('Chat archive', 'search needs words', (await post('/api/chatarchive/search', { text: ' ' })).status === 400);
      check('Chat archive', 'status counts the messages', (await get('/api/chatarchive/status')).json.messages === 5);
      check('Chat archive', 'forgetting needs an explicit confirm, then erases the folder', (await post('/api/chatarchive/forget', {})).status === 400 && fs.existsSync(path.join(S.sandbox, '.chat-archive')) && (await post('/api/chatarchive/forget', { confirm: true })).json.removed >= 1 && !fs.existsSync(path.join(S.sandbox, '.chat-archive')));
    }

    /* ---------- lecture notes and exam questions (the AI is offline in these tests, so only the refusals and the clean failures are checked here; the passes are in tests/studyserver.test.js) ---------- */
    {
      check('Study', 'lecture notes: too little text is refused; from another site it is refused', (await post('/api/lecture/notes', { transcript: 'hi' })).status === 400 && (await post('/api/lecture/notes', { transcript: 'word '.repeat(60) }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
      r = await post('/api/lecture/notes', { subject: 'DBMS', transcript: 'The lecture explains normalization and transactions in detail. '.repeat(10) });
      check('Study', 'lecture notes: with no AI running it fails with a message, and writes no half-made file', r.status === 502 && typeof r.json.error === 'string' && !fs.existsSync(path.join(S.sandbox, 'Notes')) || r.status === 502 && !fs.readdirSync(path.join(S.sandbox, 'Notes')).some(f => /^lecture-dbms/.test(f)), r.text.slice(0, 200));
      check('Study', 'exam questions: needs a note or a topic; a missing file is "not found"; with no AI a topic fails cleanly', (await post('/api/exam/questions', {})).status === 400 && (await post('/api/exam/questions', { name: 'no-such-note-zz.md' })).status === 404 && (await post('/api/exam/questions', { topic: 'normalization' })).status === 502);
    }

    /* ---------- keep JARVIS running + backup to another folder (nothing is scheduled and nothing is copied here: only status and refusals) ---------- */
    {
      const X = { headers: { 'Sec-Fetch-Site': 'cross-site' } };
      r = await get('/api/keepalive/status');
      check('Keep-alive', 'status answers (supported on Windows, off at first, the interval is 5 minutes)', r.status === 200 && r.json.success === true && (process.platform !== 'win32' || (r.json.supported === true && r.json.on === false && r.json.minutes === 5)), r.text.slice(0, 200));
      check('Keep-alive', 'switching it and acknowledging a restart are refused from another site', (await post('/api/keepalive/set', { on: true }, X)).status === 403 && (await post('/api/keepalive/ack', {}, X)).status === 403);
      r = await get('/api/mirror/status');
      check('Backup', 'status of a fresh install: no folder, not on, not running', r.status === 200 && r.json.dest === null && r.json.enabled === false && r.json.running === false, r.text.slice(0, 200));
      check('Backup', 'every route refuses another site', (await get('/api/mirror/status', X)).status === 403 && (await post('/api/mirror/setdest', { dest: 'D:\\JARVIS-Backup' }, X)).status === 403 && (await post('/api/mirror/run', {}, X)).status === 403 && (await post('/api/mirror/config', { enabled: true }, X)).status === 403);
      check('Backup', 'running with no folder set, a relative path, a whole drive, and turning weekly on with no folder are plain 400s', (await post('/api/mirror/run', {})).status === 400 && (await post('/api/mirror/setdest', { dest: 'backup' })).status === 400 && (await post('/api/mirror/setdest', { dest: 'C:\\' })).status === 400 && (await post('/api/mirror/config', { enabled: true })).status === 400);
      check('Backup', 'a folder inside ~/jarvis (the thing being backed up) is refused', (await post('/api/mirror/setdest', { dest: path.join(S.sandbox, 'Backups') })).status === 400);
      // screenshot search: the test home has no screenshots, so nothing is read
      r = await get('/api/shots/status');
      check('Screenshots', 'status of a computer with no screenshot folder: nothing found, nothing indexed', r.status === 200 && r.json.total === 0 && r.json.indexed === 0 && r.json.running === false && Array.isArray(r.json.folders), r.text.slice(0, 200));
      check('Screenshots', 'every route refuses another site', (await get('/api/shots/status', X)).status === 403 && (await post('/api/shots/update', {}, X)).status === 403 && (await post('/api/shots/search', { q: 'wifi' }, X)).status === 403 && (await post('/api/shots/folders', { add: 'C:\\x' }, X)).status === 403 && (await post('/api/shots/forget', {}, X)).status === 403 && (await post('/api/shots/open', { path: 'C:\\x.png' }, X)).status === 403);
      check('Screenshots', 'search with only filler words is a 400; with real words and an empty index it is an empty list', (await post('/api/shots/search', { q: 'the screenshot' })).status === 400 && (r = await post('/api/shots/search', { q: 'wifi password' })).status === 200 && r.json.results.length === 0);
      check('Screenshots', 'updating with no screenshots found is a plain 404 (or 501 off Windows); a missing or whole-drive folder is refused', [404, 501].includes((await post('/api/shots/update', {})).status) && (await post('/api/shots/folders', { add: path.join(S.sandbox, 'no-such-folder') })).status === 400 && (await post('/api/shots/folders', { add: path.parse(S.sandbox).root })).status === 400);
      check('Screenshots', 'a file that is not in the index cannot be opened, even a real one', (await post('/api/shots/open', { path: path.join(S.sandbox, '.config.json') })).status === 404 && (await post('/api/shots/open', { path: 'C:\\Windows\\notepad.exe' })).status === 404);
      check('Screenshots', 'forgetting an empty index is fine', (await post('/api/shots/forget', {})).json.forgotten === 0);
      // developer helpers: git summary, commit message, error explainer (no AI is called by any of these checks)
      check('Dev tools', 'every route refuses another site', (await post('/api/dev/git/summary', {}, X)).status === 403 && (await post('/api/dev/git/message', {}, X)).status === 403 && (await post('/api/dev/explain', { text: 'TypeError: x is not defined' }, X)).status === 403);
      r = await post('/api/dev/git/summary', { window: 'today' });
      check('Dev tools', 'a git summary with no projects is an empty, successful answer (or a clear 501 if git is missing)', (r.status === 200 && r.json.success === true && Array.isArray(r.json.repos) && r.json.total === 0) || r.status === 501, r.text.slice(0, 200));
      check('Dev tools', 'an unknown project name is a 404 and an unknown window falls back to today', (await post('/api/dev/git/summary', { repo: 'no-such-project-zz' })).status === 404 && (await post('/api/dev/git/message', { repo: 'no-such-project-zz' })).status === 404);
      check('Dev tools', 'a commit message with no project that has changes is a plain 400 (or 501 without git)', [400, 501].includes((await post('/api/dev/git/message', {})).status));
      r = await get('/api/whisper/status');
      check('Offline speech', 'status answers: not installed on a fresh install (no program, no model)', r.status === 200 && r.json.installed === false && r.json.success === true, r.text.slice(0, 200));
      check('Offline speech', 'both routes refuse another site; an empty body is a 400; audio with nothing installed is a clear 501', (await get('/api/whisper/status', X)).status === 403 && (await post('/api/whisper/transcribe', {}, X)).status === 403 && (await post('/api/whisper/transcribe', {})).status === 400);
      { const wavBytes = require('./../wavutil.js').encodeWav(new Float32Array(16000).fill(0.3), 16000); rec('POST', '/api/whisper/transcribe'); const rr = await fetch(S.base + '/api/whisper/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: S.base, 'Sec-Fetch-Site': 'same-origin' }, body: wavBytes }); const rj = await rr.json().catch(() => ({})); check('Offline speech', 'a real WAV with nothing installed is a 501 that says so (and tells which flag)', rr.status === 501 && rj.notInstalled === true && /install-whisper/.test(rj.error || ''), rj); }
      check('Dev tools', 'explain: too little text is a 400, and text that is not an error is a 400', (await post('/api/dev/explain', { text: 'hi' })).status === 400 && (await post('/api/dev/explain', { text: 'what is the capital of france and why' })).status === 400);
    }

    /* ---------- read-only laptop info (real, but changes nothing) ---------- */
    // Real readings are required on a Windows laptop; CI machines and Linux have no audio/brightness/radios, so there
    // the routes are still called (for the gate) but only need to answer without crashing the server.
    const HW = process.platform === 'win32' && !process.env.CI;
    const hw = (ok, x) => HW ? ok : x.status < 600;
    check('Laptop', 'system info (CPU, RAM, disk)', (await get('/api/tool/systemInfo')).json.success);
    check('Laptop', 'battery status', (await post('/api/tool/batteryStatus', {})).json.success);
    check('Laptop', 'which apps are running', Array.isArray((await post('/api/tool/runningApps', { apps: ['chrome', 'notepad'] })).json.running));
    check('Laptop', 'network info', (await post('/api/tool/networkInfo', {})).status === 200);
    check('Laptop', 'process list', (await post('/api/tool/listProcesses', {})).status === 200);
    check('Laptop', 'Wi-Fi info', (await get('/api/sys/wifi')).status < 500 || !HW);
    let x = await post('/api/sys/volume', {});
    check('Laptop', 'read the volume (no change)', hw(typeof x.json.level === 'number', x));
    x = await post('/api/sys/brightness', {});
    check('Laptop', 'read brightness (no change; 501 on desktops without it)', hw([200, 501].includes(x.status), x));
    x = await post('/api/sys/theme', {});
    check('Laptop', 'read the Windows theme (no change)', hw(/light|dark/.test(x.json.mode || ''), x));
    x = await post('/api/sys/powerPlan', {});
    check('Laptop', 'read the power plan (no change)', hw(x.status < 500, x));
    x = await post('/api/sys/radio', { kind: 'bluetooth' });
    check('Laptop', 'read the Bluetooth state (no change)', hw(x.status < 500, x));
    // Changing routes: only input they reject before acting.
    check('Laptop', 'radio refuses an unknown kind', (await post('/api/sys/radio', { kind: 'nfc', state: 'off' })).status === 400);
    check('Laptop', 'closeApplication refuses an app that isn’t allowed', (await post('/api/tool/closeApplication', { app: 'zz-not-an-app-9f3' })).status >= 400);
    check('Laptop', 'setVolume refuses a bad level', (await post('/api/tool/setVolume', { level: 'loud' })).status >= 400);
    check('Laptop', 'deleting outside the sandbox is refused', (await post('/api/tool/deleteItem', { name: 'C:\\Windows\\win.ini' })).status >= 400);

    /* ---------- access zones: open/read anywhere, ask before changing outside ~/jarvis, never the system ---------- */
    {
      const desk = path.join(S.home, 'Desktop'), deskFile = path.join(desk, 'zone-note.txt');
      fs.mkdirSync(path.join(desk, 'zoneproj'), { recursive: true });
      fs.writeFileSync(deskFile, 'desktop words');
      fs.mkdirSync(path.join(S.home, 'AppData', 'Roaming'), { recursive: true }); fs.writeFileSync(path.join(S.home, 'AppData', 'Roaming', 'secret.txt'), 'x');
      fs.mkdirSync(path.join(S.home, '.ssh'), { recursive: true }); fs.writeFileSync(path.join(S.home, '.ssh', 'id_rsa'), 'x');
      let z = await post('/api/tool/readFile', { name: 'zone-note.txt' });
      check('Access', 'reads a file on the Desktop by name, with no setup', z.json.content === 'desktop words', z.json);
      z = await post('/api/tool/readFile', { name: deskFile });
      check('Access', 'reads a Desktop file by full path', z.json.content === 'desktop words', z.json);
      z = await post('/api/tool/listFiles', { dir: 'zoneproj' });
      check('Access', 'lists a Desktop folder by name', z.json.success, z.json);
      for (const [what, p] of [['C:\\Windows\\win.ini', 'C:\\Windows\\win.ini'], ['AppData', path.join(S.home, 'AppData', 'Roaming', 'secret.txt')],
        ['.ssh', path.join(S.home, '.ssh', 'id_rsa')], ['JARVIS’s config', path.join(S.sandbox, '.config.json')]]) {
        z = await post('/api/tool/readFile', { name: p });
        check('Access', 'refuses to read ' + what, z.status >= 400 && !z.json.content, z.json);
      }
      z = await post('/api/tool/writeFile', { name: path.join(S.home, 'AppData', 'Roaming', 'evil.txt'), content: 'x', approved: true });
      check('Access', 'refuses to write into AppData even when approved', z.status >= 400 && !fs.existsSync(path.join(S.home, 'AppData', 'Roaming', 'evil.txt')), z.json);
      z = await post('/api/tool/writeFile', { name: path.join(ROOT, 'zz-evil.js'), content: 'x', approved: true });
      check('Access', 'refuses to write into the JARVIS program folder', z.status >= 400 && !fs.existsSync(path.join(ROOT, 'zz-evil.js')), z.json);

      // Changes outside ~/jarvis: 409 needsApproval, nothing changed; with approved:true it happens.
      z = await post('/api/tool/renameFile', { oldName: deskFile, newName: 'zone-renamed.txt' });
      check('Access', 'rename on the Desktop asks for permission first', z.status === 409 && z.json.needsApproval && fs.existsSync(deskFile), z.json);
      z = await post('/api/tool/renameFile', { oldName: deskFile, newName: 'zone-renamed.txt', approved: true });
      const renamed = path.join(desk, 'zone-renamed.txt');
      check('Access', 'approved rename happens, next to the original', z.json.success && fs.existsSync(renamed) && !fs.existsSync(deskFile), z.json);
      const newFile = path.join(desk, 'zone-new.md');
      z = await post('/api/tool/writeFile', { name: newFile, content: 'hi' });
      check('Access', 'writing a new Desktop file asks first', z.status === 409 && z.json.needsApproval && !fs.existsSync(newFile), z.json);
      z = await post('/api/tool/writeFile', { name: newFile, content: 'hi', approved: true });
      check('Access', 'approved write happens', z.json.success && fs.readFileSync(newFile, 'utf8').includes('hi'), z.json);
      const newDir = path.join(desk, 'zone-dir');
      z = await post('/api/tool/createFolder', { name: newDir });
      check('Access', 'creating a Desktop folder asks first', z.status === 409 && !fs.existsSync(newDir), z.json);
      z = await post('/api/tool/createFolder', { name: newDir, approved: true });
      check('Access', 'approved Desktop folder creation happens', z.json.success && fs.existsSync(newDir), z.json);
      z = await post('/api/tool/createFolder', { name: newDir });
      check('Access', 're-creating an existing Desktop folder needs no approval', z.status === 200 && z.json.existed === true, z.json);
      z = await post('/api/tool/deleteItem', { name: renamed });
      check('Access', 'deleting on the Desktop asks first', z.status === 409 && z.json.needsApproval && fs.existsSync(renamed), z.json);
      z = await post('/api/tool/deleteItem', { name: renamed, approved: true });
      check('Access', 'approved delete goes to JARVIS’s trash', z.json.success && z.json.trashName && !fs.existsSync(renamed), z.json);
      const t = z.json;
      z = await post('/api/tool/restoreItem', { trashName: t.trashName, original: t.original });
      check('Access', 'restoring to the Desktop asks first', z.status === 409 && !fs.existsSync(renamed), z.json);
      z = await post('/api/tool/restoreItem', { trashName: t.trashName, original: t.original, approved: true });
      check('Access', 'approved restore brings the Desktop file back', z.json.success && fs.readFileSync(renamed, 'utf8') === 'desktop words', z.json);

      // ~/jarvis itself never asks.
      z = await post('/api/tool/writeFile', { name: 'Notes/zone-home.md', content: 'home' });
      check('Access', 'writing inside ~/jarvis needs no approval', z.json.success, z.json);
      z = await post('/api/tool/renameFile', { oldName: 'Notes/zone-home.md', newName: 'zone-home2.md' });
      check('Access', 'renaming inside ~/jarvis needs no approval', z.json.success && fs.existsSync(path.join(S.sandbox, 'Notes', 'zone-home2.md')), z.json);
      z = await post('/api/tool/deleteItem', { name: 'Notes/zone-home2.md' });
      check('Access', 'deleting inside ~/jarvis needs no approval', z.json.success, z.json);

      // Same name in two places: the server asks which one (status 300 with choices).
      fs.mkdirSync(path.join(S.home, 'Documents'), { recursive: true });
      fs.writeFileSync(path.join(S.home, 'Documents', 'twin-note.txt'), 'a'); fs.writeFileSync(path.join(desk, 'twin-note.txt'), 'b');
      z = await post('/api/tool/readFile', { name: 'twin-note.txt' });
      check('Access', 'a name found in two places asks which one', z.status === 300 && (z.json.choices || []).length === 2, z.json);
    }

    /* ---------- erase all (guarded; allowed here because Hello isn't enrolled in the temp install) ---------- */
    r = await del('/api/state');
    check('Settings', 'erase all data clears state (after a safety snapshot)', r.json.success && !/revise dbms/.test((await S.get('/api/state.js')).text), r.json);
  } catch (e) {
    // If the server died, its own last words say why.
    check('Harness', 'suite ran to the end', false, e.stack + '\n--- server log (last lines) ---\n' + S.log().split('\n').slice(-15).join('\n'));
  } finally {
    await S.stop();
    wttr.close();
  }

  // Route gate: every declared route is tested here or listed (with a reason) in NOT_TESTABLE.
  const missing = ROUTES.filter(r => !hit.has(r) && !NOT_TESTABLE[r]);
  const stale = Object.keys(NOT_TESTABLE).filter(r => !ROUTES.includes(r));
  check('Coverage', 'every API route is tested or listed as not testable (' + missing.length + ' missing)', !missing.length, missing.join(', '));
  check('Coverage', 'NOT_TESTABLE lists only routes that exist', !stale.length, stale.join(', '));
  process.exit(done(hit.size + ' of ' + ROUTES.length + ' routes called, ' + Object.keys(NOT_TESTABLE).length + ' not testable') ? 1 : 0);
})();
