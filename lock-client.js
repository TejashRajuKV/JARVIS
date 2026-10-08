'use strict';
/* App lock — the page's half (the server's half is applock.js, the lock page is lock.html).
     1. If the server ever answers "locked" (you locked JARVIS, the auto-lock fired, or the server restarted), reload —
        the server then serves the lock page instead of the app.
     2. While the lock is on, real use (typing, clicking, speaking) tells the server you're still here, so the idle
        auto-lock doesn't fire in the middle of work. Background polling deliberately doesn't count.
   Loaded before every other script so the fetch wrapper sees all of their requests. Does nothing when the lock is off. */
(() => {
  const orig = window.fetch.bind(window);
  let reloading = false, active = false, lastPing = 0, pinging = false;
  const relock = () => { if (reloading) return; reloading = true; location.reload(); };

  window.fetch = async function (...args) {
    const r = await orig(...args);
    if (r.status === 401) { try { const j = await r.clone().json(); if (j && j.locked) relock(); } catch (e) {} }
    return r;
  };

  async function ping(force) {
    const now = Date.now();
    if (!active || pinging || (!force && now - lastPing < 20000)) return;
    lastPing = now; pinging = true;
    try { await orig('/api/lock/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {} finally { pinging = false; }
  }
  async function status() {
    try { return await (await orig('/api/lock/status')).json(); } catch (e) { return null; }
  }
  const setActive = v => { active = !!v; if (active) ping(true); };

  // Called by the app: after a command (voice included) and when Settings turns the lock on / off.
  window.__lockPing = () => ping(false);
  window.__lockSetActive = setActive;

  ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => ping(false), { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(false); });

  status().then(s => { if (s && s.locked) relock(); else setActive(s && s.active); });
  // A session that expired while the tab sat idle: show the lock page without waiting for the next click.
  setInterval(async () => { if (!active) return; const s = await status(); if (s && s.locked) relock(); }, 30000);
})();
