/* JARVIS service worker (PWA): caches the app shell so the page opens and works offline.
   Rules: same-origin GET files only â†’ network-first, cache as offline fallback; /api/* is NEVER cached; everything else
   (chat with the AI, laptop control) still needs the backend running on this machine. */
'use strict';
const VERSION = 'jarvis-v64';   // bump when the app shell changes, so old caches are dropped
const SHELL = ['index.html', 'style.css', 'themes.css', 'site-theme.css', 'ui.css', 'manifest.webmanifest',
  // NOT api/state.js: that is a full copy of your chats, memory and tasks, and the worker never answers /api/ from a cache anyway
  'lock-client.js', 'vendor/qrcode.js',
  'speechfix.js', 'places.js', 'decider.js', 'nlu.js', 'understanding.js', 'persona.js', 'emotion-intelligence.js', 'lang.js', 'study.js', 'voice.js', 'triggers.js', 'undo.js', 'speech-stream.js', 'skillrouter.js', 'skills-page.js', 'cdnpins.js', 'scanmath.js', 'wavutil.js', 'stt-page.js', 'camera-page.js', 'watch-page.js', 'ttparse.js', 'assignparse.js', 'student-page.js', 'lifeparse.js', 'life-page.js', 'services-page.js', 'traceparse.js', 'dev-page.js', 'tenderparse.js', 'tenders-page.js', 'extras-page.js',
  'palette.js', 'codepanel.js', 'tools/registry.js', 'tools/apps.js', 'tools/web.js', 'tools/tasks.js', 'tools/study.js', 'tools/system.js', 'tools/files.js', 'tools/code.js', 'tools/productivity.js', 'script.js', 'wizard.js', 'routines.js', 'agent.js',
  // added by the later commits (boot cinema, HUD, dashboard, transitions, face greeting, gestures, Qwen assist, thresholds)
  'thresholds.js', 'nlu-qwen.js', 'boot-cinema.js', 'hud-overlay.js', 'dashboard.js', 'learn.js', 'transitions.js', 'face-greet.js', 'gesture.js', 'skill-hub.js', 'platform-ui.js', 'action-receipts.js', 'workspace.js',
  'boot-cinema.css', 'hud-overlay.css', 'dashboard.css', 'transitions.css', 'fm-radio.js', 'daily-features.js', 'focus-audio.js',
  'assistant-tools.js', 'assistant-features-page.js', 'media-center.js', 'desktop-control.js', 'agent-context.js', 'agent-runtime-page.js',
  'account-page.js', 'managed-browser-page.js', 'workbench-page.js'];

// Express routes are case-insensitive; no spelling of an API path belongs in the offline cache.
function isApiPath(pathname) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return true; }
  return /^\/api(?:\/|$)/i.test(path.replace(/[/\\]+/g, '/'));
}

function isMarksPage(pathname) {
  try { return /^\/marks(?:-oauth)?\.html$/i.test(decodeURIComponent(pathname)); }
  catch { return true; }
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => caches.open(VERSION)).then(c => c.keys().then(rs => Promise.all(rs.filter(r => isApiPath(new URL(r.url).pathname)).map(r => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // fonts CDN etc. â†’ browser cache handles it
  if (isApiPath(url.pathname) || isMarksPage(url.pathname)) return;    // live backend and Marks workspace: never cached
  // Network-first: edits to the app show up on the next load; the cache only answers when the backend is unreachable.
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
