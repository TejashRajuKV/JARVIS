'use strict';
/* Search your screenshots by what is IN them ("find the screenshot with the wifi password"). Each picture in your screenshot folders is read once with the
   laptop's own text recogniser (Windows OCR, nothing leaves the computer); the text is kept in ~/jarvis/.shotindex.json and searched by words.
     What:   PNG and JPEG files in the folders (default: Pictures\Screenshots and the OneDrive copy of it), two levels deep, newest first.
     When:   only when you ask ("index my screenshots"), a batch at a time in the background. A picture is read again only if it changed.
     Safety: screenshots can show passwords, so the index file is never copied by the drive backup, and searching/forgetting works from the laptop page only.
             "Open" works only for a file that is in the index. Nothing is ever changed, moved or deleted in your folders.
   createShotIndex() takes the OCR function and the folders as parameters, so it is tested on temp folders with a fake reader. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const IMG = /\.(?:png|jpe?g)$/i, MAX_FILES = 3000, MAX_BYTES = 12 * 1048576, TEXT_KEEP = 4000, DEPTH = 2;
const STOP = new Set('the a an of for with and or to in on at is are was it this that my me i find search screenshot screenshots picture pic image photo where which what has have had says say said showing shows show containing contains about'.split(' '));
const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9@._+#-]+/).map(w => w.replace(/^[._-]+|[._-]+$/g, '')).filter(w => w.length >= 2 && !STOP.has(w));

function createShotIndex({ SANDBOX, ocr, folders = () => [], now = Date.now, stateFile, imageBytes }) {
  const sf = stateFile || path.join(SANDBOX, '.shotindex.json');
  let db = null, running = null, progress = null;
  const load = () => { if (db) return db; try { const j = JSON.parse(fs.readFileSync(sf, 'utf8')); db = j && typeof j === 'object' && j.files ? j : { files: {}, extra: [] }; } catch { db = { files: {}, extra: [] }; } if (!Array.isArray(db.extra)) db.extra = []; return db; };
  const save = () => { try { fs.writeFileSync(sf, JSON.stringify(db)); } catch { /* it just reads them again next time */ } };
  const allFolders = () => [...new Set([...folders(), ...load().extra].map(f => path.resolve(f)))].filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });

  async function listImages() {
    const out = [];
    async function walk(dir, depth) {
      let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= MAX_FILES) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < DEPTH && !e.name.startsWith('.')) await walk(full, depth + 1); }
        else if (e.isFile() && IMG.test(e.name)) { try { const st = await fsp.stat(full); if (st.size > 1000 && st.size <= MAX_BYTES) out.push({ full, name: e.name, m: Math.round(st.mtimeMs), s: st.size }); } catch { /* gone */ } }
      }
    }
    for (const f of allFolders()) await walk(f, 0);
    return out.sort((a, b) => b.m - a.m);
  }
  const pendingOf = list => { const d = load().files; return list.filter(x => { const r = d[x.full]; return !r || r.m !== x.m || r.s !== x.s || (r.err && now() - (r.at || 0) > 864e5); }); };

  async function status() {
    const d = load(), list = await listImages(), pend = pendingOf(list);
    return { folders: allFolders(), extra: d.extra, total: list.length, indexed: list.length - pend.length, pending: pend.length, running: !!running, progress, lastRun: d.lastRun || null, readable: typeof ocr === 'function' };
  }
  // reads up to `max` new or changed pictures (newest first); resolves with a summary. One run at a time.
  function update({ max = 60, budgetMs = 10 * 60000 } = {}) {
    if (running) return running;
    running = (async () => {
      const d = load(), list = await listImages(), todo = pendingOf(list).slice(0, max), t0 = now();
      let done = 0, failed = 0; progress = { done: 0, of: todo.length };
      for (const x of todo) {
        if (now() - t0 > budgetMs) break;
        try {
          const buf = imageBytes ? await imageBytes(x.full) : await fsp.readFile(x.full);
          const r = await ocr(buf);
          if (!r || r.error) { d.files[x.full] = { m: x.m, s: x.s, t: '', err: String((r && r.error) || 'could not be read').slice(0, 80), at: now() }; failed++; if (r && /no OCR language|needs Windows/.test(String(r.error))) break; }
          else { d.files[x.full] = { m: x.m, s: x.s, t: String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_KEEP) }; done++; }
        } catch (e) { d.files[x.full] = { m: x.m, s: x.s, t: '', err: String(e.message || e).slice(0, 80), at: now() }; failed++; }
        progress = { done: done + failed, of: todo.length };
        if ((done + failed) % 10 === 0) save();
      }
      // pictures that were deleted from the folders are dropped from the index
      const live = new Set(list.map(x => x.full)); for (const k of Object.keys(d.files)) if (!live.has(k) && fs.existsSync(path.dirname(k))) delete d.files[k];          // folder reachable but the file is gone (a folder that is offline keeps its entries)
      d.lastRun = now(); save();
      return { done, failed, remaining: Math.max(0, pendingOf(list).length) };
    })().finally(() => { running = null; progress = null; });
    return running;
  }
  // query words → [{ path, name, mtime, snippet, score }], best first (more of the words, then newer). `from`/`to` limit by file date.
  function search(q, { limit = 8, from = 0, to = Infinity } = {}) {
    const squash = x => String(x).toLowerCase().replace(/[-’']/g, ''), words = [...new Set(tokens(q).map(squash))].filter(Boolean); if (!words.length) return { error: 'Tell me a word or two that is in the picture.' };
    const phraseQ = squash(q).replace(/[^a-z0-9@._+# ]+/g, ' ').split(/\s+/).filter(Boolean); while (phraseQ.length && STOP.has(phraseQ[0])) phraseQ.shift(); while (phraseQ.length && STOP.has(phraseQ[phraseQ.length - 1])) phraseQ.pop();
    const phraseStr = phraseQ.length > 1 ? phraseQ.join(' ') : '';
    const out = [];
    for (const [p, r] of Object.entries(load().files)) {
      if (!r.t || r.m < from || r.m > to) continue;
      const low = squash(r.t + ' ' + path.basename(p)).replace(/[^a-z0-9@._+# ]+/g, ' ').replace(/\s+/g, ' ');
      let hit = 0; for (const w of words) if (low.includes(w)) hit++;
      if (!hit) continue;
      const phrase = phraseStr && low.includes(phraseStr) ? 1 : 0;
      const at = Math.max(0, low.indexOf(words.find(w => low.includes(w))) - 50);
      out.push({ path: p, name: path.basename(p), mtime: r.m, score: hit / words.length + phrase * 0.5, hits: hit, snippet: (at ? '…' : '') + r.t.slice(at, at + 160) + (at + 160 < r.t.length ? '…' : '') });
    }
    out.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
    return { results: out.slice(0, limit), total: out.length, words };
  }
  const isIndexed = p => { const d = load().files; return Object.prototype.hasOwnProperty.call(d, path.resolve(String(p || ''))); };
  function addFolder(f) {
    const p = path.resolve(String(f || '').trim().replace(/^["']|["']$/g, ''));
    if (!path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return { error: 'I could not find that folder.' };
    if (/^[A-Za-z]:\\?$/.test(p) || p === path.parse(p).root) return { error: 'Choose a folder, not a whole drive.' };
    const d = load(); if (!d.extra.some(x => x.toLowerCase() === p.toLowerCase())) { d.extra.push(p); save(); } return { folder: p };
  }
  function removeFolder(f) { const d = load(), p = path.resolve(String(f || '')); const n = d.extra.length; d.extra = d.extra.filter(x => x.toLowerCase() !== p.toLowerCase()); save(); return { removed: n - d.extra.length }; }
  function forget() { const n = Object.keys(load().files).length; db = { files: {}, extra: load().extra }; if (db.extra.length) save(); else { try { fs.rmSync(sf, { force: true }); } catch { /* ignore */ } } return { forgotten: n }; }
  return { status, update, search, isIndexed, addFolder, removeFolder, forget, allFolders, listImages };
}

/* ---------- routes (laptop page only) ---------- */
module.exports = function setupShots(app, { SANDBOX, IS_WIN }) {
  const home = os.homedir();
  const defaults = () => [path.join(home, 'Pictures', 'Screenshots'), path.join(home, 'OneDrive', 'Pictures', 'Screenshots'), path.join(home, 'OneDrive', 'Screenshots'), path.join(SANDBOX, 'Screenshots')];
  const ocr = async buf => (app.locals.ocrWords ? app.locals.ocrWords(buf) : { error: 'The text reader is not available.' });
  const idx = createShotIndex({ SANDBOX, ocr, folders: defaults });
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const guard = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'Your screenshots can only be searched from JARVIS on the laptop.' }), false));
  const wrap = fn => async (req, res) => { if (!guard(req, res)) return; try { await fn(req, res); } catch (e) { if (!res.headersSent) res.status(500).json({ error: 'The screenshot index hit a problem: ' + String(e.message).slice(0, 100) }); } };
  app.get('/api/shots/status', wrap(async (req, res) => res.json({ success: true, ...(await idx.status()) })));
  app.post('/api/shots/update', wrap(async (req, res) => {
    const st = await idx.status();
    if (!IS_WIN) return res.status(501).json({ error: 'Reading screenshots needs Windows’ text recogniser, which this computer does not have.' });
    if (st.running) return res.json({ success: true, started: false, running: true });
    if (!st.total) return res.status(404).json({ error: 'I found no screenshots. I look in Pictures\\Screenshots; say “add D:\\Shots to my screenshot folders” to add another.' });
    idx.update({ max: Math.min(500, Math.max(1, +(req.body && req.body.max) || 150)) }).catch(() => {});
    res.json({ success: true, started: true, pending: st.pending, total: st.total });
  }));
  app.post('/api/shots/search', wrap(async (req, res) => {
    const b = req.body || {}; const r = idx.search(String(b.q || '').slice(0, 200), { limit: Math.min(20, +b.limit || 8), from: +b.from || 0, to: +b.to || Infinity });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ success: true, ...r, status: await idx.status() });
  }));
  app.post('/api/shots/folders', wrap(async (req, res) => {
    const b = req.body || {}; const r = b.remove ? idx.removeFolder(b.remove) : idx.addFolder(b.add);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ success: true, ...r, folders: idx.allFolders() });
  }));
  app.post('/api/shots/forget', wrap(async (req, res) => res.json({ success: true, ...idx.forget() })));
  app.post('/api/shots/open', wrap(async (req, res) => {
    const p = String((req.body && req.body.path) || '');
    if (!idx.isIndexed(p) || !IMG.test(p) || !fs.existsSync(p)) return res.status(404).json({ error: 'That picture is not in the index (or it was moved).' });
    require('child_process').execFile(IS_WIN ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [path.resolve(p)], { windowsHide: true }, () => {});
    res.json({ success: true });
  }));
  return idx;
};
Object.assign(module.exports, { createShotIndex, tokens, IMG });
