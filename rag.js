'use strict';
/* "Chat with my files": a small local search index (BM25) over the sandbox and the user's project folders.
   Text only, nothing leaves the laptop from here — the page decides what to do with the snippets it gets back.
   PDFs, .docx/.pptx/.xlsx and .odt are extracted locally. Pure helpers (chunking, tokenising, ranking) are exported for tests. */
const fs = require('fs');
const path = require('path');

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.rst', '.tex', '.csv', '.json', '.yaml', '.yml', '.ini', '.toml', '.html', '.css',
  '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.c', '.cpp', '.cc', '.h', '.hpp', '.java', '.cs', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.kt', '.swift', '.ipynb']);
// Office documents: text is extracted asynchronously (like PDFs), so they live in their own allowlist.
const DOC_EXT = new Set(['.docx', '.pptx', '.xlsx']);
const MAX_FILE = 200 * 1024, MAX_FILES = 3000, MAX_DEPTH = 8, CHUNK = 800;
const STOP = new Set(('a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to was we were what when where which who why will with you your ' +
  'about according say says said tell mention mentions note notes file files document documents docs doc find search look through check show explain give please jarvis').split(' '));

/* ---------- pure helpers ---------- */
// Lowercase words, common words dropped, plurals and simple endings folded so "deadlocks" finds "deadlock".
function tokenize(text) {
  const out = [];
  for (const w of String(text || '').toLowerCase().match(/[a-z0-9_]{2,}/g) || []) {
    if (STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}
// Splits text into ~800-character pieces on blank lines/headings where possible, remembering the line range.
function chunkText(text, size = CHUNK) {
  const lines = String(text).split(/\r?\n/);
  const chunks = [];
  let buf = [], len = 0, start = 1;
  const flush = end => { const t = buf.join('\n').trim(); if (t) chunks.push({ start, end, text: t }); buf = []; len = 0; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const boundary = (l.trim() === '' || /^#{1,6}\s/.test(l)) && len >= size * 0.5;
    if (boundary || len + l.length > size * 1.5) { flush(i); start = i + 1; }
    if (buf.length === 0) start = i + 1;
    buf.push(l.length > 2000 ? l.slice(0, 2000) : l); len += l.length + 1;
  }
  flush(lines.length);
  return chunks;
}
// BM25 over chunks: docs = [{tf:Map, len}], df = Map(term → docs containing it). Returns [{i, score}] best first.
function rank(queryTokens, docs, df, avgLen, k = 5) {
  const N = docs.length; if (!N || !queryTokens.length) return [];
  const k1 = 1.5, b = 0.75, q = [...new Set(queryTokens)];
  const scored = [];
  for (let i = 0; i < N; i++) {
    const d = docs[i]; let s = 0, hit = 0;
    for (const t of q) {
      const f = d.tf.get(t); if (!f) continue;
      hit++;
      const n = df.get(t) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / (avgLen || 1)));
    }
    // Chunks matching more of the question's distinct words beat chunks repeating one word.
    if (s > 0) scored.push({ i, score: s * (0.6 + 0.4 * hit / q.length) });
  }
  return scored.sort((a, b2) => b2.score - a.score).slice(0, k);
}

/* ---------- semantic (embedding) helpers ---------- */
const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
// Reciprocal-rank fusion of two best-first index lists: rank 0 counts most, agreement counts double.
function rrfFuse(a, b, k = 60) {
  const s = new Map();
  const add = (list, w) => { for (let r = 0; r < list.length; r++) s.set(list[r], (s.get(list[r]) || 0) + w / (k + r + 1)); };
  add(a, 1); add(b, 1);
  return [...s.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
}

/* ---------- the index ---------- */
module.exports = function setupRag(app, { allRoots, SKIP_DIRS, rel, isInternal, pdfPages, docText, semantic }) {
  const MAX_PDF = 40 * 1024 * 1024;
  const pdfText = new Map(); // path → { key, pages } (filled asynchronously, then used by the next scan)
  let pendingPdf = [];
  const docTextMap = new Map(); // path → { key, pages } for .docx/.pptx/.xlsx (same pattern as PDFs)
  let pendingDoc = [];
  const files = new Map(); // full path → { mtime, size, name, chunks:[{start,end,text,tf,len}] }
  let docs = [], owners = [], df = new Map(), avgLen = 1;
  let lastScan = 0, scanning = null, lastStats = { files: 0, chunks: 0, at: 0, vecChunks: 0 };
  // Chunk vectors, keyed file+start-line so they survive index rebuilds. RAM only: a few MB at the cap,
  // rebuilt lazily from the model after a restart. semantic = { enabled(), model(), embed(model, inputs) } from the server.
  const vecs = new Map();
  const VEC_CAP = 5000, EMBED_ROUND = 256, EMBED_BATCH = 32;
  const vecKey = (f, c) => f + ':' + c.start;
  const semOk = () => semantic && semantic.enabled && semantic.enabled();

  function* walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.') || SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) yield* walk(full, depth + 1);
      else if (it.isFile() && (TEXT_EXT.has(path.extname(it.name).toLowerCase()) || (pdfPages && /\.pdf$/i.test(it.name)) || (docText && DOC_EXT.has(path.extname(it.name).toLowerCase()))) && !isInternal(full)) yield full;
    }
  }
  function scan() {
    const seen = new Set(); pendingPdf = []; pendingDoc = [];
    let n = 0, changed = false;
    for (const root of allRoots()) for (const f of walk(root, 0)) {
      if (++n > MAX_FILES) break;
      seen.add(f);
      let st; try { st = fs.statSync(f); } catch { continue; }
      const isPdf = /\.pdf$/i.test(f);
      const isDoc = !isPdf && DOC_EXT.has(path.extname(f).toLowerCase());
      if ((isPdf ? st.size > MAX_PDF : st.size > MAX_FILE) || st.size === 0) { if (files.delete(f)) changed = true; continue; }
      const old = files.get(f);
      if (old && old.mtime === st.mtimeMs && old.size === st.size) continue;
      const nameToks = tokenize(path.basename(f, path.extname(f)).replace(/[-_.]+/g, ' '));
      let pieces;
      if (isPdf) { // PDFs: text extracted asynchronously (ensureFresh), chunked page by page so answers can cite pages
        const px = pdfText.get(f);
        if (!px || px.key !== st.size + ':' + st.mtimeMs) { pendingPdf.push(f); continue; }
        pieces = px.pages.flatMap((t, i) => chunkText(t).map(c => ({ ...c, page: i + 1 })));
      } else if (isDoc) { // docx/pptx/xlsx: same async pattern, slides/sheets become pages
        const dx = docTextMap.get(f);
        if (!dx || dx.key !== st.size + ':' + st.mtimeMs) { pendingDoc.push(f); continue; }
        pieces = dx.pages.flatMap((t, i) => chunkText(t).map(c => ({ ...c, page: i + 1 })));
      } else {
        let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
        if (text.includes('\0')) continue;
        pieces = chunkText(text);
      }
      const chunks = pieces.map(c => {
        const toks = [...tokenize(c.text), ...nameToks, ...nameToks]; // the file name counts double
        const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        return { ...c, tf, len: toks.length };
      });
      files.set(f, { mtime: st.mtimeMs, size: st.size, name: rel(f), full: f, chunks });
      changed = true;
    }
    for (const f of [...files.keys()]) if (!seen.has(f)) { files.delete(f); changed = true; }
    if (changed || !docs.length) {
      docs = []; owners = []; df = new Map();
      for (const [f, e] of files) for (const c of e.chunks) {
        docs.push(c); owners.push(e);
        for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      }
      avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
    }
    lastScan = Date.now();
    lastStats = { files: files.size, chunks: docs.length, at: lastScan, vecChunks: vecs.size };
    // drop vectors for files that vanished
    if (vecs.size) { const live = new Set(); for (const [f, e] of files) for (const c of e.chunks) live.add(vecKey(f, c)); for (const key of [...vecs.keys()]) if (!live.has(key)) vecs.delete(key); }
  }
  // Embed up to EMBED_ROUND chunks that have no vector yet (batched; one bad batch never stops the rest).
  async function embedPending() {
    if (!semOk()) return;
    const model = semantic.model();
    const todo = [];
    outer: for (const [f, e] of files) for (const c of e.chunks) {
      const key = vecKey(f, c);
      if (!vecs.has(key)) { todo.push({ key, text: (e.name.replace(/[-_/.]+/g, ' ') + ' ' + c.text).slice(0, 4000) }); if (todo.length >= EMBED_ROUND || vecs.size + todo.length > VEC_CAP) break outer; }
    }
    for (let i = 0; i < todo.length; i += EMBED_BATCH) {
      const batch = todo.slice(i, i + EMBED_BATCH);
      try {
        const out = await semantic.embed(model, batch.map(b => b.text));
        batch.forEach((b, j) => { if (out[j] && out[j].length) vecs.set(b.key, out[j]); });
        lastStats.vecChunks = vecs.size;
      } catch { return; } // no model / Ollama down → stay keyword-only until the next round
    }
  }
  // Rescans at most every 20 s (cheap: only changed files are re-read), and never twice at once.
  async function ensureFresh(force) {
    if (!force && Date.now() - lastScan < 20000 && docs.length) return;
    if (!scanning) scanning = (async () => {
      await null; // let `scanning` be assigned before this can finish (otherwise it would never be cleared)
      try {
        scan();
        // new or changed PDFs: read their text (a few at a time), then scan again to index them
        for (let round = 0; round < 3 && pendingPdf.length && pdfPages; round++) {
          for (const f of pendingPdf.slice(0, 15)) {
            try { const st = fs.statSync(f); const r = await pdfPages(f); pdfText.set(f, { key: st.size + ':' + st.mtimeMs, pages: r.pages }); }
            catch { try { const st = fs.statSync(f); pdfText.set(f, { key: st.size + ':' + st.mtimeMs, pages: [] }); } catch {} }
          }
          scan();
        }
        // same for office documents (doctext.js reads the whole file synchronously — small caps apply)
        if (pendingDoc.length && docText) {
          for (const f of pendingDoc.slice(0, 20)) {
            try { const st = fs.statSync(f); const r = await docText(f); docTextMap.set(f, { key: st.size + ':' + st.mtimeMs, pages: r.pages || [] }); }
            catch { try { const st = fs.statSync(f); docTextMap.set(f, { key: st.size + ':' + st.mtimeMs, pages: [] }); } catch {} }
          }
          scan();
        }
        if (semOk()) await embedPending();
      } finally { scanning = null; }
    })();
    await scanning;
  }
  // file: optional name (e.g. "lecture3.pdf") to search inside one file only; qvec: optional query embedding.
  function search(query, k = 5, file, qvec) {
    const want = String(file || '').toLowerCase();
    const inFile = want ? i => owners[i].name.toLowerCase().endsWith(want) || owners[i].name.toLowerCase().split('/').pop() === want : null;
    const idx = inFile ? docs.map((_, i) => i).filter(inFile) : null;
    const pool = idx ? idx.map(i => docs[i]) : docs;
    const kk = Math.min(Math.max(k, 1), 10);
    const hits = rank(tokenize(query), pool, df, avgLen, kk * 4);
    // asking about one file with words it doesn't contain: fall back to its first chunks, so there's still something to answer from
    let ranked = hits.length || !idx ? hits.map(h => (idx ? idx[h.i] : h.i)) : idx.slice(0, Math.min(kk, 3));
    // semantic half: cosine over chunk vectors, then fuse the two rankings (skipped quietly when unavailable)
    if (qvec && vecs.size) {
      const scored = [];
      for (let gi = 0; gi < docs.length; gi++) {
        if (idx && !inFile(gi)) continue;
        const v = vecs.get(vecKey(owners[gi].full, docs[gi]));
        if (!v) continue;
        scored.push({ gi, s: cosine(qvec, v) });
      }
      scored.sort((a, b) => b.s - a.s);
      const vecIds = scored.slice(0, kk * 4).map(x => x.gi);
      if (vecIds.length) ranked = rrfFuse(ranked, vecIds).slice(0, kk);
    }
    return ranked.slice(0, kk).map(gi => { const c = docs[gi], o = owners[gi]; return { file: o.name, start: c.start, end: c.end, page: c.page || null, text: c.text, score: null }; });
  }
  // Query embedding for the route (null → BM25 only). Never throws.
  async function embedQuery(query) {
    if (!semOk() || !vecs.size) return null;
    try { const v = await semantic.embed(semantic.model(), [query]); return v && v[0] && v[0].length ? v[0] : null; } catch { return null; }
  }

  app.post('/api/rag/search', async (req, res) => {
    const query = String(req.body.query || '').trim().slice(0, 500);
    if (!query) return res.status(400).json({ error: 'Ask a question first' });
    await ensureFresh(false);
    const qvec = await embedQuery(query);
    res.json({ success: true, results: search(query, Number(req.body.k) || 5, req.body.file, qvec), files: lastStats.files, chunks: lastStats.chunks, vecChunks: lastStats.vecChunks });
  });
  app.post('/api/rag/reindex', async (req, res) => { await ensureFresh(true); res.json({ success: true, ...lastStats }); });
  app.get('/api/rag/status', (req, res) => res.json({ success: true, ...lastStats, watching: watcher.active, semantic: semOk() && lastStats.vecChunks > 0 }));

  /* ---------- auto-index: fs.watch on the allowed roots ---------- */
  // A save/drop/rename lands in the index within ~2 s of the next ensureFresh — no manual reindex.
  // Network drives that error under fs.watch just leave this root unwatched; the 20 s rescan still covers them.
  const watcher = { watchers: new Map(), active: 0, timer: null };
  function watchRoots() {
    const roots = new Set(allRoots().map(r => { try { return fs.realpathSync(r); } catch { return null; } }).filter(Boolean));
    for (const [r, w] of watcher.watchers) if (!roots.has(r)) { try { w.close(); } catch {} watcher.watchers.delete(r); }
    for (const r of roots) {
      if (watcher.watchers.has(r)) continue;
      try {
        const onChange = () => {
          clearTimeout(watcher.timer);
          watcher.timer = setTimeout(() => { ensureFresh(false).catch(() => {}); }, 2000);
        };
        let w; try { w = fs.watch(r, { persistent: false, recursive: true }, onChange); } catch { w = fs.watch(r, { persistent: false }, onChange); }   // subfolders too where the OS supports it
        w.on('error', () => { /* drive vanished / unsupported — periodic rescan still applies */ });
        watcher.watchers.set(r, w);
      } catch { /* this root can't be watched; periodic rescan covers it */ }
    }
    watcher.active = watcher.watchers.size;
  }
  let rootsPoll = null;
  function startWatcher() {
    watchRoots();
    clearInterval(rootsPoll); rootsPoll = setInterval(watchRoots, 30000); // pick up added/removed project folders
  }

  return { search, ensureFresh, startWatcher };
};
Object.assign(module.exports, { tokenize, stem, chunkText, rank, TEXT_EXT, DOC_EXT, cosine, rrfFuse });
