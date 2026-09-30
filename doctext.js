'use strict';
/* Text extraction for .docx / .pptx / .xlsx — they are ZIP archives of XML.
   A minimal ZIP reader on zlib.inflateRawSync (central-directory based, like unzip(1)) plus XML tag stripping,
   so JARVIS can search these files with no new npm dependencies. Pure helpers are exported for tests.
   Guards: entry count, declared and real size caps (zip bombs), and names are never used as paths. */
const zlib = require('zlib');

const MAX_FILE = 30 * 1024 * 1024;   // compressed archive we accept
const MAX_ENTRIES = 2000;            // zip-bomb guard
const MAX_ENTRY = 8 * 1024 * 1024;   // one decompressed entry
const MAX_TEXT = 2 * 1024 * 1024;    // final text cap

// End-of-central-directory: signature 0x06054b50, fixed part is 22 bytes, comment can be 0–65535.
function findEOCD(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}
// Slices of the central directory: [{ sig, method, csize, usize, name, localAt }]
function readCentral(buf, eocd) {
  const count = buf.readUInt16LE(eocd + 10), cdAt = buf.readUInt32LE(eocd + 16);
  const out = [];
  let p = cdAt;
  for (let i = 0; i < count && i < MAX_ENTRIES; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24),
      nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32),
      localAt = buf.readUInt32LE(p + 42);
    out.push({ method, csize, usize, name: buf.slice(p + 46, p + 46 + nlen).toString('utf8'), localAt });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
// One entry's decompressed bytes (or null when unsupported/corrupt/too big).
function readEntry(buf, e) {
  try {
    if (e.method !== 0 && e.method !== 8) return null;
    if (e.usize > MAX_ENTRY) return null;
    const lp = e.localAt;
    if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== 0x04034b50) return null;
    const nlen = buf.readUInt16LE(lp + 26), elen = buf.readUInt16LE(lp + 28);
    const data = buf.slice(lp + 30 + nlen + elen, lp + 30 + nlen + elen + e.csize);
    const out = e.method === 0 ? data : zlib.inflateRawSync(data);
    if (!out || out.length > MAX_ENTRY) return null;
    return out;
  } catch { return null; }
}

/* ---------- pure XML → text helpers ---------- */
// Well-formed or not: drop tags, unescape entities, collapse blank space.
function xmlToText(xml) {
  return String(xml)
    .replace(/<\/w:tc>/g, '\u0001')                                     // table-cell end → marker (kept through stripping)
    .replace(/<\/a:p>|<\/w:p>/g, '\n')                                  // pptx/docx paragraph ends
    .replace(/<a:br\/>|<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\u0001/g, ' | ')                                          // table cells stay readable
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// Keep the characters a keyword search can see; drop control bytes and lone surrogates.
const clean = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '');
const decodeText = buf => clean(buf.toString('utf8'));

/* ---------- documents ---------- */
// docx: word/document.xml (main body; word/ also has headers/footers we skip on purpose)
function docxPages(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) return null;
  for (const e of readCentral(buf, eocd)) {
    if (/^word\/document\.xml$/i.test(e.name)) {
      const x = readEntry(buf, e);
      if (x) return [xmlToText(decodeText(x)).slice(0, MAX_TEXT)];
    }
  }
  return null;
}
// pptx: ppt/slides/slideN.xml, ordered by number so the "pages" are slide order.
function pptxPages(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) return null;
  const slides = [];
  for (const e of readCentral(buf, eocd)) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(e.name);
    if (!m) continue;
    const x = readEntry(buf, e);
    if (x) slides.push({ n: +m[1], text: xmlToText(decodeText(x)).slice(0, 100000) });
  }
  if (!slides.length) return null;
  slides.sort((a, b) => a.n - b.n);
  return slides.map(s => s.text).filter(t => t.length);
}
// xlsx: sharedStrings.xml (all cell text lives here), values come as one block.
function xlsxPages(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) return null;
  for (const e of readCentral(buf, eocd)) {
    if (/^xl\/sharedStrings\.xml$/i.test(e.name)) {
      const x = readEntry(buf, e);
      if (x) return [xmlToText(decodeText(x)).slice(0, MAX_TEXT)];
    }
  }
  return null;
}

// → { pages: [string] } or { error } — never throws. pdfPages-compatible shape.
function extractDocText(file, buf) {
  try {
    if (!buf || !buf.length) return { error: 'empty file' };
    if (buf.length > MAX_FILE) return { error: 'file too large' };
    if (buf.readUInt32LE(0) !== 0x04034b50 && findEOCD(buf) < 0) return { error: 'not a zip-based document' };
    const pages = /\.pptx$/i.test(file) ? pptxPages(buf) : /\.xlsx$/i.test(file) ? xlsxPages(buf) : docxPages(buf);
    if (!pages) return { error: 'no readable document text' };
    return { pages };
  } catch (e) { return { error: e.message || 'could not read document' }; }
}

module.exports = { extractDocText, xmlToText, findEOCD, readCentral, readEntry, decodeText, MAX_FILE };
