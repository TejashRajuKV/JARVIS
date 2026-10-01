/* JARVIS service worker (PWA): caches the app shell so the page opens and works offline.
   Rules: same-origin GET files only â†’ network-first, cache as offline fallback; /api/* is NEVER cached; everything else
   (chat with the AI, laptop control) still needs the backend running on this machine. */
'use strict';
const VERSION = 'jarvis-v31';   // bump when the app shell changes (new fonts/styles), so old caches are dropped
const SHELL = ['index.html', 'style.css', 'themes.css', 'ui.css', 'manifest.webmanifest',
  'api/state.js', 'vendor/qrcode.js',
  'speechfix.js', 'places.js', 'decider.js', 'nlu.js', 'persona.js', 'lang.js', 'study.js', 'voice.js', 'triggers.js', 'undo.js', 'skills-page.js',
  'palette.js', 'codepanel.js', 'script.js', 'wizard.js', 'routines.js', 'agent.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // fonts CDN etc. â†’ browser cache handles it
  if (url.pathname.startsWith('/api/')) return;    // live backend calls: never cached
  // Network-first: edits to the app show up on the next load; the cache only answers when the backend is unreachable.
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
