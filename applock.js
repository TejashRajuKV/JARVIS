'use strict';
/* App lock: with it on, JARVIS stays closed until you prove it's you with Windows Hello (fingerprint / face / your
   Windows Hello PIN) — the same Windows Hello that approves shutdown and delete (hello.js).

   What "closed" means: the SERVER refuses every /api request (your chat, memory, tasks and every tool) and serves a
   standalone lock page (lock.html) instead of the app, so the app's code doesn't even load. It is not just a cover
   drawn over the page. Unlocking = a signed Windows Hello challenge verified here, which returns a random session
   cookie (HttpOnly, SameSite=Strict, kept only in memory on the server — a restart locks everything again).

   - Auto-lock: after N minutes without activity (the page pings on real use; background polling doesn't count).
   - Lock now: "lock jarvis" / Settings → LOCK NOW.
   - Turning the lock on or off needs a fresh Windows Hello approval (guarded in hello.js, purpose "lock").
   - No lock-out trap: the gate only applies while a Windows Hello key is enrolled. If that entry is ever removed from
     ~/jarvis/.config.json (the documented recovery), the lock is simply off.
   - Reminders, triggers and phone alerts keep running in the background while locked (they never expose data). */
const crypto = require('crypto');
const path = require('path');

const IDLE_CHOICES = [0, 5, 15, 30, 60];   // minutes; 0 = never
const MAX_FAILS = 8, FAIL_WINDOW_MS = 60000;

// The same normalisation Express uses to route (case-insensitive, extra / ignored), so /API/State.js can't slip by.
function norm(p) {
  let raw = String(p || '').split('?')[0];
  try { raw = decodeURIComponent(raw); } catch {}
  return raw.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}
// Reachable while locked: just what's needed to unlock (and for the launcher's "is JARVIS up?" probe).
const OPEN = new Set(['GET /api/health', 'GET /api/lock/status', 'GET /api/hello/status', 'POST /api/hello/challenge', 'POST /api/lock/unlock']);

module.exports = function setupAppLock({ getConfig, saveConfig, getHello, PORT, rootDir }) {
  const COOKIE = 'jarvis_session_' + PORT;   // cookies ignore ports, so two JARVIS copies mustn't share one name
  const sessions = new Map();                // token → { last }
  const fails = [];
  const cfg = () => getConfig().appLock || null;
  const idleMs = () => (cfg() && cfg().idleMin > 0 ? cfg().idleMin * 60000 : 0);
  // Active only while the lock is on AND a Windows Hello key exists to unlock with.
  const active = () => { const c = cfg(); return !!(c && c.enabled && getConfig().hello); };

  const cookieOf = req => {
    const m = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
    return m ? m.slice(COOKIE.length + 1) : '';
  };
  // The caller's live session, or null (unknown token or idle too long).
  function sessionOf(req) {
    const t = cookieOf(req), rec = t && sessions.get(t);
    if (!rec) return null;
    if (idleMs() && Date.now() - rec.last > idleMs()) { sessions.delete(t); return null; }
    return rec;
  }
  const newSession = res => {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { last: Date.now() });
    res.append('Set-Cookie', COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/');
  };

  // Mounted BEFORE the static files and every route.
  function gate(req, res, next) {
    if (!active() || sessionOf(req)) return next();
    const p = norm(req.path), key = req.method.toUpperCase() + ' ' + p;
    // The app page itself → the standalone lock page.
    if (/^(GET|HEAD)$/i.test(req.method) && (p === '/' || p === '/index.html'))
      return res.set('Cache-Control', 'no-store').sendFile(path.join(rootDir, 'lock.html'));
    if (p !== '/api' && !p.startsWith('/api/')) return next();   // app code & images: not data
    if (OPEN.has(key)) return next();
    res.status(401).json({ error: 'JARVIS is locked — unlock with Windows Hello', locked: true });
  }

  // Mounted AFTER hello.js, so its guard (turning the lock on/off needs a Hello approval) runs first.
  function routes(app) {
    app.get('/api/lock/status', (req, res) => {
      const c = cfg();
      res.json({ enabled: !!(c && c.enabled), active: active(), locked: active() && !sessionOf(req), idleMin: c ? c.idleMin || 0 : 0,
        helloEnrolled: !!getConfig().hello, choices: IDLE_CHOICES });
    });

    app.post('/api/lock/unlock', (req, res) => {
      const now = Date.now();
      while (fails.length && now - fails[0] > FAIL_WINDOW_MS) fails.shift();
      if (fails.length >= MAX_FAILS) return res.status(429).set('Retry-After', '60').json({ error: 'Too many failed attempts — wait a minute' });
      const hello = getHello();
      if (!active() || !hello) return res.json({ success: true, unlocked: true, note: 'the lock is off' });
      const bad = hello.verifyChallenge(req.body || {}, 'unlock');
      if (bad) { fails.push(now); return res.status(bad.status).json({ error: bad.error }); }
      newSession(res);
      res.json({ success: true, unlocked: true });
    });

    // Real activity (typing, clicking, speaking): keeps the session alive. Background polling does NOT call this.
    app.post('/api/lock/ping', (req, res) => {
      const s = sessionOf(req);
      if (s) s.last = Date.now();
      res.json({ success: true, active: active(), idleMin: cfg() ? cfg().idleMin || 0 : 0 });
    });

    // On (or change the auto-lock time). Guarded by hello.js: needs a fresh Windows Hello approval.
    app.post('/api/lock/enable', (req, res) => {
      if (!getConfig().hello) return res.status(400).json({ error: 'Set up Windows Hello first (Settings → Data → Windows Hello)', needHelloSetup: true });
      const idleMin = Number((req.body || {}).idleMin);
      const chosen = IDLE_CHOICES.includes(idleMin) ? idleMin : 15;
      getConfig().appLock = { enabled: true, idleMin: chosen, enabledAt: cfg() ? cfg().enabledAt : Date.now() };
      saveConfig();
      newSession(res);   // you just proved it's you — don't lock the person who turned it on out of their own page
      res.json({ success: true, enabled: true, idleMin: chosen });
    });

    // Off. Guarded by hello.js.
    app.post('/api/lock/disable', (req, res) => {
      delete getConfig().appLock; saveConfig(); sessions.clear();
      res.json({ success: true, enabled: false });
    });

    // Lock now (everywhere): no approval needed to close JARVIS.
    app.post('/api/lock/lock', (req, res) => {
      sessions.clear();
      res.json({ success: true, locked: active() });
    });
  }
  return { gate, routes, active, norm };
};
module.exports.norm = norm;
module.exports.IDLE_CHOICES = IDLE_CHOICES;
