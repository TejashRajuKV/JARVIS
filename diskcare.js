'use strict';
/* Disk care: "what is using my drive?", "tidy my Downloads", "find large / duplicate files", "clean my temp files".
   Every tool works in two steps. A SCAN or PLAN only reads; it returns a short-lived plan kept on the server. APPLY runs that stored plan
   (never a list sent by the page) and re-checks each file first: still there, same size and time, not a link, not in a blocked area.
   Reversible actions (tidy, large / duplicate files → a same-drive JARVIS trash) write a journal so ONE undo puts everything back.
   Permanent actions (old temp files, emptying JARVIS's trash) are separate, Windows Hello guarded, and always say they cannot be undone.
   Files are only ever renamed on their own drive (never copied), links and junctions are never followed, cloud-only OneDrive files are
   never read, and Windows / Program Files / AppData / secret folders are refused (the one exception is the user temp folder, by name).
   The logic is a factory with injected dependencies so tests can drive it without a server. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ScanMath = require('./scanmath');

const DAY = 864e5, MIN = 6e4, MB = 1048576;
const LIMITS = { planTtl: 15 * MIN, tempAgeDays: 3, tidyQuietMs: 10 * MIN, largeMB: 100, dupMinMB: 1, maxPlanItems: 5000, maxEntries: 300000, maxShown: 30, dupFilesCap: 20000, maxDepth: 12, maxPlans: 20,
  photoCap: 8000, photoMinKB: 30, photoDist: 6, hashBatch: 100, hashCacheMax: 60000,
  shrinkMinMB: 3, shrinkAgeDays: 90, shrinkMax: 60, shrinkBatch: 10, shrinkQuality: 82, shrinkMaxSide: 2560, shrinkMinSaving: 0.1 };
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'target', 'out', '.idea', '.vscode', '$recycle.bin', 'system volume information']);
const KNOWN_KEYS = ['downloads', 'desktop', 'documents', 'pictures', 'videos', 'music'];

const CATEGORIES = {
  Documents: 'pdf doc docx ppt pptx xls xlsx txt md rtf odt ods odp csv epub tex'.split(' '),
  Images: 'jpg jpeg png gif webp bmp svg heic tif tiff ico raw'.split(' '),
  Videos: 'mp4 mkv avi mov wmv webm flv m4v'.split(' '),
  Audio: 'mp3 wav flac aac ogg m4a wma opus'.split(' '),
  Archives: 'zip rar 7z tar gz tgz bz2 xz iso'.split(' '),
  Installers: 'exe msi msix appx apk dmg pkg'.split(' '),
  Code: 'py js mjs ts tsx jsx java c cpp h hpp cs go rs rb php html htm css json sql sh ps1 bat ipynb'.split(' '),
};
const EXT_TO_CAT = {};
for (const [cat, exts] of Object.entries(CATEGORIES)) for (const e of exts) EXT_TO_CAT[e] = cat;
const classify = name => EXT_TO_CAT[path.extname(String(name)).slice(1).toLowerCase()] || 'Other';
const PARTIAL = /\.(?:crdownload|part|partial|tmp|download|opdownload|aria2)$/i;
const SYSTEM_NAME = /^(?:desktop\.ini|thumbs\.db|\.ds_store|~\$.*)$/i;

class DiskError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

/* ---------- small helpers ---------- */
const driveOf = p => path.parse(path.resolve(p)).root.toLowerCase();
const within = (p, root) => { const a = path.resolve(p).toLowerCase(), b = path.resolve(root).toLowerCase(); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
const stamp = (d = new Date()) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const newRunId = (now = Date.now()) => stamp(new Date(now)) + '-' + crypto.randomBytes(3).toString('hex');
const RUN_RE = /^\d{14}-[a-f0-9]{6}$/;
const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const sleepTick = () => new Promise(r => setImmediate(r));
const sumBytes = items => items.reduce((s, x) => s + (x.size || 0), 0);

// A name that exists neither on disk nor among the names already given out in this plan: "a.pdf" → "a (2).pdf".
function uniqueTarget(dir, name, taken, exists = fs.existsSync) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(dir, n === 1 ? name : stem + ' (' + n + ')' + ext);
    if (!taken.has(candidate.toLowerCase()) && !exists(candidate)) { taken.add(candidate.toLowerCase()); return candidate; }
  }
  throw new DiskError('Too many files with the name “' + name + '”.');
}

// A time and size limit shared by one scan, so a huge drive can never hang the server.
function makeBudget(ms, maxEntries = LIMITS.maxEntries, now = Date.now) {
  const deadline = now() + ms;
  return { partial: false, count: 0, over() { return now() > deadline || this.count > maxEntries; } };
}

// Walks a folder tree without following links; hands each real file to onFile(full, lstat). Async, and yields so the server stays responsive.
async function walk(root, { budget, skipDir, onFile, depth = LIMITS.maxDepth }) {
  const stack = [[root, 0]];
  let seen = 0;
  while (stack.length) {
    if (budget.over()) { budget.partial = true; return; }
    const [dir, d] = stack.pop();
    let handle;
    try { handle = await fsp.opendir(dir); } catch { continue; }
    try {
      for await (const ent of handle) {
        if (++seen % 400 === 0) { await sleepTick(); if (budget.over()) { budget.partial = true; return; } }
        if (ent.isSymbolicLink()) continue;                         // links and junctions: never followed
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { if (d < depth && !(skipDir && skipDir(full, ent.name))) stack.push([full, d + 1]); }
        else if (ent.isFile()) {
          let st; try { st = await fsp.lstat(full); } catch { continue; }
          if (st.isSymbolicLink() || !st.isFile()) continue;
          budget.count++;
          await onFile(full, st);
        }
      }
    } catch { /* an unreadable folder is skipped */ }
  }
}

/* ---------- the factory ---------- */
function createDiskCare(deps) {
  const { SANDBOX, TRASH, blockedPath = () => false, knownFolder = () => null, allRoots = () => [SANDBOX], statfs = fsp.statfs, now = Date.now, scopeDir } = deps;
  const home = deps.home || os.homedir();
  const tempDir = () => deps.tempDir || process.env.JARVIS_TEMP_DIR || os.tmpdir();
  const journalDir = path.join(SANDBOX, '.diskcare');
  const plans = new Map();

  const skipDirFor = extra => (full, name) => SKIP_DIRS.has(name.toLowerCase()) || name.startsWith('$') || /^onedrive/i.test(name) || blockedPath(full) || (extra && extra(full, name));

  /* ----- plans (kept on the server) ----- */
  function savePlan(kind, data) {
    for (const [id, p] of plans) if (now() - p.at > LIMITS.planTtl) plans.delete(id);
    while (plans.size >= LIMITS.maxPlans) plans.delete(plans.keys().next().value);
    const id = crypto.randomBytes(8).toString('hex');
    plans.set(id, { kind, at: now(), ...data });
    return id;
  }
  function getPlan(id, kinds) {
    const p = plans.get(String(id || ''));
    if (!p || now() - p.at > LIMITS.planTtl) { plans.delete(String(id || '')); throw new DiskError('That plan has expired (plans last 15 minutes). Ask again and I’ll make a fresh one.', 410); }
    if (kinds && !kinds.includes(p.kind)) throw new DiskError('That plan is for something else (' + p.kind + ').', 400);
    return p;
  }

  /* ----- where to look ----- */
  function scanRoots(where) {
    if (where) {
      const w = String(where).trim();
      const k = knownFolder(w.toLowerCase());
      let p = k || null;
      if (!p && scopeDir) { const sc = scopeDir(w); if (sc && sc.all) throw new DiskError('Say which drive or folder to look in, e.g. “on D drive” or “in my Documents”.'); if (sc && sc.path) p = sc.path; else if (sc && sc.error) throw new DiskError(sc.error, 404); }
      if (!p) throw new DiskError('I couldn’t find “' + w.slice(0, 60) + '”.', 404);
      if (blockedPath(p)) throw new DiskError('That location is off-limits (Windows, program or app-data folders).', 403);
      return [p];
    }
    const roots = [];
    for (const key of KNOWN_KEYS) { const p = knownFolder(key); if (p && !/onedrive/i.test(p)) roots.push(p); }
    for (const r of allRoots()) roots.push(r);
    return [...new Set(roots.map(r => path.resolve(r)))].filter(r => fs.existsSync(r) && !blockedPath(r));
  }
  const skipOwn = (full) => within(full, TRASH) || within(full, journalDir) || path.basename(full).toLowerCase() === '.jarvis-trash';

  /* ----- usage ----- */
  async function dirSize(dir, ms, extraSkip) {
    const budget = makeBudget(ms);
    let bytes = 0, files = 0;
    await walk(dir, { budget, skipDir: skipDirFor(extraSkip), onFile: (f, st) => { bytes += st.size; files++; } });
    return { bytes, files, partial: budget.partial };
  }
  async function usage() {
    const places = [], seen = new Set(), notes = [];
    const add = async (name, p, ms = 3500) => {
      if (!p || !fs.existsSync(p)) return;
      if (/onedrive/i.test(p)) { const n = 'OneDrive folders are not counted (their files may be online-only).'; if (!notes.includes(n)) notes.push(n); return; }
      const key = path.resolve(p).toLowerCase(); if (seen.has(key)) return; seen.add(key);
      const r = await dirSize(p, ms, full => within(full, TRASH) || within(full, journalDir));      // the trash gets its own line
      places.push({ name, path: p, ...r });
    };
    for (const key of KNOWN_KEYS) await add(key[0].toUpperCase() + key.slice(1), knownFolder(key));
    if (fs.existsSync(TRASH)) { const tr = await dirSize(TRASH, 3500); places.push({ name: 'JARVIS trash', path: TRASH, ...tr }); seen.add(path.resolve(TRASH).toLowerCase()); }
    for (const r of allRoots()) await add(r === SANDBOX ? 'JARVIS files' : 'Project folder ' + path.basename(r), r, 3500);
    const t = tempDir();
    let temp = { bytes: 0, files: 0, partial: false };
    if (fs.existsSync(t)) temp = await dirSize(t, 4000);
    const driveRoots = [...new Set([home, SANDBOX, ...allRoots(), t, process.env.SystemDrive ? process.env.SystemDrive + path.sep : null].filter(Boolean).map(driveOf))];
    const drives = [];
    for (const root of driveRoots) {
      try { const s = await statfs(root); drives.push({ drive: root.replace(/[\\/]+$/, '').toUpperCase(), freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }); } catch { /* a drive that will not answer is left out */ }
    }
    places.sort((a, b) => b.bytes - a.bytes);
    return { drives, places, temp: { path: t, ...temp }, notes, partial: places.some(p => p.partial) || temp.partial };
  }

  /* ----- tidy ----- */
  function planTidy(folder, { by = '' } = {}) {
    let ents;
    try { ents = fs.readdirSync(folder, { withFileTypes: true }); } catch (e) { throw new DiskError('I can’t read that folder (' + String(e.code || e.message).slice(0, 30) + ').', 404); }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    const items = [], skipped = { inProgress: 0, recent: 0, system: 0, folders: 0, links: 0, blocked: 0 }, taken = new Set(), t = now();
    let truncated = false;
    for (const ent of ents) {
      if (ent.isSymbolicLink()) { skipped.links++; continue; }
      if (ent.isDirectory()) { skipped.folders++; continue; }
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (SYSTEM_NAME.test(name) || name.startsWith('.')) { skipped.system++; continue; }
      if (PARTIAL.test(name)) { skipped.inProgress++; continue; }
      const from = path.join(folder, name);
      let st; try { st = fs.lstatSync(from); } catch { continue; }
      if (t - st.mtimeMs < LIMITS.tidyQuietMs) { skipped.recent++; continue; }
      if (items.length >= LIMITS.maxPlanItems) { truncated = true; break; }
      const cat = classify(name);
      const destDir = path.join(folder, by === 'month' ? path.join(cat, ym(new Date(st.mtimeMs))) : cat);
      let clash = false; try { const ds = fs.statSync(path.join(folder, cat)); clash = !ds.isDirectory(); } catch { /* does not exist yet: fine */ }
      if (clash) { skipped.blocked++; continue; }          // a FILE is already called "Documents"
      items.push({ from, to: uniqueTarget(destDir, name, taken), size: st.size, mtimeMs: st.mtimeMs, category: cat });
    }
    const byCat = {};
    for (const it of items) { const c = byCat[it.category] || (byCat[it.category] = { count: 0, bytes: 0, examples: [] }); c.count++; c.bytes += it.size; if (c.examples.length < 3) c.examples.push(path.basename(it.from)); }
    return { items, skipped, byCategory: byCat, truncated };
  }

  /* ----- large files ----- */
  async function findLarge({ where, minMB = LIMITS.largeMB, ms = 15000 } = {}) {
    const minBytes = Math.max(1, Number(minMB) || LIMITS.largeMB) * MB;
    const roots = scanRoots(where), budget = makeBudget(ms), found = [];
    for (const root of roots) {
      await walk(root, { budget, skipDir: skipDirFor(skipOwn), onFile: (f, st) => { if (st.size >= minBytes && !blockedPath(f)) found.push({ path: f, size: st.size, mtimeMs: st.mtimeMs }); } });
      if (budget.partial) break;
    }
    const uniq = new Map(found.map(x => [x.path.toLowerCase(), x]));
    const items = [...uniq.values()].sort((a, b) => b.size - a.size).slice(0, LIMITS.maxShown).map((x, i) => ({ ...x, n: i + 1, ageDays: Math.floor((now() - x.mtimeMs) / DAY), drive: driveOf(x.path) }));
    return { items, totalFound: uniq.size, bytes: sumBytes(items), partial: budget.partial, roots, minMB: minBytes / MB };
  }

  /* ----- duplicates ----- */
  async function hashFile(p, size, { full = true } = {}) {
    const h = crypto.createHash('sha256');
    const fd = await fsp.open(p, 'r');
    try {
      if (!full) {                                         // quick look: the first and last 64 KB (and the size)
        const n = 65536, buf = Buffer.alloc(n);
        let r = await fd.read(buf, 0, n, 0); h.update(buf.subarray(0, r.bytesRead));
        if (size > n * 2) { r = await fd.read(buf, 0, n, size - n); h.update(buf.subarray(0, r.bytesRead)); }
        h.update(String(size));
      } else {
        const buf = Buffer.alloc(1 << 20); let pos = 0;
        for (;;) { const r = await fd.read(buf, 0, buf.length, pos); if (!r.bytesRead) break; h.update(buf.subarray(0, r.bytesRead)); pos += r.bytesRead; }
      }
    } finally { await fd.close(); }
    return h.digest('hex');
  }
  const worseCopy = p => (/[\\/](downloads|desktop|temp|tmp)[\\/]/i.test(p) ? 1 : 0);
  // A file inside a project (a folder with .git, package.json, requirements.txt …) may be referenced by that project, so a copy there is
  // never proposed for the trash, even though trashing is undoable: it would break the project until someone noticed.
  const PROJECT_MARKERS = ['.git', 'package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle', 'Cargo.toml', 'go.mod', 'CMakeLists.txt', 'Makefile', 'index.html'];
  function makeInProject(roots) {
    const cache = new Map(), stops = new Set(roots.map(r => path.resolve(r).toLowerCase()));
    return file => {
      let d = path.dirname(file);
      for (let i = 0; i < 8; i++) {
        const key = d.toLowerCase();
        if (!cache.has(key)) cache.set(key, PROJECT_MARKERS.some(m => fs.existsSync(path.join(d, m))));
        if (cache.get(key)) return true;
        const up = path.dirname(d);
        if (up === d || stops.has(key)) return false;                      // never look above the folder that was scanned
        d = up;
      }
      return false;
    };
  }
  async function findDuplicates({ where, minMB = LIMITS.dupMinMB, ms = 25000 } = {}) {
    const minBytes = Math.max(1, Number(minMB) || LIMITS.dupMinMB) * MB;
    const roots = scanRoots(where), budget = makeBudget(ms), files = [];
    for (const root of roots) {
      await walk(root, { budget, skipDir: skipDirFor(skipOwn), onFile: (f, st) => { if (st.size >= minBytes && files.length < LIMITS.dupFilesCap && !blockedPath(f)) files.push({ path: f, size: st.size, mtimeMs: st.mtimeMs }); } });
      if (budget.partial) break;
    }
    const bySize = new Map();
    for (const f of files) { const k = f.size; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(f); }
    const groups = []; let hashed = 0;
    outer: for (const [size, list] of bySize) {
      if (list.length < 2) continue;
      const quick = new Map();
      for (const f of list) {
        if (budget.over()) { budget.partial = true; break outer; }
        try { const h = await hashFile(f.path, size, { full: false }); (quick.get(h) || quick.set(h, []).get(h)).push(f); hashed++; } catch { /* unreadable: skipped */ }
      }
      for (const cands of quick.values()) {
        if (cands.length < 2) continue;
        const full = new Map();
        for (const f of cands) {
          if (budget.over()) { budget.partial = true; break outer; }
          try { const h = await hashFile(f.path, size, { full: true }); (full.get(h) || full.set(h, []).get(h)).push(f); } catch { /* skipped */ }
        }
        for (const same of full.values()) if (same.length >= 2) groups.push(same);
      }
    }
    const inProject = makeInProject(roots);
    let protectedCopies = 0;
    const out = [];
    for (const g of groups) {
      const proj = new Map(g.map(f => [f.path, inProject(f.path)]));
      // copies inside a project come first (they are kept), then the better place, then the oldest
      const ranked = g.slice().sort((a, b) => (proj.get(a.path) ? 0 : 1) - (proj.get(b.path) ? 0 : 1) || worseCopy(a.path) - worseCopy(b.path) || a.mtimeMs - b.mtimeMs || a.path.length - b.path.length);
      const keep = ranked[0];
      const extras = ranked.slice(1).filter(x => !proj.get(x.path));
      protectedCopies += ranked.slice(1).length - extras.length;
      if (!extras.length) continue;                                         // nothing here that is safe to move
      out.push({ size: g[0].size, keep: keep.path, copies: extras.map(x => ({ path: x.path, size: x.size, mtimeMs: x.mtimeMs })), wasted: g[0].size * extras.length });
    }
    out.sort((a, b) => b.wasted - a.wasted);
    const items = out.flatMap((g, gi) => g.copies.map(c => ({ from: c.path, size: c.size, mtimeMs: c.mtimeMs, group: gi }))).slice(0, LIMITS.maxPlanItems);
    return { groups: out, items, wasted: out.reduce((s, g) => s + g.wasted, 0), scanned: files.length, partial: budget.partial, roots, protectedCopies };
  }

  /* ----- similar photos (a picture fingerprint, so a resized or re-saved copy still matches) ----- */
  const PHOTO_EXT = /\.(?:jpe?g|png|bmp|gif|tiff?)$/i;
  const hashCachePath = path.join(journalDir, 'photohash.json');
  function loadHashCache() { try { const j = JSON.parse(fs.readFileSync(hashCachePath, 'utf8')); return j && j.v === 1 && j.files ? j.files : {}; } catch { return {}; } }
  function saveHashCache(files) {
    const keys = Object.keys(files);
    if (keys.length > LIMITS.hashCacheMax) for (const k of keys.slice(0, keys.length - LIMITS.hashCacheMax)) delete files[k];     // oldest entries go first
    try { fs.mkdirSync(journalDir, { recursive: true }); fs.writeFileSync(hashCachePath, JSON.stringify({ v: 1, files })); } catch { /* a cache that cannot be saved only costs time */ }
  }
  // Windows only: draw each picture down to 9 × 8 grey values with System.Drawing (no extra package). Paths travel in a temp file, never in the script text.
  const HASH_SCRIPT = `
Add-Type -AssemblyName System.Drawing
$paths = [IO.File]::ReadAllLines($env:JARVIS_LIST, [Text.Encoding]::UTF8)
$out = New-Object System.Collections.ArrayList
foreach ($p in $paths) {
  try {
    $fs = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite')
    try {
      $img = [System.Drawing.Image]::FromStream($fs, $false, $false)
      try {
        $mid = New-Object System.Drawing.Bitmap 72, 64
        $g = [System.Drawing.Graphics]::FromImage($mid); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($img, 0, 0, 72, 64); $g.Dispose()
        $bmp = New-Object System.Drawing.Bitmap 9, 8
        $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear; $g.DrawImage($mid, 0, 0, 9, 8); $g.Dispose()
        $gr = @()
        for ($y = 0; $y -lt 8; $y++) { for ($x = 0; $x -lt 9; $x++) { $c = $bmp.GetPixel($x, $y); $gr += [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B) } }
        $bmp.Dispose(); $mid.Dispose()
        [void]$out.Add(@{ p = $p; g = $gr; w = $img.Width; h = $img.Height })
      } finally { $img.Dispose() }
    } finally { $fs.Dispose() }
  } catch { [void]$out.Add(@{ p = $p; e = $_.Exception.Message }) }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($out) -Compress -Depth 4))`;
  async function withList(lines, fn) {
    const dir = path.join(os.tmpdir(), 'jarvis-disk-' + process.pid + '-' + crypto.randomBytes(3).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'list.txt');
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    try { return await fn(file); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }
  }
  // paths → Map(path → { g: [72 grey values], w, h } | null)
  async function hashImages(paths) {
    if (deps.hashImages) return deps.hashImages(paths);
    if (!deps.ps) throw new DiskError('Comparing photos needs Windows.', 501);
    const out = new Map();
    const r = await withList(paths, file => deps.ps(HASH_SCRIPT, { JARVIS_LIST: file }, 120000));
    if (r && r.error) throw new DiskError('Reading the photos failed: ' + String(r.error).slice(0, 80), 500);
    for (const x of (Array.isArray(r) ? r : [])) { const g = x.g && x.g.value ? x.g.value : x.g; out.set(x.p, Array.isArray(g) && g.length === 72 ? { g, w: x.w, h: x.h } : null); }      // Windows PowerShell 5 sometimes wraps an array as {value, Count}
    return out;
  }
  async function findSimilarPhotos({ where, ms = 60000, maxDist = LIMITS.photoDist } = {}) {
    const roots = scanRoots(where), budget = makeBudget(ms), files = [];
    for (const root of roots) {
      await walk(root, { budget, skipDir: skipDirFor(skipOwn), onFile: (f, st) => { if (PHOTO_EXT.test(f) && st.size >= LIMITS.photoMinKB * 1024 && files.length < LIMITS.photoCap && !blockedPath(f)) files.push({ path: f, size: st.size, mtimeMs: st.mtimeMs }); } });
      if (budget.partial) break;
    }
    const cache = loadHashCache(), todo = [], hashes = [];
    let cached = 0, unreadable = 0;
    for (const f of files) {
      const c = cache[f.path.toLowerCase()];
      if (c && c[0] === f.size && Math.abs(c[1] - f.mtimeMs) < 2) { if (c[2]) { hashes.push({ ...f, hash: c[2], w: c[3], h: c[4] }); cached++; } else unreadable++; } else todo.push(f);   // a picture that could not be read is remembered too
    }
    let hashedNow = 0, timeUp = false;
    for (let i = 0; i < todo.length; i += LIMITS.hashBatch) {
      if (budget.over()) { timeUp = true; break; }
      const batch = todo.slice(i, i + LIMITS.hashBatch);
      const got = await hashImages(batch.map(b => b.path));
      for (const f of batch) {
        const g = got.get(f.path);
        if (!g) { unreadable++; cache[f.path.toLowerCase()] = [f.size, f.mtimeMs, null]; continue; }
        const hash = ScanMath.dHash(g.g);
        cache[f.path.toLowerCase()] = [f.size, f.mtimeMs, hash, g.w, g.h];
        hashes.push({ ...f, hash, w: g.w, h: g.h }); hashedNow++;
      }
      saveHashCache(cache);                                                // keep what was done, so a second ask carries on from here
    }
    const groups = ScanMath.groupSimilar(hashes.map(h => ({ id: h.path, hash: h.hash, f: h })), maxDist);
    const inProject = makeInProject(roots);
    let protectedCopies = 0;
    const out = [];
    for (const g of groups) {
      const list = g.map(x => x.f);
      const proj = new Map(list.map(f => [f.path, inProject(f.path)]));
      // keep: inside a project first, then the biggest picture (most pixels, then bytes), then the better place, then the oldest
      const ranked = list.slice().sort((a, b) => (proj.get(a.path) ? 0 : 1) - (proj.get(b.path) ? 0 : 1) || ((b.w * b.h) || 0) - ((a.w * a.h) || 0) || b.size - a.size || worseCopy(a.path) - worseCopy(b.path) || a.mtimeMs - b.mtimeMs);
      const keep = ranked[0];
      const extras = ranked.slice(1).filter(x => !proj.get(x.path));
      protectedCopies += ranked.slice(1).length - extras.length;
      if (!extras.length) continue;
      out.push({ keep: { path: keep.path, size: keep.size, w: keep.w, h: keep.h }, copies: extras.map(x => ({ path: x.path, size: x.size, mtimeMs: x.mtimeMs, w: x.w, h: x.h, distance: ScanMath.hamming(keep.hash, x.hash) })), wasted: extras.reduce((s, x) => s + x.size, 0) });
    }
    out.sort((a, b) => b.wasted - a.wasted);
    const items = out.flatMap((g, gi) => g.copies.map(c => ({ from: c.path, size: c.size, mtimeMs: c.mtimeMs, group: gi }))).slice(0, LIMITS.maxPlanItems);
    return { groups: out, items, wasted: out.reduce((s, g) => s + g.wasted, 0), scanned: files.length, hashedNow, cached, unreadable, remaining: todo.length - hashedNow - unreadable, partial: budget.partial || timeUp, roots, protectedCopies };
  }

  /* ----- big JPEGs that could be smaller ----- */
  const JPEG_EXT = /\.jpe?g$/i;
  async function findShrinkable({ where, minMB, olderDays, ms = 20000 } = {}) {
    const minBytes = (Number(minMB) > 0 ? Math.max(0.5, Number(minMB)) : LIMITS.shrinkMinMB) * MB, cutoff = now() - Math.max(0, Number(olderDays) >= 0 ? Number(olderDays) : LIMITS.shrinkAgeDays) * DAY;
    const roots = scanRoots(where), budget = makeBudget(ms), found = [];
    for (const root of roots) {
      await walk(root, { budget, skipDir: skipDirFor(skipOwn), onFile: (f, st) => { if (JPEG_EXT.test(f) && st.size >= minBytes && st.mtimeMs < cutoff && !blockedPath(f) && !blockedPath(f, { forWrite: true })) found.push({ path: f, size: st.size, mtimeMs: st.mtimeMs }); } });
      if (budget.partial) break;
    }
    const inProject = makeInProject(roots);
    let protectedFiles = 0;
    const uniq = new Map(found.map(x => [x.path.toLowerCase(), x]));
    const ok = [...uniq.values()].filter(x => (inProject(x.path) ? (protectedFiles++, false) : true)).sort((a, b) => b.size - a.size);
    const items = ok.slice(0, LIMITS.shrinkMax).map((x, i) => ({ from: x.path, size: x.size, mtimeMs: x.mtimeMs, n: i + 1 }));
    return { items, totalFound: ok.length, bytes: sumBytes(items), totalBytes: sumBytes(ok), protectedFiles, partial: budget.partial, roots, minMB: minBytes / MB, olderDays: Math.round((now() - cutoff) / DAY) };
  }
  // jobs: [{ from, out }] → [{ p, ok, w, h, bytes, e }]; writes a smaller JPEG to `out` (EXIF kept, rotation baked in, longest side capped, quality fixed)
  const SHRINK_SCRIPT = `
Add-Type -AssemblyName System.Drawing
$maxSide = [int]$env:JARVIS_MAXSIDE; $q = [long]$env:JARVIS_QUALITY
$jobs = [IO.File]::ReadAllLines($env:JARVIS_LIST, [Text.Encoding]::UTF8)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $q
$res = New-Object System.Collections.ArrayList
foreach ($line in $jobs) {
  $parts = $line -split "\`t"; $in = $parts[0]; $out = $parts[1]
  try {
    $fs = [IO.File]::Open($in, 'Open', 'Read', 'ReadWrite')
    try {
      $img = [System.Drawing.Image]::FromStream($fs, $true, $true)
      try {
        $orient = 1
        try { $pi = $img.GetPropertyItem(0x0112); $orient = [int]$pi.Value[0] } catch { $pi = $null }
        switch ($orient) { 2 { $img.RotateFlip('RotateNoneFlipX') } 3 { $img.RotateFlip('Rotate180FlipNone') } 4 { $img.RotateFlip('RotateNoneFlipY') } 5 { $img.RotateFlip('Rotate90FlipX') } 6 { $img.RotateFlip('Rotate90FlipNone') } 7 { $img.RotateFlip('Rotate270FlipX') } 8 { $img.RotateFlip('Rotate270FlipNone') } }
        if ($pi -and $orient -ne 1) { $pi.Value[0] = 1; $pi.Value[1] = 0; $img.SetPropertyItem($pi) }
        $w = $img.Width; $h = $img.Height
        $k = [Math]::Min(1.0, $maxSide / [Math]::Max($w, $h))
        $nw = [Math]::Max(1, [int][Math]::Round($w * $k)); $nh = [Math]::Max(1, [int][Math]::Round($h * $k))
        $bmp = New-Object System.Drawing.Bitmap $nw, $nh
        try {
          $bmp.SetResolution($img.HorizontalResolution, $img.VerticalResolution)
          $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($img, 0, 0, $nw, $nh); $g.Dispose()
          foreach ($p in $img.PropertyItems) { try { $bmp.SetPropertyItem($p) } catch { } }
          $bmp.Save($out, $codec, $ep)
        } finally { $bmp.Dispose() }
      } finally { $img.Dispose() }
    } finally { $fs.Dispose() }
    $chk = [System.Drawing.Image]::FromFile($out); $cw = $chk.Width; $ch = $chk.Height; $chk.Dispose()
    [void]$res.Add(@{ p = $in; ok = $true; w = $cw; h = $ch; bytes = (Get-Item -LiteralPath $out).Length })
  } catch { [void]$res.Add(@{ p = $in; ok = $false; e = $_.Exception.Message }) }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($res) -Compress -Depth 4))`;
  async function shrinkImages(jobs) {
    if (deps.shrinkImages) return deps.shrinkImages(jobs);
    if (!deps.ps) throw new DiskError('Making photos smaller needs Windows.', 501);
    const out = [];
    for (let i = 0; i < jobs.length; i += LIMITS.shrinkBatch) {
      const batch = jobs.slice(i, i + LIMITS.shrinkBatch);
      const r = await withList(batch.map(j => j.from + '\t' + j.out), file => deps.ps(SHRINK_SCRIPT, { JARVIS_LIST: file, JARVIS_MAXSIDE: String(LIMITS.shrinkMaxSide), JARVIS_QUALITY: String(LIMITS.shrinkQuality) }, 240000));
      if (r && r.error) { for (const j of batch) out.push({ p: j.from, ok: false, e: String(r.error).slice(0, 60) }); continue; }
      for (const x of (Array.isArray(r) ? r : [])) out.push(x);
    }
    return out;
  }
  const looksLikeJpeg = file => { try { const fd = fs.openSync(file, 'r'); try { const head = Buffer.alloc(3), tail = Buffer.alloc(2), size = fs.fstatSync(fd).size; if (size < 1000) return false; fs.readSync(fd, head, 0, 3, 0); fs.readSync(fd, tail, 0, 2, size - 2); return head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF && tail[0] === 0xFF && tail[1] === 0xD9; } finally { fs.closeSync(fd); } } catch { return false; } };

  /* ----- temp (the one allowlisted exception to the blocked-areas rule) ----- */
  function tempRoot() {
    const raw = tempDir();
    let real; try { real = fs.realpathSync(raw); } catch { throw new DiskError('I can’t find your temp folder.', 404); }
    if (path.parse(real).root === real || within(home, real) || within(SANDBOX, real)) throw new DiskError('That doesn’t look like a temp folder, so I won’t clean it.', 403);   // never a drive, nor anything that contains your files
    if (!/(?:^|[\\/])(?:temp|tmp)$/i.test(real)) throw new DiskError('I only clean folders named “Temp” or “tmp”.', 403);
    return real;
  }
  async function planTemp({ ms = 20000 } = {}) {
    const root = tempRoot(), budget = makeBudget(ms), items = [], limit = now() - LIMITS.tempAgeDays * DAY;
    await walk(root, { budget, skipDir: () => false, onFile: (f, st) => { if (st.mtimeMs < limit && items.length < 20000) items.push({ path: f, size: st.size, mtimeMs: st.mtimeMs }); } });
    return { root, items, bytes: sumBytes(items), partial: budget.partial, olderThanDays: LIMITS.tempAgeDays };
  }

  /* ----- JARVIS's own trash ----- */
  function journals() {
    let names = []; try { names = fs.readdirSync(journalDir).filter(f => /\.json$/.test(f)); } catch { return []; }
    const out = [];
    for (const f of names) { try { const j = JSON.parse(fs.readFileSync(path.join(journalDir, f), 'utf8')); if (j && RUN_RE.test(String(j.runId))) out.push(j); } catch { /* skip */ } }
    return out;
  }
  function trashFolders() {                                   // every place JARVIS has put things aside (one entry per folder, no overlaps)
    const out = new Map();
    if (fs.existsSync(TRASH)) out.set(TRASH.toLowerCase(), TRASH);
    for (const j of journals()) for (const d of j.trashDirs || []) if (fs.existsSync(d) && !within(d, TRASH)) out.set(d.toLowerCase(), d);
    return [...out.values()];
  }
  async function planTrash() {
    const items = []; let bytes = 0;
    const budget = makeBudget(15000);
    const roots = [...new Set(trashFolders())];
    for (const r of roots) {
      let kids = []; try { kids = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
      for (const k of kids) {
        if (k.isSymbolicLink()) continue;
        const full = path.join(r, k.name);
        let size = 0;
        if (k.isDirectory()) { await walk(full, { budget, skipDir: () => false, onFile: (f, st) => { size += st.size; } }); }
        else { try { size = fs.lstatSync(full).size; } catch { continue; } }
        items.push({ path: full, size, isDir: k.isDirectory() }); bytes += size;
      }
    }
    return { items, bytes, partial: budget.partial, roots };
  }

  /* ----- trash location on the SAME drive (a rename never copies) ----- */
  function trashDirFor(file, runId) {
    if (driveOf(file) === driveOf(TRASH)) return path.join(TRASH, 'diskcare-' + runId);
    return path.join(path.parse(path.resolve(file)).root, '.jarvis-trash', runId);
  }

  /* ----- applying reversible plans ----- */
  const recheck = (p, size, mtimeMs) => { try { const st = fs.lstatSync(p); return st.isFile() && !st.isSymbolicLink() && st.size === size && Math.abs(st.mtimeMs - mtimeMs) < 2; } catch { return false; } };
  function writeJournal(j) { fs.mkdirSync(journalDir, { recursive: true }); fs.writeFileSync(path.join(journalDir, j.runId + '.json'), JSON.stringify(j, null, 1)); }

  function applyMoves(plan, indices) {
    const runId = newRunId(now()), journal = { runId, kind: plan.kind, at: now(), items: [], createdDirs: [], trashDirs: [], approvalPaths: plan.approvalPaths || [] };
    const failed = [], skipped = [];
    const list = (indices ? indices.map(i => plan.items[i]) : plan.items).filter(Boolean);
    let n = 0, bytes = 0;
    for (const it of list) {
      if (blockedPath(it.from, { forWrite: true })) { failed.push({ path: it.from, why: 'that location is off-limits' }); continue; }
      if (!recheck(it.from, it.size, it.mtimeMs)) { skipped.push({ path: it.from, why: 'it changed or disappeared since the scan' }); continue; }
      try {
        let to = it.to;
        if (plan.kind === 'tidy') {
          const dir = path.dirname(to);
          if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); journal.createdDirs.push(dir); }
          if (fs.existsSync(to)) to = uniqueTarget(dir, path.basename(to), new Set());
        } else {
          const tdir = trashDirFor(it.from, runId);
          fs.mkdirSync(tdir, { recursive: true });
          to = path.join(tdir, String(++n).padStart(4, '0') + '_' + path.basename(it.from));
          if (!journal.trashDirs.includes(tdir)) journal.trashDirs.push(tdir);
        }
        fs.renameSync(it.from, to);
        journal.items.push({ from: it.from, to, size: it.size, trash: plan.kind !== 'tidy' ? to : undefined });
        bytes += it.size;
      } catch (e) { failed.push({ path: it.from, why: e.code === 'EXDEV' ? 'it is on another drive' : e.code === 'EBUSY' || e.code === 'EPERM' ? 'it is in use or protected' : String(e.code || e.message).slice(0, 40) }); }
    }
    if (journal.items.length) writeJournal(journal);
    return { runId: journal.items.length ? runId : null, moved: journal.items.length, bytes, failed, skipped };
  }

  // Make a smaller copy of each picture, then swap it in. The ORIGINAL goes to the JARVIS trash (a rename on its own drive), so "undo" brings it back.
  // The smaller file must decode, be a real JPEG and be at least 10% smaller, or the original is simply left alone.
  async function applyShrink(plan, indices) {
    const runId = newRunId(now()), journal = { runId, kind: 'shrink', at: now(), items: [], createdDirs: [], trashDirs: [], approvalPaths: plan.approvalPaths || [] };
    const failed = [], skipped = [];
    const list = (indices ? indices.map(i => plan.items[i]) : plan.items).filter(Boolean).slice(0, LIMITS.shrinkMax);
    const work = [];
    for (const it of list) {
      if (blockedPath(it.from, { forWrite: true })) { failed.push({ path: it.from, why: 'that location is off-limits' }); continue; }
      if (!recheck(it.from, it.size, it.mtimeMs)) { skipped.push({ path: it.from, why: 'it changed or disappeared since the scan' }); continue; }
      work.push(it);
    }
    const tmp = path.join(journalDir, 'shrink-' + runId);
    let n = 0, saved = 0, original = 0;
    try {
      if (work.length) fs.mkdirSync(tmp, { recursive: true });
      const jobs = work.map((it, i) => ({ from: it.from, out: path.join(tmp, i + '.jpg') }));
      const results = work.length ? await shrinkImages(jobs) : [];
      const byPath = new Map(results.map(r => [r.p, r]));
      for (let i = 0; i < work.length; i++) {
        const it = work[i], out = jobs[i].out, r = byPath.get(it.from);
        if (!r || !r.ok) { failed.push({ path: it.from, why: 'it could not be re-saved (' + String((r && r.e) || 'no answer').slice(0, 40) + ')' }); continue; }
        let newSize = 0; try { newSize = fs.statSync(out).size; } catch { /* missing */ }
        if (!newSize || !looksLikeJpeg(out)) { failed.push({ path: it.from, why: 'the smaller copy was not a valid picture, so I kept the original' }); continue; }
        if (newSize > it.size * (1 - LIMITS.shrinkMinSaving)) { skipped.push({ path: it.from, why: 'it is already small enough' }); continue; }
        if (!recheck(it.from, it.size, it.mtimeMs)) { skipped.push({ path: it.from, why: 'it changed while I worked' }); continue; }
        const side = it.from + '.jarvis-new';
        try {
          if (fs.existsSync(side)) throw Object.assign(new Error('busy'), { code: 'EEXIST' });
          fs.copyFileSync(out, side); fs.utimesSync(side, new Date(it.mtimeMs), new Date(it.mtimeMs));       // same date as the original, so it still sorts where it was
          const tdir = trashDirFor(it.from, runId); fs.mkdirSync(tdir, { recursive: true });
          const to = path.join(tdir, String(++n).padStart(4, '0') + '_' + path.basename(it.from));
          if (!journal.trashDirs.includes(tdir)) journal.trashDirs.push(tdir);
          fs.renameSync(it.from, to);
          try { fs.renameSync(side, it.from); }
          catch (e) { fs.renameSync(to, it.from); throw e; }                                                  // could not put the new one in place: the original goes straight back
          journal.items.push({ from: it.from, to, size: it.size, newSize, trash: to, replaced: true, w: r.w, h: r.h });
          saved += it.size - newSize; original += it.size;
        } catch (e) { try { fs.rmSync(side, { force: true }); } catch { /* none */ } failed.push({ path: it.from, why: e.code === 'EBUSY' || e.code === 'EPERM' ? 'it is in use or protected' : String(e.code || e.message).slice(0, 40) }); }
      }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } }
    if (journal.items.length) writeJournal(journal);
    return { runId: journal.items.length ? runId : null, moved: journal.items.length, bytes: original, saved, failed, skipped };
  }

  function undoRun(runId) {
    if (!RUN_RE.test(String(runId))) throw new DiskError('That isn’t a run I know.', 400);
    let j; try { j = JSON.parse(fs.readFileSync(path.join(journalDir, runId + '.json'), 'utf8')); } catch { throw new DiskError('I have no record of that run.', 404); }
    if (j.undoneAt) throw new DiskError('That run was already undone.', 409);
    const restored = [], problems = [];
    for (const it of (j.items || []).slice().reverse()) {
      try {
        if (!fs.existsSync(it.to)) { problems.push({ path: it.from, why: it.trash ? 'it is no longer in the JARVIS trash (emptied?)' : 'it is no longer there' }); continue; }
        if (it.replaced && fs.existsSync(it.from)) {                    // a smaller copy took its place: remove it, but only if nobody has touched it since
          let st = null; try { st = fs.lstatSync(it.from); } catch { /* gone */ }
          if (st && st.isFile() && st.size === it.newSize) fs.rmSync(it.from, { force: true });
          else { problems.push({ path: it.from, why: 'the smaller copy was changed since, so I left both' }); continue; }
        }
        if (fs.existsSync(it.from)) { problems.push({ path: it.from, why: 'something else is already at the old place' }); continue; }
        fs.mkdirSync(path.dirname(it.from), { recursive: true });
        fs.renameSync(it.to, it.from);
        restored.push(it.from);
      } catch (e) { problems.push({ path: it.from, why: String(e.code || e.message).slice(0, 40) }); }
    }
    for (const d of (j.createdDirs || []).slice().reverse()) { try { fs.rmdirSync(d); } catch { /* not empty: leave it */ } }
    for (const d of j.trashDirs || []) { try { fs.rmdirSync(d); } catch { /* still has items */ } }
    j.undoneAt = now(); if (!problems.length) j.fullyUndone = true;
    writeJournal(j);
    return { restored: restored.length, problems, kind: j.kind };
  }

  /* ----- applying permanent plans ----- */
  function applyTemp(plan) {
    const root = tempRoot(), rootReal = root.toLowerCase() + path.sep;
    let removed = 0, bytes = 0, inUse = 0, changed = 0;
    const dirs = new Set(), limit = now() - LIMITS.tempAgeDays * DAY;
    for (const it of plan.items) {
      try {
        const st = fs.lstatSync(it.path);
        if (!st.isFile() || st.isSymbolicLink() || st.size !== it.size || st.mtimeMs >= limit) { changed++; continue; }
        const real = fs.realpathSync(it.path);
        if (!real.toLowerCase().startsWith(rootReal)) { changed++; continue; }        // a junction led out of the temp folder
        fs.rmSync(it.path, { force: true });
        removed++; bytes += st.size; dirs.add(path.dirname(it.path));
      } catch (e) { if (e.code === 'ENOENT') changed++; else inUse++; }
    }
    // Folders that this clean-up emptied go too, working upward; never the temp folder itself, and a folder with anything left in it stays.
    for (const start of [...dirs].sort((a, b) => b.length - a.length)) {
      for (let d = start; d.toLowerCase() !== root.toLowerCase() && within(d, root); d = path.dirname(d)) {
        try { fs.rmdirSync(d); } catch { break; }                                 // not empty (or in use): stop climbing
      }
    }
    return { removed, bytes, inUse, changed };
  }
  function applyTrash(plan) {
    let removed = 0, bytes = 0, failed = 0;
    for (const it of plan.items) {
      try {
        const st = fs.lstatSync(it.path);
        if (st.isSymbolicLink()) { failed++; continue; }
        fs.rmSync(it.path, { recursive: true, force: true }); removed++; bytes += it.size;
      } catch { failed++; }
    }
    for (const r of plan.roots) { if (r !== TRASH) { try { fs.rmdirSync(r); } catch { /* not empty */ } try { fs.rmdirSync(path.dirname(r)); } catch { /* other runs still there */ } } }
    for (const j of journals()) { if (j.kind !== 'tidy' && !j.purgedAt && (j.trashDirs || []).length && !(j.trashDirs || []).some(d => fs.existsSync(d))) { j.purgedAt = now(); try { writeJournal(j); } catch { /* ignore */ } } }
    return { removed, bytes, failed };
  }

  return { usage, dirSize, planTidy, findLarge, findDuplicates, findSimilarPhotos, findShrinkable, applyShrink, planTemp, planTrash, savePlan, getPlan, applyMoves, undoRun, applyTemp, applyTrash, trashDirFor, scanRoots, tempRoot, journals, trashFolders, hashFile, plans };
}

/* ---------- routes ---------- */
module.exports = function setupDiskCare(app, deps) {
  const dc = createDiskCare({ ...deps, ps: deps.ps || ((...a) => (app.locals.ps ? app.locals.ps(...a) : Promise.resolve({ error: 'Windows tools are not available here' }))) });
  const { approvedChange, anyPath, findAllowed, knownFolder, blockedPath, TRASH, SANDBOX } = deps;
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const laptopOnly = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'File changes can only be made from JARVIS on the laptop.' }), false));
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (res.headersSent) return; res.status(e instanceof DiskError ? e.status : 500).json({ error: e instanceof DiskError ? e.message : 'Disk care hit a problem: ' + String(e.message).slice(0, 100) }); }
  };

  function folderFor(name) {
    const n = String(name || 'downloads').trim().replace(/^["']|["']$/g, '');
    let p = knownFolder(n.toLowerCase());
    if (!p && anyPath && path.isAbsolute(n)) p = anyPath(n);
    if (!p && findAllowed) p = findAllowed(n, { kind: 'folder' });
    let st; try { st = p && fs.statSync(p); } catch { /* none */ }
    if (!st || !st.isDirectory()) throw new DiskError('I can’t find a folder called “' + n.slice(0, 60) + '”. Try Downloads, Desktop, Documents or a full path.', 404);
    if (path.parse(p).root === p) throw new DiskError('That is a whole drive. Pick one folder.');
    if (blockedPath(p, { forWrite: true })) throw new DiskError('That folder is off-limits (Windows, program or app-data folders).', 403);
    if (within(p, TRASH)) throw new DiskError('That is JARVIS’s own trash.');
    return p;
  }

  app.post('/api/disk/usage', wrap(async (req, res) => {
    const u = await dc.usage();
    const trash = u.places.find(p => p.name === 'JARVIS trash');
    res.json({ success: true, ...u, trashBytes: trash ? trash.bytes : 0 });
  }));

  app.post('/api/disk/plan', wrap(async (req, res) => {
    const b = req.body || {}, kind = String(b.kind || '');
    if (kind === 'tidy') {
      const folder = folderFor(b.folder);
      const p = dc.planTidy(folder, { by: b.by === 'month' ? 'month' : '' });
      const planId = dc.savePlan('tidy', { items: p.items, folder, approvalPaths: [folder] });
      return res.json({ success: true, kind, planId, folder, count: p.items.length, bytes: sumBytes(p.items), byCategory: p.byCategory, skipped: p.skipped, truncated: p.truncated, by: b.by === 'month' ? 'month' : '' });
    }
    if (kind === 'large') {
      const r = await dc.findLarge({ where: b.where, minMB: b.minMB });
      const planId = dc.savePlan('large', { items: r.items.map(i => ({ from: i.path, size: i.size, mtimeMs: i.mtimeMs })), shown: r.items, approvalPaths: [...new Set(r.items.map(i => path.dirname(i.path)))].slice(0, 5) });
      return res.json({ success: true, kind, planId, items: r.items, totalFound: r.totalFound, bytes: r.bytes, partial: r.partial, minMB: r.minMB, roots: r.roots });
    }
    if (kind === 'duplicates') {
      const r = await dc.findDuplicates({ where: b.where, minMB: b.minMB });
      const planId = dc.savePlan('duplicates', { items: r.items, groups: r.groups, approvalPaths: [...new Set(r.items.map(i => path.dirname(i.from)))].slice(0, 5) });
      return res.json({ success: true, kind, planId, groupCount: r.groups.length, extraCopies: r.items.length, wasted: r.wasted, scanned: r.scanned, partial: r.partial, protectedCopies: r.protectedCopies, groups: r.groups.slice(0, 12).map(g => ({ size: g.size, keep: g.keep, copies: g.copies.map(c => c.path), wasted: g.wasted })), roots: r.roots });
    }
    if (kind === 'photos') {
      const r = await dc.findSimilarPhotos({ where: b.where });
      const planId = dc.savePlan('photos', { items: r.items, groups: r.groups, approvalPaths: [...new Set(r.items.map(i => path.dirname(i.from)))].slice(0, 5) });
      return res.json({ success: true, kind, planId, groupCount: r.groups.length, extraCopies: r.items.length, wasted: r.wasted, scanned: r.scanned, hashedNow: r.hashedNow, cached: r.cached, unreadable: r.unreadable, remaining: r.remaining, partial: r.partial, protectedCopies: r.protectedCopies, groups: r.groups.slice(0, 12).map((g, i) => ({ n: i + 1, keep: g.keep, copies: g.copies, wasted: g.wasted })), roots: r.roots });
    }
    if (kind === 'shrink') {
      const r = await dc.findShrinkable({ where: b.where, minMB: b.minMB, olderDays: b.olderDays });
      const planId = dc.savePlan('shrink', { items: r.items, approvalPaths: [...new Set(r.items.map(i => path.dirname(i.from)))].slice(0, 5) });
      return res.json({ success: true, kind, planId, count: r.items.length, totalFound: r.totalFound, bytes: r.bytes, totalBytes: r.totalBytes, protectedFiles: r.protectedFiles, partial: r.partial, minMB: r.minMB, olderDays: r.olderDays, items: r.items.slice(0, 15), quality: LIMITS.shrinkQuality, maxSide: LIMITS.shrinkMaxSide, roots: r.roots });
    }
    if (kind === 'temp') {
      const r = await dc.planTemp();
      const planId = dc.savePlan('temp', { items: r.items });
      return res.json({ success: true, kind, planId, root: r.root, count: r.items.length, bytes: r.bytes, partial: r.partial, olderThanDays: r.olderThanDays, permanent: true });
    }
    if (kind === 'trash') {
      const r = await dc.planTrash();
      const planId = dc.savePlan('trash', { items: r.items, roots: r.roots });
      return res.json({ success: true, kind, planId, count: r.items.length, bytes: r.bytes, partial: r.partial, permanent: true });
    }
    throw new DiskError('I can plan: tidy, large, duplicates, photos, shrink, temp or trash.');
  }));

  app.post('/api/disk/apply', wrap(async (req, res) => {
    if (!laptopOnly(req, res)) return;
    const b = req.body || {};
    const plan = dc.getPlan(b.planId, ['tidy', 'large', 'duplicates', 'photos', 'shrink']);
    let indices = null;
    if (plan.kind === 'large') {
      const pick = Array.isArray(b.pick) ? b.pick.map(Number) : [];
      if (!pick.length || pick.some(n => !Number.isInteger(n) || n < 1 || n > plan.items.length)) throw new DiskError('Which ones? Give their numbers from the list, e.g. 1, 3 and 5.');
      indices = [...new Set(pick)].map(n => n - 1);
    }
    if (plan.kind === 'photos' && Array.isArray(b.pick) && b.pick.length) {            // "clean sets 1 and 3": only those sets
      const sets = new Set(b.pick.map(Number));
      const maxG = Math.max(-1, ...plan.items.map(i => i.group)) + 1;
      if ([...sets].some(n => !Number.isInteger(n) || n < 1 || n > maxG)) throw new DiskError('I only have sets 1 to ' + maxG + ' in that list.');
      indices = plan.items.map((it, i) => (sets.has(it.group + 1) ? i : -1)).filter(i => i >= 0);
    }
    if (plan.kind === 'shrink' && Array.isArray(b.pick) && b.pick.length) {
      const pick = b.pick.map(Number);
      if (pick.some(n => !Number.isInteger(n) || n < 1 || n > plan.items.length)) throw new DiskError('I only have numbers 1 to ' + plan.items.length + ' in that list.');
      indices = [...new Set(pick)].map(n => n - 1);
    }
    if (!plan.items.length) throw new DiskError('Nothing to do: the plan has no files.');
    const verb = plan.kind === 'tidy' ? 'tidy the files in' : plan.kind === 'duplicates' ? 'move extra copies out of' : plan.kind === 'photos' ? 'move similar photos out of' : plan.kind === 'shrink' ? 'replace photos with smaller copies in' : 'move large files out of';
    if (approvedChange && !approvedChange(req, res, verb, ...(plan.approvalPaths || []))) return;
    const r = plan.kind === 'shrink' ? await dc.applyShrink(plan, indices) : dc.applyMoves(plan, indices);
    dc.plans.delete(String(b.planId));
    res.json({ success: true, kind: plan.kind, ...r, trashNote: plan.kind !== 'tidy' });
  }));

  app.post('/api/disk/applyPermanent', wrap(async (req, res) => {
    if (!laptopOnly(req, res)) return;
    const plan = dc.getPlan((req.body || {}).planId, ['temp', 'trash']);
    if (!plan.items.length) throw new DiskError('Nothing to clean.');
    const r = plan.kind === 'temp' ? dc.applyTemp(plan) : dc.applyTrash(plan);
    dc.plans.delete(String((req.body || {}).planId));
    res.json({ success: true, kind: plan.kind, permanent: true, ...r });
  }));

  app.post('/api/disk/undo', wrap(async (req, res) => {
    if (!laptopOnly(req, res)) return;
    const runId = String((req.body || {}).runId || '');
    const j = dc.journals().find(x => x.runId === runId);
    if (j && approvedChange && !approvedChange(req, res, 'move files back into', ...(j.approvalPaths || []))) return;
    res.json({ success: true, ...dc.undoRun(runId) });
  }));
};
Object.assign(module.exports, { createDiskCare, classify, uniqueTarget, makeBudget, walk, driveOf, within, newRunId, RUN_RE, CATEGORIES, LIMITS, DiskError, PARTIAL, SYSTEM_NAME });
