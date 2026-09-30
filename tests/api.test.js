// Server API tests: every /api route of a REAL server.js, started isolated (temp home, no AI — tests/lib/server.js).
// Nothing here touches your own ~/jarvis, and nothing acts on the laptop: routes that would (volume, apps, power,
// clipboard, keyboard…) are only called with input the route rejects before acting, or are listed in NOT_TESTABLE
// with the reason — they are covered by the page self-test with fakes, and by `npm run test:live`.
// A gate at the end fails if any route exists that is neither tested nor listed. Run: node tests/api.test.js
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
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
  'POST /api/tool/screenshot': 'captures your screen', 'POST /api/sys/screenRead': 'OCRs your screen',
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
};

// Every route declared in the server files, as "METHOD /path" with :params, for the gate.
const ROUTE_FILES = ['server.js', 'system-tools.js', 'agent-tools.js', 'rag.js', 'skills.js', 'scheduler.js', 'backup.js', 'codetools.js',
  'hotkey.js', 'hello.js', 'llm.js', 'update.js', 'tts.js', 'autostart.js', 'wakeword.js'];
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
  const S = await startServer({ env: { GIT_AUTHOR_NAME: 'JARVIS test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'JARVIS test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    JARVIS_WTTR_URL: wttr.url } });
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
    for (const p of ['/api/skill/viva/grade', '/api/skill/coach', '/api/skill/fix', '/api/skill/site', '/api/skill/siteEdit', '/api/skill/siteRevert']) {
      const x = await post(p, {});
      check('Skills', p.replace('/api/skill/', '') + ': missing input gets a plain 4xx message', x.status >= 400 && x.status < 500 && typeof x.json.error === 'string', x.status + ' ' + x.text);
    }
    r = await post('/api/skill/viva/questions', { topic: 'DBMS' });
    check('Skills', 'viva questions with the AI offline: a clean error, not a crash', r.status >= 400 && typeof r.json.error === 'string', r.status + ' ' + r.text);
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
