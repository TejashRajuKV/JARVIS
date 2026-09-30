// One JARVIS per user: a second start reuses the running one; stale locks are replaced; other tabs hear about chat
// changes; ntfy sending stays inside the service's limits. Everything runs on isolated servers (temp home folders).
// Run: node tests/instance.test.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { startServer, suite, freePort, ROOT } = require('./lib/server');
const { check, done } = suite('instance');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A raw `node server.js` in an existing home, the way an AI tool or a terminal would start it.
function rawStart(home, env = {}) {
  return freePort().then(port => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PORT: String(port), USERPROFILE: home, HOME: home, HOMEDRIVE: '', HOMEPATH: '', OLLAMA_URL: 'http://127.0.0.1:9', JARVIS_TEST: '1' }, env) });
    let out = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; });
    const exited = new Promise(r => child.once('exit', code => r(code)));
    return { child, port, out: () => out, exited };
  });
}
const health = async port => { try { const r = await fetch('http://localhost:' + port + '/api/health'); return r.ok ? await r.json() : null; } catch { return null; } };
const readLock = home => { try { return JSON.parse(fs.readFileSync(path.join(home, 'jarvis', '.jarvis.lock'), 'utf8')); } catch { return null; } };
const ok = h => h && h.status === 'online';

(async () => {
  const cleanup = [];
  try {
    /* ---------- a second start reuses the running one ---------- */
    const A = await startServer({ keepHome: true }); cleanup.push(() => A.stop());
    const hA = await health(A.port);
    check('Lock', 'the first server records itself (pid and port) in ~/jarvis/.jarvis.lock', readLock(A.home) && readLock(A.home).pid === hA.pid && readLock(A.home).port === A.port, readLock(A.home));
    check('Lock', 'it also writes the pid and port files the launcher and Stop JARVIS use', fs.readFileSync(path.join(A.home, 'jarvis', '.jarvis.pid'), 'utf8').trim() === String(hA.pid) && fs.readFileSync(path.join(A.home, 'jarvis', '.jarvis-port'), 'utf8').trim() === String(A.port));

    const B = await rawStart(A.home);
    const code = await Promise.race([B.exited, sleep(15000).then(() => 'timeout')]);
    check('Lock', 'a second `node server.js` in the same home exits at once with code 0', code === 0, code);
    check('Lock', 'it says where the running JARVIS is', B.out().includes('already running at http://localhost:' + A.port), B.out());
    check('Lock', 'it never listened on its own port', !(await health(B.port)));
    check('Lock', 'the first server is untouched and still holds the lock', ok(await health(A.port)) && readLock(A.home).pid === hA.pid);

    /* ---------- a lock left by a crash is replaced ---------- */
    await A.stop();   // killed hard on Windows: no exit handler, so the lock may still be there
    const dead = spawn(process.execPath, ['-e', '0']); await new Promise(r => dead.once('exit', r));
    fs.mkdirSync(path.join(A.home, 'jarvis'), { recursive: true });
    fs.writeFileSync(path.join(A.home, 'jarvis', '.jarvis.lock'), JSON.stringify({ pid: dead.pid, port: 3999, started: new Date().toISOString() }));
    const C = await startServer({ home: A.home, keepHome: true }); cleanup.push(() => C.stop());
    const hC = await health(C.port);
    check('Lock', 'a stale lock (its process is gone) is replaced and the server starts', ok(hC) && readLock(A.home).pid === hC.pid && readLock(A.home).port === C.port, readLock(A.home));

    /* ---------- escape hatch and isolation ---------- */
    const D = await rawStart(A.home, { JARVIS_ALLOW_MULTI: '1' }); cleanup.push(() => { D.child.kill(); });
    for (let i = 0; i < 40 && !(await health(D.port)); i++) await sleep(250);
    check('Lock', 'JARVIS_ALLOW_MULTI=1 lets a second copy run on purpose', ok(await health(D.port)) && ok(await health(C.port)));
    D.child.kill();
    const E = await startServer(); cleanup.push(() => E.stop());
    check('Lock', 'servers with different home folders (the test setup) coexist', ok(await health(E.port)) && ok(await health(C.port)));

    /* ---------- chat changes reach other tabs ---------- */
    const base = 'http://localhost:' + C.port, hdr = { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'same-origin' };
    const ctrl = new AbortController();
    const es = await fetch(base + '/api/events', { headers: hdr, signal: ctrl.signal });
    let seen = ''; (async () => { try { for await (const ch of es.body) seen += Buffer.from(ch).toString(); } catch {} })();
    await sleep(300);
    const msgs = [{ role: 'user', text: 'hello from tab A', t: Date.now() }];
    await fetch(base + '/api/state', { method: 'POST', headers: hdr, body: JSON.stringify({ src: 'tabA', set: { 'jarvis.chat': msgs } }) });
    for (let i = 0; i < 20 && !/event: state/.test(seen); i++) await sleep(100);
    const m = /event: state\ndata: (.+)\n/.exec(seen); const ev = m ? JSON.parse(m[1]) : null;
    check('Tabs', 'saving the chat pushes a `state` event to other open tabs', ev && ev.key === 'jarvis.chat' && ev.value[0].text === 'hello from tab A', seen.slice(0, 300));
    check('Tabs', 'the event names the writing tab, so it can ignore its own change', ev && ev.src === 'tabA', ev);
    seen = '';
    await fetch(base + '/api/state', { method: 'POST', headers: hdr, body: JSON.stringify({ src: 'tabA', set: { 'jarvis.todos': [] } }) });
    await sleep(400);
    check('Tabs', 'other data changes are not broadcast as chat', !/event: state/.test(seen), seen.slice(0, 200));
    ctrl.abort();

    /* ---------- a clean quit releases the lock ---------- */
    await fetch(base + '/api/quit', { method: 'POST', headers: hdr, body: '{}' });
    for (let i = 0; i < 40 && await health(C.port); i++) await sleep(150);   // it quits by itself after a moment
    for (let i = 0; i < 20 && readLock(A.home); i++) await sleep(150);
    check('Lock', 'quitting JARVIS removes the lock', !readLock(A.home), readLock(A.home));

    /* ---------- ntfy: one at a time, no repeats, pause on 429 ---------- */
    let posts = [], mode = 429;
    const fake = http.createServer((req, res) => {
      if (req.method === 'POST') { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { posts.push({ at: Date.now(), body: JSON.parse(b || '{}') }); if (mode === 429) { res.writeHead(429, { 'Retry-After': '2' }); res.end('{}'); } else { res.writeHead(200); res.end('{}'); } }); return; }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.write('{"event":"open"}\n');   // the phone stream: stays open
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r)); cleanup.push(() => fake.close());
    const N = await startServer({ env: { NTFY_URL: 'http://127.0.0.1:' + fake.address().port, NTFY_MIN_PAUSE_MS: '1000' } }); cleanup.push(() => N.stop());
    await N.post('/api/state', { set: { 'jarvis.settings': { phonePush: true, phoneTopic: 'jarvis-test-topic-1' } } });
    const reply = t => N.post('/api/phone/reply', { text: t });
    await reply('first'); await reply('second'); await reply('third');
    check('ntfy', 'after a 429 from ntfy, later messages are held back instead of retried', posts.length === 1, posts.length);
    mode = 200; posts = [];
    await sleep(2600);   // the pause (Retry-After 2 s, minimum 1 s here) is over
    await reply('same text'); await reply('same text');
    check('ntfy', 'an identical reply sent twice within 30 s goes out once', posts.length === 1, posts.length);
    await reply('other text'); await reply('another one');
    const gaps = posts.slice(1).map((p, i) => p.at - posts[i].at);
    check('ntfy', 'messages are sent one at a time, at least a second apart', posts.length === 3 && gaps.every(g => g >= 950), gaps);
  } catch (e) {
    check('Harness', 'suite ran to the end', false, e.stack);
  } finally {
    for (const f of cleanup.reverse()) { try { await f(); } catch {} }
  }
  process.exit(done('') ? 1 : 0);
})();
