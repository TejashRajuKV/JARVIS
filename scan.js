'use strict';
/* Pictures from the camera: document scans, "what is in this photo", and the room-watch snapshots. Three separate jobs, all local.
     Scan:      the page sends each flattened page as a raw JPEG (POST /api/scan/page, one request per page); POST /api/scan/finish
                reads the words with Windows OCR and writes ONE searchable PDF to ~/jarvis/Scans: the picture on the page, plus an
                invisible text layer (so Ctrl+F finds words in it), and a .txt of the text beside it. Latin letters only (the PDF's
                built-in font can't draw others); other words are skipped and counted, never garbled.
     Vision:    POST /api/vision/ask gives a photo and a question to the AI model that is selected (a local one by default). The OCR text is
                added as a hint so numbers and symbols are not guessed. If a cloud model is selected, the answer says the picture went there.
     Snapshots: POST /api/room/snapshot keeps a few still frames from "watch my room" in ~/jarvis/Watch (last 50). Never uploaded anywhere.
   Everything that writes a file accepts only a real JPEG (checked by its first bytes), and only from the JARVIS page on the laptop. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MAX_PAGES = 20, MAX_PAGE_BYTES = 15 * 1024 * 1024, MAX_SESSION_BYTES = 80 * 1024 * 1024, SESSION_TTL = 30 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024, KEEP_SNAPSHOTS = 50;
const MAX_VISION_BYTES = 2 * 1024 * 1024;

let lib = null;
const pdflib = () => lib || (lib = require('pdf-lib'));

const isJpeg = b => Buffer.isBuffer(b) && b.length > 20 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
const slug = s => String(s || '').toLowerCase().replace(/\.(pdf|txt)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return { day: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), time: p(d.getHours()) + p(d.getMinutes()), full: d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) };
};
function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext), n = 1;
  while (fs.existsSync(p)) p = path.join(dir, base + '-' + (++n) + ext);
  return p;
}

/* ---------- the searchable PDF ---------- */
// pages: [{ jpeg: Buffer, words: [{t,x,y,w,h}] (image pixels), width, height }] → { pdf: Buffer, words, skipped }
async function buildSearchablePdf(pages, title) {
  const { PDFDocument, StandardFonts } = pdflib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let words = 0, skipped = 0;
  for (const pg of pages) {
    const img = await doc.embedJpg(new Uint8Array(pg.jpeg));      // a copy with its own memory: pdf-lib reads .buffer, and a small Node Buffer shares a pool
    const w = pg.width || img.width, h = pg.height || img.height;
    const land = w > h;
    const maxW = land ? 841.89 : 595.28, maxH = land ? 595.28 : 841.89;
    const k = Math.min(maxW / w, maxH / h);                         // fit the picture on an A4 sheet, keeping its shape
    const pw = w * k, ph = h * k;
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    for (const wd of pg.words || []) {
      const text = String(wd.t || '');
      if (!text.trim() || !(wd.w > 0) || !(wd.h > 0)) continue;
      let tw;
      try { tw = font.widthOfTextAtSize(text, 10); } catch { skipped++; continue; }    // a letter Helvetica can't draw
      const boxW = wd.w * k, boxH = wd.h * k;
      const size = Math.max(2, Math.min(boxW / tw * 10, boxH * 3));    // wide enough to span the printed word, so a selection lines up
      page.drawText(text + ' ', { x: wd.x * k, y: ph - (wd.y + wd.h * 0.8) * k, size, font, opacity: 0 });
      words++;
    }
  }
  doc.setProducer('JARVIS'); doc.setCreator('JARVIS');
  if (title) doc.setTitle(String(title).slice(0, 120));
  return { pdf: Buffer.from(await doc.save()), words, skipped };
}

/* ---------- snapshots ---------- */
function pruneSnapshots(dir, keep = KEEP_SNAPSHOTS) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^watch-\d{8}-\d{6}(?:-\d+)?\.jpg$/.test(f)).sort(); } catch { return 0; }
  let removed = 0;
  for (const f of files.slice(0, Math.max(0, files.length - keep))) { try { fs.unlinkSync(path.join(dir, f)); removed++; } catch {} }
  return removed;
}

module.exports = function setupScan(app, { SANDBOX, llm, DEFAULT_MODEL, rel, openPath, IS_WIN }) {
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const laptopOnly = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'Pictures can only be saved from JARVIS on the laptop.' }), false));
  const jpegBody = limit => express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit });
  const ocrWords = (...a) => (app.locals.ocrWords ? app.locals.ocrWords(...a) : Promise.resolve({ error: 'Reading text from pictures is not available.' }));

  /* ---- sessions: pages waiting for "finish" (memory only, 30 minutes) ---- */
  const sessions = new Map();
  const sweep = () => { const now = Date.now(); for (const [k, v] of sessions) if (now - v.touched > SESSION_TTL) sessions.delete(k); };
  const bytesOf = s => s.pages.reduce((n, p) => n + p.length, 0);

  app.get('/api/scan/status', async (req, res) => {
    let vision = false;
    try { vision = !!(llm && await llm.hasVision(DEFAULT_MODEL)); } catch {}
    let pdfLib = true; try { pdflib(); } catch { pdfLib = false; }
    res.json({ success: true, ocr: !!IS_WIN, pdfLib, vision, maxPages: MAX_PAGES });
  });

  app.post('/api/scan/page', jpegBody(MAX_PAGE_BYTES), (req, res) => {
    if (!laptopOnly(req, res)) return;
    sweep();
    if (!isJpeg(req.body)) return res.status(400).json({ error: 'That is not a JPEG picture.' });
    let id = String(req.query.scan || '');
    if (id && !/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Unknown scan.' });
    let s = id ? sessions.get(id) : null;
    if (id && !s) return res.status(404).json({ error: 'That scan expired. Start again.' });
    if (!s) { id = crypto.randomBytes(8).toString('hex'); s = { pages: [], touched: Date.now() }; sessions.set(id, s); }
    if (s.pages.length >= MAX_PAGES) return res.status(413).json({ error: 'A scan can have up to ' + MAX_PAGES + ' pages. Save this one and start another.' });
    if (bytesOf(s) + req.body.length > MAX_SESSION_BYTES) return res.status(413).json({ error: 'That is too much picture data for one scan. Save this one and start another.' });
    s.pages.push(Buffer.from(req.body)); s.touched = Date.now();
    res.json({ success: true, scan: id, pages: s.pages.length });
  });

  app.post('/api/scan/discard', (req, res) => {
    if (!laptopOnly(req, res)) return;
    const had = sessions.delete(String((req.body && req.body.scan) || ''));
    res.json({ success: true, discarded: had });
  });

  app.post('/api/scan/finish', async (req, res) => {
    if (!laptopOnly(req, res)) return;
    sweep();
    const id = String((req.body && req.body.scan) || '');
    const s = sessions.get(id);
    if (!s || !s.pages.length) return res.status(404).json({ error: 'There are no pages waiting. Take a picture first.' });
    s.touched = Date.now();
    const wantOcr = !(req.body && req.body.ocr === false);
    const t0 = Date.now();
    const pages = [], texts = [], problems = [];
    for (let i = 0; i < s.pages.length; i++) {
      const jpeg = s.pages[i];
      let words = [], width, height;
      if (wantOcr) {
        const r = await ocrWords(jpeg);
        if (r.error) problems.push('page ' + (i + 1) + ': ' + r.error);
        else { words = r.words; width = r.width; height = r.height; texts.push(s.pages.length > 1 ? '--- page ' + (i + 1) + ' ---\n' + r.text : r.text); }
      }
      pages.push({ jpeg, words, width, height });
    }
    let built;
    try { built = await buildSearchablePdf(pages, req.body && req.body.name); }
    catch (e) { return res.status(422).json({ error: 'I could not build the PDF (' + String(e.message).slice(0, 80) + ').' }); }
    const dir = path.join(SANDBOX, 'Scans'); fs.mkdirSync(dir, { recursive: true });
    const st = stamp();
    const base = slug(req.body && req.body.name) || 'scan-' + st.day + '-' + st.time;
    const out = uniquePath(dir, base, '.pdf');
    fs.writeFileSync(out, built.pdf);
    const text = texts.join('\n\n').trim();
    let textFile = null;
    if (text) { textFile = out.replace(/\.pdf$/i, '.txt'); fs.writeFileSync(textFile, text + '\n'); }
    sessions.delete(id);
    if (req.body && req.body.open && openPath) { try { openPath(out); } catch {} }
    res.json({ success: true, file: rel(out), name: path.basename(out), pages: pages.length, words: built.words, skipped: built.skipped,
      searchable: built.words > 0, text: text.slice(0, 12000), textFile: textFile ? rel(textFile) : null, truncated: text.length > 12000,
      bytes: built.pdf.length, problems, ms: Date.now() - t0 });
  });

  /* ---- "what is this?" / "solve this": a photo and a question for the selected AI model ---- */
  app.post('/api/vision/ask', async (req, res) => {
    if (!laptopOnly(req, res)) return;
    const b64 = String((req.body && req.body.image) || '').replace(/^data:image\/\w+;base64,/, '');
    const question = String((req.body && req.body.question) || '').trim().slice(0, 600) || 'What is in this picture? If it is a problem, solve it.';
    if (!b64) return res.status(400).json({ error: 'image (base64 JPEG) required' });
    const buf = Buffer.from(b64, 'base64');
    if (!isJpeg(buf)) return res.status(400).json({ error: 'That is not a JPEG picture.' });
    if (buf.length > MAX_VISION_BYTES) return res.status(413).json({ error: 'That picture is too large to send to the AI; take it again smaller.' });
    const model = String((req.body && req.body.model) || DEFAULT_MODEL);
    let ok = false; try { ok = await llm.hasVision(model); } catch {}
    if (!ok) return res.status(422).json({ error: 'The AI model selected (' + model + ') cannot look at pictures. Pick one that can in Settings.' });
    let hint = '';
    if (!(req.body && req.body.ocr === false)) { const r = await ocrWords(buf); if (!r.error && r.text) hint = r.text.slice(0, 1500); }
    const cloud = llm.isCloud(model);
    try {
      const answer = await llm.complete({
        model, temperature: 0.2, maxTokens: 900, numCtx: 12288, timeoutMs: 240000, images: [b64],
        system: 'You look at a photo taken by the user and answer their question about it. If it shows a maths, physics or chemistry problem, solve it step by step in plain text and put the final answer last. ' +
          'Say clearly when something is too blurry or small to read. Never invent text, numbers or symbols that you cannot see. Keep it short.',
        messages: [{ role: 'user', content: question + (hint ? '\n\nText the computer read from the picture (it may contain mistakes, check it against the image):\n' + hint : '') }],
      });
      if (!answer) return res.status(502).json({ error: 'The AI gave no answer.' });
      res.json({ success: true, answer: String(answer).slice(0, 6000), model, cloud, usedOcr: !!hint });
    } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 200) }); }
  });

  /* ---- room-watch snapshots ---- */
  app.post('/api/room/snapshot', jpegBody(MAX_SNAPSHOT_BYTES), (req, res) => {
    if (!laptopOnly(req, res)) return;
    if (!isJpeg(req.body)) return res.status(400).json({ error: 'That is not a JPEG picture.' });
    const dir = path.join(SANDBOX, 'Watch'); fs.mkdirSync(dir, { recursive: true });
    const out = uniquePath(dir, 'watch-' + stamp().full, '.jpg');
    fs.writeFileSync(out, req.body);
    pruneSnapshots(dir);
    res.json({ success: true, file: rel(out) });
  });
};
Object.assign(module.exports, { buildSearchablePdf, isJpeg, pruneSnapshots, slug, MAX_PAGES });
