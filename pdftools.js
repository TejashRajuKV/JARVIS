'use strict';
/* PDF tools in plain JavaScript (pdf-lib): put PDFs together, take pages out, turn pages, write text into a new PDF, stamp a
   word across the pages. Your original is never changed: every result is a new file (in ~/jarvis/PDFs, or beside the original if you
   ask, which needs your OK). Password-protected PDFs are refused with a clear message, and the same size limits as the PDF reader
   apply (40 MB, 400 pages). The helpers work on Buffers and are exported for tests. Reading and OCR stay in pdftext.js / ocr.js. */
const fs = require('fs');
const path = require('path');

let lib = null;
const pdflib = () => lib || (lib = require('pdf-lib'));

const MAX_BYTES = 40 * 1024 * 1024, MAX_PAGES = 400, MAX_MERGE = 10, MAX_TEXT = 200000;
const A4 = [595.28, 841.89];

class PdfError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const slug = s => String(s || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'document';

/* ---------- page selections ---------- */
// "1-3,7" · "5-" · "-3"(first three) · "first 3" · "last 2" · "odd" · "even" · "all" → sorted-as-written, unique, 0-based
function parsePages(spec, total) {
  const s = String(spec == null ? '' : spec).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\band\b/g, ',').replace(/\bto\b/g, '-');
  if (!s || s === 'all') return Array.from({ length: total }, (_, i) => i);
  let m;
  if ((m = s.match(/^first (\d+)$/))) return Array.from({ length: Math.min(+m[1], total) }, (_, i) => i);
  if ((m = s.match(/^last (\d+)$/))) { const n = Math.min(+m[1], total); return Array.from({ length: n }, (_, i) => total - n + i); }
  if (s === 'last') return [total - 1];
  if (s === 'first') return [0];
  if (s === 'odd') return Array.from({ length: total }, (_, i) => i).filter(i => i % 2 === 0);
  if (s === 'even') return Array.from({ length: total }, (_, i) => i).filter(i => i % 2 === 1);
  const out = [];
  for (const part of s.split(',').map(x => x.trim().replace(/\s*-\s*/g, '-')).filter(Boolean)) {
    let a, b;
    if ((m = part.match(/^(\d+)$/))) { a = b = +m[1]; }
    else if ((m = part.match(/^(\d+)-(\d+)$/))) { a = +m[1]; b = +m[2]; }
    else if ((m = part.match(/^(\d+)-$/))) { a = +m[1]; b = total; }
    else if ((m = part.match(/^-(\d+)$/))) { a = 1; b = +m[1]; }
    else throw new PdfError('I don’t understand “' + part.slice(0, 30) + '” as pages. Try 1-3, 5, 7- or “last 2”.');
    if (a < 1 || b < 1) throw new PdfError('Page numbers start at 1.');
    if (a > b) throw new PdfError('“' + a + '-' + b + '” runs backwards. Write it as ' + b + '-' + a + '.');
    if (a > total || b > total) throw new PdfError('This PDF has ' + total + ' page' + (total === 1 ? '' : 's') + ', so page ' + Math.max(a, b) + ' doesn’t exist.');
    for (let p = a; p <= b; p++) out.push(p - 1);
  }
  return [...new Set(out)];
}
const describePages = idx => {            // [0,1,2,6] → "1-3,7"
  const p = idx.map(i => i + 1).sort((x, y) => x - y), parts = [];
  for (let i = 0; i < p.length;) { let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++; parts.push(j > i ? p[i] + '-' + p[j] : String(p[i])); i = j + 1; }
  return parts.join(',');
};
function parseRotation(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  const map = { right: 90, clockwise: 90, cw: 90, left: 270, anticlockwise: 270, 'counter-clockwise': 270, counterclockwise: 270, ccw: 270, around: 180, upside: 180, flip: 180 };
  const n = s in map ? map[s] : parseInt(s, 10);
  const turn = Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;           // 360 is a full turn: nothing to do
  if (!Number.isFinite(n) || n % 90 !== 0 || turn === 0) throw new PdfError('I can turn pages by 90, 180 or 270 degrees (or “left” / “right”).');
  return turn;
}

/* ---------- loading ---------- */
async function loadPdf(buf) {
  const { PDFDocument } = pdflib();
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.toString('latin1', 0, 5) !== '%PDF-') throw new PdfError('That doesn’t look like a PDF file.');
  if (buf.length > MAX_BYTES) throw new PdfError('That PDF is ' + Math.round(buf.length / 1048576) + ' MB. I work with PDFs up to ' + MAX_BYTES / 1048576 + ' MB.', 413);
  let doc;
  try { doc = await PDFDocument.load(buf, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new PdfError('That PDF is password-protected, so I can’t change it. Remove the password first (open it, then print it to a new PDF).');
    throw new PdfError('I couldn’t read that PDF (' + String(e.message).slice(0, 70) + '). It may be damaged.');
  }
  let pages;
  try { pages = doc.getPageCount(); } catch { throw new PdfError('I couldn’t read that PDF: it has no usable pages. It may be damaged.'); }   // a broken file can "load" and still have no page tree
  if (!pages) throw new PdfError('That PDF has no pages.');
  if (pages > MAX_PAGES) throw new PdfError('That PDF has ' + pages + ' pages; I work with up to ' + MAX_PAGES + '.', 413);
  return doc;
}
const finish = async (doc, title) => {
  doc.setProducer('JARVIS'); doc.setCreator('JARVIS');
  if (title) doc.setTitle(String(title).slice(0, 120));
  return Buffer.from(await doc.save());
};

/* ---------- operations (Buffers in, Buffer out) ---------- */
async function mergePdfs(bufs) {
  if (bufs.length < 2) throw new PdfError('I need at least two PDFs to put together.');
  if (bufs.length > MAX_MERGE) throw new PdfError('I can put together up to ' + MAX_MERGE + ' PDFs at a time.');
  const { PDFDocument } = pdflib();
  const out = await PDFDocument.create();
  let pages = 0;
  for (const b of bufs) {
    const src = await loadPdf(b);
    pages += src.getPageCount();
    if (pages > MAX_PAGES) throw new PdfError('Together they have more than ' + MAX_PAGES + ' pages.', 413);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return { buf: await finish(out), pages };
}
async function extractPages(buf, spec) {
  const src = await loadPdf(buf), total = src.getPageCount();
  const idx = parsePages(spec, total);
  if (!idx.length) throw new PdfError('No pages matched “' + spec + '”.');
  const { PDFDocument } = pdflib();
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  return { buf: await finish(out), pages: idx.length, total, selected: describePages(idx) };
}
async function rotatePdf(buf, degrees, spec) {
  const { degrees: deg } = pdflib();
  const add = parseRotation(degrees), src = await loadPdf(buf), total = src.getPageCount();
  const idx = parsePages(spec, total);
  const pages = src.getPages();
  for (const i of idx) pages[i].setRotation(deg((pages[i].getRotation().angle + add) % 360));
  return { buf: await finish(src), pages: idx.length, total, degrees: add };
}

// Text → a plain, readable PDF. Only the characters the built-in font has can be drawn; the rest become "?" and are counted.
const SMART = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '-', ' ': ' ', '→': '->', '←': '<-', '✓': 'v', '×': 'x' };
function toLatin(text, charset) {
  let replaced = 0, out = '';
  for (const ch of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    const c = SMART[ch] !== undefined ? SMART[ch] : ch;
    for (const d of c) { if (d === '\n' || charset.has(d.codePointAt(0))) out += d; else { out += '?'; replaced++; } }
  }
  return { text: out, replaced };
}
async function textToPdf({ title, text, author }) {
  const { PDFDocument, StandardFonts, rgb } = pdflib();
  const body = String(text || '');
  if (!body.trim()) throw new PdfError('There is no text to put in the PDF.');
  if (body.length > MAX_TEXT) throw new PdfError('That is more than ' + MAX_TEXT.toLocaleString('en-US') + ' characters. Split it up.', 413);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const t = toLatin(body, charset), ttl = toLatin(title || '', charset);
  const [W, H] = A4, margin = 56, maxW = W - margin * 2;
  let page = doc.addPage(A4), y = H - margin, pageNo = 1;
  const pages = [page];
  const newPage = () => { page = doc.addPage(A4); pages.push(page); y = H - margin; pageNo++; };
  const wrap = (str, f, size, width) => {
    const words = str.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const trial = cur ? cur + ' ' + w : w;
      if (f.widthOfTextAtSize(trial, size) <= width) { cur = trial; continue; }
      if (cur) lines.push(cur);
      let rest = w;                                              // a word longer than the line is cut
      while (f.widthOfTextAtSize(rest, size) > width) { let k = rest.length; while (k > 1 && f.widthOfTextAtSize(rest.slice(0, k), size) > width) k--; lines.push(rest.slice(0, k)); rest = rest.slice(k); }
      cur = rest;
    }
    lines.push(cur);
    return lines;
  };
  const draw = (str, f, size, indent, gap) => {
    for (const ln of wrap(str, f, size, maxW - indent)) {
      if (y - size < margin + 20) newPage();
      page.drawText(ln, { x: margin + indent, y: y - size, size, font: f, color: rgb(0.1, 0.1, 0.12) });
      y -= size * 1.35;
    }
    y -= gap;
  };
  if (ttl.text.trim()) draw(ttl.text.trim(), bold, 20, 0, 10);
  for (const raw of t.text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { y -= 8; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) draw(m[2], bold, m[1].length === 1 ? 16 : m[1].length === 2 ? 14 : 12, 0, 4);
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (y - 11 < margin + 20) newPage(); page.drawText('-', { x: margin + 4, y: y - 11, size: 11, font, color: rgb(0.1, 0.1, 0.12) }); draw(m[1], font, 11, 16, 1); }
    else draw(line, font, 11, 0, 2);
  }
  pages.forEach((p, i) => p.drawText('Page ' + (i + 1) + ' of ' + pages.length, { x: W / 2 - 30, y: 28, size: 9, font, color: rgb(0.5, 0.5, 0.55) }));
  if (author) doc.setAuthor(String(author).slice(0, 80));
  return { buf: await finish(doc, ttl.text.trim() || 'Notes'), pages: pages.length, replaced: t.replaced + ttl.replaced };
}

async function watermarkPdf(buf, text, spec) {
  const { StandardFonts, rgb, degrees } = pdflib();
  const src = await loadPdf(buf), total = src.getPageCount();
  const font = await src.embedFont(StandardFonts.HelveticaBold), charset = new Set(font.getCharacterSet());
  const t = toLatin(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40), charset);
  if (!t.text.trim()) throw new PdfError('What should the watermark say?');
  const idx = parsePages(spec, total), pages = src.getPages();
  for (const i of idx) {
    const p = pages[i], { width, height } = p.getSize();
    const size = Math.max(24, Math.min(110, (Math.min(width, height) * 0.9) / Math.max(4, t.text.length * 0.55)));
    const w = font.widthOfTextAtSize(t.text, size), a = Math.PI / 4;
    p.drawText(t.text, { x: width / 2 - (w / 2) * Math.cos(a) + (size * 0.3) * Math.sin(a), y: height / 2 - (w / 2) * Math.sin(a) - (size * 0.3) * Math.cos(a), size, font, color: rgb(0.55, 0.55, 0.6), opacity: 0.25, rotate: degrees(45) });
  }
  return { buf: await finish(src), pages: idx.length, total, replaced: t.replaced };
}

/* ---------- files and routes ---------- */
module.exports = function setupPdf(app, { findAllowed, anyPath, approvedChange, openPath, rel, SANDBOX }) {
  const outDir = path.join(SANDBOX, 'PDFs');
  const locate = name => {
    const n = String(name || '').trim().replace(/^["']|["']$/g, '');
    if (!n) return null;
    return (anyPath && path.isAbsolute(n) ? anyPath(n) : null) || (findAllowed ? findAllowed(n, { kind: 'file' }) : null);
  };
  const readPdf = name => {
    const p = locate(name);
    if (!p || !fs.existsSync(p)) throw new PdfError('I can’t find “' + String(name || '').slice(0, 60) + '” in ~/jarvis or your project folders. Put the PDF there, or give the full path.', 404);
    if (!/\.pdf$/i.test(p)) throw new PdfError('“' + path.basename(p) + '” isn’t a PDF.');
    const st = fs.statSync(p);
    if (st.size > MAX_BYTES) throw new PdfError('That PDF is ' + Math.round(st.size / 1048576) + ' MB. I work with PDFs up to ' + MAX_BYTES / 1048576 + ' MB.', 413);
    return { p, buf: fs.readFileSync(p) };
  };
  // A new file, never an old one: name.pdf → name-2.pdf if it exists.
  const target = (dir, base) => { fs.mkdirSync(dir, { recursive: true }); let f = path.join(dir, base + '.pdf'), k = 2; while (fs.existsSync(f)) f = path.join(dir, base + '-' + (k++) + '.pdf'); return f; };
  const respond = (req, res, kind, buf, dir, base, extra) => {
    const file = target(dir, base);
    fs.writeFileSync(file, buf);
    if ((req.body || {}).open !== false && openPath) openPath(file);
    res.json({ success: true, kind, file: rel ? rel(file) : file, path: file, bytes: buf.length, ...extra });
  };
  // Beside the original needs your OK (it is outside ~/jarvis); otherwise ~/jarvis/PDFs.
  const placeFor = (req, res, original) => {
    if (!(req.body || {}).beside) return outDir;
    const d = path.dirname(original);
    if (approvedChange && !approvedChange(req, res, 'save the new PDF next to', path.join(d, 'x.pdf'))) return null;
    return d;
  };
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (res.headersSent) return; res.status(e.status || 500).json({ error: e instanceof PdfError ? e.message : 'I couldn’t do that with the PDF: ' + String(e.message).slice(0, 100) }); }
  };

  app.post('/api/pdf/merge', wrap(async (req, res) => {
    const names = Array.isArray((req.body || {}).files) ? req.body.files.slice(0, MAX_MERGE + 1) : [];
    if (names.length < 2) throw new PdfError('Tell me at least two PDFs to put together.');
    const srcs = names.map(readPdf);
    const dir = placeFor(req, res, srcs[0].p); if (!dir) return;
    const r = await mergePdfs(srcs.map(s => s.buf));
    const stem = slug(path.basename(srcs[0].p)) + (srcs.length > 2 ? '-and-' + (srcs.length - 1) + '-more' : '-and-' + slug(path.basename(srcs[1].p)));
    const custom = String((req.body || {}).name || '').trim();
    respond(req, res, 'merge', r.buf, dir, custom ? slug(custom) : stem + '-merged', { pages: r.pages, parts: srcs.length });
  }));
  app.post('/api/pdf/pages', wrap(async (req, res) => {
    const b = req.body || {}, src = readPdf(b.file);
    const dir = placeFor(req, res, src.p); if (!dir) return;
    const r = await extractPages(src.buf, b.pages);
    respond(req, res, 'pages', r.buf, dir, slug(path.basename(src.p)) + '-pages-' + r.selected.replace(/,/g, '_'), { pages: r.pages, total: r.total, selected: r.selected });
  }));
  app.post('/api/pdf/rotate', wrap(async (req, res) => {
    const b = req.body || {}, src = readPdf(b.file);
    const dir = placeFor(req, res, src.p); if (!dir) return;
    const r = await rotatePdf(src.buf, b.degrees, b.pages);
    respond(req, res, 'rotate', r.buf, dir, slug(path.basename(src.p)) + '-rotated', { pages: r.pages, total: r.total, degrees: r.degrees });
  }));
  app.post('/api/pdf/watermark', wrap(async (req, res) => {
    const b = req.body || {}, src = readPdf(b.file);
    const dir = placeFor(req, res, src.p); if (!dir) return;
    const r = await watermarkPdf(src.buf, b.text, b.pages);
    respond(req, res, 'watermark', r.buf, dir, slug(path.basename(src.p)) + '-watermarked', { pages: r.pages, total: r.total, replaced: r.replaced });
  }));
  app.post('/api/pdf/make', wrap(async (req, res) => {
    const b = req.body || {};
    const r = await textToPdf({ title: String(b.title || '').slice(0, 120), text: b.text, author: b.author });
    respond(req, res, 'make', r.buf, outDir, slug(b.title || String(b.text || '').split('\n')[0].slice(0, 40) || 'notes'), { pages: r.pages, replaced: r.replaced });
  }));
};
Object.assign(module.exports, { parsePages, describePages, parseRotation, loadPdf, mergePdfs, extractPages, rotatePdf, textToPdf, watermarkPdf, toLatin, PdfError, slug, MAX_BYTES, MAX_PAGES, MAX_MERGE, MAX_TEXT });
