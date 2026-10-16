// The page half of the app lock (lock-client.js): reload when the server says "locked", keep the session alive only on real use, throttle the pings. Fake browser, no server. Run: node tests/lockclient.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

function boot({ status = { locked: false, active: true } } = {}) {
  const log = { fetches: [], reloads: 0, listeners: {}, docListeners: {}, intervals: [] };
  let clock = 1000000;
  const respond = (body, st = 200) => ({ status: st, ok: st < 400, json: async () => body, clone() { return this; } });
  const routes = { '/api/lock/status': () => respond(status), '/api/lock/ping': () => respond({ ok: true }), '/api/x': () => respond({ locked: true }, 401), '/api/y': () => respond({ error: 'nope' }, 401), '/api/z': () => respond({ fine: 1 }) };
  const win = { fetch: async (u, o) => { log.fetches.push([u, o && o.method]); return (routes[u] || routes['/api/z'])(); }, addEventListener: (ev, fn) => { (log.listeners[ev] = log.listeners[ev] || []).push(fn); } };
  win.window = win;
  const ctx = vm.createContext({ window: win, document: { hidden: false, addEventListener: (ev, fn) => { (log.docListeners[ev] = log.docListeners[ev] || []).push(fn); } }, location: { reload: () => { log.reloads++; } },
    addEventListener: win.addEventListener, setInterval: (fn, ms) => { log.intervals.push([fn, ms]); return 1; }, Date: { now: () => clock }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lock-client.js'), 'utf8'), ctx);
  return { win, log, routes, tick: ms => { clock += ms; }, pings: () => log.fetches.filter(f => f[0] === '/api/lock/ping').length, flush: () => new Promise(r => setTimeout(r, 15)), fire: (ev) => (log.listeners[ev] || []).forEach(fn => fn({})) };
}

(async () => {
  // lock off: nothing is pinged, nothing reloads
  let b = boot({ status: { locked: false, active: false } }); await b.flush();
  b.fire('keydown'); b.fire('pointerdown'); await b.flush();
  check('lock off: typing and clicking never ping the server', b.pings() === 0);
  check('lock off: no reload', b.log.reloads === 0);
  check('lock off: it asked for the lock status once at start', b.log.fetches.filter(f => f[0] === '/api/lock/status').length === 1);

  // a normal 401 (not a lock) and a normal response pass through untouched
  let r = await b.win.fetch('/api/y'); await b.flush();
  check('a 401 that is not "locked" (e.g. a phone-only route) does not reload the page', r.status === 401 && b.log.reloads === 0);
  r = await b.win.fetch('/api/z'); check('an ordinary response is returned unchanged', r.status === 200 && (await r.json()).fine === 1);

  // the server says locked on any request → reload, once
  r = await b.win.fetch('/api/x'); await b.flush();
  check('a "locked" answer to any request reloads the page (the server then shows the lock page)', b.log.reloads === 1);
  await b.win.fetch('/api/x'); await b.win.fetch('/api/x'); await b.flush();
  check('…but only once, however many requests are refused at the same time', b.log.reloads === 1, b.log.reloads);

  // started while locked → reload straight away
  b = boot({ status: { locked: true, active: true } }); await b.flush();
  check('opened while the server says locked: reloads at once', b.log.reloads === 1);

  // lock on: real use pings, throttled
  b = boot({ status: { locked: false, active: true } }); await b.flush();
  check('lock on: it pings once straight away when it learns the lock is active', b.pings() === 1, b.pings());
  b.fire('keydown'); b.fire('pointermove'); b.fire('wheel'); await b.flush();
  check('lock on: a burst of activity right after is throttled (20 s) — still one ping', b.pings() === 1, b.pings());
  b.tick(21000); b.fire('pointerdown'); await b.flush();
  check('lock on: activity 21 s later pings again', b.pings() === 2, b.pings());
  b.tick(5000); b.win.__lockPing(); await b.flush();
  check('lock on: the app\'s own "I ran a command" ping is throttled the same way', b.pings() === 2, b.pings());
  b.tick(30000); b.win.__lockPing(); await b.flush();
  check('lock on: …and goes through after the throttle', b.pings() === 3, b.pings());
  const posts = b.log.fetches.filter(f => f[0] === '/api/lock/ping').every(f => f[1] === 'POST');
  check('pings are POSTs', posts);
  const kinds = Object.keys(b.log.listeners).sort().join();
  check('it listens for keyboard, pointer, wheel and touch use (and nothing like timers or polling counts as activity)', kinds === 'keydown,pointerdown,pointermove,touchstart,wheel', kinds);
  b.tick(25000); (b.log.docListeners.visibilitychange || []).forEach(fn => fn()); await b.flush();
  check('coming back to the tab counts as use', b.pings() === 4, b.pings());

  // the app turns it on/off from Settings
  b = boot({ status: { locked: false, active: false } }); await b.flush();
  b.win.__lockSetActive(true); await b.flush();
  check('Settings turning the lock on starts pinging at once', b.pings() === 1);
  b.win.__lockSetActive(false); b.tick(60000); b.fire('keydown'); await b.flush();
  check('Settings turning it off stops the pings', b.pings() === 1);

  // the 30-second check: a session that expired while the tab sat idle
  b = boot({ status: { locked: false, active: true } }); await b.flush();
  const [fn, ms] = b.log.intervals[0] || [];
  check('it re-checks the lock every 30 seconds', ms === 30000, b.log.intervals.map(i => i[1]));
  b.routes['/api/lock/status'] = () => ({ status: 200, ok: true, json: async () => ({ locked: true }), clone() { return this; } });
  await fn(); await b.flush();
  check('an expired session found by that check reloads the page', b.log.reloads === 1);
  b = boot({ status: { locked: false, active: false } }); await b.flush(); const before = b.log.fetches.length; await b.log.intervals[0][0]();
  check('with the lock off the periodic check does nothing (no request)', b.log.fetches.length === before);

  console.log(`lockclient: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
