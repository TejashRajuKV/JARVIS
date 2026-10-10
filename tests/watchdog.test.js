// Service watchdog (watchdog.js): what may be watched, when an alert is worth sending, the real probes, saving, the routes.
// Run: node tests/watchdog.test.js
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const W = require(path.join(__dirname, '..', 'watchdog.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- parseTarget ---------- */
{
  const p = t => W.parseTarget(t);
  let r = p('localhost:5000');
  check('target: host:port is a TCP check', r.target && r.target.kind === 'tcp' && r.target.host === 'localhost' && r.target.port === 5000 && r.target.label === 'localhost:5000' && r.target.id === 'localhost-5000', r);
  r = p('https://my-site.com/health');
  check('target: a URL is a web check', r.target && r.target.kind === 'http' && r.target.url === 'https://my-site.com/health' && r.target.label === 'my-site.com', r);
  check('target: http works too, trailing punctuation is dropped', p('http://localhost:3000.').target.url === 'http://localhost:3000/');
  check('target: IPv4 and IPv6 loopback', p('127.0.0.1:8080').target.host === '127.0.0.1' && p('[::1]:8080').target.host === '::1');
  check('target: host names are lower-cased', p('MyServer.local:22').target.host === 'myserver.local');
  for (const bad of ['', '   ', 'localhost', 'localhost:', ':5000', 'localhost:0', 'localhost:70000', 'local host:80', 'bad_host:80', 'a:b:80', 'javascript:alert(1)', 'file:///c:/windows/win.ini', 'ftp://example.com/x', 'data:text/html,hi', 'https://user:pw@example.com/', 'x'.repeat(250), 'localhost:80/path', '../../etc:80', 'http://']) {
    check('target: refused: ' + JSON.stringify(bad.slice(0, 40)), !!p(bad).error && !p(bad).target, p(bad));
  }
  check('target: every refusal says what to do instead', p('nonsense').error.length > 20);
}

/* ---------- applyResult: when an alert is worth sending ---------- */
{
  const run = (steps) => { let st = W.blankState(), t = 1000; const changes = []; for (const ok of steps) { const o = W.applyResult(st, ok ? { ok: true, ms: 10 } : { ok: false, error: 'nothing is listening there' }, t += 1000); st = o.state; changes.push(o.change); } return { st, changes }; };
  let r = run([true, true, true]);
  check('state: staying up never alerts', r.st.up === true && r.changes.every(c => c === null) && r.st.fails === 0);
  r = run([true, false]);
  check('state: one failed check is a blip, not an outage', r.st.up === true && r.changes[1] === null && r.st.fails === 1);
  r = run([true, false, false]);
  check('state: two failures in a row → "down", once', r.st.up === false && r.changes[2] === 'down' && r.changes.filter(c => c === 'down').length === 1);
  r = run([true, false, false, false, false]);
  check('state: staying down does not repeat the alert', r.changes.filter(Boolean).length === 1 && r.st.up === false);
  r = run([true, false, false, true]);
  check('state: coming back → "up", once', r.changes[3] === 'up' && r.st.up === true && r.st.fails === 0);
  r = run([true, false, true, false, true]);
  check('state: flapping single blips never alert', r.changes.every(c => c === null));
  r = run([false]);
  check('state: down on the first look is recorded without an alert', r.st.up === false && r.changes[0] === null);
  r = run([false, false, true]);
  check('state: something that was never up does not announce "back up"', r.changes.every(c => c === null) && r.st.up === true);
  r = run([false, true, false, false, true]);
  check('state: …but once it has been up, going down and back is announced', r.changes[3] === 'down' && r.changes[4] === 'up');
  const many = run(Array.from({ length: 100 }, () => true));
  check('state: history is capped', many.st.history.length === 60);
  check('uptime: percentage over the history', W.uptime([true, true, true, false]) === 75 && W.uptime([]) === null && W.uptime([false]) === 0);
  check('state: the last error is kept and cleared', run([false]).st.lastError === 'nothing is listening there' && run([false, true]).st.lastError === '');
  check('duration wording', W.dur(20000) === 'under a minute' && W.dur(5 * 60000) === '5 minutes' && W.dur(60000) === '1 minute' && /hours/.test(W.dur(90 * 60000)));
}

/* ---------- the real probes, against real local servers ---------- */
(async () => {
  const srv = http.createServer((q, res) => {
    if (q.url === '/ok') { res.writeHead(200); return res.end('hi'); }
    if (q.url === '/missing') { res.writeHead(404); return res.end('no'); }
    if (q.url === '/boom') { res.writeHead(500); return res.end('x'); }
    if (q.url === '/redirect') { res.writeHead(302, { Location: 'http://example.invalid/' }); return res.end(); }
    if (q.url === '/slow') return;                                  // never answers
    res.writeHead(200); res.end('root');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  let r = await W.probeHttp(base + '/ok');
  check('probe http: 200 is up, with a response time', r.ok && r.status === 200 && r.ms >= 0, r);
  check('probe http: 404 still means the server is alive', (await W.probeHttp(base + '/missing')).ok);
  check('probe http: a redirect is not followed and counts as alive', (await W.probeHttp(base + '/redirect')).ok);
  r = await W.probeHttp(base + '/boom');
  check('probe http: 500 is down, and says why', !r.ok && /error 500/.test(r.error), r);
  r = await W.probeHttp(base + '/slow', 300);
  check('probe http: no answer in time is down', !r.ok && /no answer in 0.3 s/.test(r.error) && r.ms >= 250 && r.ms < 3000, r);
  const dead = net.createServer(); await new Promise(res => dead.listen(0, '127.0.0.1', res)); const deadPort = dead.address().port; await new Promise(res => dead.close(res));
  r = await W.probeHttp('http://127.0.0.1:' + deadPort + '/');
  check('probe http: nothing listening → cannot connect', !r.ok && r.error === 'cannot connect', r);

  const tcp = net.createServer(s => s.end()); await new Promise(res => tcp.listen(0, '127.0.0.1', res));
  r = await W.probeTcp('127.0.0.1', tcp.address().port);
  check('probe tcp: an open port is up', r.ok && r.ms >= 0, r);
  r = await W.probeTcp('127.0.0.1', deadPort);
  check('probe tcp: a closed port is down', !r.ok && /nothing is listening/.test(r.error), r);
  const fakeSock = new (require('events'))(); fakeSock.setTimeout = ms => setTimeout(() => fakeSock.emit('timeout'), 20); fakeSock.destroy = () => {};
  r = await W.probeTcp('10.255.255.1', 80, 50, () => fakeSock);
  check('probe tcp: a silent host times out', !r.ok && /no answer/.test(r.error), r);
  tcp.close();

  /* ---------- the watchdog, with fake probes and a fake clock ---------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-'));
  const f = path.join(tmp, 'x', '.watchdog.json');
  let clock = 1_000_000; const up = { ollama: true, 'localhost-5000': true, 'my-site-com': true };
  const events = [], checked = [];
  const probes = { http: async url => { checked.push(url); const id = /11434/.test(url) ? 'ollama' : 'my-site-com'; return up[id] ? { ok: true, ms: 12 } : { ok: false, ms: 5000, error: 'cannot connect' }; },
    tcp: async (h, p) => { checked.push(h + ':' + p); return up['localhost-' + p] ? { ok: true, ms: 1 } : { ok: false, ms: 1, error: 'nothing is listening there' }; } };
  const timers = [];
  const mkWd = () => W.createWatchdog({ file: f, OLLAMA: 'http://127.0.0.1:11434', broadcast: e => events.push(e), probes, setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; }, clearTimer: t => { t.cleared = true; }, now: () => clock });
  let wd = mkWd();
  check('watchdog: starts off, watching only Ollama', !wd.isEnabled() && wd.status().targets.length === 1 && wd.status().targets[0].builtin && wd.status().targets[0].up === null);
  let a = wd.add('localhost:5000'); wd.add('https://my-site.com');
  check('add: targets listed, the same target twice is one', a.target.id === 'localhost-5000' && wd.add('LOCALHOST:5000').existed && wd.status().targets.length === 3);
  check('add: a custom label is cleaned', wd.add('db.local:5432', 'My\nDB\x00 ' + 'x'.repeat(100)).target.label.length <= 60 && !/[\n\x00]/.test(wd.status().targets.find(t => t.id === 'db-local-5432').label));
  check('add: refused input gives the reason', /host:port/.test(wd.add('nonsense').error));
  wd.remove('db-local-5432');
  let st = await wd.checkNow();
  check('check: every target is probed once and reported', st.targets.every(t => t.up === true && t.ms >= 0 && t.uptime === 100 && t.checks === 1) && checked.length === 3, st);
  check('check: the first look raises no alert', events.length === 0);
  up['localhost-5000'] = false; clock += 60000; await wd.checkNow();
  check('alert: one failed check is not an outage yet', events.length === 0 && wd.status().targets.find(t => t.id === 'localhost-5000').up === true);
  clock += 60000; st = await wd.checkNow();
  check('alert: the second failure sends one "down" with the label', events.length === 1 && events[0].type === 'watchdog' && events[0].status === 'down' && events[0].label === 'localhost:5000' && st.down.join() === 'localhost:5000', events);
  clock += 60000; await wd.checkNow(); clock += 60000; await wd.checkNow();
  check('alert: still down, no repeats', events.length === 1);
  up['localhost-5000'] = true; clock += 120000; await wd.checkNow();
  check('alert: coming back sends one "up" with how long it was down', events.length === 2 && events[1].status === 'up' && events[1].downForMs === 240000, events[1]);
  check('status: uptime reflects the outage', wd.status().targets.find(t => t.id === 'localhost-5000').uptime < 100);
  up.ollama = false; clock += 1000; await wd.checkNow(); clock += 1000; await wd.checkNow();
  check('alert: Ollama is watched like anything else', events.some(e => e.id === 'ollama' && e.status === 'down'));
  up.ollama = true;
  let calls = 0;
  const once = W.createWatchdog({ file: null, OLLAMA: 'http://x', now: () => clock, probes: { http: async () => ({ ok: true, ms: 1 }), tcp: async () => { calls++; await new Promise(r => setTimeout(r, 50)); return { ok: true, ms: 1 }; } } });
  once.add('a.local:1');
  await Promise.all([once.checkNow(), once.checkNow()]);
  check('check: two rounds at once run only once', calls === 1, calls);
  await once.checkNow();
  check('check: …and the next round runs normally', calls === 2);
  events.length = 0;
  const brokenBroadcast = W.createWatchdog({ file: null, OLLAMA: 'http://x', broadcast: () => { throw new Error('boom'); }, probes: { http: async () => ({ ok: true, ms: 1 }), tcp: async () => ({ ok: false, ms: 1, error: 'x' }) }, now: () => clock });
  brokenBroadcast.add('localhost:1'); await brokenBroadcast.checkNow(); await brokenBroadcast.checkNow();
  check('alert: a failing alert channel never breaks the watchdog', brokenBroadcast.status().down.includes('localhost:1'));

  // switching on/off and the timer
  timers.length = 0;
  wd.setEnabled(true);
  check('enable: starts one timer at the interval', timers.length === 1 && timers[0].ms === 120000 && wd.isEnabled());
  wd.setEnabled(true);
  check('enable: twice does not start two', timers.length === 1);
  wd.setEnabled(false);
  check('disable: the timer is stopped', timers[0].cleared === true && !wd.isEnabled());

  // saving and loading
  wd.setEnabled(true);
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
  check('saved: enabled flag, interval and only the targets you added (no Ollama, no history)', saved.enabled === true && saved.targets.length === 2 && saved.targets.every(t => !t.builtin) && !('history' in saved.targets[0]) && !fs.existsSync(f + '.tmp'), saved);
  timers.length = 0;
  const wd2 = mkWd();
  check('load: the same targets come back, and it starts itself because it was on', wd2.status().targets.length === 3 && wd2.isEnabled() && timers.length === 1);
  fs.writeFileSync(f, JSON.stringify({ enabled: true, intervalMs: 5, targets: [{ kind: 'tcp', host: 'ok.local', port: 22 }, { kind: 'tcp', host: 'bad host', port: 22 }, { kind: 'http', url: 'file:///etc/passwd' }, 'junk', null] }));
  const wd3 = mkWd();
  check('load: a hand-edited file keeps only valid targets, and the interval has a floor', wd3.status().targets.length === 2 && wd3.status().intervalMs === W.MIN_INTERVAL, wd3.status());
  fs.writeFileSync(f, '{ broken');
  check('load: a damaged file is ignored', mkWd().status().targets.length === 1);

  // removing
  const r1 = wd.remove('localhost:5000'), r2 = wd.remove('nope'), r3 = wd.remove('ollama');
  check('remove: by name; unknown and the built-in are refused with a reason', r1.removed && r1.removed.label === 'localhost:5000' && /not watching/.test(r2.error) && /always watched/.test(r3.error));
  check('remove: its history goes with it', !wd.status().targets.some(t => t.id === 'localhost-5000'));
  // the cap
  const capWd = W.createWatchdog({ file: null, OLLAMA: 'http://x', probes, now: () => clock });
  for (let i = 1; i <= W.MAX_TARGETS; i++) capWd.add('h' + i + '.local:80');
  check('cap: at most 20 targets', capWd.status().targets.length === W.MAX_TARGETS + 1 && /at most 20/.test(capWd.add('extra.local:80').error));

  /* ---------- routes ---------- */
  const routes = {};
  const app = { locals: { broadcast: e => events.push(e) }, get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const rf = path.join(tmp, 'routes.json');
  W(app, { OLLAMA: 'http://127.0.0.1:11434', SANDBOX: tmp, file: rf, probes });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (key, req) => { let out, code = 200; await routes[key]({ headers: {}, body: {}, ...req }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
  r = await call('GET /api/watch/status');
  check('route: status is open and lists Ollama', r.success && r.enabled === false && r.targets[0].id === 'ollama');
  check('route: adding from anywhere but the laptop page is refused', (await call('POST /api/watch/add', { body: { target: 'localhost:5000' } })).code === 403 && (await call('POST /api/watch/add', { headers: { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' }, body: { target: 'localhost:5000' } })).code === 403 && (await call('POST /api/watch/add', { headers: { 'sec-fetch-site': 'same-origin', host: '192.168.1.5:3001' }, body: { target: 'localhost:5000' } })).code === 403);
  for (const k of ['remove', 'enable']) check('route: ' + k + ' is laptop-only too', (await call('POST /api/watch/' + k, { body: {} })).code === 403);
  r = await call('POST /api/watch/add', { headers: LAPTOP, body: { target: 'localhost:5000', label: 'My app' } });
  check('route: add watches it, switches the watchdog on and checks right away', r.success && r.enabled && r.watching.label === 'My app' && r.watching.up === true && r.watching.checks === 1, r);
  check('route: a bad target is a 400 with the reason', (await call('POST /api/watch/add', { headers: LAPTOP, body: { target: 'file:///x' } })).code === 400);
  r = await call('POST /api/watch/check', {});
  check('route: check runs a round now', r.success && r.targets.find(t => t.id === 'localhost-5000').checks === 2);
  r = await call('POST /api/watch/remove', { headers: LAPTOP, body: { target: 'My app' } });
  check('route: remove by the label you gave', r.success && r.removed === 'My app');
  check('route: remove of something unknown is a 404', (await call('POST /api/watch/remove', { headers: LAPTOP, body: { target: 'nothing' } })).code === 404);
  r = await call('POST /api/watch/enable', { headers: LAPTOP, body: { on: false } });
  check('route: switch off', r.success && r.enabled === false && JSON.parse(fs.readFileSync(rf, 'utf8')).enabled === false);

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`watchdog: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
