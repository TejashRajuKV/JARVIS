'use strict';
/* Which Node.js is running, and is it new enough? JARVIS uses AbortSignal.any (Node 20.3+) for AI timeouts, and the online neural voices use the built-in
   WebSocket (Node 22+). server.js asks this before anything else starts, so an old Node gives one plain sentence instead of a crash deep in a request.
     check('18.19.0') → { ok: false, fatal: 'JARVIS needs Node.js 20.3 or newer …', warn: null }
     check('20.9.0')  → { ok: true,  fatal: null, warn: 'Node 20.9.0 works, but the online neural voices need Node 22 or newer …' }
     check('24.1.0')  → { ok: true,  fatal: null, warn: null } */
const MIN = [20, 3], VOICE = 22;
function parse(v) { const m = String(v || '').replace(/^v/, '').match(/^(\d+)\.(\d+)/); return m ? [+m[1], +m[2]] : null; }
function check(version = process.versions.node) {
  const p = parse(version);
  if (!p) return { ok: false, fatal: 'I could not tell which Node.js version this is (“' + version + '”). JARVIS needs Node.js 20.3 or newer: https://nodejs.org', warn: null };
  if (p[0] < MIN[0] || (p[0] === MIN[0] && p[1] < MIN[1])) return { ok: false, fatal: 'JARVIS needs Node.js ' + MIN.join('.') + ' or newer, and this is Node ' + String(version).replace(/^v/, '') + '. Install the current LTS from https://nodejs.org, then start JARVIS again.', warn: null };
  if (p[0] < VOICE) return { ok: true, fatal: null, warn: 'Node ' + String(version).replace(/^v/, '') + ' works, but the online neural voices (FRIDAY, Telugu, Kannada) need Node ' + VOICE + ' or newer; JARVIS will use your browser’s voices until you update.' };
  return { ok: true, fatal: null, warn: null };
}
module.exports = { check, parse, MIN, VOICE };
