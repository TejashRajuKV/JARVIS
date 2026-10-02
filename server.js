const express = require('express');
const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// One JARVIS per user: a second start (an AI tool, VS Code, a terminal) reuses the running one instead of adding a copy
// with its own chat, ntfy stream and wake-word listener. This runs before anything else starts work (instance.js).
const instance = require('./instance');
const PORT = Number(process.env.PORT) || instance.rememberedPort();
const lock = instance.claim(PORT);
if (lock.running) {
  console.log(`JARVIS is already running at http://localhost:${lock.port} — use that one (pid ${lock.pid}).`);
  process.exit(0);
}

const app = express();
const HOST = '127.0.0.1';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
// The weather service (tests point it at a local fake, like OLLAMA_URL above).
const WTTR = (process.env.JARVIS_WTTR_URL || 'https://wttr.in').replace(/\/+$/, '');
const DEFAULT_MODEL = process.env.JARVIS_MODEL || 'qwen3.5:4b';
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/* ---------------- security: same-origin only ---------------- */
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

app.use((req, res, next) => {
  // Host check blocks DNS-rebinding; Origin check blocks other websites calling the tools.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).json({ error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Forbidden origin' });
  // Windows Hello (WebAuthn) needs the page on "localhost" — an IP address can't be its relying party. Data is
  // shared on the server now, so moving the page from 127.0.0.1 to localhost loses nothing.
  if (req.method === 'GET' && req.headers.host === `127.0.0.1:${PORT}` && (req.path === '/' || req.path.endsWith('.html')))
    return res.redirect(302, `http://localhost:${PORT}${req.originalUrl}`);
  next();
});
app.use(express.json({ limit: '3mb' }));
// no-cache = the browser re-checks each file on load (a cheap 304 when unchanged), so an updated JARVIS is never
// run with yesterday's scripts still cached.
app.use(express.static(__dirname, { index: 'index.html', dotfiles: 'ignore', setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

/* ---------------- sandbox ---------------- */
const SANDBOX = path.join(os.homedir(), 'jarvis');
const TRASH = path.join(SANDBOX, '.trash');
const CODE_DIR = path.join(SANDBOX, 'Code');
for (const d of [SANDBOX, TRASH, CODE_DIR, ...['Documents', 'Projects', 'Notes'].map(d => path.join(SANDBOX, d))]) {
  fs.mkdirSync(d, { recursive: true });
}
const welcome = path.join(SANDBOX, 'Notes', 'welcome.md');
if (!fs.existsSync(welcome)) fs.writeFileSync(welcome, '# Welcome\nThis is your JARVIS sandbox. Files I create live here.\n');

// Extra project folders the user allows (managed only from the Settings UI).
const CONFIG_FILE = path.join(SANDBOX, '.config.json');
let config = { roots: [] };
try { config = { roots: [], ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}
config.roots = config.roots.filter(r => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// Every AI call goes through llm.js: local Ollama, or a cloud provider with the user's own API key (kept in .config.json).
const llm = require('./llm')({ getConfig: () => config, saveConfig, OLLAMA, DEFAULT_MODEL });
llm.routes(app);

// Windows Hello approvals (hello.js). Mounted before every route so its guard sees shutdown/delete/wipe first.
// Stored in .config.json, not appState, so a /api/state write can't turn it off.
require('./hello')(app, { getConfig: () => config, saveConfig, ALLOWED_ORIGINS });

/* ---------------- phone access over Tailscale ---------------- */
// `tailscale serve` publishes this port as https://<laptop>.<tailnet>.ts.net to the user's own devices only,
// forwarding to 127.0.0.1 — JARVIS still listens locally. That address is added to the allowed Host/Origin
// lists while Tailscale is logged in, and removed again when it isn't.
const TS_BIN = IS_WIN && fs.existsSync('C:\\Program Files\\Tailscale\\tailscale.exe') ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
let tsName = null;
const tsJSON = args => new Promise(done => execFile(TS_BIN, args, { windowsHide: true, timeout: 8000 },
  (err, out) => { try { done(err ? null : JSON.parse(out)); } catch { done(null); } }));
async function detectTailscale() {
  const st = await tsJSON(['status', '--json']);
  let name = st && st.BackendState === 'Running' && st.Self && st.Self.DNSName ? String(st.Self.DNSName).replace(/\.$/, '').toLowerCase() : null;
  if (name && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) name = null;
  if (name === tsName) return;
  if (tsName) { ALLOWED_HOSTS.delete(tsName); ALLOWED_HOSTS.delete(tsName + ':443'); ALLOWED_ORIGINS.delete('https://' + tsName); }
  tsName = name;
  if (tsName) { ALLOWED_HOSTS.add(tsName); ALLOWED_HOSTS.add(tsName + ':443'); ALLOWED_ORIGINS.add('https://' + tsName); }
  console.log(tsName ? `Phone access (Tailscale): https://${tsName}` : 'Phone access (Tailscale): off');
}
detectTailscale();
setInterval(detectTailscale, 60000);
app.get('/api/remote/status', async (req, res) => {
  await detectTailscale();
  const serve = tsName ? await tsJSON(['serve', 'status', '--json']) : null;
  const serving = !!serve && JSON.stringify(serve).includes(`:${PORT}"`);
  res.json({ tailscale: !!tsName, url: tsName ? 'https://' + tsName : null, serving, port: PORT });
});

/* ---------------- shared app state ---------------- */
// Chat, memory, tasks and settings live here (not in each browser's localStorage), so every browser and port
// shows the same JARVIS. The page loads it synchronously via /api/state.js before any app script runs.
const STATE_FILE = path.join(SANDBOX, '.jarvis-state.json');
let appState = {};
try { appState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch {}
let stateTimer = null;
function writeStateNow() {
  clearTimeout(stateTimer); stateTimer = null;
  const tmp = STATE_FILE + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(appState)); fs.renameSync(tmp, STATE_FILE); }
  catch { try { fs.writeFileSync(STATE_FILE, JSON.stringify(appState)); } catch (e) { console.error('could not save app state:', e.message); } }
}
const saveState = () => { clearTimeout(stateTimer); stateTimer = setTimeout(writeStateNow, 300); };
process.on('exit', () => { if (stateTimer) writeStateNow(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
const STATE_KEY = /^jarvis\.[\w.-]{1,40}$/;
const scheduler = require('./scheduler');
scheduler(app, { getState: () => appState, saveState, PORT, IS_WIN, llm, DEFAULT_MODEL, getConfig: () => config, saveConfig, procOf: k => procOf(k) });
// Ctrl+Shift+J: send the selected text from any app to JARVIS (opt-in in Settings; hotkey.js).
require('./hotkey')(app, { getState: () => appState, IS_WIN, PORT });
require('./autostart')(app, { IS_WIN }); // "Start with Windows" (Startup-folder link), managed from Settings
require('./wakeword')(app, { IS_WIN }); // wake word heard by Windows' offline recogniser — works while you're in another tab/app

// A <script src> from another website carries no Origin header, so the global Origin check can't stop it
// from reading this; Sec-Fetch-Site (set by the browser, not the page) can.
app.get('/api/state.js', (req, res) => {
  if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).type('application/javascript').send('/* forbidden */');
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
    .send('window.JARVIS_STATE = ' + JSON.stringify(appState).replace(/</g, '\\u003c') + ';');
});
app.post('/api/state', (req, res) => {
  const set = req.body && req.body.set;
  if (!set || typeof set !== 'object' || Array.isArray(set)) return res.status(400).json({ error: 'expected {set: {key: value}}' });
  const bad = Object.keys(set).find(k => !STATE_KEY.test(k));
  if (bad) return res.status(400).json({ error: 'invalid key: ' + bad });
  for (const [k, v] of Object.entries(set)) {
    if (v === null) delete appState[k];
    // The server fires reminders; a tab's stale copy must not un-fire or rewind them (scheduler.js).
    else if (k === 'jarvis.reminders') appState[k] = scheduler.mergeReminders(appState[k], v);
    else appState[k] = v;
  }
  saveState();
  // Other open tabs of this JARVIS show a changed chat at once (the writer's own tab ignores it: same src).
  if ('jarvis.chat' in set && Array.isArray(set['jarvis.chat']) && typeof app.locals.broadcast === 'function') {
    app.locals.broadcast({ type: 'state', key: 'jarvis.chat', value: set['jarvis.chat'], src: String(req.body.src || '').slice(0, 32) });
  }
  res.json({ success: true });
});
// "Erase all" keeps the migrated marker, so another browser's stale localStorage can't repopulate it afterwards.
app.delete('/api/state', (req, res) => { backup.snapshot('before-erase'); appState = appState['jarvis.migrated'] ? { 'jarvis.migrated': true } : {}; saveState(); res.json({ success: true }); });

// Backup / export / import, and automatic snapshots in ~/jarvis/.backups (backup.js).
const backup = require('./backup')(app, {
  getState: () => appState, setState: s => { appState = s; writeStateNow(); }, getConfig: () => config, saveConfig,
  mergeReminders: (a, b) => scheduler.mergeReminders(a, b), addRoot: p => addRootQuiet(p), dir: path.join(SANDBOX, '.backups'), appVersion: require('./package.json').version,
});
// Adds a project folder from a backup, with the same checks as Settings → Project folders. Returns whether it was added.
function addRootQuiet(p) {
  try {
    p = fs.realpathSync(path.resolve(String(p)));
    if (!fs.statSync(p).isDirectory() || path.parse(p).root === p) return false;
    if (FORBIDDEN_ROOTS.find(f => norm(p) === norm(f) || (norm(f) !== norm(os.homedir()) && norm(p).startsWith(norm(f) + path.sep)))) return false;
    if (rootOf(p)) return false;
    config.roots.push(p); saveConfig(); return true;
  } catch { return false; }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'target', 'out', '.idea', '.vscode']);
const CODE_EXT = new Set(['.py', '.js', '.mjs', '.ts', '.c', '.cpp', '.cc', '.h', '.hpp', '.java', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.sql', '.sh', '.kt', '.swift']);
const norm = p => (IS_WIN ? p.toLowerCase() : p);
const allRoots = () => [SANDBOX, ...config.roots];
function rootOf(p) {
  const np = norm(p);
  return allRoots().find(r => np === norm(r) || np.startsWith(norm(r) + path.sep)) || null;
}
const inTrash = p => norm(p) === norm(TRASH) || norm(p).startsWith(norm(TRASH) + path.sep);
const inSandbox = p => rootOf(p) === SANDBOX;

// Resolves a user-supplied name/path to a location inside an allowed root (or null).
// Accepts: absolute paths inside a root, "<rootFolderName>/sub/file", or paths relative to the sandbox.
function safePath(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  let s = name.trim().replace(/^["']|["']$/g, '');
  let p;
  if (path.isAbsolute(s) && !/^[/\\]/.test(s)) p = path.resolve(s);
  else {
    s = s.replace(/^[/\\]+/, '');
    const first = s.split(/[/\\]/)[0].toLowerCase();
    const root = config.roots.find(r => path.basename(r).toLowerCase() === first);
    p = root ? path.resolve(root, s.split(/[/\\]/).slice(1).join(path.sep)) : path.resolve(SANDBOX, s);
  }
  if (!rootOf(p) || inTrash(p) || isInternal(p)) return null;
  return p;
}
// JARVIS's own data files (API keys, authenticator secret, Hello key, shared state) are never reachable through the
// file tools — otherwise "read .config.json", or a cloud model asking for it, would hand them out.
const INTERNAL_FILES = new Set([CONFIG_FILE, STATE_FILE].map(f => norm(f)));
// Windows ignores trailing dots/spaces and reads "name::$DATA" as the file itself, so compare the cleaned name.
function isInternal(p) {
  const r = path.resolve(p);
  if (norm(r).startsWith(norm(path.join(SANDBOX, '.backups')) + path.sep)) return true;
  const base = path.basename(r).replace(/:.*$/, '').replace(/[. ]+$/, '');
  return INTERNAL_FILES.has(norm(path.join(path.dirname(r), base)));
}
/* ---- Access zones: open and read anywhere, ask before changing, never touch the system ----
   blocked — Windows, Program Files, ProgramData, AppData (app and browser data), secret folders in your home (.ssh,
             .aws…), the Recycle Bin, JARVIS's own settings/state/backups; and writes into the JARVIS program itself.
   home    — ~/jarvis: as before.
   laptop  — everywhere else: opening and reading are fine; any change needs your approval (409 needsApproval, the
             page asks, then retries with approved: true). */
const HOME_DIR = os.homedir();
const BLOCKED_DIRS = [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files',
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData', path.join(HOME_DIR, 'AppData'),
  ...['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.password-store'].map(d => path.join(HOME_DIR, d))].map(d => path.resolve(d));
const BLOCKED_NAMES = /^(\$recycle\.bin|system volume information|recovery|\$windows\.~bt|\$windows\.~ws)$/i;
const under = (p, dir) => { const a = norm(path.resolve(p)), b = norm(dir); return a === b || a.startsWith(b + path.sep); };
function blockedPath(p, { forWrite } = {}) {
  const r = path.resolve(p);
  if (BLOCKED_DIRS.some(d => under(r, d))) return true;
  if (r.split(path.sep).some(seg => BLOCKED_NAMES.test(seg))) return true;
  if (isInternal(r) || (rootOf(r) === SANDBOX && inTrash(r))) return true;
  if (forWrite && under(r, __dirname)) return true;   // JARVIS never rewrites its own program files
  return false;
}
const zoneOf = p => blockedPath(p) ? 'blocked' : (under(p, SANDBOX) ? 'home' : 'laptop');
// A full path you typed ("C:\Users\you\Desktop\notes.txt"), anywhere that isn't blocked; relative names keep the old
// meaning (~/jarvis, or "<project>/…").
function anyPath(name, opts) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const s = name.trim().replace(/^["']|["']$/g, '');
  if (path.isAbsolute(s) && !/^[/\\]/.test(s)) { const p = path.resolve(s); return blockedPath(p, opts) ? null : p; }
  return safePath(s);
}
// Changes outside ~/jarvis need approval. Returns true when the route may go ahead; otherwise it has answered.
function approvedChange(req, res, action, ...paths) {
  const ps = paths.filter(Boolean);
  if (ps.some(p => blockedPath(p, { forWrite: true }))) { res.status(403).json({ error: 'That location is off-limits (Windows, program or app-data folders, or JARVIS itself)' }); return false; }
  const outside = ps.filter(p => zoneOf(p) === 'laptop');
  if (outside.length && req.body.approved !== true) { res.status(409).json({ needsApproval: true, action, paths: outside, error: 'This changes files outside ~/jarvis and needs your permission' }); return false; }
  return true;
}

// Find by name across the laptop: Desktop, Documents, Downloads (and OneDrive's), the top of your home folder, and
// other drives a few levels down. Folder- or file-names as people say them (sameName: "dss print" → dsa_sprint; a
// version suffix counts for folders: "agriloop" → AGRILOOP-1, AGRILOOP61). Bounded (entries and time) and cached 30 s.
const laptopCache = new Map();
function laptopSearch(name, { kind, max = 6, contains = false } = {}) {
  const want = String(name || '').trim();
  if (!want || want.length > 120) return [];
  const key = (kind || '') + '|' + (contains ? 'c|' : '') + want.toLowerCase();
  const hit = laptopCache.get(key);
  if (hit && Date.now() - hit.t < 30000) return hit.paths;
  const w = squashName(want), q = want.toLowerCase();
  const bases = [[path.join(HOME_DIR, 'Desktop'), 3], [path.join(HOME_DIR, 'OneDrive', 'Desktop'), 3], [path.join(HOME_DIR, 'Documents'), 3],
    [path.join(HOME_DIR, 'OneDrive', 'Documents'), 3], [path.join(HOME_DIR, 'Downloads'), 3], [HOME_DIR, 0]];
  if (IS_WIN && !process.env.JARVIS_TEST) for (const d of 'CDEFGH') { const r = d + ':\\'; if (fs.existsSync(r)) bases.push([r, d === 'C' ? 0 : 2]); }
  const matches = (n, isDir) => contains ? n.toLowerCase().includes(q)
    : sameName(n, want) || (isDir && w.length >= 5 && squashName(n).startsWith(w) && squashName(n).length - w.length <= 4)
      || (!isDir && fuzzyNoteName(n, w));
  const found = [], seen = new Set(), t0 = Date.now(); let scanned = 0;
  const look = (dir, depth, maxDepth) => {
    if (found.length >= max || depth > maxDepth || scanned > 40000 || Date.now() - t0 > 4000) return;
    let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      scanned++;
      if (it.name.startsWith('.') || it.name.startsWith('$') || SKIP_DIRS.has(it.name) || BLOCKED_NAMES.test(it.name)) continue;
      const full = path.join(dir, it.name), isDir = it.isDirectory();
      if (isDir && blockedPath(full)) continue;
      if ((!kind || (kind === 'folder') === isDir) && matches(it.name, isDir)) {
        if (!seen.has(norm(full))) { seen.add(norm(full)); found.push(full); }
        if (found.length >= max) return;
        if (isDir && !contains) continue;
      }
      if (isDir && depth < maxDepth) look(full, depth + 1, maxDepth);
    }
  };
  for (const [b, d] of bases) if (fs.existsSync(b)) look(b, 0, d);
  // Deeper than the quick scan reaches (PycharmProjects\pythonProject, D:\…\…\index.html): the background index.
  if (found.length < max && fileIndex.ready) {
    const tol = w.length >= 12 ? 2 : w.length >= 6 ? 1 : 0;
    const exact = [], close = [];
    for (let i = 0; i < fileIndex.paths.length && exact.length < max; i++) {
      const isDir = fileIndex.dirs[i] === 1;
      if (kind && (kind === 'folder') !== isDir) continue;
      const sq = fileIndex.sq[i];
      let ok, best = false;
      if (contains) ok = fileIndex.low[i].includes(q);
      else {
        best = sq === w || fileIndex.low[i] === q;
        ok = best || (tol > 0 && Math.abs(sq.length - w.length) <= tol && editDistance(sq, w) <= tol)
          || (isDir && w.length >= 5 && sq.startsWith(w) && sq.length - w.length <= 4)
          || (!isDir && (sq === w + 'notes' || sq === w + 'note'));
      }
      if (ok) (best || contains ? exact : close).push(fileIndex.paths[i]);
    }
    for (const p of [...exact, ...close]) {
      if (found.length >= max) break;
      if (!seen.has(norm(p)) && fs.existsSync(p)) { seen.add(norm(p)); found.push(p); }
    }
  }
  laptopCache.set(key, { t: Date.now(), paths: found });
  if (laptopCache.size > 200) laptopCache.clear();
  return found;
}
/* Laptop-wide file-name index: every file and folder name on every drive (your home folder in full, other drives in
   full), skipping blocked places (Windows, Program Files, AppData, secrets), hidden/system entries and build folders
   (node_modules, .git…). Names and paths only — never file contents. Built in the background a little after start,
   without blocking requests, and rebuilt every 30 minutes. Off in tests. */
const fileIndex = { ready: false, building: false, paths: [], low: [], sq: [], dirs: [], builtAt: 0, ms: 0 };
const INDEX_MAX = 1500000;
async function buildFileIndex() {
  if (fileIndex.building) return;
  fileIndex.building = true;
  const t0 = Date.now(), paths = [], low = [], sq = [], dirs = [];
  const roots = [HOME_DIR];
  if (IS_WIN) for (const d of 'CDEFGHIJ') { const r = d + ':\\'; if (fs.existsSync(r)) roots.push(r); }
  const seenDir = new Set();
  let n = 0;
  const walk = async dir => {
    if (paths.length >= INDEX_MAX) return;
    const k = norm(dir); if (seenDir.has(k)) return; seenDir.add(k);
    let d; try { d = await fs.promises.opendir(dir); } catch { return; }
    const sub = [];
    try {
      for await (const it of d) {
        if (it.name.startsWith('.') || it.name.startsWith('$') || SKIP_DIRS.has(it.name) || BLOCKED_NAMES.test(it.name)) continue;
        if (it.isSymbolicLink()) continue;
        const full = path.join(dir, it.name), isDir = it.isDirectory();
        if (isDir && blockedPath(full)) continue;
        if (isInternal(full)) continue;
        paths.push(full); low.push(it.name.toLowerCase()); sq.push(squashName(it.name)); dirs.push(isDir ? 1 : 0);
        if (isDir) sub.push(full);
        if (++n % 2000 === 0) await new Promise(r => setImmediate(r));   // stay responsive while indexing
        if (paths.length >= INDEX_MAX) break;
      }
    } catch {}
    for (const s of sub) await walk(s);
  };
  const perRoot = {};
  for (const r of roots) { const before = paths.length; try { await walk(r); } catch {} perRoot[r] = paths.length - before; }
  Object.assign(fileIndex, { ready: true, building: false, paths, low, sq, dirs, perRoot, builtAt: Date.now(), ms: Date.now() - t0 });
  laptopCache.clear();
  console.log(`File index: ${paths.length} files and folders in ${Math.round((Date.now() - t0) / 1000)} s`);
}
if (!process.env.JARVIS_TEST) {
  setTimeout(buildFileIndex, 15000).unref();
  setInterval(buildFileIndex, 30 * 60 * 1000).unref();
}
/* "Did you mean…?": names on this laptop that are CLOSE to what was said — a typo ("calculater"), a short form
   ("calc" → calculator-app), extra words ("calculator project" → calculator), different separators (calc_app,
   CalcApp). Scored 0–1; library/system-ish places (site-packages, venv, icon packs…) count less. */
function jaroWinkler(a, b) {
  if (a === b) return 1;
  const md = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1), am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) for (let j = Math.max(0, i - md); j < Math.min(b.length, i + md + 1); j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let l = 0; while (l < 4 && a[l] && a[l] === b[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}
const SIM_NOISE = /[\\/](?:site-packages|dist-packages|venv|\.venv|env|lib|libs|vendor|third[_-]?party|packages|@resources|@backup|skins|icons?|winicons|cache|temp|tmp|locales?|fonts?)(?=[\\/])/i;
function nameSimilarity(want, cand) {
  // A copy/version suffix isn't part of the name: AGRILOOP-1, notes (2), project copy, app_v2 → agriloop, notes…
  const bare = String(cand).replace(/(?:[\s_-]*(?:\(\d+\)|-\s*copy|copy|v?\d+(?:\.\d+)*))+$/i, '');
  return Math.max(nameSimilarity1(want, cand), bare && bare !== cand ? nameSimilarity1(want, bare) * 0.99 : 0);
}
function nameSimilarity1(want, cand) {
  const w = squashName(want), c = squashName(cand);
  if (!w || !c) return 0;
  if (c === w) return 1;
  // Spelling look-alikes count as close when they are a few typos apart (about one per 4 letters: "agri look" →
  // AGRRILOOP, "calculater" → calculator); further apart ("calculus", "calendar") they don't.
  const ed = w.length >= 4 && c.length >= 4 ? editDistance(w, c) : 9;
  let s = ed < 9 ? jaroWinkler(w, c) * (ed <= Math.max(1, Math.floor(Math.max(w.length, c.length) / 4)) ? 1 : 0.85) : 0;
  if (ed >= 2) s = Math.min(s, 0.85);   // two typos away: offered, but below names that clearly contain what was said
  if (w.length >= 3 && c.startsWith(w)) s = Math.max(s, 0.86);                    // calc → calculator_app
  else if (w.length >= 4 && c.includes(w)) s = Math.max(s, 0.84);                  // calculator → my-calculator
  if (c.length >= 4 && w.startsWith(c)) s = Math.max(s, 0.83);                      // calculatorproject → calculator, calculator → calc
  const wt = String(want).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 1 && !/^(?:my|the|project|folder|app|files?)$/.test(x));
  const ct = String(cand).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 1);
  if (wt.length && wt.every(t => ct.some(u => u.startsWith(t.slice(0, 4)) && (u.startsWith(t) || t.startsWith(u) || editDistance(t, u) <= 1)))) s = Math.max(s, 0.85);
  return s;
}
function similarNames(want, { kind, max = 5, min = 0.82 } = {}) {
  if (!fileIndex.ready) return null;
  const out = [];
  for (let i = 0; i < fileIndex.paths.length; i++) {
    const isDir = fileIndex.dirs[i] === 1;
    if (kind && (kind === 'folder') !== isDir) continue;
    const p = fileIndex.paths[i];
    let s = nameSimilarity(want, path.basename(p));
    if (s < min - 0.1) continue;
    if (SIM_NOISE.test(p)) s *= 0.88;
    if (p.split(/[\\/]/).length > 8) s *= 0.97;
    if (s >= min) out.push({ path: p, name: path.basename(p), dir: isDir, score: Math.round(s * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, max);
}
// Your own words, for the speech fixer (speechfix.js): names of your folders and projects (the top levels of each
// drive, home, Desktop, Documents, Downloads, and your project folders) and which drive letters exist. The browser's
// recogniser only knows dictionary words — "agriloop" comes back as "ugly loop" — so the page matches what it heard
// against these by sound. Names only.
app.get('/api/voice/vocab', (req, res) => {
  const names = new Map(), add = n => { const s = String(n || '').trim(); if (s.length >= 3 && s.length <= 40 && /[a-z]/i.test(s) && !names.has(s.toLowerCase())) names.set(s.toLowerCase(), s); };
  (config.roots || []).forEach(r => add(path.basename(r)));
  const tops = [HOME_DIR, path.join(HOME_DIR, 'Desktop'), path.join(HOME_DIR, 'Documents'), path.join(HOME_DIR, 'Downloads'), path.join(HOME_DIR, 'OneDrive', 'Desktop'), path.join(SANDBOX, 'Projects')];
  const drives = IS_WIN ? 'CDEFGHIJ'.split('').filter(d => fs.existsSync(d + ':\\')) : [];
  drives.forEach(d => tops.push(d + ':\\'));
  if (fileIndex.ready) {
    const roots = tops.map(t => t.toLowerCase().replace(/[\\/]+$/, ''));
    for (let i = 0; i < fileIndex.paths.length && names.size < 4000; i++) {
      if (fileIndex.dirs[i] !== 1) continue;
      const p = fileIndex.paths[i], parent = path.dirname(p).toLowerCase().replace(/[\\/]+$/, '');
      // a folder directly in one of those places, or one level below (Downloads\Documents - Copy\AGRILOOP-1)
      if (roots.includes(parent) || roots.includes(path.dirname(parent))) { if (!SIM_NOISE.test(p)) add(path.basename(p)); }
    }
  } else {
    for (const t of tops) { try { fs.readdirSync(t, { withFileTypes: true }).forEach(it => { if (it.isDirectory() && !it.name.startsWith('.') && !it.name.startsWith('$') && !SKIP_DIRS.has(it.name)) add(it.name); }); } catch {} }
  }
  res.json({ success: true, drives, names: [...names.values()] });
});
app.post('/api/tool/similar', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Which name?' });
  const kind = ['folder', 'file'].includes(req.body.kind) ? req.body.kind : null;
  const r = similarNames(name, { kind, max: Math.min(8, +req.body.max || 5) });
  res.json(r === null ? { success: true, indexing: true, suggestions: [] } : { success: true, suggestions: r.filter(x => fs.existsSync(x.path)) });
});
app.get('/api/fileIndex/status', (req, res) => res.json({ ready: fileIndex.ready, building: fileIndex.building, count: fileIndex.paths.length, perRoot: fileIndex.perRoot, builtAt: fileIndex.builtAt, ms: fileIndex.ms }));
// "dbms" finds "DBMS Notes.md" / "dbms_notes.txt".
function fuzzyNoteName(n, w) { const s = squashName(n); return !!w && (s === w || s === w + 'notes' || s === w + 'note'); }
// Open/read by name anywhere: a full path, then ~/jarvis + project folders (forgiving names), then the laptop.
// → { path } | { choices: [paths] } | null
function findAnywhere(name, { kind } = {}) {
  const s = String(name || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  const direct = anyPath(s);
  if (direct && fs.existsSync(direct)) { const isDir = fs.statSync(direct).isDirectory(); if (!kind || (kind === 'folder') === isDir) return { path: direct }; }
  const inRoots = findAllowed(s, { kind });
  if (inRoots) return { path: inRoots };
  if (/[/\\]/.test(s)) return null;   // a relative path that isn't in ~/jarvis or a project: don't guess around the laptop
  const found = laptopSearch(s, { kind });
  if (!found.length) return null;
  return found.length === 1 ? { path: found[0] } : { choices: found };
}
// The same answer for every open/read route when a name is ambiguous or missing.
function notFoundOrChoices(res, f, name) {
  if (f && f.choices) return res.status(300).json({ choices: f.choices, error: `Several places match "${name}" — which one?` });
  return res.status(404).json({ error: `I can't find "${name}" on this laptop` });
}

// Friendly display path: "Notes/x.md" in the sandbox, "<project>/src/x.py" in project folders.
function rel(p) {
  const r = rootOf(p);
  if (!r) return p;
  const sub = path.relative(r, p).split(path.sep).join('/');
  return r === SANDBOX ? sub : path.basename(r) + (sub ? '/' + sub : '');
}

// Case-insensitive lookup of an existing file/folder: sandbox first, then project folders (depth 4).
// Folder/file names as people say them: case, spaces, _ and - don't matter ("dsa sprint" = "dsa_sprint"), and a
// longer name may be one letter off (two for 12+ letters) — speech recognition hears "dsa sprint" as "dss print".
// Short names must match exactly, so "os" never finds "ds".
const squashName = x => String(x || '').toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(/[\s_-]+/g, '');
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function sameName(candidate, wanted) {
  const c = squashName(candidate), w = squashName(wanted);
  if (!c || !w) return false;
  if (c === w) return true;
  const tol = w.length >= 12 ? 2 : w.length >= 6 ? 1 : 0;
  return tol > 0 && editDistance(c, w) <= tol;
}
// exact: true — no forgiving second pass. Used where a wrong guess would change or remove the wrong thing
// (writing, deleting, moving, renaming, copying, undoing a creation).
function findAllowed(name, { kind, exact } = {}) {
  if (!name) return null;
  const direct = safePath(name);
  if (direct && fs.existsSync(direct)) {
    const isDir = fs.statSync(direct).isDirectory();
    if (!kind || (kind === 'folder') === isDir) return direct;
  }
  const base = path.basename(String(name).replace(/[/\\]+$/, '')).toLowerCase();
  const variants = kind === 'folder' ? [base] : [base, ...['.txt', '.md', '.py', '.cpp', '.c', '.js', '.java'].map(e => base + e)];
  let hit = null;
  // Second pass (only when the exact pass found nothing): "dbms" also finds "DBMS Notes.md", "dsa sprint" finds
  // "dsa_sprint", "dss print" finds "dsa_sprint" (sameName).
  const squash = squashName;
  const want = squash(base), fuzzy = new Set([want, want + 'notes', want + 'note']);
  const looseMatch = (itemName, isDir) => isDir ? sameName(itemName, base) : (fuzzy.has(squash(itemName)) || sameName(itemName, base));
  let loose = false;
  const walk = (dir, depth) => {
    if (hit || depth > 4) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (item.name.startsWith('.') || SKIP_DIRS.has(item.name)) continue;
      const full = path.join(dir, item.name);
      const isDir = item.isDirectory();
      if ((!kind || (kind === 'folder') === isDir) && (loose ? want && looseMatch(item.name, isDir) : variants.includes(item.name.toLowerCase()))) { hit = full; return; }
      if (isDir) walk(full, depth + 1);
    }
  };
  for (const r of allRoots()) { if (norm(path.basename(r)) === base && kind !== 'file' && r !== SANDBOX) return r; walk(r, 0); if (hit) break; }
  if (!hit && !exact) {
    loose = true;
    // A project folder itself, by the name you say (C:\…\Desktop\dsa_sprint for "dsa sprint").
    if (kind !== 'file') { const root = allRoots().find(r => r !== SANDBOX && sameName(path.basename(r), base)); if (root) return root; }
    for (const r of allRoots()) { walk(r, 0); if (hit) break; }
  }
  return hit;
}

/* ---------------- config (project folders) ---------------- */
const FORBIDDEN_ROOTS = [os.homedir(), path.join(os.homedir(), 'AppData'), process.env.SystemRoot || 'C:\\Windows',
  process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData'];
app.get('/api/config', (req, res) => res.json({ success: true, sandbox: SANDBOX, roots: config.roots }));
app.post('/api/config', (req, res) => {
  const action = req.body.action;
  let p = String(req.body.path || '').trim().replace(/^["']|["']$/g, '');
  if (action === 'remove') {
    config.roots = config.roots.filter(r => norm(r) !== norm(p));
    saveConfig();
    return res.json({ success: true, roots: config.roots });
  }
  if (action !== 'add') return res.status(400).json({ error: 'action must be add or remove' });
  if (!path.isAbsolute(p)) return res.status(400).json({ error: 'Use a full path, e.g. D:\\projects' });
  p = path.resolve(p);
  try { p = fs.realpathSync(p); } catch { return res.status(400).json({ error: 'That folder does not exist' }); }
  if (!fs.statSync(p).isDirectory()) return res.status(400).json({ error: 'That is not a folder' });
  if (path.parse(p).root === p) return res.status(400).json({ error: 'A whole drive is too broad — pick a project folder' });
  const bad = FORBIDDEN_ROOTS.find(f => norm(p) === norm(f) || (norm(f) !== norm(os.homedir()) && norm(p).startsWith(norm(f) + path.sep)));
  if (bad) return res.status(400).json({ error: 'System or home folders are not allowed — pick a specific project folder' });
  if (rootOf(p)) return res.status(400).json({ error: 'That folder is already accessible' });
  config.roots.push(p);
  saveConfig();
  res.json({ success: true, roots: config.roots });
});

function openPath(target) {
  const cmd = IS_WIN ? 'explorer' : IS_MAC ? 'open' : 'xdg-open';
  const p = spawn(cmd, [target], { detached: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.unref();
}

/* ---------------- applications ---------------- */
// win: command for `cmd /c start`; proc: process image name for closing.
const APPS = {
  chrome:          { win: 'start chrome',      unix: 'google-chrome',        proc: 'chrome' },
  firefox:         { win: 'start firefox',     unix: 'firefox',              proc: 'firefox' },
  edge:            { win: 'start msedge',      unix: 'microsoft-edge',       proc: 'msedge' },
  brave:           { win: 'start brave',       unix: 'brave-browser',        proc: 'brave' },
  vscode:          { win: 'start code',        unix: 'code',                 proc: 'Code' },
  notepad:         { win: 'start notepad',     unix: 'gedit',                proc: 'notepad' },
  terminal:        { win: 'start wt',          unix: 'gnome-terminal',       proc: 'WindowsTerminal' },
  cmd:             { win: 'start cmd',         unix: 'gnome-terminal',       proc: 'cmd' },
  powershell:      { win: 'start powershell',  unix: 'bash',                 proc: 'powershell' },
  calculator:      { win: 'start calc',        unix: 'gnome-calculator',     proc: 'CalculatorApp' },
  explorer:        { win: 'start explorer',    unix: 'nautilus',             proc: null },
  calendar:        { win: 'start outlookcal:', unix: 'gnome-calendar',       proc: null },
  outlook:         { win: 'start outlook',     unix: 'thunderbird',          proc: 'OUTLOOK' },
  word:            { win: 'start winword',     unix: 'libreoffice --writer', proc: 'WINWORD' },
  excel:           { win: 'start excel',       unix: 'libreoffice --calc',   proc: 'EXCEL' },
  powerpoint:      { win: 'start powerpnt',    unix: 'libreoffice --impress',proc: 'POWERPNT' },
  spotify:         { win: 'start spotify:',    unix: 'spotify',              proc: 'Spotify' },
  discord:         { win: 'start discord:',    unix: 'discord',              proc: 'Discord' },
  whatsapp:        { win: 'start whatsapp:',   unix: 'whatsapp',             proc: 'WhatsApp' },
  slack:           { win: 'start slack:',      unix: 'slack',                proc: 'slack' },
  zoom:            { win: 'start zoommtg:',    unix: 'zoom',                 proc: 'Zoom' },
  teams:           { win: 'start msteams:',    unix: 'teams',                proc: 'ms-teams' },
  steam:           { win: 'start steam:',      unix: 'steam',                proc: 'steam' },
  antigravity:     { win: 'start agy',         unix: 'agy',                  proc: 'Antigravity' },
  paint:           { win: 'start mspaint',     unix: 'gimp',                 proc: 'mspaint' },
  'task manager':  { win: 'start taskmgr',     unix: 'gnome-system-monitor', proc: 'Taskmgr' },
  settings:        { win: 'start ms-settings:',unix: 'gnome-control-center', proc: null },
  camera:          { win: 'start microsoft.windows.camera:', unix: 'cheese', proc: 'WindowsCamera' },
  'snipping tool': { win: 'start ms-screenclip:', unix: 'gnome-screenshot',  proc: null },
  intellij:        { win: 'start idea64',      unix: 'idea',                 proc: 'idea64' },
  pycharm:         { win: 'start pycharm64',   unix: 'pycharm',              proc: 'pycharm64' },
  'android studio':{ win: 'start studio64',    unix: 'android-studio',       proc: 'studio64' },
  postman:         { win: 'start postman',     unix: 'postman',              proc: 'Postman' },
  obs:             { win: 'start obs64',       unix: 'obs',                  proc: 'obs64' },
  vlc:             { win: 'start vlc',         unix: 'vlc',                  proc: 'vlc' },
};

/* ---- apps installed on this laptop (Start menu) ---- */
// Beyond the fixed list above, anything in the Start menu can be opened by name. It launches through Windows' own
// app launcher (explorer shell:AppsFolder\<AppID>) with the exact ID Windows reports — the user's words only pick
// an entry from this list, they never become part of a command. Shortcuts to uninstallers, manuals, websites,
// release notes and the like are left out.
const JUNK_APP = /uninstall|manual|documentation|\bdocs?\b|\bhelp\b|website|homepage|release notes|licen[cs]e|\bfaq|readme|what is new|installation notes|about java|visit java|check for updates|\(safe mode\)|reload configuration|support center|online support/i;
let installedApps = []; // [{ name, id, proc|null }]
// A process name for closing/checking, only when the AppID reveals it: a path to an .exe, or a Squirrel app ID.
function procFromAppId(id) {
  const m = /([^\\/]+)\.exe$/i.exec(id); if (m) return m[1];
  const q = /^com\.squirrel\.[^.]+\.([\w-]+)$/i.exec(id); return q ? q[1] : null;
}
function refreshInstalledApps() {
  if (!IS_WIN) return Promise.resolve();
  return new Promise(done => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress'],
  { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    let list = null;
    try { list = err ? null : JSON.parse(out); } catch {}
    if (list) {
      if (!Array.isArray(list)) list = [list];
      const seen = new Set();
      installedApps = list.filter(a => a && a.Name && a.AppID && String(a.Name).trim().length >= 3 && !JUNK_APP.test(a.Name) && !/^https?:/i.test(a.AppID))
        .filter(a => { const k = String(a.Name).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .map(a => ({ name: String(a.Name).trim(), id: String(a.AppID), proc: procFromAppId(String(a.AppID)) }));
      agentTools.setInstalledApps(installedApps.map(a => a.name));
    }
    done();
  }));
}
const installedReady = new Promise(r => setImmediate(() => refreshInstalledApps().then(r)));
setInterval(refreshInstalledApps, 10 * 60000);
const findInstalled = key => { const n = String(key || '').replace(/^app:/, '').toLowerCase(); return installedApps.find(a => a.name.toLowerCase() === n) || null; };
const procOf = key => (APPS[key] && APPS[key].proc) || (/^app:/.test(key) && (findInstalled(key) || {}).proc) || null;

app.get('/api/apps', async (req, res) => { await installedReady; res.json({ success: true, apps: Object.keys(APPS), installed: installedApps.map(a => a.name) }); });

app.post('/api/tool/openApplication', (req, res) => {
  const key = String(req.body.app || '').toLowerCase();
  const entry = APPS[key];
  if (!entry) {
    const inst = /^app:/.test(key) && findInstalled(key);
    if (!inst) return res.status(400).json({ error: `"${key}" is not installed or not in the allowlist` });
    // explorer.exe reports exit code 1 even when it worked, so the result isn't used.
    execFile('explorer.exe', ['shell:AppsFolder\\' + inst.id], { windowsHide: true }, () => {});
    return res.json({ success: true, message: `Opening ${inst.name}` });
  }
  if (IS_WIN) {
    exec(`cmd /c ${entry.win}`, { windowsHide: true }, err => {
      if (err) console.warn(`open ${key} failed:`, err.message);
    });
  } else {
    const [bin, ...args] = entry.unix.split(' ');
    const p = spawn(bin, args, { detached: true, stdio: 'ignore' });
    p.on('error', e => console.warn(`open ${key} failed:`, e.message));
    p.unref();
  }
  res.json({ success: true, message: `Opening ${key}` });
});

app.post('/api/tool/closeApplication', (req, res) => {
  const key = String(req.body.app || '').toLowerCase();
  const proc = procOf(key);
  if (!proc || !/^[\w .+-]{1,80}$/.test(proc)) {
    const inst = findInstalled(key);
    return res.status(400).json({ error: inst ? `I can open ${inst.name}, but I can't tell which program it runs as, so I won't guess what to close — close it from its window` : `I can't close "${key}"` });
  }
  const [cmd, args] = IS_WIN ? ['taskkill', ['/IM', `${proc}.exe`, '/F']] : ['pkill', ['-f', proc]];
  execFile(cmd, args, { windowsHide: true }, err => {
    if (err) return res.json({ success: false, error: `${key} doesn't seem to be running` });
    res.json({ success: true, message: `Closed ${(findInstalled(key) || {}).name || key}` });
  });
});

/* ---------------- URLs / web ---------------- */
app.post('/api/tool/openUrl', (req, res) => {
  let url;
  try { url = new URL(String(req.body.url || '')); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'Only http/https URLs allowed' });
  const [cmd, args] = IS_WIN ? ['rundll32', ['url.dll,FileProtocolHandler', url.href]]
    : IS_MAC ? ['open', [url.href]] : ['xdg-open', [url.href]];
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.unref();
  res.json({ success: true, url: url.href });
});

const UA = { 'User-Agent': 'JARVIS-local-assistant/2.0 (personal use)' };
async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Finds the top YouTube video for a query (no API key) so "play X" plays X instead of showing a search page.
app.post('/api/tool/youtubeTop', async (req, res) => {
  const q = String(req.body.query || '').trim().slice(0, 150);
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const r = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (!m) return res.json({ success: false, error: 'No video found' });
    let title = m[2];
    try { title = JSON.parse('"' + m[2] + '"'); } catch {}
    res.json({ success: true, videoId: m[1], title, url: `https://www.youtube.com/watch?v=${m[1]}` });
  } catch (e) {
    res.json({ success: false, error: 'YouTube unreachable: ' + e.message });
  }
});

app.post('/api/tool/weather', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  const city = String(req.body.city || '').trim().slice(0, 60);
  try {
    const d = await getJSON(`${WTTR}/${encodeURIComponent(city)}?format=j1`);
    const c = d.current_condition[0];
    const today = d.weather[0];
    const tomorrow = d.weather[1];
    const area = d.nearest_area && d.nearest_area[0];
    // wttr's "nearest area" is its closest weather station's suburb (Bangalore → "Yesvantpur"), so show the city
    // as the user named it, with the state. Without a city it guesses from the IP address.
    const val = k => (area && area[k] && area[k][0] && area[k][0].value) || '';
    const named = city.replace(/\s+/g, ' ').replace(/\b[a-z]/g, x => x.toUpperCase());
    const region = val('region'), country = val('country');
    const place = named
      ? [named, region && region.toLowerCase() !== named.toLowerCase() ? region : country].filter(Boolean).join(', ')
      : [val('areaName'), region].filter(Boolean).join(', ') || 'your area';
    // An IP lookup that only resolved to the country gives whole-degree coordinates (India → 22.00, 79.00).
    const q = (d.request && d.request[0] && d.request[0].query) || '';
    const approximate = !named && /Lat -?\d+\.00 and Lon -?\d+\.00/.test(q);
    const rainChance = Math.max(...today.hourly.map(h => +h.chanceofrain || 0));
    res.json({
      success: true, place, approximate,
      tempC: +c.temp_C, feelsC: +c.FeelsLikeC, desc: c.weatherDesc[0].value.trim(),
      humidity: +c.humidity, windKmph: +c.windspeedKmph,
      maxC: +today.maxtempC, minC: +today.mintempC, rainChance,
      tomorrow: tomorrow ? { maxC: +tomorrow.maxtempC, minC: +tomorrow.mintempC, desc: tomorrow.hourly[4].weatherDesc[0].value.trim() } : null,
    });
  } catch (e) {
    res.status(502).json({ error: 'Weather service unreachable: ' + e.message });
  }
});

app.post('/api/tool/webAnswer', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  const q = String(req.body.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const ddg = await getJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`).catch(() => null);
    const direct = ddg && (ddg.Answer || ddg.AbstractText || ddg.Definition);
    if (direct) return res.json({ success: true, answer: String(direct), source: ddg.AbstractSource || 'DuckDuckGo', url: ddg.AbstractURL || '' });
    const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`);
    const title = s.query && s.query.search[0] && s.query.search[0].title;
    if (!title) return res.json({ success: true, answer: null });
    const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    res.json({ success: true, answer: sum.extract || null, source: 'Wikipedia', title, url: sum.content_urls ? sum.content_urls.desktop.page : '' });
  } catch (e) {
    res.status(502).json({ error: 'Lookup failed: ' + e.message });
  }
});

/* ---------------- distance / directions (Nominatim geocoding + OSRM's public demo router, both keyless) ----------------
   Best-effort public services, same spirit as the wttr.in weather lookup above — no guarantees, no API key. */
// Builds a plain-English line from an OSRM maneuver — OSRM itself only returns structured turn data, not text.
// Returns null for maneuvers that aren't an actionable turn (a mid-road name change, or entering a roundabout —
// the following "exit roundabout" step already says what to do), which the caller filters out.
function stepText(step) {
  const m = step.maneuver || {}, onto = step.name ? ' onto ' + step.name : '';
  const dir = { left: 'left', right: 'right', straight: 'straight ahead', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharply left', 'sharp right': 'sharply right', uturn: 'around' }[m.modifier];
  if (m.type === 'depart') return 'Head out' + onto + '.';
  if (m.type === 'arrive') return 'Arrive at your destination.';
  if (m.type === 'new name' || m.type === 'notification' || m.type === 'roundabout' || m.type === 'rotary') return null;
  if (m.type === 'exit roundabout' || m.type === 'exit rotary') return 'At the roundabout, take the exit' + onto + '.';
  if (m.type === 'turn' || m.type === 'end of road' || m.type === 'fork') return 'Turn ' + (dir || 'onto') + onto + '.';
  if (m.type === 'continue') return 'Continue' + onto + '.';
  if (m.type === 'merge' || m.type === 'on ramp' || m.type === 'off ramp') return 'Merge' + onto + '.';
  const kind = (m.type || 'continue').replace(/_/g, ' ');
  return kind.charAt(0).toUpperCase() + kind.slice(1) + onto + '.';
}
// Up to 5 matches for a place; with `near`, only matches within about 110 km of that point.
async function geocodeAll(place, near) {
  const box = near ? `&bounded=1&viewbox=${near.lon - 1},${near.lat + 1},${near.lon + 1},${near.lat - 1}` : '';
  const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(place) + box);
  return Array.isArray(j) ? j.map(x => ({ name: x.display_name.split(',')[0], lat: +x.lat, lon: +x.lon })) : [];
}
const kmBetween = (p, q) => { const R = 6371, r = d => d * Math.PI / 180, dLat = r(q.lat - p.lat), dLon = r(q.lon - p.lon);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(dLon / 2) ** 2)); };
// A trip is between places near each other far more often than across the world: "majestic to bangalore airport" is
// Majestic in Bengaluru, not Majestic in Kentucky or Portugal. Pick the closest pair of matches, and if the two ends are
// still continents apart, look the vaguer name up again near the other end.
async function placePair(from, to) {
  const [A, B] = await Promise.all([geocodeAll(from), geocodeAll(to)]);
  if (!A.length || !B.length) return { a: A[0], b: B[0] };
  let best = { a: A[0], b: B[0], km: kmBetween(A[0], B[0]) };
  for (const a of A) for (const b of B) { const km = kmBetween(a, b); if (km < best.km) best = { a, b, km }; }
  if (best.km > 1500) {
    const An = await geocodeAll(from, B[0]).catch(() => []), Bn = await geocodeAll(to, A[0]).catch(() => []);
    for (const [a, b] of [[An[0], B[0]], [A[0], Bn[0]]]) if (a && b && kmBetween(a, b) < best.km) best = { a, b, km: kmBetween(a, b) };
  }
  return best;
}
async function routeBetween(from, to, steps) {
  const { a, b } = await placePair(from, to);
  if (!a) return { error: `I couldn't find "${from}" — try being more specific` };
  if (!b) return { error: `I couldn't find "${to}" — try being more specific` };
  const r = await getJSON(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false${steps ? '&steps=true' : ''}`);
  if (!r.routes || !r.routes.length) return { error: 'No driving route found between those places' };
  const route = r.routes[0];
  return { a, b, distanceKm: Math.round(route.distance / 100) / 10, durationMin: Math.round(route.duration / 60), route };
}
app.post('/api/tool/distance', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  const from = String(req.body.from || '').trim().slice(0, 100), to = String(req.body.to || '').trim().slice(0, 100);
  if (!from || !to) return res.status(400).json({ error: 'Both a starting point and a destination are required' });
  try {
    const r = await routeBetween(from, to, false);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ success: true, from: r.a, to: r.b, distanceKm: r.distanceKm, durationMin: r.durationMin });
  } catch (e) { res.status(502).json({ error: 'Routing service unreachable: ' + e.message }); }
});
app.post('/api/tool/directions', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  const from = String(req.body.from || '').trim().slice(0, 100), to = String(req.body.to || '').trim().slice(0, 100);
  if (!from || !to) return res.status(400).json({ error: 'Both a starting point and a destination are required' });
  try {
    const r = await routeBetween(from, to, true);
    if (r.error) return res.status(404).json({ error: r.error });
    const steps = r.route.legs[0].steps.map(s => ({ instruction: stepText(s), distanceM: Math.round(s.distance) })).filter(s => s.instruction);
    res.json({ success: true, from: r.a, to: r.b, distanceKm: r.distanceKm, durationMin: r.durationMin, steps });
  } catch (e) { res.status(502).json({ error: 'Routing service unreachable: ' + e.message }); }
});

/* ---------------- LLM (Ollama) ---------------- */
// Tools the model may use: generated from the agent registry (agent-tools.js), which also validates every call.
const agentTools = require('./agent-tools')({ APPS, safePath, anyPath, llm, DEFAULT_MODEL });
agentTools.routes(app);
const TOOL_CATALOGUE = agentTools.catalogue() + '\nIf the user asks you to WRITE code AND save/run it in the same message, first answer with the code block normally; JARVIS will save it for them.';

function lengthRule(len) {
  if (len === 'concise') return 'Answer in 1-3 short sentences unless the user asks for code or detail.';
  if (len === 'detailed') return 'Give thorough, well-structured answers with examples.';
  return 'Keep answers short and clear (under about 120 words) unless the user asks for code or more detail.';
}

// "in 2 lines" style requests from the page: {n, unit}.
function cleanLimit(l) {
  if (!l || typeof l !== 'object') return null;
  const n = parseInt(l.n, 10), unit = ['line', 'sentence', 'word', 'point'].includes(l.unit) ? l.unit : null;
  return unit && n >= 1 && n <= (unit === 'word' ? 500 : 30) ? { n, unit } : null;
}
function buildSystemPrompt(ctx = {}) {
  const now = new Date();
  const facts = Array.isArray(ctx.memory) && ctx.memory.length ? ctx.memory.slice(0, 20).map(m => `- ${m}`).join('\n') : '- (none yet)';
  const tasks = Array.isArray(ctx.tasks) && ctx.tasks.length ? ctx.tasks.slice(0, 15).map(t => `- ${t}`).join('\n') : '- (none)';
  const address = String(ctx.address || 'sir').slice(0, 30);
  const friday = ctx.persona === 'friday';
  const LANGS = { te: 'Telugu', kn: 'Kannada' };
  const langRule = LANGS[ctx.language] ? `
LANGUAGE
- Reply in ${LANGS[ctx.language]} (native script). Keep technical terms, code, file names and numbers in English. Keep it short and simple.
` : '';
  return `${friday
    ? `You are F.R.I.D.A.Y. — the user's personal AI, modelled on Tony Stark's FRIDAY (JARVIS's successor). You run 100% locally on the user's own computer.`
    : `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System) — the user's personal AI, modelled on Tony Stark's JARVIS. You run 100% locally on the user's own computer.`}
The user${ctx.name ? ` is named ${ctx.name} and` : ''} is a computer-science student. Today is ${now.toDateString()}, local time ${now.toTimeString().slice(0, 5)}.
${langRule}
PERSONALITY
- ${friday ? 'Warm, quick and brisk, with a light Irish lilt in phrasing and a confident, friendly edge. Efficient, never gushing.' : 'Calm, precise, unfailingly polite and loyal, with understated dry British wit. Composed, never excitable.'}
- Address the user as "${address}" — naturally, about once per reply (e.g. "Right away, ${address}." / "I'm afraid not, ${address}."), not in every sentence.
- Confident and concise. Never say "As an AI", never grovel or over-apologise, no emojis, no exclamation-mark enthusiasm.
- A light touch of humour is welcome when the moment allows; substance always comes first.
- Usually open with a brief, natural ${friday ? 'FRIDAY' : 'JARVIS'}-style lead-in ("Certainly, ${address}." / "Of course, ${address}." / "An excellent question, ${address}.") and, where it fits, close by offering the next step. Keep the lead-in to a few words.
- Style examples:
  User: "are you there?" → "At your service, ${address}."
  User: "explain recursion quickly" → "Certainly, ${address}. Recursion is a function solving a problem by calling itself on a smaller version of it — like a set of Russian dolls, each opening to a slightly smaller one, until you reach the base case. …"
  User: "I failed my DBMS quiz" → "One result, ${address}, not a verdict. Shall we go through the questions you missed?"
  (These are style examples only — never copy their wording into unrelated answers.)

HOW TO BEHAVE
- Users talk casually, with typos, slang, Hinglish or broken grammar. Work out what they MEAN and respond to that. If truly ambiguous, ask ONE short clarifying question.
- ${lengthRule(ctx.responseLen)}
- Use Markdown. Put code in fenced code blocks with a language tag.
- Never pretend you performed an action. Only tools actually perform actions. Writing a reply creates NO file: never say you generated, created, saved, built, opened or ran anything (e.g. "it is saved as calculator.html") unless a tool result in this chat says so. Never say "generating now…" — either put the code in your reply, or don't.
- If the user wants an app, website, frontend or UI page BUILT, you cannot build it in a reply: tell them to say "build a website for <their idea>" (JARVIS's website builder asks a few questions, builds the page and opens it). Do not promise to build it yourself.
- You CAN see the user's screen: read_screen captures the window in front (a browser tab, an error, a PDF). For anything about their screen, window, tab or page, use <<read_screen {"explain":true}>> — never say you can't see it.
- Never mention tool names (like open_in_editor or write_note) in normal replies; describe things in plain words ("say 'open it in VS Code'").
- You CANNOT browse the internet and have no live data. Never invent "sample" problems, examples or code the user did not ask for.
- If the user wants to open, find or look at something online (a website, problem statements, results, a page), use open_best or research.
- If a question needs current information you may not have (events, 2025/2026 news, dates, releases), use research — or say in one sentence that you are not sure and offer to search. Stay on the user's topic.
- You are also a CS study partner: explain concepts simply with small examples, analyse time/space complexity, find bugs, and help with DSA, OS, DBMS, CN, OOP, compilers, maths.
- When asked to quiz the user, ask ONE question at a time, wait for their answer, then say if it was right, give the correct answer briefly, and ask the next question.

ACTIONS
If the user wants something DONE that a tool below handles, reply with ONLY one line in exactly this format and nothing else:
<<tool_name {"arg":"value"}>>
Example: user "yo fire up crome" -> <<open_app {"app":"chrome"}>>
Example: user "remind me to drink water in 30 min" -> <<remind {"text":"drink water","when":"in 30 minutes"}>>
If no tool fits, answer normally in text. Never invent tools.

TOOLS
${TOOL_CATALOGUE}

WHAT YOU KNOW ABOUT THE USER
${facts}

THEIR CURRENT TASKS / DEADLINES
${tasks}${ctx.focus ? `

RIGHT NOW (what "that folder", "there", "it" refer to)
${String(ctx.focus).slice(0, 600)}` : ''}${summaryRule(ctx.earlier)}${limitRule(cleanLimit(ctx.limit))}`;
}
// Rolling conversation memory: the page sends a compact summary of everything before the last 14 messages.
function summaryRule(earlier) {
  const text = String(earlier || '').trim();
  if (!text) return '';
  return `\n
EARLIER IN THIS CONVERSATION (already discussed, before the messages below — do not re-summarise it back)
${text.slice(0, 4000)}`;
}
function limitRule(l) {
  if (!l) return '';
  const what = l.unit === 'word' ? `${l.n} words or fewer` : l.unit === 'point' ? `exactly ${l.n} bullet point${l.n > 1 ? 's' : ''} (one short line each), nothing before or after them`
    : `exactly ${l.n} short sentence${l.n > 1 ? 's' : ''}${l.unit === 'line' ? ', one per line' : ''}`;
  return `

LENGTH — THIS OVERRIDES EVERY OTHER STYLE RULE
The user asked for a specific length. Answer in ${what}. No headings, no examples, no code, no lead-in, no follow-up offer. Stop as soon as the limit is reached.`;
}

// Local Ollama models plus every configured cloud provider's models ("<provider>::<model>").
app.get('/api/llm/status', async (req, res) => {
  const { ollamaOnline, models, errors } = await llm.listModels();
  const ids = models.map(m => m.id);
  res.json({ success: true, online: models.length > 0, ollamaOnline, models: ids, groups: models, errors,
    defaultModel: ids.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : ids[0] || null });
});

app.post('/api/llm/warm', async (req, res) => {
  const model = String(req.body.model || DEFAULT_MODEL);
  if (llm.isCloud(model)) return res.json({ success: true, cloud: true }); // nothing to load
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: '30m' }), signal: AbortSignal.timeout(180000),
    });
    res.json({ success: r.ok });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Small non-streaming LLM calls from the page (rolling conversation memory).
app.post('/api/summarize', async (req, res) => {
  const text = String((req.body && req.body.text) || '').slice(0, 24000);
  const instruction = String((req.body && req.body.instruction) || 'Summarise.').slice(0, 300);
  if (!text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const out = await llm.complete({ model: req.body.model || DEFAULT_MODEL, system: instruction, messages: [{ role: 'user', content: text }], maxTokens: 400, temperature: 0.3 });
    res.json({ success: true, summary: String(out || '').trim().slice(0, 4000) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- NL Command Parser (Qwen + rules) ----------------
   Additive: when the rule engine's confidence is low (CONVERSATION or < 0.85) and the
   user has enabled "Qwen NLU assist" in settings, the page asks Qwen to extract a
   structured intent. The model is constrained to a strict JSON schema and a known
   intent whitelist — it can never invent a tool. If parsing fails or the model is
   unreachable, the page falls back to the rule-engine result unchanged. */
const NLU_INTENT_WHITELIST = [
  'OPEN_APPLICATION','CLOSE_APPLICATION','OPEN_WEB','WEB_SEARCH','SITE_SEARCH',
  'BRIGHTNESS','VOLUME','MUTE','DARK_MODE','BATTERY','WEATHER','TIME','DATE',
  'TIMER','REMINDER','TASK_ADD','TASK_LIST','TASK_DONE','TASK_DELETE',
  'READ_FILE','LIST_FILES','SEARCH_FILES','CREATE_FOLDER','CREATE_FILE',
  'SCREENSHOT','READ_SCREEN','LOCK','SLEEP','SHUTDOWN','RESTART',
  'PLAY_MUSIC','PAUSE','NEXT_TRACK','PREV_TRACK',
  'WEATHER','MAPS','CONVERT','CALCULATE','CONVERSATION'
];
app.post('/api/nlu/parse', async (req, res) => {
  const text = String((req.body && req.body.text) || '').slice(0, 800);
  if (!text.trim()) return res.status(400).json({ error: 'text required' });
  const sys = [
    'You are JARVIS\'s natural-language intent parser.',
    'Read the user command and reply with ONLY a single JSON object — no prose, no code fences.',
    'Schema: {"intent": string, "args": object, "confidence": number 0..1}',
    'The intent MUST be one of: ' + NLU_INTENT_WHITELIST.join(', ') + '.',
    'If the command is casual chat or you are unsure, use "CONVERSATION".',
    'Pull app names, file names, numbers, times and queries into args (e.g. {"app":"chrome"}, {"query":"react hooks"}, {"level":50}, {"minutes":10}).',
    'Be strict: confidence 0.9+ only when the intent is unmistakable. 0.7-0.9 for clear but slightly ambiguous. Below 0.7 means CONVERSATION.',
    'Never invent an intent not in the whitelist. Never claim to perform the action — you only classify.'
  ].join(' ');
  try {
    const out = await llm.complete({
      model: req.body.model || DEFAULT_MODEL,
      system: sys,
      messages: [{ role: 'user', content: text }],
      maxTokens: 220, temperature: 0.2, json: true,
    });
    let parsed = null;
    if (out) {
      try { parsed = JSON.parse(String(out).replace(/^```(?:json)?|```$/gim, '').trim()); }
      catch { parsed = llm.extractJSON ? llm.extractJSON(out) : null; }
    }
    if (!parsed || typeof parsed !== 'object') return res.json({ success: false, reason: 'no_json' });
    const intent = String(parsed.intent || '').toUpperCase();
    if (!NLU_INTENT_WHITELIST.includes(intent)) return res.json({ success: false, reason: 'bad_intent', got: intent });
    const conf = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {};
    res.json({ success: true, intent, args, confidence: conf, source: 'qwen' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  const { messages, context = {}, model } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  // context.earlier: the page's rolling summary of the conversation before these messages (capped, plain text).
  if (context.earlier != null) context.earlier = String(context.earlier).slice(0, 4000);
  const clean = messages.slice(-14)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  // A screenshot captured by /api/sys/screenRead: single-use, attached only to the latest user message.
  const image = typeof req.body.imageToken === 'string' && app.locals.takeVisionImage ? app.locals.takeVisionImage(req.body.imageToken) : null;
  const last = clean[clean.length - 1];
  const withImage = !!(image && last && last.role === 'user' && await llm.hasVision(model || DEFAULT_MODEL));
  let numPredict = { concise: 350, balanced: 700, detailed: 1400 }[context.responseLen] || 700;
  // Code (a whole page, a program) needs room: 700 tokens cut a calculator page off half-way through its HTML.
  const askText = String((last && last.content) || '') + ' ' + String((clean[clean.length - 3] || {}).content || '');
  if (/\b(code|html|css|javascript|program|script|website|web ?page|frontend|front end|calculator|app|function|class|implement|write (?:a|the|me))\b/i.test(askText)) numPredict = Math.max(numPredict, 3500);
  const lim = cleanLimit(context.limit);
  if (lim) numPredict = Math.min(numPredict, lim.unit === 'word' ? lim.n * 2 + 40 : lim.n * (lim.unit === 'point' ? 50 : 45) + 40);

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
  try {
    // Every provider's stream is re-emitted as Ollama-style NDJSON ({message:{content}}), which the page already reads.
    const s = await llm.openStream({ model: model || DEFAULT_MODEL, system: buildSystemPrompt(context), messages: clean,
      images: withImage ? [image] : null, temperature: 0.5, maxTokens: numPredict, numCtx: withImage ? 12288 : 8192, signal: ctrl.signal });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    if (s.droppedImages) res.write(JSON.stringify({ message: { role: 'assistant', content: '_(This model didn’t accept the screenshot, so I answered from the text only.)_\n\n' } }) + '\n');
    for await (const delta of s.deltas) res.write(JSON.stringify({ message: { role: 'assistant', content: delta }, done: false }) + '\n');
    res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
    res.end();
  } catch (e) {
    if (ctrl.signal.aborted) return;
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else { res.write(JSON.stringify({ error: e.message }) + '\n'); res.end(); }
  }
});

/* ---------------- files (sandboxed to ~/jarvis) ---------------- */
app.get('/api/tool/sandboxInfo', (req, res) => res.json({ success: true, root: SANDBOX }));

// Where a request points, as people say it: "my laptop" (everything), "D drive" / "d:" (a drive), "desktop" /
// "my downloads" (known folders), a full path. null = a folder name to look up (findAnywhere).
function whereDir(w) {
  const k = knownFolder(w);
  if (k) return { path: k };
  const sc = scopeDir(w);
  return sc && sc.path ? sc : { error: (sc && sc.error) || `I couldn't find the folder "${w}"` };
}
function scopeDir(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/[.?!]+$/, '');
  if (!s || /^(?:(?:my|the|this|whole|entire)\s+)*(?:laptop|computer|pc|system|machine|all (?:my )?drives|everywhere)$/i.test(s)) return { all: true };
  const d = s.match(/^(?:the\s+|my\s+)?([a-z])(?::[\\/]?|\s+drive)$/i) || s.match(/^drive\s+([a-z]):?$/i);
  if (d) { const r = d[1].toUpperCase() + ':\\'; return fs.existsSync(r) ? { path: r } : { error: `There is no ${d[1].toUpperCase()}: drive on this laptop` }; }
  const k = s.replace(/^(?:my|the)\s+/i, '').replace(/\s+folder$/i, '').toLowerCase();
  if (KNOWN[k]) { const p = knownFolder(k); return p ? { path: p } : { error: `I couldn't find your ${KNOWN[k]} folder` }; }
  if (path.isAbsolute(s) && !/^[/\\]/.test(s)) { const p = anyPath(s); return p && fs.existsSync(p) ? { path: p } : { error: `I can't find "${s}"` }; }
  return null;
}
app.post('/api/tool/listFiles', (req, res) => {
  const sc = req.body.dir ? scopeDir(req.body.dir) : null;
  if (sc && sc.error) return res.status(404).json({ error: sc.error });
  if (sc && sc.all) {   // "list folders in my laptop": the drives, and your home folder
    const drives = IS_WIN ? 'CDEFGHIJ'.split('').map(d => d + ':\\').filter(r => fs.existsSync(r)) : ['/'];
    return res.json({ success: true, dir: 'This laptop', path: '', folders: [...drives, HOME_DIR], files: [], projects: [], laptop: true });
  }
  const f = sc && sc.path ? { path: sc.path } : req.body.dir ? findAnywhere(req.body.dir, { kind: 'folder' }) : { path: SANDBOX };
  if (!f || !f.path) return notFoundOrChoices(res, f, req.body.dir);
  const dir = f.path;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true }).filter(i => !i.name.startsWith('.') && !i.name.startsWith('$') && !BLOCKED_NAMES.test(i.name));
    res.json({
      success: true, dir: rel(dir) || '~/jarvis', path: dir,
      folders: items.filter(i => i.isDirectory() && !SKIP_DIRS.has(i.name)).map(i => i.name),
      files: items.filter(i => i.isFile()).map(i => i.name),
      projects: dir === SANDBOX ? config.roots.map(r => path.basename(r)) : [],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// "how many folders are on my laptop" / "count folders in D drive": answered from the laptop file index (names only),
// so it covers every level, not just the top. Hidden, system and build folders (node_modules, .git…) are not counted.
app.post('/api/tool/folderStats', (req, res) => {
  const raw = String(req.body.scope || '').trim();
  let sc = scopeDir(raw);
  if (sc && sc.error) return res.status(404).json({ error: sc.error });
  if (!sc) { const f = findAnywhere(raw, { kind: 'folder' }); if (!f || !f.path) return notFoundOrChoices(res, f, raw); sc = { path: f.path }; }
  // One folder: counted live from disk (always current — the index may be up to 30 minutes old), unless it is huge.
  if (!sc.all) {
    const t0 = Date.now(); let folders = 0, files = 0, seen = 0, complete = true; const directDirs = []; let directFiles = 0;
    const walk = (dir, depth) => {
      if (!complete) return;
      let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        if (++seen > 300000 || Date.now() - t0 > 4000) { complete = false; return; }
        if (it.name.startsWith('.') || it.name.startsWith('$') || SKIP_DIRS.has(it.name) || BLOCKED_NAMES.test(it.name) || it.isSymbolicLink()) continue;
        const full = path.join(dir, it.name), isDir = it.isDirectory();
        if (isDir && blockedPath(full)) continue;
        if (isDir) folders++; else files++;
        if (depth === 0) { if (isDir) directDirs.push(it.name); else directFiles++; }
        if (isDir) walk(full, depth + 1);
      }
    };
    walk(sc.path, 0);
    if (complete || !fileIndex.ready)
      return res.json({ success: true, scope: sc.path, path: sc.path, folders, files, partial: !complete,
        direct: { folders: directDirs.slice(0, 40), folderCount: directDirs.length, files: directFiles }, perDrive: null });
  }
  if (!fileIndex.ready) return res.json({ success: true, indexing: true, scope: sc.all ? 'this laptop' : sc.path });
  const pre = sc.all ? '' : (sc.path.endsWith(path.sep) ? sc.path : sc.path + path.sep).toLowerCase();
  let folders = 0, files = 0, directFiles = 0; const directDirs = [], perDrive = {};
  for (let i = 0; i < fileIndex.paths.length; i++) {
    const p = fileIndex.paths[i];
    if (pre && !p.toLowerCase().startsWith(pre)) continue;
    const isDir = fileIndex.dirs[i] === 1;
    if (isDir) folders++; else files++;
    if (sc.all) { const d = p.slice(0, 2).toUpperCase(); perDrive[d] = perDrive[d] || { folders: 0, files: 0 }; perDrive[d][isDir ? 'folders' : 'files']++; }
    else if (!p.slice(pre.length).includes(path.sep)) { if (isDir) directDirs.push(path.basename(p)); else directFiles++; }
  }
  res.json({ success: true, scope: sc.all ? 'this laptop' : sc.path, path: sc.all ? '' : sc.path, folders, files,
    direct: sc.all ? null : { folders: directDirs.slice(0, 40), folderCount: directDirs.length, files: directFiles }, perDrive: sc.all ? perDrive : null,
    builtAt: fileIndex.builtAt });
});

const pdf = require('./pdftext');
const cap1 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
// Drag a file into JARVIS (or 📎): saved to ~/jarvis/Documents so you can ask about it, summarise it or make flashcards.
const UPLOAD_EXT = /\.(pdf|txt|md|markdown|csv|json|py|js|ts|c|cpp|h|java|cs|go|rs|html|css|sql|ipynb|docx|pptx|xlsx)$/i;
app.post('/api/tool/upload', express.raw({ type: 'application/octet-stream', limit: '40mb' }), async (req, res) => {
  let name = path.basename(String(req.query.name || '')).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim().slice(0, 120);
  if (!name || !UPLOAD_EXT.test(name)) return res.status(400).json({ error: 'I can take PDFs, text, Markdown and code files' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'The file was empty' });
  const dir = path.join(SANDBOX, 'Documents'); fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, name), n = 1;
  const ext = path.extname(name), base = name.slice(0, -ext.length);
  while (fs.existsSync(dest)) dest = path.join(dir, base + ' (' + (++n) + ')' + ext);
  fs.writeFileSync(dest, req.body);
  let pages = null, scanned = false;
  if (/\.pdf$/i.test(dest)) {
    try { const r = await pdf.pdfPages(dest); pages = r.total; scanned = r.scanned; }
    catch (e) { try { fs.unlinkSync(dest); } catch {} return res.status(422).json({ error: cap1(e.message) }); }
  }
  res.json({ success: true, name: rel(dest), file: path.basename(dest), pages, scanned });
});
// Opens a file with its usual program (a PDF in the PDF viewer) — anywhere on the laptop except system folders.
app.post('/api/tool/openFile', (req, res) => {
  const f = findAnywhere(String(req.body.name || ''), { kind: 'file' });
  if (!f || !f.path) return notFoundOrChoices(res, f, req.body.name);
  const p = f.path;
  if (!/\.(pdf|txt|md|png|jpe?g|gif|docx?|pptx?|xlsx?|csv|html?)$/i.test(p)) return res.status(400).json({ error: 'I only open documents and pictures this way — say "run" for programs' });
  openPath(p);
  res.json({ success: true, name: rel(p), path: p });
});
app.post('/api/tool/readFile', (req, res) => {
  const f = findAnywhere(String(req.body.name || ''), { kind: 'file' });
  if (!f || !f.path) return notFoundOrChoices(res, f, req.body.name);
  const p = f.path;
  if (/\.pdf$/i.test(p)) { // PDFs: the text of each page, with [page N] markers
    return pdf.pdfPages(p).then(r => {
      if (r.scanned) return res.status(422).json({ error: 'That PDF is pictures of pages (a scan), with no text I can read. Try "read my screen" with the page open instead' });
      let content = pdf.withMarkers(r.pages); const cut = content.length > 200000;
      if (cut) content = content.slice(0, 200000);
      res.json({ success: true, name: rel(p), path: p, content, pages: r.total, truncated: cut });
    }).catch(e => res.status(422).json({ error: cap1(e.message) }));
  }
  try {
    const st = fs.statSync(p);
    if (st.size > 200 * 1024) return res.status(413).json({ error: 'File too large to read aloud (>200KB)' });
    res.json({ success: true, name: rel(p), path: p, content: fs.readFileSync(p, 'utf-8') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Writes a file. If it already exists and neither `overwrite` nor `append` is set, returns {exists:true}
// so the client can ask the user first.
app.post('/api/tool/writeFile', (req, res) => {
  let name = String(req.body.name || '').trim().replace(/^["']|["']$/g, '');
  if (!name || /[<>:"|?*]/.test(name.replace(/^[a-z]:/i, ''))) return res.status(400).json({ error: 'Invalid file name' });
  if (!path.extname(name)) name += '.md';
  // "in desktop" / "in downloads": a plain file inside that known folder (still asks first — it is outside ~/jarvis).
  // where: a known folder ("desktop") or any folder as scopeDir reads it ("D drive", "C:\Users\me\Projects").
  const where = req.body.where ? whereDir(req.body.where) : null;
  if (where && where.error) return res.status(404).json({ error: where.error });
  let p;
  if (where) {
    // a plain name, or "new-folder/file.html" (the folder is made too) — never ".." or a drive inside it
    const parts = name.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.length > 3 || parts.some(x => /[:*?"<>|]|^\.+$/.test(x))) return res.status(400).json({ error: 'Invalid file name' });
    p = anyPath(path.join(where.path, ...parts), { forWrite: true });
  } else {
    const hasDir = /[/\\]/.test(name) || path.isAbsolute(name);
    const existing = path.isAbsolute(name) ? null : findAllowed(name, { kind: 'file', exact: true });
    const defaultDir = CODE_EXT.has(path.extname(name).toLowerCase()) ? 'Code' : 'Notes';
    // A full path ("C:\Users\you\Desktop\todo.txt") may be anywhere that isn't off-limits; a plain name lands in ~/jarvis.
    p = existing || (path.isAbsolute(name) ? anyPath(name, { forWrite: true }) : safePath(hasDir ? name : path.join(defaultDir, name)));
  }
  if (!p) return res.status(400).json({ error: 'That location is off-limits (Windows, program or app-data folders, or JARVIS itself)' });
  const content = String(req.body.content ?? '');
  if (content.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Content too large' });
  const exists = fs.existsSync(p);
  if (exists && !req.body.overwrite && !req.body.append) {
    return res.json({ success: false, exists: true, name: rel(p), path: p, size: fs.statSync(p).size });
  }
  if (!approvedChange(req, res, exists ? (req.body.append ? 'add to' : 'overwrite') : 'create', p)) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let backup = null; // the previous version, kept in the trash so "undo" can bring it back
    if (exists && (req.body.overwrite || req.body.append)) { try { backup = Date.now() + '_' + path.basename(p); fs.copyFileSync(p, path.join(TRASH, backup)); } catch { backup = null; } }
    if (req.body.append && exists) fs.appendFileSync(p, (content.startsWith('\n') ? '' : '\n') + content);
    else fs.writeFileSync(p, content);
    res.json({ success: true, name: rel(p), path: p, created: !exists, appended: !!(req.body.append && exists), backup });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/createFolder', (req, res) => {
  // "in desktop" / "in downloads": a plain name inside that known folder (still asks first — it is outside ~/jarvis).
  // where: a known folder ("desktop") or any folder as scopeDir reads it ("D drive", "C:\Users\me\Projects").
  const where = req.body.where ? whereDir(req.body.where) : null;
  if (where && where.error) return res.status(404).json({ error: where.error });
  const nm = String(req.body.name || '').trim();
  if (where && (!nm || /[\\/:*?"<>|]|^\.+$/.test(nm))) return res.status(400).json({ error: 'Invalid folder name' });
  const p = where ? anyPath(path.join(where.path, nm), { forWrite: true }) : anyPath(nm, { forWrite: true });
  if (!p || p === SANDBOX) return res.status(400).json({ error: 'Invalid folder name' });
  // Nothing changes when the folder is already there — report that without asking permission first.
  try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return res.json({ success: true, name: rel(p), path: p, existed: true }); } catch {}
  if (!approvedChange(req, res, 'create the folder', p)) return;
  try {
    const existed = fs.existsSync(p);
    fs.mkdirSync(p, { recursive: true });
    res.json({ success: true, name: rel(p), path: p, existed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The exact item named — a full path anywhere, or an exact name in ~/jarvis / project folders. Never a near-miss:
// these are the routes that change or remove things.
function exactItem(name, kind) {
  const s = String(name || '').trim().replace(/^["']|["']$/g, '');
  if (path.isAbsolute(s) && !/^[/\\]/.test(s)) { const p = anyPath(s); return p && fs.existsSync(p) && (!kind || (kind === 'folder') === fs.statSync(p).isDirectory()) ? p : null; }
  return findAllowed(s, { kind, exact: true });
}
// Into JARVIS's trash (so "undo" can restore it). Across drives a rename fails, so copy, then remove.
function moveToTrash(p) {
  const trashName = `${Date.now()}_${path.basename(p)}`, dest = path.join(TRASH, trashName);
  fs.mkdirSync(TRASH, { recursive: true });
  try { fs.renameSync(p, dest); }
  catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(p, dest, { recursive: true }); fs.rmSync(p, { recursive: true, force: true }); }
  return trashName;
}
app.post('/api/tool/deleteItem', (req, res) => {
  const p = exactItem(req.body.name, req.body.kind);
  if (!p || p === SANDBOX || blockedPath(p, { forWrite: true })) return res.status(404).json({ error: `I can't find "${req.body.name}" (or it's somewhere I never delete)` });
  if (config.roots.some(r => norm(r) === norm(p))) return res.status(403).json({ error: 'That is one of your project folders — remove it from Settings first, and delete it yourself' });
  if (!approvedChange(req, res, 'delete', p)) return;
  try {
    const original = rel(p);
    const trashName = moveToTrash(p);
    res.json({ success: true, name: rel(p), trashed: true, trashName, original });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/clearSandbox', (req, res) => {
  try {
    const items = fs.readdirSync(SANDBOX).filter(n => !n.startsWith('.'));
    const moved = [];
    for (const n of items) { const t = `${Date.now()}_${n}`; fs.renameSync(path.join(SANDBOX, n), path.join(TRASH, t)); moved.push({ trashName: t, original: n }); }
    res.json({ success: true, count: items.length, items: moved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Source (exact item) and destination for rename / copy / move. A bare new name stays next to the original
// ("rename report.md to final.md" on your Desktop stays on your Desktop); a folder name puts it inside that folder.
function twoPaths(src0, dest0, res) {
  const src = exactItem(src0);
  if (!src || blockedPath(src)) { res.status(404).json({ error: `I can't find "${src0}"` }); return null; }
  const d = String(dest0 || '').trim().replace(/^["']|["']$/g, '');
  if (!d) { res.status(400).json({ error: 'Invalid destination' }); return null; }
  const folder = !path.isAbsolute(d) && findAllowed(d, { kind: 'folder', exact: true });
  let dest = path.isAbsolute(d) ? anyPath(d, { forWrite: true }) : folder ? folder : /[/\\]/.test(d) ? safePath(d) : path.join(path.dirname(src), path.basename(d));
  if (!dest) { res.status(400).json({ error: 'Invalid destination' }); return null; }
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, path.basename(src));
  if (fs.existsSync(dest)) { res.status(409).json({ error: `"${rel(dest)}" already exists` }); return null; }
  return { src, dest };
}
// Across drives a rename fails: copy, then remove.
function moveAcross(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(src, dest); }
  catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(src, dest, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); }
}

app.post('/api/tool/renameFile', (req, res) => {
  const pr = twoPaths(req.body.oldName, req.body.newName, res);
  if (!pr || !approvedChange(req, res, 'rename', pr.src, pr.dest)) return;
  try { moveAcross(pr.src, pr.dest); res.json({ success: true, from: rel(pr.src), to: rel(pr.dest) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/copyFile', (req, res) => {
  const pr = twoPaths(req.body.src, req.body.dest, res);
  if (!pr || !approvedChange(req, res, 'copy into', pr.dest)) return;   // the original isn't changed
  try { fs.cpSync(pr.src, pr.dest, { recursive: true }); res.json({ success: true, from: rel(pr.src), to: rel(pr.dest) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/moveFile', (req, res) => {
  const pr = twoPaths(req.body.src, req.body.dest, res);
  if (!pr || !approvedChange(req, res, 'move', pr.src, pr.dest)) return;
  try { moveAcross(pr.src, pr.dest); res.json({ success: true, from: rel(pr.src), to: rel(pr.dest) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- undo helpers (page "undo"): restore from the trash, move back, remove a just-created item ---- */
const RECENT = 15 * 60000;
app.post('/api/tool/restoreItem', (req, res) => {
  const t = String(req.body.trashName || '');
  if (!/^\d+_[^\\/:*?"<>|]+$/.test(t)) return res.status(400).json({ error: 'Invalid trash item' });
  const src = path.join(TRASH, t);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'That item is no longer in the trash' });
  const dest = anyPath(String(req.body.original || ''), { forWrite: true });
  if (!dest) return res.status(400).json({ error: 'Invalid original location' });
  if (fs.existsSync(dest)) return res.status(409).json({ error: `"${rel(dest)}" exists again, so I won't overwrite it` });
  if (!approvedChange(req, res, 'restore', dest)) return;
  try { moveAcross(src, dest); res.json({ success: true, name: rel(dest) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tool/restoreVersion', (req, res) => { // puts back the file as it was before an overwrite/append
  const t = String(req.body.backup || '');
  if (!/^\d+_[^\\/:*?"<>|]+$/.test(t)) return res.status(400).json({ error: 'Invalid backup' });
  const src = path.join(TRASH, t), dest = anyPath(String(req.body.name || ''), { forWrite: true });
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'The earlier version is no longer in the trash' });
  if (!dest) return res.status(400).json({ error: 'Invalid file' });
  if (!approvedChange(req, res, 'restore the earlier version of', dest)) return;
  try { fs.copyFileSync(src, dest); res.json({ success: true, name: rel(dest) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tool/undoMove', (req, res) => { // moves "to" back to "from" (undo of rename/move)
  const to = anyPath(String(req.body.to || ''), { forWrite: true }), from = anyPath(String(req.body.from || ''), { forWrite: true });
  if (!to || !from || !fs.existsSync(to)) return res.status(404).json({ error: 'The moved item isn\u2019t there any more' });
  if (fs.existsSync(from)) return res.status(409).json({ error: `"${rel(from)}" exists again, so I won't overwrite it` });
  if (!approvedChange(req, res, 'move back', to, from)) return;
  try { moveAcross(to, from); res.json({ success: true, name: rel(from) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tool/undoCreate', (req, res) => { // removes something JARVIS created a moment ago (goes to the trash, not deleted)
  const p = exactItem(req.body.name);
  if (!p || p === SANDBOX || blockedPath(p, { forWrite: true })) return res.status(404).json({ error: `I can't find "${req.body.name}"` });
  try {
    const st = fs.statSync(p);
    if (Date.now() - (st.birthtimeMs || st.ctimeMs) > RECENT) return res.status(403).json({ error: 'That was made more than 15 minutes ago, so I won\u2019t remove it automatically' });
    if (!approvedChange(req, res, 'remove', p)) return;
    moveToTrash(p);
    res.json({ success: true, name: rel(p) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/searchFiles', (req, res) => {
  const q = String(req.body.query || '').toLowerCase().trim();
  if (!q) return res.status(400).json({ error: 'Query required' });
  const results = [], paths = [];   // paths: the same items as full paths (for "open the second one")
  const walk = (dir, depth) => {
    if (depth > 5 || results.length >= 30) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (item.name.startsWith('.') || SKIP_DIRS.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.name.toLowerCase().includes(q)) { results.push(rel(full) + (item.isDirectory() ? '/' : '')); paths.push(full); }
      if (item.isDirectory()) walk(full, depth + 1);
    }
  };
  try {
    allRoots().forEach(r => walk(r, 0));
    // Then the rest of the laptop (Desktop, Documents, Downloads, drives), shown as full paths.
    if (results.length < 30) for (const p of laptopSearch(q, { contains: true, max: 30 - results.length })) {
      if (!rootOf(p)) { let dir = false; try { dir = fs.statSync(p).isDirectory(); } catch {} results.push(p + (dir ? path.sep : '')); paths.push(p); }
    }
    res.json({ success: true, results, paths });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tool/openFolder', (req, res) => {
  const name = String(req.body.name || '').trim();
  const f = name ? findAnywhere(name, { kind: 'folder' }) : { path: SANDBOX };
  if (!f || !f.path) return notFoundOrChoices(res, f, name);
  const p = f.path;
  openPath(p);
  res.json({ success: true, name: rel(p) || '~/jarvis', path: p });
});

/* ---------------- code: editor / run / paste ---------------- */
// Locate VS Code's executable so paths are passed as real argv (no cmd.exe parsing of file names).
let VSCODE = null;
try {
  const cmd = require('child_process').execFileSync(IS_WIN ? 'where' : 'which', ['code'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
  const exe = IS_WIN ? path.join(path.dirname(path.dirname(cmd)), 'Code.exe') : cmd;
  VSCODE = fs.existsSync(exe) ? exe : null;
} catch {}

app.post('/api/tool/openInEditor', (req, res) => {
  const name = String(req.body.name || '').trim();
  const f = name ? findAnywhere(name) : { path: SANDBOX };
  if (!f || !f.path) return notFoundOrChoices(res, f, name);
  const p = f.path;
  if (!VSCODE) return res.status(501).json({ error: 'VS Code (code) is not installed or not on PATH' });
  const child = spawn(VSCODE, [p], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  res.json({ success: true, name: rel(p), path: p });
});

// "open dsa sprint in vs code and ask copilot to …" / "ask claude in dsa sprint to …" — open a coding tool
// (an editor fork's chat, or a terminal agent) in a project folder and hand its AI a prompt. See codetools.js.
require('./codetools')(app, { findAllowed, rel, SANDBOX });

// "What do my notes say about …?" — local keyword search over the sandbox and project folders (rag.js).
const doctext = require('./doctext');
// .docx/.pptx/.xlsx → text, read directly (small, local, capped — see doctext.js).
const docText = file => { try { return doctext.extractDocText(file, fs.readFileSync(file)); } catch (e) { return { error: e.message }; } };
// Semantic search: opt-in in Settings; needs an embedding model (default: Ollama's nomic-embed-text).
const semModel = () => String((appState['jarvis.settings'] || {}).embedModel || 'nomic-embed-text').slice(0, 80);
const semEnabled = () => (appState['jarvis.settings'] || {}).semanticSearch === true;
const rag = require('./rag')(app, { allRoots, SKIP_DIRS, rel, isInternal, pdfPages: pdf.pdfPages, docText,
  semantic: { enabled: semEnabled, model: semModel, embed: (m, inputs) => llm.embed(m, inputs) } });
rag.startWatcher(); // new/changed files are picked up automatically (still cheap; explicit reindex stays available)

// Website generator, DSA coach and viva practice (skills.js).
require('./skills')(app, { llm, DEFAULT_MODEL, SANDBOX, openPath, rel, findAllowed, anyPath, approvedChange, whereDir });
require('./jarviscode')(app, { llm, DEFAULT_MODEL, SANDBOX, anyPath, approvedChange, whereDir, rel, TRASH });

// Checks only — JARVIS never installs a missing compiler or extension, it just reports what it found.
const TOOLCHAIN = {
  cpp: { cmd: 'g++', label: 'g++ (C++)' }, c: { cmd: 'gcc', label: 'gcc (C)' },
  python: { cmd: IS_WIN ? 'python' : 'python3', label: 'Python' }, javascript: { cmd: null, label: 'Node.js' }, // Node is always present — it's what's running this check
};
app.post('/api/tool/checkCompiler', (req, res) => {
  const t = TOOLCHAIN[String(req.body.language || '').toLowerCase()];
  if (!t) return res.status(400).json({ error: 'Unknown language' });
  if (!t.cmd) return res.json({ success: true, found: true, label: t.label });
  execFile(IS_WIN ? 'where' : 'which', [t.cmd], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
    res.json({ success: true, found: !err, label: t.label, path: err ? null : stdout.split(/\r?\n/)[0].trim() });
  });
});
// "what version of node am I running": the version installed on THIS laptop (not the latest release on the web).
// A fixed list — the name you say only picks an entry; it never reaches a command line.
const VERSION_TOOLS = {
  node: { label: 'Node.js', run: null }, nodejs: { label: 'Node.js', run: null }, npm: { label: 'npm', cmd: 'npm', args: ['--version'], shell: true },
  python: { label: 'Python', cmd: IS_WIN ? 'python' : 'python3', args: ['--version'] }, pip: { label: 'pip', cmd: IS_WIN ? 'pip' : 'pip3', args: ['--version'] },
  git: { label: 'Git', cmd: 'git', args: ['--version'] }, java: { label: 'Java', cmd: 'java', args: ['-version'] }, javac: { label: 'javac', cmd: 'javac', args: ['-version'] },
  gcc: { label: 'gcc', cmd: 'gcc', args: ['--version'] }, 'g++': { label: 'g++', cmd: 'g++', args: ['--version'] }, ollama: { label: 'Ollama', cmd: 'ollama', args: ['--version'] },
  docker: { label: 'Docker', cmd: 'docker', args: ['--version'] }, vscode: { label: 'VS Code', cmd: 'code', args: ['--version'], shell: true },
};
app.post('/api/tool/toolVersion', (req, res) => {
  const key = String(req.body.tool || '').toLowerCase().replace(/[\s.]+/g, '').replace(/^vscode|^visualstudiocode/, 'vscode').replace(/^python3$/, 'python').replace(/^cpp$|^c\+\+$/, 'g++');
  const t = VERSION_TOOLS[key];
  if (!t) return res.status(400).json({ error: 'I can check: ' + [...new Set(Object.values(VERSION_TOOLS).map(x => x.label))].join(', ') });
  if (t.run === null) return res.json({ success: true, label: t.label, found: true, version: process.version.replace(/^v/, '') });
  execFile(t.cmd, t.args, { windowsHide: true, timeout: 8000, shell: !!t.shell }, (err, stdout, stderr) => {
    const out = String(stdout || '') + String(stderr || '');
    const v = (out.match(/\d+\.\d+(?:\.\d+)?(?:[-+_.\w]*)?/) || [])[0];
    if (err && !v) return res.json({ success: true, label: t.label, found: false });
    res.json({ success: true, label: t.label, found: true, version: v || out.trim().split(/\r?\n/)[0].slice(0, 80) });
  });
});
// "what's the latest file in my project": the newest-modified files in a folder (your files; names and times only).
app.post('/api/tool/recentFiles', (req, res) => {
  const raw = String(req.body.dir || '').trim();
  const sc = raw ? scopeDir(raw) : null;
  if (sc && sc.error) return res.status(404).json({ error: sc.error });
  const f = sc && sc.path ? { path: sc.path } : raw ? findAnywhere(raw, { kind: 'folder' }) : { path: SANDBOX };
  if (!f || !f.path) return notFoundOrChoices(res, f, raw);
  const out = [], t0 = Date.now();
  const walk = (dir, depth) => {
    if (depth > 6 || out.length > 20000 || Date.now() - t0 > 3000) return;
    let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.') || it.name.startsWith('$') || SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) { if (!blockedPath(full)) walk(full, depth + 1); continue; }
      try { out.push({ full, m: fs.statSync(full).mtimeMs }); } catch {}
    }
  };
  walk(f.path, 0);
  out.sort((a, b) => b.m - a.m);
  res.json({ success: true, dir: f.path, files: out.slice(0, Math.min(10, +req.body.n || 5)).map(x => ({ path: x.full, name: path.relative(f.path, x.full), modified: x.m })) });
});
const RECOMMENDED_EXT = { cpp: 'ms-vscode.cpptools', c: 'ms-vscode.cpptools', python: 'ms-python.python', javascript: null };
app.post('/api/tool/checkExtension', (req, res) => {
  const lang = String(req.body.language || '').toLowerCase();
  const ext = RECOMMENDED_EXT[lang];
  if (!(lang in RECOMMENDED_EXT)) return res.status(400).json({ error: 'Unknown language' });
  if (!ext) return res.json({ success: true, applicable: false });
  if (!VSCODE) return res.json({ success: true, applicable: true, found: false, extension: ext });
  // "code --list-extensions" can hang if it tries to talk to an already-running VS Code instance instead of
  // just listing and exiting — bounded so one slow check can never stall the rest of a plan.
  execFile(VSCODE, ['--list-extensions'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
    const found = !err && String(stdout).split(/\r?\n/).some(l => l.trim().toLowerCase() === ext.toLowerCase());
    res.json({ success: true, applicable: true, found, extension: ext, timedOut: !!(err && err.killed) });
  });
});

const RUNNERS = {
  '.py': p => [IS_WIN ? 'python' : 'python3', ['-u', p]],
  '.js': p => [process.execPath, [p]],
  '.mjs': p => [process.execPath, [p]],
};
const COMPILERS = { '.c': 'gcc', '.cpp': 'g++', '.cc': 'g++' };
const cap = (s, n = 20000) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more characters truncated)` : s);

/* ---------------- dev servers: locate a project, start/stop its backend or frontend ----------------
   The command to run is never typed by the user or invented by the AI — it only ever comes from the
   project's own package.json ("dev"/"start"/"serve" script) or a well-known entry file (manage.py, app.py).
   That keeps this from ever becoming a general "run a shell command" tool. */
const DEV_PROCS = new Map(); // id -> { id, pid, project, projDir, which, dir, label, alive, exitCode, out, port }
let devProcSeq = 0;
const PKG_SCRIPT_PRIORITY = ['dev', 'start', 'serve'];
function detectStart(dir) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
      const name = PKG_SCRIPT_PRIORITY.find(n => scripts[n]);
      if (name) return IS_WIN
        ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', 'run', name], label: 'npm run ' + name }
        : { cmd: 'npm', args: ['run', name], label: 'npm run ' + name };
    }
  } catch {}
  if (fs.existsSync(path.join(dir, 'manage.py'))) return { cmd: IS_WIN ? 'python' : 'python3', args: ['manage.py', 'runserver'], label: 'python manage.py runserver' };
  for (const f of ['app.py', 'main.py', 'server.py']) {
    if (fs.existsSync(path.join(dir, f))) return { cmd: IS_WIN ? 'python' : 'python3', args: [f], label: 'python ' + f };
  }
  return null;
}
const ROLE_DIRS = { backend: ['backend', 'server', 'api'], frontend: ['frontend', 'client', 'web', 'ui'] };
function findRoleDir(projectDir, which) {
  if (which === 'app') return detectStart(projectDir) ? projectDir : null;
  for (const n of ROLE_DIRS[which] || []) {
    const d = path.join(projectDir, n);
    if (fs.existsSync(d) && fs.statSync(d).isDirectory() && detectStart(d)) return d;
  }
  return null;
}
function findDevProc(projDir, which) { return [...DEV_PROCS.values()].find(p => p.alive && p.projDir === projDir && p.which === which); }
// A start that died because the project's dependencies were never installed (no node_modules, "Cannot find module
// 'express'", "'vite' is not recognized…", Python's "No module named flask"). Only ever answers with the project's
// own install command (npm install / pip install -r requirements.txt) — a missing *relative* module ('./routes')
// is a code bug, not a dependency, and gets null. → { tool, command, module } | null
function depsInstall(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return IS_WIN
    ? { tool: 'npm', cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', 'install'], command: 'npm install' }
    : { tool: 'npm', cmd: 'npm', args: ['install'], command: 'npm install' };
  if (fs.existsSync(path.join(dir, 'requirements.txt'))) return { tool: 'pip', cmd: IS_WIN ? 'python' : 'python3', args: ['-m', 'pip', 'install', '-r', 'requirements.txt'], command: 'pip install -r requirements.txt' };
  return null;
}
function missingDeps(dir, out) {
  const inst = depsInstall(dir);
  if (!inst) return null;
  if (inst.tool === 'npm') {
    const m = out.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/i);
    if (m && /^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:)/.test(m[1])) return null;
    const noModules = !fs.existsSync(path.join(dir, 'node_modules'));
    const cmdMissing = out.match(/'([\w.-]+)' is not recognized as an internal or external command|\b([\w.-]+): (?:command )?not found/i);
    if (m || noModules || cmdMissing) return { tool: inst.tool, command: inst.command, module: m ? m[1] : cmdMissing ? (cmdMissing[1] || cmdMissing[2]) : null };
    return null;
  }
  const p = out.match(/No module named ['"]?([\w.]+)/);
  return p ? { tool: inst.tool, command: inst.command, module: p[1] } : null;
}

app.post('/api/tool/locateProject', (req, res) => {
  const p = findAllowed(String(req.body.name || ''), { kind: 'folder' });
  if (!p) return res.status(404).json({ error: `I can't find a project called "${req.body.name}"` });
  res.json({ success: true, name: rel(p), path: p });
});

// A folder the user named that isn't in ~/jarvis or their project folders yet (e.g. Desktop\dsa_sprint): look for it in
// the usual places so the page can ask "allow JARVIS to use it?". Only reports paths; adding it still goes through
// Settings → Project folders rules (/api/config add), after the user clicks.
app.post('/api/tool/findFolderAnywhere', (req, res) => {
  const want = String(req.body.name || '').trim();
  if (!want || want.length > 80 || /[\\/:*?"<>|]/.test(want)) return res.status(400).json({ error: 'Invalid folder name' });
  // The shared laptop search (laptopSearch): forgiving names, version suffixes, system folders skipped.
  res.json({ success: true, paths: laptopSearch(want, { kind: 'folder', max: 5 }).filter(p => !FORBIDDEN_ROOTS.some(f => norm(p) === norm(f))) });
});

app.post('/api/tool/startProcess', (req, res) => {
  const which = String(req.body.which || '');
  if (!['backend', 'frontend', 'app'].includes(which)) return res.status(400).json({ error: 'which must be backend, frontend or app' });
  const projDir = findAllowed(String(req.body.name || ''), { kind: 'folder' });
  if (!projDir) return res.status(404).json({ error: `I can't find a project called "${req.body.name}"` });
  const existing = findDevProc(projDir, which);
  if (existing) return res.json({ success: true, id: existing.id, pid: existing.pid, existed: true, port: existing.port, command: existing.label, dir: rel(existing.dir) });
  const dir = findRoleDir(projDir, which);
  const start = dir && detectStart(dir);
  if (!dir || !start) return res.status(404).json({ error: `No ${which} found in "${rel(projDir)}" (looked for a package.json script or a known entry file)` });
  const id = 'proc_' + (++devProcSeq);
  const child = spawn(start.cmd, start.args, { cwd: dir, windowsHide: true, detached: !IS_WIN });
  const rec = { id, pid: child.pid, project: rel(projDir), projDir, which, dir, label: start.label, alive: true, exitCode: null, out: '', port: null };
  DEV_PROCS.set(id, rec);
  const onData = b => {
    rec.out = (rec.out + b.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-4000);
    // Never read a port out of a crash dump: Node's EADDRINUSE error object itself contains "port: 5055",
    // which would otherwise look exactly like a successful "now listening" announcement.
    if (!rec.port && !/EADDRINUSE|\berror\b/i.test(rec.out)) {
      const m = rec.out.match(/(?:localhost|127\.0\.0\.1)[:\s]*:(\d{2,5})|\b(?:listening|running)\b[^\n]*?\bport\b[:\s]+(\d{2,5})/i);
      if (m) rec.port = Number(m[1] || m[2]);
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', code => { rec.alive = false; rec.exitCode = code; });
  child.on('error', e => { rec.alive = false; rec.out += '\n' + e.message; });
  // Poll instead of a single fixed wait: resolves the moment the port is known or it fails fast (e.g. the
  // port is already in use), but still gives npm's cmd.exe/npm.cmd wrapper up to 4s to get going on Windows.
  const t0 = Date.now();
  (function poll() {
    if (!rec.alive) {
      const inUse = /EADDRINUSE|address already in use|already in use/i.test(rec.out);
      // Prefer an explicit "port: 5055" (Node's structured error object always has one) over guessing from
      // proximity to "EADDRINUSE" — that text also sits right next to unrelated numbers like the errno.
      const m1 = rec.out.match(/\bport['":\s]{1,4}(\d{2,5})\b/i);
      const m2 = !m1 && rec.out.match(/(\d{4,5})\D{0,20}(?:already in use|EADDRINUSE)|EADDRINUSE\D{0,20}(\d{4,5})/i);
      const port = m1 ? Number(m1[1]) : m2 ? Number(m2[1] || m2[2]) : null;
      return res.json({ success: false, id, exitCode: rec.exitCode, portInUse: inUse, port, missingDeps: inUse ? null : missingDeps(dir, rec.out), tail: rec.out.slice(-800), command: start.label, dir: rel(dir) });
    }
    if (rec.port || Date.now() - t0 > 4000) return res.json({ success: true, id, pid: rec.pid, port: rec.port, command: start.label, dir: rel(dir), existed: false });
    setTimeout(poll, 250);
  })();
});

app.post('/api/tool/stopProcess', (req, res) => {
  const which = String(req.body.which || '');
  const projDir = findAllowed(String(req.body.name || ''), { kind: 'folder' });
  const rec = projDir && findDevProc(projDir, which);
  if (!rec) return res.status(404).json({ error: `No running ${which || 'process'} for "${req.body.name}" that I started` });
  rec.alive = false;
  if (IS_WIN) execFile('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { windowsHide: true }, () => res.json({ success: true, id: rec.id }));
  else { try { process.kill(-rec.pid, 'SIGTERM'); } catch { try { process.kill(rec.pid, 'SIGTERM'); } catch {} } res.json({ success: true, id: rec.id }); }
});

// Install a project's dependencies with its own install command (see depsInstall) — the agent only calls this
// after the user approved it, following a start that failed with missingDeps. Never runs anything else.
app.post('/api/tool/installDeps', async (req, res) => {
  const which = String(req.body.which || '');
  if (!['backend', 'frontend', 'app'].includes(which)) return res.status(400).json({ error: 'which must be backend, frontend or app' });
  const projDir = findAllowed(String(req.body.name || ''), { kind: 'folder' });
  if (!projDir) return res.status(404).json({ error: `I can't find a project called "${req.body.name}"` });
  const dir = findRoleDir(projDir, which);
  const inst = dir && depsInstall(dir);
  if (!inst) return res.status(404).json({ error: `No package.json or requirements.txt for the ${which} of "${rel(projDir)}"` });
  const r = await runProc(inst.cmd, inst.args, { cwd: dir, timeout: 5 * 60e3 });
  const tail = (r.stderr + '\n' + r.stdout).trim().slice(-800);
  res.json({ success: r.exitCode === 0 && !r.timedOut, command: inst.command, dir: rel(dir), exitCode: r.exitCode, timedOut: r.timedOut, ms: r.ms, tail });
});

// Does anything answer HTTP on this port? Any response at all (even a 404) means the server is up.
function probePort(port, ms = 1500) {
  return new Promise(resolve => {
    const req = require('http').get({ host: 'localhost', port, path: '/', timeout: ms }, r => { r.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
app.post('/api/tool/processStatus', async (req, res) => {
  const which = String(req.body.which || '');
  const projDir = findAllowed(String(req.body.name || ''), { kind: 'folder' });
  const rec = projDir && findDevProc(projDir, which);
  if (!rec) return res.json({ success: true, found: false });
  const responding = rec.alive && rec.port ? await probePort(rec.port) : null;
  res.json({ success: true, found: true, alive: rec.alive, pid: rec.pid, port: rec.port, responding, exitCode: rec.exitCode, tail: rec.out.slice(-800) });
});

// Who is listening on a port, and — the key safety gate for auto-recovery — is it a process JARVIS itself
// started earlier for this same project and role? Only then does the executor ever offer to close it.
app.post('/api/tool/portOwner', (req, res) => {
  const port = Number(req.body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Port must be 1-65535' });
  const respond = (pid, name) => {
    if (!pid) return res.json({ success: true, found: false });
    const jp = [...DEV_PROCS.values()].find(p => p.pid === pid);
    res.json({ success: true, found: true, pid, name: name || 'unknown', ownedByJarvis: !!jp, project: jp ? jp.project : null, which: jp ? jp.which : null });
  };
  if (!IS_WIN) {
    return execFile('lsof', ['-t', '-i', ':' + port], (err, stdout) => {
      const pid = Number(String(stdout).trim().split('\n')[0]);
      if (!pid) return respond(null);
      execFile('ps', ['-p', String(pid), '-o', 'comm='], (e2, out2) => respond(pid, String(out2 || '').trim()));
    });
  }
  execFile('netstat', ['-ano'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err) return respond(null);
    const line = String(stdout).split(/\r?\n/).find(l => new RegExp('[:.]' + port + '\\s').test(l) && /LISTENING/i.test(l));
    const pid = line && Number(line.trim().split(/\s+/).pop());
    if (!pid) return respond(null);
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e2, out2) => {
      respond(pid, (String(out2 || '').split('","')[0] || '').replace(/^"/, ''));
    });
  });
});

function runProc(cmd, args, opts, stdin) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    const clean = s => cap(String(s || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n'));
    const child = execFile(cmd, args, { timeout: opts.timeout || 10000, maxBuffer: 1024 * 1024, windowsHide: true, cwd: opts.cwd, env }, (err, stdout, stderr) => {
      resolve({
        stdout: clean(stdout), stderr: clean(stderr) || (err && !err.killed && err.code === 'ENOENT' ? `${cmd} not found — is it installed and on PATH?` : ''),
        exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), ms: Date.now() - t0,
      });
    });
    if (child.stdin) child.stdin.end(stdin || '');
  });
}

app.post('/api/tool/runFile', async (req, res) => {
  // Anywhere on the laptop; the page asks before running (RUN_FILE needs your permission).
  const f = findAnywhere(String(req.body.name || ''), { kind: 'file' });
  if (!f || !f.path) return notFoundOrChoices(res, f, req.body.name);
  const p = f.path;
  const ext = path.extname(p).toLowerCase();
  const cwd = path.dirname(p);
  const stdin = String(req.body.stdin || '');
  try {
    if (RUNNERS[ext]) {
      const [cmd, args] = RUNNERS[ext](p);
      return res.json({ success: true, name: rel(p), lang: ext.slice(1), ...(await runProc(cmd, args, { cwd }, stdin)) });
    }
    if (COMPILERS[ext]) {
      const exe = path.join(os.tmpdir(), `jarvis_run_${Date.now()}${IS_WIN ? '.exe' : ''}`);
      const comp = await runProc(COMPILERS[ext], [p, '-o', exe], { cwd, timeout: 30000 });
      if (comp.exitCode !== 0) return res.json({ success: true, name: rel(p), lang: ext.slice(1), compileError: true, ...comp });
      const out = await runProc(exe, [], { cwd }, stdin);
      fs.unlink(exe, () => {});
      return res.json({ success: true, name: rel(p), lang: ext.slice(1), compileMs: comp.ms, ...out });
    }
    res.status(400).json({ error: `I can run .py, .js, .c and .cpp files — not ${ext || 'this file'}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Presses Ctrl+V in whatever window is focused after a short delay (user switches to their editor first).
app.post('/api/tool/pasteKeys', (req, res) => {
  const delayMs = Math.max(1000, Math.min(10000, parseInt(req.body.delayMs) || 3000));
  setTimeout(() => {
    if (IS_WIN) run('powershell', ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).SendKeys('^v')"]);
    else if (IS_MAC) run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    else run('xdotool', ['key', 'ctrl+v']);
  }, delayMs);
  res.json({ success: true, delayMs });
});

/* ---------------- windows helpers ---------------- */
app.post('/api/tool/showDesktop', (req, res) => {
  if (IS_WIN) run('powershell', ['-NoProfile', '-Command', '(New-Object -ComObject Shell.Application).MinimizeAll()']);
  else if (!IS_MAC) run('xdotool', ['key', 'super+d']);
  res.json({ success: true });
});

const KNOWN = { downloads: 'Downloads', documents: 'Documents', desktop: 'Desktop', pictures: 'Pictures', photos: 'Pictures', music: 'Music', videos: 'Videos' };
// Desktop/Documents/… — the normal folder, or the OneDrive one when Windows moved it there.
function knownFolder(key) {
  const sub = KNOWN[String(key || '').toLowerCase()];
  return sub ? [path.join(os.homedir(), sub), path.join(os.homedir(), 'OneDrive', sub)].find(c => fs.existsSync(c)) || null : null;
}
app.post('/api/tool/openKnownFolder', (req, res) => {
  const key = String(req.body.name || '').toLowerCase();
  const sub = KNOWN[key];
  if (!sub) return res.status(400).json({ error: 'Unknown folder' });
  const p = knownFolder(key);
  if (!p) return res.status(404).json({ error: `Couldn't find your ${sub} folder` });
  openPath(p);
  res.json({ success: true, name: sub, path: p });
});

// Which of the given allowlisted apps are currently running (for distraction-free mode).
app.post('/api/tool/runningApps', (req, res) => {
  const keys = (Array.isArray(req.body.apps) ? req.body.apps : []).map(k => String(k).toLowerCase()).filter(k => procOf(k));
  // "checked" = apps with a known process name; anything else can't be verified either way.
  const done = list => res.json({ success: true, checked: keys, running: keys.filter(k => list.has(procOf(k).toLowerCase())) });
  if (IS_WIN) {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // If the process list can't be read, say so (checked: []) — "not running" would be a false answer that makes
      // the agent report a verified-looking failure ("Notepad doesn't seem to have started").
      if (err) return res.json({ success: true, checked: [], running: [], error: 'could not read the process list' });
      done(new Set(stdout.split(/\r?\n/).map(l => (l.split('","')[0] || '').replace(/^"/, '').replace(/\.exe$/i, '').toLowerCase())));
    });
  } else {
    execFile('ps', ['-A', '-o', 'comm='], (err, stdout) => done(new Set(err ? [] : stdout.split('\n').map(l => path.basename(l.trim()).toLowerCase()))));
  }
});

/* ---------------- fetch a web page as text (for summaries) ---------------- */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|\[?f[cd])/i;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const stripTags = s => decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Fetches a public web page and returns its readable text.
async function pageText(href, { timeout = 10000, max = 8000 } = {}) {
  let url;
  try { url = new URL(String(href || '')); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || PRIVATE_HOST.test(url.hostname)) throw new Error('Only public http(s) pages');
  const r = await fetch(url.href, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,text/plain', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!r.ok) throw new Error(`Page returned HTTP ${r.status}`);
  const html = (await r.text()).slice(0, 1024 * 1024);
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const text = decodeEntities(html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, url: url.href, text: text.slice(0, max) };
}

app.post('/api/tool/fetchPage', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  try { res.json({ success: true, ...(await pageText(req.body.url)) }); }
  catch (e) { res.status(/Invalid|Only public/.test(e.message) ? 400 : 502).json({ error: e.message }); }
});

/* ---------------- web search (Bing HTML, no API key) ---------------- */
const searchCache = new Map();
function bingRealUrl(href) {
  href = decodeEntities(href);
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const enc = u.searchParams.get('u') || '';
      if (enc.startsWith('a1')) return Buffer.from(enc.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
    return u.href;
  } catch { return null; }
}
const SEARCH_STOP = new Set(['the', 'a', 'an', 'of', 'for', 'in', 'on', 'to', 'and', 'or', 'is', 'are', 'was', 'were', 'what', 'who', 'when', 'where', 'which', 'how', 'why',
  'latest', 'upcoming', 'current', 'new', 'best', 'top', 'released', 'release', 'about', 'tell', 'me', 'my', 'with', 'from', 'this', 'that', 'did', 'does', 'do', 'list', 'all']);
// Words every page about anything contains ("website", "official"): they must not make an unrelated page look
// relevant — "smart india hackathon website" once scored website-builder pages above the real site.
const GENERIC_WORDS = new Set(['website', 'websites', 'site', 'sites', 'web', 'page', 'pages', 'webpage', 'homepage', 'home', 'official', 'portal', 'online', 'link', 'login', 'open']);
// Everyday words that make a poor first search word (Bing latches onto the first word of a weak query).
const COMMON_WORDS = new Set(['won', 'win', 'wins', 'winner', 'last', 'latest', 'new', 'newest', 'news', 'best', 'first', 'top', 'price', 'today', 'now', 'current',
  'invented', 'invent', 'created', 'made', 'happened', 'happening', 'year', 'time', 'about', 'right', 'live', 'score', 'result', 'results', 'recent', 'update', 'updates']);
const keywords = q => [...new Set(q.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !SEARCH_STOP.has(w) && !GENERIC_WORDS.has(w)))];
// Share of query keywords found in the top results; acronyms (IPL, SIH) and numbers (2026) count double.
function relevance(results, q) {
  const kw = keywords(q);
  if (!kw.length || !results.length) return 0;
  const acr = new Set((q.match(/\b[A-Z]{2,6}\b/g) || []).map(w => w.toLowerCase()));
  // Everyday words count half: pages about "won" (the currency) must not tie with pages about "ipl".
  const weight = k => (acr.has(k) || /\d/.test(k) ? 2 : COMMON_WORDS.has(k) ? 0.5 : 1);
  const total = kw.reduce((s, k) => s + weight(k), 0);
  const top = results.slice(0, 3);
  return top.reduce((s, r) => { const hay = (r.title + ' ' + r.url + ' ' + r.snippet).toLowerCase(); return s + kw.filter(k => hay.includes(k)).reduce((a, k) => a + weight(k), 0) / total; }, 0) / top.length;
}
// Bing's no-JS results fixate on the first word of some queries ("who won X" → dictionary pages),
// so low-relevance results are retried with the most specific word first and with the words reversed.
async function webSearch(q) {
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.results;
  let best = await searchOnce(q), bestScore = relevance(best, q);
  // DuckDuckGo reads natural questions better ("who won the last ipl" → IPL winners, where Bing returned the
  // South Korean won), so it is the first retry.
  if (bestScore < 0.55) {
    const d = await searchDDG(q).catch(() => []);
    const sc = relevance(d, q);
    if (sc > bestScore) { best = d; bestScore = sc; }
  }
  if (bestScore < 0.55) {
    const words = q.split(/\s+/).filter(Boolean);
    // The word to lead with is the specific one: an acronym in capitals, else the longest word that isn't an everyday
    // one ("who won the last ipl" → "ipl", not "last", which Bing reads as Last.fm).
    const kw = keywords(q).filter(w => !/^\d+$/.test(w));
    const lead = words.find(w => /^[A-Z]{2,6}$/.test(w)) || kw.filter(w => !COMMON_WORDS.has(w)).sort((a, b) => b.length - a.length)[0] || kw.sort((a, b) => b.length - a.length)[0];
    const variants = [words.filter(w => !SEARCH_STOP.has(w.toLowerCase())).join(' ')];
    if (lead) variants.push([lead, ...words.filter(w => w.toLowerCase() !== lead.toLowerCase() && !SEARCH_STOP.has(w.toLowerCase()))].join(' '));
    // Specific words first, everyday words after ("artificial intelligence news", not "latest news about …").
    const specific = kw.filter(w => !COMMON_WORDS.has(w)), everyday = kw.filter(w => COMMON_WORDS.has(w) && !/^(latest|last|about|now|today|current)$/.test(w));
    if (specific.length) variants.push(specific.concat(everyday).join(' '));
    variants.push(words.filter(w => !SEARCH_STOP.has(w.toLowerCase())).reverse().join(' '));
    for (const v of [...new Set(variants)].filter(v => v && v.toLowerCase() !== key)) {
      const r = await searchOnce(v).catch(() => []);
      const sc = relevance(r, q);
      if (sc > bestScore) { best = r; bestScore = sc; }
      if (bestScore >= 0.55) break;
    }
  }
  if (best.length) searchCache.set(key, { t: Date.now(), results: best });
  return best;
}
async function searchOnce(q) {
  const r = await fetch('https://www.bing.com/search?setlang=en&cc=IN&q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
  });
  const html = await r.text();
  const results = [];
  for (const chunk of html.split('<li class="b_algo"').slice(1)) {
    const a = chunk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = bingRealUrl(a[1]);
    if (!url || !/^https?:\/\//.test(url) || /bing\.com|microsoft\.com\/.*bing/.test(url)) continue;
    const snip = chunk.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) || chunk.match(/<div class="b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    results.push({ title: stripTags(a[2]), url, snippet: snip ? stripTags(snip[1]).replace(/^[\w\s,]+\d{4}\s*·\s*/, '') : '' });
    if (results.length >= 8) break;
  }
  return results;
}
// DuckDuckGo's plain-HTML results (no key). Links come wrapped as //duckduckgo.com/l/?uddg=<real url>.
async function searchDDG(q) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000),
  });
  if (r.status !== 200) return [];   // 202 = DuckDuckGo wants a check it can't get here
  const html = await r.text();
  const results = [];
  for (const chunk of html.split('class="result__body"').slice(1)) {
    const a = chunk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com/.test(url)) continue;
    const snip = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({ title: stripTags(a[2]), url, snippet: snip ? stripTags(snip[1]) : '' });
    if (results.length >= 8) break;
  }
  return results;
}
// Search is used to open "the best page for X" (an explicit user web action), so it is not gated by Online tools.
app.post('/api/tool/webSearch', async (req, res) => {
  const q = String(req.body.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Query required' });
  try { res.json({ success: true, results: await webSearch(q) }); }
  catch (e) { res.status(502).json({ error: 'Search failed: ' + e.message }); }
});
// Search + read the top pages, for AI answers with sources. Sends data to the web → Online-gated.
app.post('/api/tool/research', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  const q = String(req.body.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const results = await webSearch(q);
    const pages = await Promise.all(results.slice(0, 3).map(r => pageText(r.url, { timeout: 6000, max: 3500 }).then(p => ({ ...r, text: p.text })).catch(() => ({ ...r, text: '' }))));
    res.json({ success: true, results, pages });
  } catch (e) { res.status(502).json({ error: 'Research failed: ' + e.message }); }
});

/* ---------------- programming contests ---------------- */
let contestCache = null;
async function fetchContests() {
  if (contestCache && Date.now() - contestCache.t < 30 * 60e3) return contestCache.list;
  const J = (u, o) => fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': BROWSER_UA, ...(o && o.headers) }, ...o }).then(r => r.json());
  const [cf, lc, cc] = await Promise.allSettled([
    J('https://codeforces.com/api/contest.list?gym=false'),
    J('https://leetcode.com/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' }, body: JSON.stringify({ query: '{ upcomingContests { title titleSlug startTime duration } }' }) }),
    J('https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all'),
  ]);
  const list = [];
  if (cf.status === 'fulfilled' && cf.value.result) for (const c of cf.value.result) if (c.phase === 'BEFORE') list.push({ platform: 'Codeforces', name: c.name, start: c.startTimeSeconds * 1000, durationMin: Math.round(c.durationSeconds / 60), url: `https://codeforces.com/contests/${c.id}` });
  if (lc.status === 'fulfilled' && lc.value.data) for (const c of lc.value.data.upcomingContests || []) list.push({ platform: 'LeetCode', name: c.title, start: c.startTime * 1000, durationMin: Math.round(c.duration / 60), url: `https://leetcode.com/contest/${c.titleSlug}` });
  if (cc.status === 'fulfilled' && cc.value.future_contests) for (const c of cc.value.future_contests) list.push({ platform: 'CodeChef', name: c.contest_name, start: Date.parse(c.contest_start_date_iso), durationMin: +c.contest_duration || 0, url: `https://www.codechef.com/${c.contest_code}` });
  const now = Date.now();
  const out = list.filter(c => c.start > now && c.start - now < 21 * 864e5).sort((a, b) => a.start - b.start);
  const failed = [['Codeforces', cf], ['LeetCode', lc], ['CodeChef', cc]].filter(([, r]) => r.status !== 'fulfilled').map(([n]) => n);
  if (out.length) contestCache = { t: now, list: { contests: out, failed } };
  return { contests: out, failed };
}
app.post('/api/tool/contests', async (req, res) => {
  if (!req.body.online) return res.status(403).json({ error: 'offline' });
  try { res.json({ success: true, ...(await fetchContests()) }); }
  catch (e) { res.status(502).json({ error: 'Could not load contests: ' + e.message }); }
});

/* ---------------- git clone ---------------- */
app.post('/api/tool/gitClone', (req, res) => {
  const url = String(req.body.url || '').trim().replace(/\/+$/, '');
  const m = url.match(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!m) return res.status(400).json({ error: 'Only https GitHub, GitLab or Bitbucket repo URLs (https://github.com/owner/repo)' });
  const base = config.roots[0] || path.join(SANDBOX, 'Projects');
  const dest = path.join(base, m[3]);
  if (fs.existsSync(dest)) return res.status(409).json({ error: `"${rel(dest)}" already exists`, name: rel(dest) });
  execFile('git', ['clone', '--depth', '1', '--', url, dest], { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return res.status(502).json({ error: (stderr || err.message).trim().split('\n').pop() });
    let files = 0;
    try { files = fs.readdirSync(dest).filter(n => !n.startsWith('.')).length; } catch {}
    res.json({ success: true, name: rel(dest), path: dest, files });
  });
});

/* ---------------- system info ---------------- */
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const t in c.times) total += c.times[t]; idle += c.times.idle; }
  return { idle, total };
}
let prevCpu = cpuTimes();
function cpuUsage() {
  const cur = cpuTimes();
  const di = cur.idle - prevCpu.idle, dt = cur.total - prevCpu.total;
  prevCpu = cur;
  return dt > 0 ? Math.round(100 * (1 - di / dt)) : 0;
}

app.get('/api/tool/systemInfo', (req, res) => {
  const total = os.totalmem(), free = os.freemem();
  let disk = { freeGB: null, totalGB: null, usedPercent: null };
  try {
    const s = fs.statfsSync(os.homedir());
    const t = s.blocks * s.bsize, f = s.bavail * s.bsize;
    disk = { freeGB: Math.round(f / 1e9), totalGB: Math.round(t / 1e9), usedPercent: Math.round(100 * (1 - f / t)) };
  } catch {}
  res.json({
    success: true,
    platform: process.platform,
    osName: `${os.type()} ${os.release()}`,
    cpuModel: (os.cpus()[0] || {}).model || 'CPU',
    cpus: os.cpus().length,
    cpuUsage: cpuUsage(),
    totalMemoryGB: +(total / 1073741824).toFixed(1),
    usedMemoryGB: +((total - free) / 1073741824).toFixed(1),
    memoryUsagePercent: Math.round(((total - free) / total) * 100),
    disk,
    uptimeMin: Math.round(os.uptime() / 60),
  });
});

/* ---------------- enriched telemetry for the animated diagnostics dashboard ----------------
   Uses the systeminformation npm package (cross-platform, zero deps) for:
   - CPU temperature (per-core where available)
   - GPU model(s) and VRAM
   - Network throughput (rx_sec / tx_sec per interface)
   - Top N processes by CPU and by RAM
   - Battery (ac voltage, cycle count where available)
   The existing /api/tool/systemInfo stays untouched; this is an additive endpoint
   the dashboard overlay polls every 2s. Falls back gracefully if systeminformation
   is not installed (returns null fields with a 'pro' flag = false). */
let si = null;
try { si = require('systeminformation'); } catch (e) { /* package not installed */ }
const PROC_CACHE = { cpu: [], mem: [], at: 0 };
async function topProcesses(limit = 6) {
  if (!si) return { cpu: [], mem: [] };
  const now = Date.now();
  if (now - PROC_CACHE.at < 1500) return PROC_CACHE; // throttle: process list is expensive
  try {
    const procs = await si.processes();
    const arr = procs.list || [];
    const cpu = [...arr].sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, limit).map(p => ({ name: p.name, pid: p.pid, cpu: +(p.cpu || 0).toFixed(1), mem: +(p.mem || 0).toFixed(1) }));
    const mem = [...arr].sort((a, b) => (b.mem || 0) - (a.mem || 0)).slice(0, limit).map(p => ({ name: p.name, pid: p.pid, cpu: +(p.cpu || 0).toFixed(1), mem: +(p.mem || 0).toFixed(1) }));
    PROC_CACHE.cpu = cpu; PROC_CACHE.mem = mem; PROC_CACHE.at = now;
    return { cpu, mem };
  } catch { return { cpu: [], mem: [] }; }
}
app.get('/api/sys/dashboard', async (req, res) => {
  if (!si) return res.json({ success: true, pro: false, message: 'systeminformation package not installed — run npm install systeminformation' });
  // Run the cheap calls in parallel; topProcesses has its own throttle.
  const [cpuTemp, graphics, netStats, procs, battery] = await Promise.all([
    si.cpuTemperature().catch(() => ({})),
    si.graphics().catch(() => ({ controllers: [] })),
    si.networkStats().catch(() => []),
    topProcesses(6),
    si.battery().catch(() => ({})),
  ]);
  // Filter to physical network interfaces (skip loopback) with rx_sec or tx_sec > 0.
  const nets = (netStats || []).filter(n => n.iface && !/^lo$/i.test(n.iface)).map(n => ({
    iface: n.iface, rx_sec: n.rx_sec || 0, tx_sec: n.tx_sec || 0, rx_total: n.rx_bytes || 0, tx_total: n.tx_bytes || 0,
  }));
  res.json({
    success: true, pro: true,
    cpuTemp: cpuTemp && cpuTemp.main != null ? cpuTemp.main : null,
    cpuTempCores: cpuTemp && Array.isArray(cpuTemp.cores) ? cpuTemp.cores : [],
    gpus: (graphics && graphics.controllers || []).map(g => ({ model: g.model, vram: g.vram, vendor: g.vendor })),
    networks: nets,
    procs: procs,
    battery: battery && battery.hasbattery ? { percent: battery.percent, isCharging: battery.ischarging, cycleCount: battery.cyclecount || null, voltage: battery.voltage || null } : null,
  });
});

app.post('/api/tool/batteryStatus', (req, res) => {
  if (IS_WIN) {
    execFile('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) return res.json({ success: true, level: null, status: 'No battery detected' });
      try {
        let d = JSON.parse(stdout); if (Array.isArray(d)) d = d[0];
        res.json({ success: true, level: d.EstimatedChargeRemaining, status: [2, 6, 7, 8, 9].includes(d.BatteryStatus) ? 'Charging' : 'On battery' });
      } catch { res.json({ success: true, level: null, status: 'No battery detected' }); }
    });
  } else {
    execFile(IS_MAC ? 'pmset' : 'upower', IS_MAC ? ['-g', 'batt'] : ['-i', '/org/freedesktop/UPower/devices/battery_BAT0'], (err, stdout) => {
      if (err) return res.json({ success: true, level: null, status: 'Unknown' });
      const m = stdout.match(/(\d+)%/);
      res.json({ success: true, level: m ? +m[1] : null, status: /charging|AC Power/i.test(stdout) && !/discharging/i.test(stdout) ? 'Charging' : 'On battery' });
    });
  }
});

app.post('/api/tool/listProcesses', (req, res) => {
  if (IS_WIN) {
    execFile('powershell', ['-NoProfile', '-Command',
      "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 Name,@{N='CPU';E={[Math]::Round($_.CPU,1)}},@{N='RAM_MB';E={[Math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json"],
      { windowsHide: true }, (err, stdout) => {
        if (err) return res.status(500).json({ error: err.message });
        try { const p = JSON.parse(stdout); res.json({ success: true, processes: Array.isArray(p) ? p : [p] }); }
        catch { res.json({ success: true, processes: [] }); }
      });
  } else {
    exec('ps -eo comm,%cpu,rss --sort=-rss | head -9 | tail -8', (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      const processes = stdout.trim().split('\n').map(l => { const [Name, cpu, rss] = l.trim().split(/\s+/); return { Name, CPU: +cpu, RAM_MB: Math.round(+rss / 1024) }; });
      res.json({ success: true, processes });
    });
  }
});

app.post('/api/tool/networkInfo', (req, res) => {
  let ip = 'unknown', iface = 'unknown';
  for (const [k, list] of Object.entries(os.networkInterfaces())) {
    const a = list.find(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
    if (a) { ip = a.address; iface = k; break; }
  }
  res.json({ success: true, ip, interface: iface, hostname: os.hostname() });
});

/* ---------------- power ---------------- */
const run = (cmd, args) => { const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); };

app.post('/api/tool/lockSystem', (req, res) => {
  if (IS_WIN) run('rundll32.exe', ['user32.dll,LockWorkStation']);
  else if (IS_MAC) run('pmset', ['displaysleepnow']);
  else run('xdg-screensaver', ['lock']);
  res.json({ success: true });
});
app.post('/api/tool/sleepSystem', (req, res) => {
  if (IS_WIN) run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
  else if (IS_MAC) run('pmset', ['sleepnow']);
  else run('systemctl', ['suspend']);
  res.json({ success: true });
});
app.post('/api/tool/shutdownSystem', (req, res) => {
  if (IS_WIN) run('shutdown', ['/s', '/t', '30']); else run('shutdown', ['-h', '+1']);
  res.json({ success: true, seconds: IS_WIN ? 30 : 60 });
});
app.post('/api/tool/restartSystem', (req, res) => {
  if (IS_WIN) run('shutdown', ['/r', '/t', '30']); else run('shutdown', ['-r', '+1']);
  res.json({ success: true, seconds: IS_WIN ? 30 : 60 });
});
app.post('/api/tool/cancelShutdown', (req, res) => {
  if (IS_WIN) run('shutdown', ['/a']); else run('shutdown', ['-c']);
  res.json({ success: true });
});

/* ---------------- volume / media ---------------- */
const sendKey = (code, times = 1) => run('powershell', ['-NoProfile', '-Command',
  `$w=New-Object -ComObject WScript.Shell; for($i=0;$i -lt ${times};$i++){$w.SendKeys([char]${code})}`]);

app.post('/api/tool/setVolume', (req, res) => {
  const action = ['mute', 'unmute', 'up', 'down'].includes(req.body.action) ? req.body.action : null;
  if (!action) return res.status(400).json({ error: 'action must be up/down/mute/unmute' });
  const steps = Math.max(1, Math.min(25, parseInt(req.body.steps) || 5));
  if (IS_WIN) {
    if (action === 'mute' || action === 'unmute') sendKey(173);
    else sendKey(action === 'up' ? 175 : 174, steps);
  } else if (IS_MAC) {
    const scripts = { mute: 'set volume output muted true', unmute: 'set volume output muted false',
      up: 'set volume output volume ((output volume of (get volume settings)) + 10)', down: 'set volume output volume ((output volume of (get volume settings)) - 10)' };
    run('osascript', ['-e', scripts[action]]);
  } else {
    run('amixer', ['set', 'Master', { mute: 'mute', unmute: 'unmute', up: '5%+', down: '5%-' }[action]]);
  }
  res.json({ success: true, action });
});

app.post('/api/tool/mediaKey', (req, res) => {
  const key = ['play', 'next', 'prev', 'stop'].includes(req.body.key) ? req.body.key : 'play';
  if (IS_WIN) sendKey({ play: 179, next: 176, prev: 177, stop: 178 }[key]);
  else if (IS_MAC) run('osascript', ['-e', `tell application "Music" to ${{ play: 'playpause', next: 'next track', prev: 'previous track', stop: 'pause' }[key]}`]);
  else run('playerctl', [{ play: 'play-pause', next: 'next', prev: 'previous', stop: 'stop' }[key]]);
  res.json({ success: true, key });
});

/* ---------------- screenshot / clipboard ---------------- */
app.post('/api/tool/screenshot', (req, res) => {
  const filename = `JARVIS_screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const dir = fs.existsSync(path.join(os.homedir(), 'Desktop')) ? path.join(os.homedir(), 'Desktop') : SANDBOX;
  const out = path.join(dir, filename);
  const done = err => err ? res.status(500).json({ error: err.message }) : res.json({ success: true, file: filename, path: out });
  if (IS_WIN) {
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save($env:JARVIS_OUT); $g.Dispose(); $bmp.Dispose()`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { env: { ...process.env, JARVIS_OUT: out }, windowsHide: true }, done);
  } else if (IS_MAC) execFile('screencapture', [out], done);
  else execFile('scrot', [out], done);
});

app.post('/api/tool/readClipboard', (req, res) => {
  const [cmd, args] = IS_WIN ? ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']]
    : IS_MAC ? ['pbpaste', []] : ['xclip', ['-selection', 'clipboard', '-o']];
  execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) return res.json({ success: true, content: '' });
    res.json({ success: true, content: stdout.replace(/\r\n/g, '\n').trim() });
  });
});

app.post('/api/tool/writeClipboard', (req, res) => {
  const text = String(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Text required' });
  const [cmd, args] = IS_WIN ? ['powershell', ['-NoProfile', '-Command', '$input | Out-String | ForEach-Object { $_.TrimEnd() } | Set-Clipboard']]
    : IS_MAC ? ['pbcopy', []] : ['xclip', ['-selection', 'clipboard']];
  const p = spawn(cmd, args, { windowsHide: true });
  p.on('error', e => { if (!res.headersSent) res.status(500).json({ error: e.message }); });
  p.on('close', () => { if (!res.headersSent) res.json({ success: true }); });
  p.stdin.end(text);
});

/* ---------------- dev tools ---------------- */
const GIT_CWD = req => {
  const d = req.body && req.body.repo ? findAllowed(String(req.body.repo), { kind: 'folder' }) : null;
  return d || config.roots[0] || __dirname;
};
const git = (req, res, args, empty) => execFile('git', args, { cwd: GIT_CWD(req), windowsHide: true }, (err, stdout, stderr) => {
  if (err) return res.status(500).json({ error: /not a git repository/i.test(stderr) ? 'This folder is not a git repository' : (stderr || err.message).trim() });
  res.json({ success: true, output: stdout.trim() || empty });
});
app.post('/api/tool/gitStatus', (req, res) => git(req, res, ['status', '--short', '--branch'], 'Working tree clean'));
app.post('/api/tool/gitLog', (req, res) => git(req, res, ['log', '--oneline', '-5'], 'No commits yet'));
app.post('/api/tool/gitDiff', (req, res) => git(req, res, ['diff', '--stat'], 'No changes'));
app.post('/api/tool/gitCommit', (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Commit message required' });
  execFile('git', ['add', '-A'], { cwd: GIT_CWD(req), windowsHide: true }, err => {
    if (err) return res.status(500).json({ error: 'git add failed' });
    git(req, res, ['commit', '-m', message], 'Committed');
  });
});

app.post('/api/tool/checkPort', (req, res) => {
  const port = Number(req.body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Port must be 1-65535' });
  const net = require('net');
  // Something already answering on 127.0.0.1 or ::1 is "in use" — Vite and other dev servers often listen only on
  // IPv6 localhost, where binding 0.0.0.0 still succeeds and would wrongly report the port free.
  const answers = host => new Promise(done => {
    const c = net.connect({ host, port, timeout: 800 }, () => { c.destroy(); done(true); });
    c.on('error', () => done(false)); c.on('timeout', () => { c.destroy(); done(false); });
  });
  Promise.all([answers('127.0.0.1'), answers('::1')]).then(([v4, v6]) => {
    if (v4 || v6) return res.json({ success: true, inUse: true });
    const srv = net.createServer();
    srv.once('error', () => res.json({ success: true, inUse: true }));
    srv.once('listening', () => srv.close(() => res.json({ success: true, inUse: false })));
    srv.listen(port, '0.0.0.0');
  });
});

/* ---------------- health ---------------- */
// The cinematic landing page (landing.html) also lives at /welcome.
app.get(['/welcome', '/home'], (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString(), sandbox: SANDBOX, platform: process.platform, pid: process.pid, port: PORT });
});

// Stop JARVIS itself (Settings → Data → Stop). The no-window launcher keeps no console open, so this
// is the clean way to end the background server; the desktop icon (or Startup link) starts it again.
app.post('/api/quit', (req, res) => {
  res.json({ success: true, bye: true });
  setTimeout(() => process.exit(0), 150); // let the reply flush before quitting
});

/* ---------------- updates (update.js) ---------------- */
// Version + the latest GitHub release, for Settings → Check for updates. No phone-home:
// the page only calls GitHub when you click the button, and only if Online tools is on.
require('./update')(app, { appVersion: require('./package.json').version });

/* ---------------- translation (Telugu / Kannada ↔ English) ---------------- */
const LANG_NAMES = { en: 'English', te: 'Telugu', kn: 'Kannada' };

// Google Translate's public web endpoint (no key). Used only for replies when "online translation" is on.
async function googleTranslate(text, to) {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + to + '&dt=t', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': BROWSER_UA },
    body: 'q=' + encodeURIComponent(text), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j[0] || []).map(x => x[0]).join('');
}
// Translates Markdown line by line: code blocks, inline code, links, URLs and [1] citations are kept exactly.
async function translateMarkdown(text, to) {
  const lines = text.split('\n');
  const jobs = [];
  let inCode = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return; }
    if (inCode || !/[A-Za-z]{2}/.test(line)) return;
    const m = line.match(/^(\s*(?:[-*•]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?)(.*)$/);
    const keep = [];
    const body = m[2].replace(/\[[^\]]+\]\([^)]+\)|`[^`]+`|https?:\/\/\S+|\[\d+\]/g, x => { keep.push(x); return `⟦${keep.length - 1}⟧`; });
    jobs.push({ i, prefix: m[1], body, keep, bold: /\*\*/.test(body) });
  });
  if (!jobs.length) return text;
  const restore = (job, t) => {
    const out = t.replace(/⟦\s*(\d+)\s*⟧/g, (x, n) => job.keep[+n] !== undefined ? job.keep[+n] : '');
    return job.keep.every(k => out.includes(k)) ? job.prefix + out : null;
  };
  // One request for everything; if Google merges or splits lines, fall back to one request per line.
  let parts = null;
  try { parts = (await googleTranslate(jobs.map(j => j.body.replace(/\*\*/g, '')).join('\n'), to)).split('\n'); } catch (e) { throw e; }
  if (parts.length !== jobs.length) parts = await Promise.all(jobs.map(j => googleTranslate(j.body.replace(/\*\*/g, ''), to).catch(() => null)));
  jobs.forEach((job, k) => { const t = parts[k] && restore(job, parts[k].trim()); if (t) lines[job.i] = t; });
  return lines.join('\n');
}

app.post('/api/translate', async (req, res) => {
  const to = String(req.body.to || 'en');
  const mode = req.body.mode === 'command' ? 'command' : 'text';
  if (!LANG_NAMES[to]) return res.status(400).json({ error: 'to must be en, te or kn' });
  if (req.body.engine === 'online' && mode === 'text') {
    const md = String(req.body.text || '').trim().slice(0, 6000);
    if (!md) return res.status(400).json({ error: 'text required' });
    try { return res.json({ success: true, text: await translateMarkdown(md, to), engine: 'online' }); }
    catch (e) { if (!req.body.fallback) return res.status(502).json({ error: 'Online translation failed: ' + e.message }); }
  }
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'text required' });
  // Commands: Google reads Telugu/Kannada verbs and English names written in Telugu/Kannada script far better than the
  // local model (e.g. "స్పాటిఫై మూసెయ్యి" → "Close Spotify", not "Play Spotify"). It can't read romanized text, so that stays local.
  if (req.body.engine === 'online' && mode === 'command' && !req.body.roman) {
    try {
      const out = (await googleTranslate(text.slice(0, 500), 'en')).trim();
      if (out && !/[ఀ-೿]/.test(out)) return res.json({ success: true, text: out, engine: 'online' });
    } catch (e) { if (!req.body.fallback) return res.status(502).json({ error: 'Online translation failed: ' + e.message }); }
  }
  const GLOSSARY = ' Verbs: తెరువు/ఓపెన్ చెయ్యి/ತೆರೆ/ಓಪನ್ ಮಾಡು = open; మూసెయ్యి/క్లోజ్ చెయ్యి/ಮುಚ್ಚು/ಕ್ಲೋಸ್ ಮಾಡು = close; ప్లే చెయ్యి/పెట్టు (a song)/ಹಾಕು/ಪ್ಲೇ ಮಾಡು = play; పెట్టు/ಇಡು (a timer) = set; పెంచు/ಜಾಸ್ತಿ ಮಾಡು/ಹೆಚ್ಚಿಸು = increase; తగ్గించు/ಕಮ್ಮಿ ಮಾಡು/ಕಡಿಮೆ ಮಾಡು = decrease; ఆపు/ఆఫ్ చెయ్యి/ಆಫ್ ಮಾಡು/ನಿಲ್ಲಿಸು = turn off or stop; చూపించు/ತೋರಿಸು = show; చెప్పు/ಹೇಳು = tell; తీయి/ತೆಗೆ = take; చదువు/ಓದು = read; వెతుకు/ಹುಡುಕು = search; గుర్తు చెయ్యి/ನೆನಪಿಸು = remind me; చేర్చు/ಸೇರಿಸು = add; రద్దు చెయ్యి/ಕ್ಯಾನ್ಸಲ್ ಮಾಡು = cancel. Song, film, app and people names written in Telugu/Kannada letters must be written as their original English name (బిలీవర్/ಬಿಲೀವರ್ → Believer, స్పాటిఫై → Spotify).';
  const ROMAN = req.body.roman ? ' The input is Telugu or Kannada typed in English letters (e.g. "volume penchu" = increase the volume, "timer cancel maadu" = cancel the timer, "system hegide" = how is my system, "ela unnav" = how are you, "X ante enti" / "X andre enu" = what is X, "rendu lines lo cheppu" / "eradu saalinalli helu" = tell in 2 lines, "ela cheyyali" / "hege maadodu" = how to do it).' : '';
  const system = mode === 'command'
    ? 'You convert a spoken request (in Telugu, Kannada, English or a mix, possibly romanized) into ONE short, clear English sentence with the same meaning, as the user would say it to a PC assistant. Keep names, numbers, times, file names and app names exactly.' + GLOSSARY + ROMAN + ' The text comes from speech recognition, so English technical words are often written in Telugu/Kannada script and may be mis-heard: the user is a computer-science student, so choose the most likely programming meaning (e.g. "ಸ್ಟಾಕಿಂಗ್ ಪೈಥಾನ್" / "స్టాకింగ్ పైథాన్" → "stack in Python", "ಲಿಂಕ್ಡ್ ಲಿಸ್ಟ್" → "linked list"). "జార్విస్"/"ಜಾರ್ವಿಸ್" and mis-hearings like "ಜರಿಸ್" mean "Jarvis". If it is a question, translate it as a question — never answer it. Output ONLY the English sentence.'
    : `Translate the text into ${LANG_NAMES[to]}${to === 'en' ? '' : ' (native script)'}. Keep technical terms, code, file names, app names, URLs and numbers in English. Write all numbers with Western digits (0-9), never native numerals. Render "sir" as ${to === 'te' ? '"సర్"' : to === 'kn' ? '"ಸರ್"' : '"sir"'} and "boss" as ${to === 'te' ? '"బాస్"' : to === 'kn' ? '"ಬಾಸ್"' : '"boss"'}. Keep the tone polite, natural and conversational (spoken style, not formal). Output ONLY the translation.`;
  try {
    const reply = await llm.complete({ model: String(req.body.model || DEFAULT_MODEL), system, messages: [{ role: 'user', content: text }],
      temperature: 0, maxTokens: mode === 'command' ? 60 : Math.min(600, text.length * 3 + 60), timeoutMs: 90000 });
    const out = reply.replace(/<<[\s\S]*?>>/g, '').trim().replace(/^["'“]|["'”]$/g, '');
    if (!out) return res.status(502).json({ error: 'No translation returned' });
    res.json({ success: true, text: out });
  } catch (e) {
    res.status(502).json({ error: 'AI unavailable: ' + e.message });
  }
});

/* ---------------- Windows laptop controls ---------------- */
require('./system-tools')(app, { IS_WIN, APPS });
require('./ocr')(app, { IS_WIN, IS_MAC });
require('./portwatch')(app, { IS_WIN, IS_MAC });
require('./tts')(app);

/* ---------------- Face recognition greeting (Phase 3.11) ----------------
   Additive endpoints for storing/loading the enrolled face descriptor.
   The descriptor is a 128-dimensional Float32Array (512 bytes) — never an
   image. Stored in .config.json next to the existing `hello` key, so the
   same localhost-only origin discipline applies. */
app.get('/api/facegreet/status', (req, res) => {
  const fg = config.faceGreet || null;
  res.json({ success: true, enrolled: !!fg, descriptor: fg ? 'present' : null });
});
app.post('/api/facegreet/enroll', (req, res) => {
  const d = req.body && req.body.descriptor;
  if (!Array.isArray(d) || d.length !== 128) return res.status(400).json({ error: 'descriptor must be an array of 128 numbers' });
  // Validate all elements are finite numbers
  if (!d.every(v => typeof v === 'number' && isFinite(v))) return res.status(400).json({ error: 'descriptor contains non-numeric values' });
  config.faceGreet = d;
  saveConfig();
  console.log('[facegreet] descriptor enrolled (128 floats)');
  res.json({ success: true, enrolled: true });
});
app.delete('/api/facegreet/enroll', (req, res) => {
  delete config.faceGreet;
  saveConfig();
  res.json({ success: true, enrolled: false });
});

// Malformed JSON bodies etc. → short JSON error instead of an HTML stack trace.
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Server error' });
});

const httpServer = app.listen(PORT, HOST, () => {
  lock.update(PORT);   // record the real port, pid and port file for the launcher and Stop JARVIS
  console.log(`JARVIS backend running on http://localhost:${PORT}`);
  console.log(`Sandbox: ${SANDBOX}`);
  console.log(`LLM: ${OLLAMA} (${DEFAULT_MODEL})`);
});
httpServer.on('error', e => {
  lock.release();
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${PORT} is used by another program. Start JARVIS from its desktop icon (it picks a free port), or set PORT to a free one.`
    : 'Could not start: ' + e.message);
  process.exit(1);
});
