'use strict';
/* PDF → text, page by page (unpdf / Mozilla pdf.js). Cached by path + size + modified time, so each PDF is read once.
   Scanned PDFs (pictures of pages, no text layer) come back with almost no text — callers say so plainly. */
const fs = require('fs');

const MAX_PDF = 40 * 1024 * 1024, MAX_PAGES = 400;
const cache = new Map(); // path → { key, pages:[text], total }
let unpdf = null;
const lib = async () => unpdf || (unpdf = await import('unpdf'));

// → { pages: [string], total, scanned } ; throws a friendly Error on bad/locked files
async function pdfPages(file) {
  const st = fs.statSync(file);
  if (st.size > MAX_PDF) throw new Error('that PDF is larger than 40 MB');
  const key = st.size + ':' + st.mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.val;
  const { getDocumentProxy, extractText } = await lib();
  let pdf;
  try { pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file))); }
  catch (e) { throw new Error(/password/i.test(e.message) ? 'that PDF is password-protected' : 'I couldn’t read that PDF (' + String(e.message).slice(0, 80) + ')'); }
  const r = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(r.text) ? r.text : [r.text]).slice(0, MAX_PAGES).map(t => String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  const chars = pages.reduce((s, p) => s + p.length, 0);
  const val = { pages, total: r.totalPages || pages.length, scanned: chars < 40 * Math.max(1, pages.length) };
  cache.set(file, { key, val });
  try { await pdf.destroy(); } catch {}
  return val;
}
// Whole text with page markers, for "read / summarise this PDF".
const withMarkers = pages => pages.map((t, i) => '[page ' + (i + 1) + ']\n' + t).join('\n\n');

module.exports = { pdfPages, withMarkers, MAX_PDF };
