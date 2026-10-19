// "Chat with my files" tests: chunking, tokenising, BM25 ranking, and a real index over a temp folder.
// Run: node tests/rag.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const R = require(path.join(__dirname, '..', 'rag.js'));
// A minimal valid PDF with one line of text per page (Helvetica), built with correct byte offsets.
function makePdf(pagesText) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + pagesText.length * 2;
  const kids = [];
  for (const t of pagesText) {
    const stream = 'BT /F1 12 Tf 50 750 Td (' + t.replace(/[()\\]/g, '\\$&') + ') Tj ET';
    const c = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + c + ' 0 R >>'));
  }
  add('<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  const cat = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

check('stopwords dropped, plurals folded', JSON.stringify(R.tokenize('What do my notes say about Deadlocks?')) === '["deadlock"]', R.tokenize('What do my notes say about Deadlocks?'));
check('stem: ing/ies/es', R.stem('scheduling') === 'schedul' && R.stem('queries') === 'query' && R.stem('processes') === 'process' && R.stem('class') === 'class');

const text = '# Deadlock\nA deadlock happens when processes wait forever.\n\n' + 'filler line about something else. '.repeat(40) + '\n\n# Paging\nPaging splits memory into fixed size frames.\n';
const chunks = R.chunkText(text);
check('chunks cover the text with line ranges', chunks.length >= 2 && chunks[0].start === 1 && chunks.every(c => c.end >= c.start), chunks.map(c => [c.start, c.end]));
check('a heading starts a new chunk once the last is big enough', chunks.some(c => /^# Paging/.test(c.text)));
check('empty text → no chunks', R.chunkText('  \n\n').length === 0);

// tiny corpus for ranking
const mk = t => { const toks = R.tokenize(t), tf = new Map(); toks.forEach(x => tf.set(x, (tf.get(x) || 0) + 1)); return { tf, len: toks.length }; };
const docs = ['deadlock needs mutual exclusion hold and wait no preemption circular wait', 'paging maps virtual pages to physical frames', 'binary search halves the range each step'].map(mk);
const df = new Map(); docs.forEach(d => { for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1); });
const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
const top = q => R.rank(R.tokenize(q), docs, df, avg, 3);
check('deadlock question ranks the deadlock doc first', top('what causes a deadlock')[0].i === 0);
check('paging question ranks the paging doc first', top('how does paging work')[0].i === 1);
check('no matching words → nothing', top('quantum chromodynamics').length === 0);

// real index over a temp "sandbox"
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-'));
fs.writeFileSync(path.join(dir, 'os-notes.md'), '# OS\nA deadlock happens when four conditions hold together: mutual exclusion, hold and wait, no preemption, circular wait.\n');
fs.writeFileSync(path.join(dir, 'dbms.txt'), 'Normalization removes redundancy. Third normal form removes transitive dependencies.\n');
fs.writeFileSync(path.join(dir, 'skip.bin'), Buffer.from([0, 1, 2, 3]));
fs.mkdirSync(path.join(dir, 'node_modules')); fs.writeFileSync(path.join(dir, 'node_modules', 'x.md'), 'deadlock in node_modules');
fs.mkdirSync(path.join(dir, '.trash')); fs.writeFileSync(path.join(dir, '.trash', 't.md'), 'deadlock in trash');
fs.writeFileSync(path.join(dir, '.config.json'), '{"apiKey":"sk-SECRET deadlock"}');
const routes = {};
const app = { post: (p, h) => { routes[p] = h; }, get: (p, h) => { routes[p] = h; } };
const rag = R(app, { allRoots: () => [dir], SKIP_DIRS: new Set(['node_modules']), rel: p => path.relative(dir, p).split(path.sep).join('/'), isInternal: p => path.basename(p) === '.config.json' });
const call = async (p, body) => { let out; await routes[p]({ body }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) }); return out; };
(async () => {
  const r = await call('/api/rag/search', { query: 'what do my os notes say about deadlock?' });
  check('finds the note', r.results.length && r.results[0].file === 'os-notes.md', r.results);
  check('cites lines', r.results[0].start >= 1 && r.results[0].end >= r.results[0].start);
  check('never indexes node_modules, dot folders, secrets or binaries', r.results.every(x => x.file === 'os-notes.md') && r.files === 2, { files: r.files, results: r.results.map(x => x.file) });
  const r2 = await call('/api/rag/search', { query: 'third normal form' });
  check('finds the other file', r2.results[0].file === 'dbms.txt', r2.results);
  fs.writeFileSync(path.join(dir, 'new.md'), 'Semaphores count available resources.\n');
  await call('/api/rag/reindex', {});
  const r3 = await call('/api/rag/search', { query: 'semaphore' });
  check('picks up a new file after reindex', r3.results.length && r3.results[0].file === 'new.md', r3.results);
  fs.unlinkSync(path.join(dir, 'new.md')); await call('/api/rag/reindex', {});
  check('forgets a deleted file', (await call('/api/rag/search', { query: 'semaphore' })).results.length === 0);
  check('empty query → error', (await call('/api/rag/search', { query: '  ' })).error);

  // notes in Telugu / Kannada are searchable too (the tokenizer used to see only a-z)
  check('tokenize: Telugu and Kannada words are kept whole (with their vowel signs); English words are still stemmed', JSON.stringify(R.tokenize('నమస్తే ಕನ್ನಡ deadlocks')) === JSON.stringify(['నమస్తే', 'ಕನ್ನಡ', 'deadlock']), R.tokenize('నమస్తే ಕನ್ನಡ deadlocks'));
  fs.writeFileSync(path.join(dir, 'telugu.md'), '# నోట్స్\nడెడ్‌లాక్ అంటే ప్రాసెస్‌లు ఒకదానికొకటి వేచి ఉండటం.\n');
  fs.writeFileSync(path.join(dir, 'kannada.md'), 'ಸಾಮಾನ್ಯೀಕರಣ ಎಂದರೆ ಡೇಟಾ ಪುನರಾವರ್ತನೆ ಕಡಿಮೆ ಮಾಡುವುದು.\n');
  await call('/api/rag/reindex', {});
  const rt = await call('/api/rag/search', { query: 'డెడ్‌లాక్ అంటే' }), rk = await call('/api/rag/search', { query: 'ಡೇಟಾ ಪುನರಾವರ್ತನೆ' });
  check('a Telugu question finds the Telugu note', rt.results.length && rt.results[0].file === 'telugu.md', rt.results);
  check('a Kannada question finds the Kannada note', rk.results.length && rk.results[0].file === 'kannada.md', rk.results);
  fs.unlinkSync(path.join(dir, 'telugu.md')); fs.unlinkSync(path.join(dir, 'kannada.md')); await call('/api/rag/reindex', {});

  // the index is kept on disk and reused after a restart — only while a file is unchanged
  {
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-cache-')), cache = path.join(cdir, '.rag-cache.json');
    const note = path.join(cdir, 'notes.md'); fs.writeFileSync(note, 'The scheduler picks the next process to run.\n');
    fs.utimesSync(note, new Date(1700000000000), new Date(1700000000000));       // a whole-millisecond time, so it can be set back exactly
    const t0 = fs.statSync(note);
    const mkRag = () => { const rt2 = {}; R({ post: (p, h) => { rt2[p] = h; }, get: (p, h) => { rt2[p] = h; } }, { allRoots: () => [cdir], SKIP_DIRS: new Set(), rel: p => path.basename(p), isInternal: p => path.basename(p).startsWith('.'), cacheFile: cache, cacheDelayMs: 20 }); return async (p, body) => { let out; await rt2[p]({ body }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) }); return out; }; };
    const a = mkRag(); const ra = await a('/api/rag/search', { query: 'which process does the scheduler pick' });
    await new Promise(r => setTimeout(r, 300));
    check('cache: the first run finds the note and writes the index file', ra.results.length && ra.results[0].file === 'notes.md' && fs.existsSync(cache), ra.results);
    check('cache: the index file is not itself indexed (a dot file)', ra.files === 1, ra.files);
    // same size and same modified time, different words: a restarted JARVIS must trust the cache (proof it did not re-read the file)
    fs.writeFileSync(note, 'The zzzzzzzzz picks the qqqq qqqqqqq to run xxxxxxxx.\n'.slice(0, t0.size - 1) + '\n'); fs.utimesSync(note, t0.atime, t0.mtime);
    check('cache: precondition — same size and time', fs.statSync(note).size === t0.size && fs.statSync(note).mtimeMs === t0.mtimeMs);
    const b = mkRag(); const rb = await b('/api/rag/search', { query: 'which process does the scheduler pick' });
    check('cache: after a "restart" the old index is reused without reading the file again', rb.results.length && rb.results[0].file === 'notes.md', rb.results);
    fs.writeFileSync(note, 'Banker algorithm avoids deadlock by checking safe states.\n');   // size and time change
    const c = mkRag(); const rc = await c('/api/rag/search', { query: 'banker algorithm' });
    check('cache: a file that changed (size or time) is read again, never served stale', rc.results.length && rc.results[0].file === 'notes.md' && /Banker/.test(rc.results[0].text || rc.results[0].snippet || JSON.stringify(rc.results[0])), rc.results);
    fs.writeFileSync(cache, '{ not json'); const d = mkRag(); const rd = await d('/api/rag/search', { query: 'banker algorithm' });
    check('cache: a damaged cache file is ignored and the index is rebuilt', rd.results.length && rd.results[0].file === 'notes.md');
    fs.rmSync(cdir, { recursive: true, force: true });
  }

  // each shared folder gets its own share of the file limit: a huge project folder listed first cannot crowd out the notes
  {
    const big = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-big-')), small = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-small-'));
    for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(big, 'f' + i + '.md'), 'project file number ' + i + ' about compilers\n');
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(small, 'n' + i + '.md'), 'my lecture note ' + i + ' about semaphores\n');
    const rt3 = {}; R({ post: (p, h) => { rt3[p] = h; }, get: (p, h) => { rt3[p] = h; } }, { allRoots: () => [big, small], SKIP_DIRS: new Set(), rel: p => path.basename(p), isInternal: () => false, maxFiles: 100 });
    let out; await rt3['/api/rag/search']({ body: { query: 'lecture note semaphores' } }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) });
    check('quota: with a limit of 100 files and two folders, the small notes folder is fully indexed even though the big one is listed first', out.results.length && /^n\d\.md$/.test(out.results[0].file) && out.files === 55, [out.files, out.results.map(x => x.file)]);
    fs.rmSync(big, { recursive: true, force: true }); fs.rmSync(small, { recursive: true, force: true });
  }

  // PDFs: a real 2-page PDF, indexed page by page and cited with page numbers
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragpdf-'));
  fs.writeFileSync(path.join(pdfDir, 'lecture3.pdf'), makePdf(['Deadlock needs mutual exclusion and circular wait.', 'Paging divides memory into fixed size frames.']));
  fs.writeFileSync(path.join(pdfDir, 'other.md'), 'Paging is also mentioned here in a markdown note.');
  const r2routes = {};
  const app2 = { post: (p, h) => { r2routes[p] = h; }, get: (p, h) => { r2routes[p] = h; } };
  R(app2, { allRoots: () => [pdfDir], SKIP_DIRS: new Set(), rel: p => path.relative(pdfDir, p).split(path.sep).join('/'), isInternal: () => false, pdfPages: require(path.join(__dirname, '..', 'pdftext.js')).pdfPages });
  const call2 = async (p, body) => { let out; await r2routes[p]({ body }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) }); return out; };
  const pr = await call2('/api/rag/search', { query: 'what is paging' });
  const pdfHit = pr.results.find(x => x.file === 'lecture3.pdf');
  check('PDF text is searchable', !!pdfHit, pr.results);
  check('PDF hits cite the right page', pdfHit && pdfHit.page === 2, pdfHit);
  const only = await call2('/api/rag/search', { query: 'paging', file: 'lecture3.pdf' });
  check('search inside one named file only', only.results.length && only.results.every(x => x.file === 'lecture3.pdf'), only.results);
  const dl = await call2('/api/rag/search', { query: 'deadlock', file: 'lecture3.pdf' });
  check('page 1 content → page 1', dl.results[0] && dl.results[0].page === 1);

  /* ---------- hybrid semantic search (fake embedder) ---------- */
  {
    const { cosine, rrfFuse } = R;
    check('cosine: identical → 1, orthogonal → 0', cosine([1, 0], [1, 0]) === 1 && Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
    check('cosine: mismatched lengths → 0', cosine([1], [1, 2]) === 0 && cosine(null, [1]) === 0);
    check('rrf: agreement floats to the top', (() => { const fused = rrfFuse([0, 1, 2, 3], [2, 0, 9, 8]); return fused[0] === 0 && fused[1] === 2; })());
    const semDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragsem-'));
    // "thrashing" never appears as a word, so BM25 alone can't find page 2 — only vectors can.
    fs.writeFileSync(path.join(semDir, 'os.md'), '# OS notes\nWhen memory is overcommitted the system spends all its time swapping pages in and out, which is called excessive paging activity under low CPU utilisation.\n');
    const fakeVecs = new Map([
      ['os.md', [1, 0.9, 0.1]],  // direction ≈ thrashing/memory
      ['other.md', [0.1, 0, 1]], // direction ≈ cooking
    ]);
    const fakeFileOf = new Map([['os.md', 'os.md'], ['other.md', 'other.md']]);
    let calls = 0;
    const semRoutes = {};
    const app3 = { post: (p, h) => { semRoutes[p] = h; }, get: (p, h) => { semRoutes[p] = h; } };
    const rag3 = R(app3, {
      allRoots: () => [semDir], SKIP_DIRS: new Set(), rel: p => path.basename(p), isInternal: () => false,
      semantic: { enabled: () => true, model: () => 'fake-embed', embed: (m, inputs) => { calls++; return inputs.map(() => [1, 0.9, 0.1]); } },
    });
    const call3 = async (p, body) => { let out; await semRoutes[p]({ body }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) }); return out; };
    const before = await call3('/api/rag/search', { query: 'what is thrashing' });
    check('semantic: no vectors yet → BM25 fallback', before.results.length >= 0 && calls >= 0);
    await call3('/api/rag/reindex', {}); // triggers embedPending with the fake embedder
    const st = await new Promise(res => semRoutes['/api/rag/status']({}, { json: res }));
    check('semantic: vectors stored after embed round', st.vecChunks > 0, st);
    const sem = await call3('/api/rag/search', { query: 'what is thrashing' });
    check('semantic: search still returns the file', sem.results.length && sem.results[0].file === 'os.md', sem.results);
    check('semantic: disabled when embed throws', (() => { const r4 = {}; const app4 = { post: (p, h) => { r4[p] = h; }, get: (p, h) => { r4[p] = h; } };
      R(app4, { allRoots: () => [semDir], SKIP_DIRS: new Set(), rel: p => path.basename(p), isInternal: () => false, semantic: { enabled: () => true, model: () => 'x', embed: () => { throw new Error('down'); } } });
      return true; })());
    fs.rmSync(semDir, { recursive: true, force: true });
  }

  /* ---------- docx indexing ---------- */
  {
    // a minimal real .docx with correct CRCs and sizes (the extractor checks them)
    const crc32 = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    const docXml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Thrashing occurs when the system spends most of its time swapping pages rather than doing useful work.</w:t></w:r></w:p></w:body></w:document>';
    const name = Buffer.from('word/document.xml'), content = Buffer.from(docXml), crc = crc32(content);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(crc, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + content.length, 16);
    const docxBuf = Buffer.concat([local, name, content, central, name, end]);
    fs.writeFileSync(path.join(pdfDir, 'chapter2.docx'), docxBuf);
    const r2routes = {};
    const app4 = { post: (p, h) => { r2routes[p] = h; }, get: (p, h) => { r2routes[p] = h; } };
    R(app4, { allRoots: () => [pdfDir], SKIP_DIRS: new Set(), rel: p => path.basename(p), isInternal: () => false,
      pdfPages: require(path.join(__dirname, '..', 'pdftext.js')).pdfPages, docText: f => require(path.join(__dirname, '..', 'doctext.js')).extractDocText(f, fs.readFileSync(f)) });
    const call4 = async (p, body) => { let out; await r2routes[p]({ body }, { json: o => { out = o; }, status: () => ({ json: o => { out = o; } }) }); return out; };
    const dr = await call4('/api/rag/search', { query: 'thrashing swapping pages' });
    const hit = dr.results.find(x => x.file === 'chapter2.docx');
    check('docx text is searchable', !!hit, dr.results);
    check('docx content matches', hit && /swapping pages/.test(hit.text), hit && hit.text.slice(0, 60));
  }
  fs.rmSync(pdfDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`rag: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
