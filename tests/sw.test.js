// The service worker (sw.js): the shell lists only files that exist, never the live state copy, never caches /api/, and purges old API entries. Run: node tests/sw.test.js
'use strict';
const fs = require('fs'), path = require('path');
const root = f => path.join(__dirname, '..', f);
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const src = fs.readFileSync(root('sw.js'), 'utf8');
const shell = [...(src.match(/const SHELL = \[([\s\S]*?)\];/)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
check('the shell is not empty and has the page and its script', shell.includes('index.html') && shell.includes('script.js'));
check('every file in the shell exists', shell.every(f => fs.existsSync(root(f))), shell.filter(f => !fs.existsSync(root(f))));
check('no /api/ path is pre-cached (api/state.js is a full copy of chats, memory and tasks)', !shell.some(f => /^\/?api\//.test(f)), shell.filter(f => /^\/?api\//.test(f)));
const html = fs.readFileSync(root('index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(f => !/^https?:/.test(f) && !/^api\//.test(f));
check('every local script the page loads is in the shell (so it works offline)', scripts.every(f => shell.includes(f)), scripts.filter(f => !shell.includes(f)));
check('the version was bumped for this change so old caches (with the state copy) are dropped', /const VERSION = 'jarvis-v(3[7-9]|[4-9]\d)/.test(src), (src.match(/const VERSION = '[^']+'/) || [])[0]);
// run the worker's own handlers with fakes
const handlers = {}, caches = new Map();
const mkCache = () => { const m = new Map(); return { m, put: async (r, v) => { m.set(typeof r === 'string' ? r : r.url, v); }, keys: async () => [...m.keys()].map(u => ({ url: u })), delete: async r => m.delete(r.url), addAll: async () => {}, match: async () => undefined }; };
const sandbox = { self: { addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, clients: { claim() {} } }, location: { origin: 'http://localhost:3001' }, URL, caches: { keys: async () => [...caches.keys()], delete: async k => caches.delete(k), open: async k => { if (!caches.has(k)) caches.set(k, mkCache()); return caches.get(k); }, match: async () => undefined }, fetch: async () => ({ ok: true, type: 'basic', clone() { return this; } }) };
new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
(async () => {
  const ver = (src.match(/const VERSION = '([^']+)'/) || [])[1];
  caches.set('jarvis-v1', mkCache()); const cur = mkCache(); caches.set(ver, cur);
  cur.m.set('http://localhost:3001/api/state.js', 'stale'); cur.m.set('http://localhost:3001/script.js', 'keep');
  let done; handlers.activate({ waitUntil: p => { done = p; } }); await done;
  check('activate drops old caches', !caches.has('jarvis-v1') && caches.has(ver));
  check('activate removes any /api/ entry that an older worker had cached, and keeps the app files', !cur.m.has('http://localhost:3001/api/state.js') && cur.m.has('http://localhost:3001/script.js'), [...cur.m.keys()]);
  let responded = null; handlers.fetch({ request: { method: 'GET', url: 'http://localhost:3001/api/state.js' }, respondWith: p => { responded = p; } });
  check('/api/ requests are not intercepted at all', responded === null);
  handlers.fetch({ request: { method: 'GET', url: 'http://localhost:3001/style.css' }, respondWith: p => { responded = p; } }); await responded; await new Promise(r => setTimeout(r, 10));
  check('ordinary files are fetched network-first and cached', cur.m.has('http://localhost:3001/style.css') || [...cur.m.keys()].some(k => /style\.css/.test(k)));
  console.log(`sw: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
