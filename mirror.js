'use strict';
/* A second copy of your JARVIS data on another drive ("back up my files to D:"). Not a restore tool: it makes a plain folder of plain files you can open
   or copy back yourself.
     What:  everything in ~/jarvis that is yours (Notes, Documents, Code, Scans, PDFs, Journal, Skills, snapshots, chat archive…) and, if you say so, the
            project folders you gave JARVIS (without node_modules, build folders and the like). Never ~/jarvis/.config.json (keys), the trash, or lock/log files.
     How:   incremental. A file is copied when it is new or has changed; a changed file's OLD version is kept for 30 days in _previous/<date>/, and nothing
            is ever deleted from the backup. Every copy is checked (size, and a hash up to 8 MB) before it replaces anything.
     When:  when you ask, and once a week by itself if you switch that on (only into the folder you approved).
     Where: a folder you choose, not a whole drive and not a folder that already holds other things (it is marked with a .jarvis-mirror file).
   createMirror() is plain code with its folders passed in, so it is tested on temp folders. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MARKER = '.jarvis-mirror';
const KEEP_DAYS = 30, WEEK = 7 * 864e5, MIN_FREE = 500 * 1048576, HASH_MAX = 8 * 1048576, MAX_FILES = 80000, MAX_ERRORS = 20;
const SKIP_IN_JARVIS = new Set(['.trash', '.diskcare', '.config.json', '.jarvis.lock', '.jarvis.pid', '.jarvis-port', '.launcher.log', '.launcher.log.err', '.keepalive.log', '.keepalive.json', '.stopped-by-user', '.restarted.json', '.jarvis-state.json', '.mirror.json', '.shotindex.json']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', 'target', 'out', '.cache', '.gradle', '.idea']);
const isoDay = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const within = (p, root) => { const a = path.resolve(p).toLowerCase(), b = path.resolve(root).toLowerCase(); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };

class MirrorError extends Error { constructor(m, status) { super(m); this.status = status || 400; } }

async function hashFile(p) {
  const h = crypto.createHash('sha256'); const fd = await fsp.open(p, 'r');
  try { const buf = Buffer.alloc(1 << 20); let pos = 0; for (;;) { const r = await fd.read(buf, 0, buf.length, pos); if (!r.bytesRead) break; h.update(buf.subarray(0, r.bytesRead)); pos += r.bytesRead; } } finally { await fd.close(); }
  return h.digest('hex');
}

function createMirror({ SANDBOX, roots = () => [], blockedPath = () => false, snapshot, now = Date.now, statfs = fsp.statfs, stateFile }) {
  const sf = stateFile || path.join(SANDBOX, '.mirror.json');
  const load = () => { try { const j = JSON.parse(fs.readFileSync(sf, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const save = o => { try { fs.writeFileSync(sf, JSON.stringify(o, null, 1)); } catch { /* the backup still works; it just forgets */ } };
  let running = null, progress = null;

  /* ---------- where to ---------- */
  function checkDest(dest) {
    const d = String(dest || '').trim().replace(/^["']|["']$/g, '');
    if (!d || !path.isAbsolute(d)) throw new MirrorError('Give me a full folder path, like D:\\JARVIS-Backup.');
    const p = path.resolve(d);
    if (path.parse(p).root.toLowerCase() === p.toLowerCase()) throw new MirrorError('That is a whole drive. Name a folder on it, like ' + p.replace(/[\\/]+$/, '') + '\\JARVIS-Backup, so nothing else on the drive gets mixed in.');
    if (blockedPath(p, { forWrite: true })) throw new MirrorError('That location is off-limits (Windows, program or app-data folders).', 403);
    for (const r of [SANDBOX, ...roots()]) if (within(p, r) || within(r, p)) throw new MirrorError('The backup cannot be inside the folder it backs up, or hold it: ' + r + '.');
    let st = null; try { st = fs.statSync(p); } catch { /* new */ }
    if (st && !st.isDirectory()) throw new MirrorError('That is a file, not a folder.');
    if (st && !fs.existsSync(path.join(p, MARKER)) && fs.readdirSync(p).length) throw new MirrorError('That folder already has other files in it. Pick an empty or new folder so your backup stays separate.');
    return p;
  }

  /* ---------- what ---------- */
  async function* walk(dir, rel, skipTop, skipDirs) {
    let d; try { d = await fsp.opendir(dir); } catch { return; }
    for await (const ent of d) {
      if (skipTop && !rel && skipTop.has(ent.name)) continue;
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name), r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { if (skipDirs.has(ent.name.toLowerCase())) continue; yield* walk(full, r, null, skipDirs); }
      else if (ent.isFile()) yield { full, rel: r };
    }
  }
  const sources = includeProjects => [{ label: 'jarvis', dir: SANDBOX, top: SKIP_IN_JARVIS, dirs: new Set(['.trash']) }, ...(includeProjects ? roots().filter(r => path.resolve(r).toLowerCase() !== path.resolve(SANDBOX).toLowerCase() && fs.existsSync(r)).map(r => ({ label: 'projects/' + path.basename(r), dir: r, top: null, dirs: SKIP_DIRS })) : [])];

  /* ---------- one file ---------- */
  async function copyOne(src, st, dst, prevDir, rel, stats) {
    let ds = null; try { ds = fs.statSync(dst); } catch { /* not there yet */ }
    if (ds && ds.size === st.size && Math.abs(ds.mtimeMs - st.mtimeMs) < 2000) { stats.unchanged++; return; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (ds) {                                                         // keep the old version for a while
      let prev = path.join(prevDir, rel), n = 1; fs.mkdirSync(path.dirname(prev), { recursive: true });
      while (fs.existsSync(prev)) prev = path.join(prevDir, rel + '.' + (++n));
      fs.renameSync(dst, prev); stats.replaced++;
    }
    const tmp = dst + '.part';
    await fsp.copyFile(src, tmp);
    const ts = fs.statSync(tmp);
    if (ts.size !== st.size) { fs.rmSync(tmp, { force: true }); throw new Error('the copy had the wrong size'); }
    if (st.size <= HASH_MAX && await hashFile(src) !== await hashFile(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error('the copy did not match'); }
    fs.renameSync(tmp, dst);
    try { fs.utimesSync(dst, new Date(), new Date(st.mtimeMs)); } catch { /* the date is a nicety */ }
    stats.copied++; stats.copiedBytes += st.size;
  }
  function pruneOld(dest) {
    const base = path.join(dest, '_previous'); let n = 0, cutoff = now() - KEEP_DAYS * 864e5;
    let days = []; try { days = fs.readdirSync(base); } catch { return 0; }
    for (const d of days) { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < cutoff) { try { fs.rmSync(path.join(base, d), { recursive: true, force: true }); n++; } catch { /* in use */ } } }
    return n;
  }

  /* ---------- a run ---------- */
  async function doRun({ dest, includeProjects, budgetMs }) {
    const t0 = now(), stats = { files: 0, bytes: 0, copied: 0, copiedBytes: 0, unchanged: 0, replaced: 0, errors: [], skipped: 0, partial: false, prunedDays: 0 };
    const d = checkDest(dest);
    fs.mkdirSync(d, { recursive: true });
    if (!fs.existsSync(path.join(d, MARKER))) fs.writeFileSync(path.join(d, MARKER), 'This folder is a JARVIS backup. JARVIS only adds to it (changed files keep their old version in _previous for ' + KEEP_DAYS + ' days). Created ' + new Date(t0).toISOString() + '\n');
    if (snapshot) { try { snapshot(); } catch { /* the files still go */ } }
    const prevDir = path.join(d, '_previous', isoDay(t0));
    const full = new Set();
    outer: for (const src of sources(includeProjects)) {
      for await (const f of walk(src.dir, '', src.top, src.dirs)) {
        if (now() - t0 > budgetMs) { stats.partial = true; break outer; }
        if (stats.files >= MAX_FILES) { stats.partial = true; break outer; }
        let st; try { st = await fsp.lstat(f.full); } catch { continue; }
        stats.files++; stats.bytes += st.size; progress = { files: stats.files, copied: stats.copied };
        if (stats.files % 200 === 1) { try { const sfs = await statfs(d), free = Number(sfs.bavail) * Number(sfs.bsize); if (free < MIN_FREE) { stats.errors.push({ path: f.rel, why: 'the backup drive is nearly full' }); stats.partial = true; break outer; } } catch { /* cannot tell */ } }
        const rel = src.label + '/' + f.rel;
        try { await copyOne(f.full, st, path.join(d, ...rel.split('/')), prevDir, rel, stats); }
        catch (e) { stats.skipped++; if (stats.errors.length < MAX_ERRORS) stats.errors.push({ path: rel, why: e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' ? 'in use or protected' : String(e.message || e.code).slice(0, 60) }); }
      }
    }
    stats.prunedDays = pruneOld(d);
    stats.ms = now() - t0;
    return { dest: d, stats };
  }
  async function run(opts = {}) {
    if (running) throw new MirrorError('A backup is already running.', 409);
    const cur = load();
    const dest = opts.dest || cur.dest;
    if (!dest) throw new MirrorError('No backup folder is set yet. Say “set my backup folder to D:\\JARVIS-Backup”.');
    const includeProjects = opts.includeProjects !== undefined ? !!opts.includeProjects : !!cur.includeProjects;
    running = doRun({ dest, includeProjects, budgetMs: opts.budgetMs || 15 * 60000 }).then(r => {
      save({ ...load(), dest: r.dest, includeProjects, lastRun: now(), last: r.stats, lastError: null }); return r;
    }).catch(e => { save({ ...load(), lastError: String(e.message || e).slice(0, 160), lastTry: now() }); throw e; })
      .finally(() => { running = null; progress = null; });
    return running;
  }
  function status() {
    const s = load();
    return { dest: s.dest || null, enabled: !!s.enabled, includeProjects: !!s.includeProjects, approved: s.approved || null, lastRun: s.lastRun || null, last: s.last || null, lastError: s.lastError || null, running: !!running, progress, dueIn: s.enabled && s.lastRun ? Math.max(0, s.lastRun + WEEK - now()) : null };
  }
  function configure({ dest, enabled, includeProjects, approved }) {
    const s = load();
    if (dest !== undefined) { s.dest = checkDest(dest); if (approved) s.approved = s.dest; }
    if (enabled !== undefined) { if (enabled && !s.dest) throw new MirrorError('Set the backup folder first.'); s.enabled = !!enabled; }
    if (includeProjects !== undefined) s.includeProjects = !!includeProjects;
    save(s); return status();
  }
  // called every so often by the server: a weekly run into the folder you approved
  async function autoTick() {
    const s = load();
    if (!s.enabled || !s.dest || s.approved !== s.dest || running) return null;
    if (s.lastRun && now() - s.lastRun < WEEK) return null;
    if (s.lastTry && now() - s.lastTry < 6 * 3600e3 && s.lastError) return null;             // it failed a moment ago: try again later, not every hour
    try { return await run({}); } catch { return null; }
  }
  return { run, status, configure, autoTick, checkDest, MARKER };
}

/* ---------- routes (laptop page only) ---------- */
module.exports = function setupMirror(app, { SANDBOX, roots, blockedPath, approvedChange, snapshot }) {
  const m = createMirror({ SANDBOX, roots, blockedPath, snapshot });
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const guard = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'Backups can only be changed from JARVIS on the laptop.' }), false));
  const wrap = fn => async (req, res) => { if (!guard(req, res)) return; try { await fn(req, res); } catch (e) { if (res.headersSent) return; res.status(e instanceof MirrorError ? e.status : 500).json({ error: e instanceof MirrorError ? e.message : 'The backup hit a problem: ' + String(e.message).slice(0, 100) }); } };
  app.get('/api/mirror/status', wrap(async (req, res) => res.json({ success: true, ...m.status() })));
  app.post('/api/mirror/setdest', wrap(async (req, res) => {
    const b = req.body || {}; const d = m.checkDest(b.dest);
    if (approvedChange && !approvedChange(req, res, 'back up your JARVIS files into', d)) return;      // outside ~/jarvis: asks you first
    res.json({ success: true, ...m.configure({ dest: d, approved: true, includeProjects: b.includeProjects, enabled: b.enabled }) });
  }));
  app.post('/api/mirror/config', wrap(async (req, res) => { const b = req.body || {}; res.json({ success: true, ...m.configure({ enabled: b.enabled, includeProjects: b.includeProjects }) }); }));
  app.post('/api/mirror/run', wrap(async (req, res) => {
    const st = m.status();
    if (!st.dest) throw new MirrorError('No backup folder is set yet. Say “set my backup folder to D:\\JARVIS-Backup”.');
    if (st.running) throw new MirrorError('A backup is already running.', 409);
    if (st.approved !== st.dest) throw new MirrorError('Set the backup folder from JARVIS first, so I can ask you before writing there.', 403);
    m.run({ budgetMs: 15 * 60000 }).catch(() => {});                                                 // runs in the background; /status shows how far it is
    res.json({ success: true, started: true });
  }));
  setInterval(() => { m.autoTick().catch(() => {}); }, 3600e3).unref();
  setTimeout(() => { m.autoTick().catch(() => {}); }, 120000).unref();
  return m;
};
Object.assign(module.exports, { createMirror, MirrorError, MARKER, SKIP_IN_JARVIS, KEEP_DAYS });
