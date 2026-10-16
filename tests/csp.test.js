// The page's Content-Security-Policy (csp.js) and the fingerprints of the CDN scripts (cdnpins.js). Run: node tests/csp.test.js
'use strict';
const fs = require('fs'), path = require('path');
const root = f => path.join(__dirname, '..', f);
const { buildCsp, isPagePath } = require(root('csp.js'));
const Pins = require(root('cdnpins.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- the policy ---------- */
const csp = buildCsp(), dir = Object.fromEntries(csp.split('; ').map(x => { const [k, ...v] = x.split(' '); return [k, v]; }));
check('no inline or foreign scripts: script-src is this site + the CDN (+ WebAssembly and eval for OpenCV), without unsafe-inline, a bare https:, a wildcard or data:/blob:', dir['script-src'].includes("'self'") && dir['script-src'].includes('https://cdn.jsdelivr.net') && dir['script-src'].includes("'wasm-unsafe-eval'") && dir['script-src'].includes("'unsafe-eval'") && !dir['script-src'].some(v => /^'unsafe-inline'$|^https?:$|^data:$|^blob:$|\*/.test(v)) && dir['script-src'].length === 4, dir['script-src']);
check('connections go only back to this server, embedded data: files, and the two places the libraries load data from', dir['connect-src'].join(' ') === "'self' data: https://cdn.jsdelivr.net https://storage.googleapis.com", dir['connect-src']);
check('no frames, no plugins; <base> and forms stay on this site; nobody can frame JARVIS', dir['frame-src'][0] === "'none'" && dir['object-src'][0] === "'none'" && dir['base-uri'][0] === "'self'" && dir['form-action'][0] === "'self'" && dir['frame-ancestors'][0] === "'none'");
check('default-src is this site only (anything not listed is blocked)', dir['default-src'].join(' ') === "'self'");
check('inline STYLES are allowed (the page sets styles from script), fonts from the CDN, pictures from https, camera frames from blob:', dir['style-src'].includes("'unsafe-inline'") && dir['font-src'].includes('https://cdn.jsdelivr.net') && dir['img-src'].includes('https:') && dir['img-src'].includes('blob:') && dir['media-src'].includes('blob:'));
check('the policy is one line of plain ASCII with no newline (a header)', !/[\r\n]/.test(csp) && /^[\x20-\x7e]+$/.test(csp));
check('isPagePath: the HTML pages get it; API routes, scripts and other files do not', ['/', '/index.html', '/lock.html', '/INDEX.HTML'].every(isPagePath) && ['/api/health', '/script.js', '/api/state.js', '/style.css', '/lock-client.js', '/x/index.html', ''].every(p => !isPagePath(p) || p === ''));

/* ---------- what the page really needs fits the policy ---------- */
const html = fs.readFileSync(root('index.html'), 'utf8');
check('index.html has no inline <script> (they would be blocked)', ![...html.matchAll(/<script\b([^>]*)>/gi)].some(m => !/\bsrc\s*=/.test(m[1])), [...html.matchAll(/<script\b([^>]*)>/gi)].filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[0]));
check('index.html has no inline event handlers (onclick= …), which the policy would block', !/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<style[\s\S]*?<\/style>/gi, '')));
const remote = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(https?:\/\/[^"/]+)/gi)].map(m => m[1]);
check('every remote script / stylesheet host in index.html is allowed by the policy (links to other sites are just links)', remote.length >= 5 && remote.every(h => h === 'https://cdn.jsdelivr.net'), remote);
const lock = fs.existsSync(root('lock.html')) ? fs.readFileSync(root('lock.html'), 'utf8') : '';
check('lock.html also has no inline script or handler (its script lives in lock-page.js) and loads that file', /<script src="lock-page\.js"><\/script>/.test(lock) && fs.existsSync(root('lock-page.js')) && !lock || (![...lock.matchAll(/<script\b([^>]*)>/gi)].some(m => !/\bsrc\s*=/.test(m[1])) && !/\son[a-z]+\s*=\s*["']/i.test(lock)));

/* ---------- the fingerprints ---------- */
check('each pin is a sha256 fingerprint in base64 (44 characters ending in =)', Object.values(Pins).every(v => /^sha256-[A-Za-z0-9+/]{43}=$/.test(v)), Object.values(Pins));
const urlsInCode = new Set();
for (const f of ['camera-page.js', 'watch-page.js', 'face-greet.js']) for (const m of fs.readFileSync(root(f), 'utf8').matchAll(/'(https:\/\/cdn\.jsdelivr\.net\/[^']+\.js)'/g)) urlsInCode.add(m[1]);
check('every CDN script URL the code loads has a fingerprint (change a version → update cdnpins.js)', urlsInCode.size >= 3 && [...urlsInCode].every(u => Pins[u]), [...urlsInCode].filter(u => !Pins[u]));
check('…and no pin is left over for a URL that is no longer used', Object.keys(Pins).every(u => urlsInCode.has(u)), Object.keys(Pins).filter(u => !urlsInCode.has(u)));
check('the pins are pinned versions (no "latest", no ranges)', Object.keys(Pins).every(u => /@\d+\.\d+\.\d+/.test(u) && !/latest|\^|~/.test(u)));

/* ---------- the loaders set integrity ---------- */
{
  const made = []; global.document = { createElement: () => { const el = { attrs: {}, remove() {}, set src(v) { this._s = v; }, get src() { return this._s; } }; made.push(el); return el; }, head: { appendChild(el) { setTimeout(() => el.onload && el.onload(), 0); } } };
  global.window = global; global.CdnPins = Pins;
  global.localStorage = { getItem: () => null, setItem() {} };
  const src = fs.readFileSync(root('camera-page.js'), 'utf8');
  // the loader is pure page code; evaluate only what loadScript needs
  const Camera = new Function('document', 'CdnPins', 'window', 'navigator', 'location', src + ';return Camera;')(global.document, Pins, global, { mediaDevices: {} }, { reload() {} });
  (async () => {
    const pinned = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    await Camera.loadScript(pinned);
    check('loadScript: a pinned script is requested with its integrity value and crossorigin=anonymous (the browser checks it)', made.length === 1 && made[0].integrity === Pins[pinned] && made[0].crossOrigin === 'anonymous', made[0]);
    await Camera.loadScript('https://example.invalid/other.js');
    check('loadScript: a URL with no pin is loaded without integrity (nothing else in the app does that)', made.length === 2 && !made[1].integrity);
    console.log(`csp: ${total - fail}/${total}`);
    process.exitCode = fail ? 1 : 0;
  })().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
}
