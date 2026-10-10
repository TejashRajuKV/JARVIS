'use strict';
/* Service watchdog: "is it still up?" for Ollama and for the web pages or ports you ask it to watch (a dev server, a database,
   your own site). Checks on a timer while it is switched on, keeps a short history (uptime %, response time) and tells you ONCE when
   something goes down and once when it comes back. It only ever makes a plain GET to a URL or opens a TCP connection to a
   host:port you gave it, and then closes it. No scanning. Targets are saved in ~/jarvis/.watchdog.json. */
const fs = require('fs');
const path = require('path');
const net = require('net');

const MAX_TARGETS = 20;
const HISTORY = 60;
const MIN_INTERVAL = 30000, DEFAULT_INTERVAL = 120000;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/* ---------- pure helpers ---------- */
const slug = s => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'target';

// "localhost:5000" → a TCP check; "https://my-site.com/health" → a web check. Anything else is refused with a reason.
function parseTarget(input) {
  const raw = String(input || '').trim().replace(/[.,;!?]+$/, '');
  if (!raw) return { error: 'What should I watch? Give a web address or host:port, e.g. localhost:5000.' };
  if (raw.length > 200) return { error: 'That address is too long.' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let u;
    try { u = new URL(raw); } catch { return { error: 'That doesn’t look like a web address.' }; }
    if (!/^https?:$/.test(u.protocol)) return { error: 'I can only watch http and https addresses (or host:port).' };
    if (u.username || u.password) return { error: 'Leave passwords out of the address.' };
    const url = u.href;
    return { target: { kind: 'http', url, label: u.host, id: slug(u.host + u.pathname) } };
  }
  const m = raw.match(/^(\[::1\]|[^\s:/]+):(\d{1,5})$/);
  if (!m) return { error: 'Use a web address (https://…) or host:port, e.g. localhost:5000.' };
  const host = m[1], port = +m[2];
  if (host !== '[::1]' && !HOST_RE.test(host)) return { error: '“' + host + '” isn’t a valid host name.' };
  if (port < 1 || port > 65535) return { error: 'The port must be between 1 and 65535.' };
  return { target: { kind: 'tcp', host: host === '[::1]' ? '::1' : host.toLowerCase(), port, label: host + ':' + port, id: slug(host + '-' + port) } };
}

const blankState = () => ({ up: null, wasUp: false, since: 0, ms: 0, lastCheck: 0, fails: 0, history: [], lastError: '' });

// One check result → the new state, and 'down' / 'up' only when it is worth telling you about:
// down needs 2 failures in a row (one blip is not an outage); "back up" is only said for something that was up before.
function applyResult(st, r, now, downAfter = 2) {
  const s = { ...st, history: [...st.history, !!r.ok].slice(-HISTORY), lastCheck: now };
  let change = null;
  if (r.ok) {
    s.ms = r.ms; s.lastError = ''; s.fails = 0;
    if (st.up === false && st.wasUp) change = 'up';
    if (st.up !== true) { s.up = true; s.since = now; }
    s.wasUp = true;
  } else {
    s.fails = st.fails + 1; s.lastError = String(r.error || 'no answer').slice(0, 120);
    if (st.up === true && s.fails >= downAfter) { s.up = false; s.since = now; change = 'down'; }
    else if (st.up === null) { s.up = false; s.since = now; }          // first look: down, but nothing to announce
  }
  return { state: s, change };
}
const uptime = h => (h.length ? Math.round(100 * h.filter(Boolean).length / h.length) : null);
const dur = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 60 ? m + ' minute' + (m === 1 ? '' : 's') : Math.round(m / 6) / 10 + ' hours'; };

/* ---------- probes (real network; replaceable in tests) ---------- */
async function probeHttp(url, timeoutMs = 5000, f = fetch) {
  const t0 = Date.now();
  try {
    const res = await f(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'JARVIS-watchdog' } });
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch {}
    // any real answer means the service is alive; only a server error (5xx) counts as down
    return res.status < 500 ? { ok: true, ms: Date.now() - t0, status: res.status } : { ok: false, ms: Date.now() - t0, error: 'answered with error ' + res.status };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: /timeout|abort/i.test(e.message) ? 'no answer in ' + timeoutMs / 1000 + ' s' : 'cannot connect' }; }
}
function probeTcp(host, port, timeoutMs = 3000, connect = net.connect) {
  const t0 = Date.now();
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve({ ...r, ms: Date.now() - t0 }); };
    const sock = connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish({ ok: true }));
    sock.once('timeout', () => finish({ ok: false, error: 'no answer in ' + timeoutMs / 1000 + ' s' }));
    sock.once('error', () => finish({ ok: false, error: 'nothing is listening there' }));
  });
}

/* ---------- the watchdog ---------- */
function createWatchdog({ file, OLLAMA, broadcast, probes = {}, intervalMs, setTimer = setInterval, clearTimer = clearInterval, now = Date.now }) {
  const pHttp = probes.http || probeHttp, pTcp = probes.tcp || probeTcp;
  let enabled = false, interval = DEFAULT_INTERVAL, user = [], states = new Map(), timer = null, checking = null;
  const builtins = () => [{ id: 'ollama', label: 'Ollama (local AI)', kind: 'http', url: String(OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '') + '/api/tags', builtin: true }];
  const all = () => builtins().concat(user);
  const stateOf = id => states.get(id) || blankState();

  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      enabled = !!j.enabled; interval = Math.max(MIN_INTERVAL, +j.intervalMs || DEFAULT_INTERVAL);
      user = (Array.isArray(j.targets) ? j.targets : []).map(t => (t && typeof t === 'object' ? parseTarget(t.kind === 'http' ? t.url : t.host + ':' + t.port) : { error: 'junk' }))
        .filter(r => r.target).map(r => r.target).slice(0, MAX_TARGETS);
    } catch {}
  }
  if (intervalMs) interval = Math.max(1, intervalMs);
  const save = () => {
    if (!file) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ enabled, intervalMs: interval, targets: user }, null, 1)); fs.renameSync(tmp, file); } catch {}
  };

  async function checkOne(t) {
    const r = t.kind === 'http' ? await pHttp(t.url) : await pTcp(t.host, t.port);
    const out = applyResult(stateOf(t.id), r, now());
    const before = stateOf(t.id);
    states.set(t.id, out.state);
    if (out.change && typeof broadcast === 'function') {
      try { broadcast({ type: 'watchdog', id: t.id, label: t.label, status: out.change, downForMs: out.change === 'up' ? now() - before.since : 0, ms: r.ms }); } catch {}
    }
    return out.change;
  }
  // Runs every check once (never two rounds at the same time).
  function checkNow() {
    if (checking) return checking;
    checking = Promise.allSettled(all().map(checkOne)).then(() => status()).finally(() => { checking = null; });
    return checking;
  }
  const start = () => { if (timer) return; timer = setTimer(() => { checkNow(); }, interval); if (timer && timer.unref) timer.unref(); };
  const stop = () => { if (timer) { clearTimer(timer); timer = null; } };
  function setEnabled(on) { enabled = !!on; enabled ? start() : stop(); save(); }

  function describe(t) {
    const s = stateOf(t.id);
    return { id: t.id, label: t.label, kind: t.kind, target: t.kind === 'http' ? t.url : t.host + ':' + t.port, builtin: !!t.builtin, up: s.up, since: s.since, ms: s.ms, uptime: uptime(s.history), checks: s.history.length, lastCheck: s.lastCheck, error: s.lastError };
  }
  function status() { return { enabled, intervalMs: interval, targets: all().map(describe), down: all().filter(t => stateOf(t.id).up === false).map(t => t.label) }; }

  function add(input, label) {
    const p = parseTarget(input);
    if (p.error) return { error: p.error };
    const existing = user.find(t => t.id === p.target.id);
    if (existing) return { target: existing, existed: true };
    if (user.length >= MAX_TARGETS) return { error: 'I can watch at most ' + MAX_TARGETS + ' things. Remove one first.' };
    if (label) p.target.label = String(label).replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 60) || p.target.label;
    user.push(p.target); save();
    return { target: p.target };
  }
  function remove(idOrTarget) {
    const q = String(idOrTarget || '').trim().toLowerCase();
    const p = parseTarget(q);
    const t = user.find(x => x.id === q || x.label.toLowerCase() === q || (p.target && x.id === p.target.id));
    if (!t) return builtins().some(b => b.id === q) ? { error: 'Ollama is always watched; you can only switch the watchdog off.' } : { error: 'I’m not watching “' + q.slice(0, 60) + '”.' };
    user = user.filter(x => x !== t); states.delete(t.id); save();
    return { removed: t };
  }
  if (enabled) start();
  return { add, remove, setEnabled, checkNow, status, start, stop, all, isEnabled: () => enabled };
}

/* ---------- routes ---------- */
module.exports = function setupWatchdog(app, { OLLAMA, SANDBOX, probes, file, intervalMs }) {
  const wd = createWatchdog({ file: file || path.join(SANDBOX, '.watchdog.json'), OLLAMA, intervalMs, probes, broadcast: ev => app.locals.broadcast && app.locals.broadcast(ev) });
  // Changing what is watched is done from JARVIS on the laptop, like AI provider settings.
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const laptopOnly = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'Change what I watch from JARVIS on the laptop.' }), false));

  app.get('/api/watch/status', (req, res) => res.json({ success: true, ...wd.status() }));
  app.post('/api/watch/check', async (req, res) => res.json({ success: true, ...(await wd.checkNow()) }));
  app.post('/api/watch/add', async (req, res) => {
    if (!laptopOnly(req, res)) return;
    const r = wd.add((req.body || {}).target, (req.body || {}).label);
    if (r.error) return res.status(400).json({ error: r.error });
    wd.setEnabled(true);
    const st = await wd.checkNow();
    res.json({ success: true, existed: !!r.existed, watching: st.targets.find(t => t.id === r.target.id), enabled: true, intervalMs: st.intervalMs });
  });
  app.post('/api/watch/remove', (req, res) => {
    if (!laptopOnly(req, res)) return;
    const r = wd.remove((req.body || {}).id || (req.body || {}).target);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ success: true, removed: r.removed.label });
  });
  app.post('/api/watch/enable', (req, res) => {
    if (!laptopOnly(req, res)) return;
    wd.setEnabled((req.body || {}).on !== false);
    res.json({ success: true, enabled: wd.isEnabled() });
  });
  return wd;
};
Object.assign(module.exports, { parseTarget, applyResult, uptime, dur, blankState, probeHttp, probeTcp, createWatchdog, slug, MAX_TARGETS, MIN_INTERVAL });
