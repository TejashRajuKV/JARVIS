// Camera pictures (scan.js, ocr.js word boxes, /api/phone/alert): searchable PDF building, scan sessions, snapshots, vision refusals.
// A real server in a temp home; a real JPEG is drawn with Windows' own drawing code, and read back with Windows OCR when it is available.
// Run: node tests/scan.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { execFileSync } = require('child_process');
const { startServer, suite } = require('./lib/server');
const S_ = require(path.join(__dirname, '..', 'scan.js'));
const { PDFDocument } = require('pdf-lib');
const { check, done } = suite('scan');
const keep = setInterval(() => {}, 1000);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
// Draw a JPEG with some words on it (Windows only; otherwise a plain white page is used and OCR checks are skipped).
function drawJpeg(file, lines) {
  const ps = `Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 700
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White)
$f = New-Object System.Drawing.Font 'Arial', 40
$y = 60; foreach ($l in ($env:LINES -split '\\|')) { $g.DrawString($l, $f, [System.Drawing.Brushes]::Black, 50, $y); $y += 150 }
$g.Dispose(); $bmp.Save($env:OUTJ, [System.Drawing.Imaging.ImageFormat]::Jpeg); $bmp.Dispose()`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { env: { ...process.env, OUTJ: file, LINES: lines.join('|') }, windowsHide: true, timeout: 30000 });
  return fs.readFileSync(file);
}
const inflated = buf => [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('\n');

// the words the page draws (pdf-lib writes them as hex strings: <48656C6C6F> Tj)
const pdfWords = buf => [...inflated(buf).matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map(m => Buffer.from(m[1], 'hex').toString('latin1')).join('').replace(/\s+/g, ' ');

(async () => {
  const IS_WIN = process.platform === 'win32';
  let jpg;
  try { jpg = IS_WIN ? drawJpeg(path.join(tmp, 'doc.jpg'), ['Database Systems', 'Normalization removes redundancy', 'Invoice total 4521']) : null; } catch { jpg = null; }
  if (!jpg) { console.log('scan: skipped — could not draw a test picture here'); clearInterval(keep); process.exit(0); }

  /* ---------- pure helpers ---------- */
  check('Helpers', 'a JPEG is recognised by its first bytes; PNG, text and short buffers are not', S_.isJpeg(jpg) && !S_.isJpeg(Buffer.from('hello world, not a picture at all')) && !S_.isJpeg(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) && !S_.isJpeg(null));
  check('Helpers', 'file names are made safe', S_.slug('My Notes: Unit 3/4.pdf') === 'my-notes-unit-3-4' && S_.slug('..\\..\\evil') === 'evil' && S_.slug('') === '');
  {
    const words = [{ t: 'Hello', x: 100, y: 100, w: 200, h: 50 }, { t: 'world', x: 320, y: 100, w: 180, h: 50 }, { t: 'తెలుగు', x: 100, y: 200, w: 200, h: 50 }, { t: 'x', x: 0, y: 0, w: 0, h: 5 }, { t: '  ', x: 0, y: 0, w: 5, h: 5 }];
    const r = await S_.buildSearchablePdf([{ jpeg: jpg, words, width: 900, height: 700 }, { jpeg: jpg, words: [], width: 900, height: 700 }], 'Test');
    const doc = await PDFDocument.load(r.pdf);
    check('PDF', 'one page per picture, the picture on each, shaped like the photo (landscape stays landscape)', doc.getPageCount() === 2 && doc.getPage(0).getWidth() > doc.getPage(0).getHeight());
    check('PDF', 'words with a real box are written as a hidden text layer; empty, zero-size and non-Latin words are skipped, not garbled', r.words === 2 && r.skipped === 1, r);
    const body = inflated(r.pdf), said = pdfWords(r.pdf);
    check('PDF', 'the hidden text is really in the page ("Hello world"), so a PDF viewer can search it', /Hello world/.test(said) && !said.includes('?'), said);
    check('PDF', 'the text is invisible (an opacity of zero is set), so the page still looks like the photo', body.includes('/ca 0') && /GS-?[0-9]+ gs/.test(body), body.slice(0, 300));
  }

  /* ---------- a real server ---------- */
  const S = await startServer({});
  const raw = (method, p, body, extra = {}) => fetch(S.base + p, { method, headers: { Origin: S.base, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'image/jpeg', ...(extra.headers || {}) }, body }).then(async r => { const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; });
  try {
    const st = (await S.get('/api/scan/status')).json;
    check('Status', 'reports OCR, the PDF library, vision and the page limit', st.success === true && st.ocr === true && st.pdfLib === true && st.maxPages === 20 && typeof st.vision === 'boolean', st);

    /* ---- word boxes ---- */
    const w = await S.post('/api/ocr/words', { image: jpg.toString('base64') });
    check('OCR words', 'reads the drawn picture: size, words with boxes and the text', w.status === 200 && w.json.width === 900 && w.json.height === 700 && Array.isArray(w.json.words) && w.json.words.length >= 6, w.status + ' ' + w.text.slice(0, 200));
    if (w.status === 200) {
      const said = w.json.words.map(x => x.t).join(' ');
      check('OCR words', 'the words are the ones drawn', /Database/i.test(said) && /Normalization/i.test(said) && /4521/.test(said), said);
      const db = w.json.words.find(x => /^Database/i.test(x.t)), inv = w.json.words.find(x => /^Invoice/i.test(x.t));
      check('OCR words', 'positions make sense: each word has a box inside the picture and later lines are lower down', db && inv && db.w > 50 && db.h > 20 && db.x >= 0 && db.x + db.w <= 900 && inv.y > db.y + 100, [db, inv]);
      check('OCR words', 'the text is returned line by line too', /Database Systems/i.test(w.json.text) && w.json.lines.length >= 3, w.json.lines);
    }
    check('OCR words', 'needs an image', (await S.post('/api/ocr/words', {})).status === 400);
    check('OCR words', 'text that is not a picture is refused', (await S.post('/api/ocr/words', { image: Buffer.from('not a picture, just some words here').toString('base64') })).status === 400);

    /* ---- a scan in two pages ---- */
    const p1 = await raw('POST', '/api/scan/page', jpg);
    check('Scan', 'the first page starts a scan', p1.status === 200 && /^[a-f0-9]{16}$/.test(p1.json.scan) && p1.json.pages === 1, p1.text);
    const id = p1.json.scan;
    const p2 = await raw('POST', '/api/scan/page?scan=' + id, jpg);
    check('Scan', 'the second page joins it', p2.status === 200 && p2.json.pages === 2 && p2.json.scan === id, p2.text);
    check('Scan', 'a page that is not a JPEG is refused (text, PNG signature, empty)', (await raw('POST', '/api/scan/page?scan=' + id, Buffer.from('<html>not a picture at all, sorry</html>'))).status === 400 && (await raw('POST', '/api/scan/page', Buffer.alloc(0))).status === 400);
    check('Scan', 'an unknown or malformed scan id is refused', (await raw('POST', '/api/scan/page?scan=' + 'a'.repeat(16), jpg)).status === 404 && (await raw('POST', '/api/scan/page?scan=../../x', jpg)).status === 400);
    check('Scan', 'a page from another site is refused', (await raw('POST', '/api/scan/page', jpg, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status >= 400);
    const f = await S.post('/api/scan/finish', { scan: id, name: 'DBMS notes' });
    check('Finish', 'builds one PDF with both pages', f.status === 200 && f.json.pages === 2 && /^Scans\/dbms-notes\.pdf$/.test(f.json.file), f.text.slice(0, 300));
    const pdfPath = path.join(S.sandbox, 'Scans', 'dbms-notes.pdf');
    check('Finish', 'the file is a real PDF with two pages', fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).toString('latin1', 0, 5) === '%PDF-' && (await PDFDocument.load(fs.readFileSync(pdfPath))).getPageCount() === 2);
    check('Finish', 'the text was read from the pictures and the PDF is searchable', f.json.searchable === true && f.json.words >= 6 && /Normalization/i.test(f.json.text) && /page 1/.test(f.json.text) && /page 2/.test(f.json.text), f.json.text);
    check('Finish', 'the same words are in the PDF itself (hidden layer)', /Normalization/.test(pdfWords(fs.readFileSync(pdfPath))));
    check('Finish', 'the text is also saved beside it', f.json.textFile === 'Scans/dbms-notes.txt' && /Invoice total/i.test(fs.readFileSync(path.join(S.sandbox, 'Scans', 'dbms-notes.txt'), 'utf8')));
    check('Finish', 'finishing uses the pages up: the scan id is gone', (await S.post('/api/scan/finish', { scan: id })).status === 404);
    const p3 = await raw('POST', '/api/scan/page', jpg);
    const f2 = await S.post('/api/scan/finish', { scan: p3.json.scan, name: 'DBMS notes', ocr: false });
    check('Finish', 'a second scan with the same name makes a second file, never an overwrite; no OCR still gives a PDF', f2.status === 200 && f2.json.file === 'Scans/dbms-notes-2.pdf' && f2.json.searchable === false && !f2.json.textFile, f2.text.slice(0, 200));
    const f3 = await S.post('/api/scan/finish', { scan: (await raw('POST', '/api/scan/page', jpg)).json.scan });
    check('Finish', 'with no name it is dated', f3.status === 200 && /^Scans\/scan-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/.test(f3.json.file), f3.json.file);
    check('Finish', 'needs a scan', (await S.post('/api/scan/finish', {})).status === 404 && (await S.post('/api/scan/finish', { scan: 'nope' })).status === 404);
    const p4 = await raw('POST', '/api/scan/page', jpg);
    check('Discard', 'a started scan can be thrown away', (await S.post('/api/scan/discard', { scan: p4.json.scan })).json.discarded === true && (await S.post('/api/scan/finish', { scan: p4.json.scan })).status === 404 && (await S.post('/api/scan/discard', { scan: 'zzz' })).json.discarded === false);
    // page limit
    let last, scanId;
    for (let i = 0; i < 21; i++) { last = await raw('POST', '/api/scan/page' + (scanId ? '?scan=' + scanId : ''), jpg); scanId = scanId || last.json.scan; }
    check('Scan', 'a scan holds at most 20 pages', last.status === 413 && /20 pages/.test(last.json.error), last.text);
    await S.post('/api/scan/discard', { scan: scanId });

    /* ---- vision ---- */
    check('Vision', 'needs a picture', (await S.post('/api/vision/ask', { question: 'what is this' })).status === 400);
    check('Vision', 'a non-JPEG is refused', (await S.post('/api/vision/ask', { image: Buffer.from('plain words, not a picture, really').toString('base64') })).status === 400);
    const big = Buffer.concat([jpg.subarray(0, 20), Buffer.alloc(2.2 * 1024 * 1024, 1)]);
    check('Vision', 'a picture over 2 MB is refused before anything is sent', (await S.post('/api/vision/ask', { image: big.toString('base64') })).status === 413);
    const v = await S.post('/api/vision/ask', { image: jpg.toString('base64'), question: 'what does it say' });
    check('Vision', 'with no AI running it fails cleanly, with a message and no crash', v.status >= 400 && v.status < 600 && typeof v.json.error === 'string' && v.json.error.length > 5, v.text);
    check('Vision', 'from another site it is refused', (await S.post('/api/vision/ask', { image: jpg.toString('base64') }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status >= 400);

    /* ---- room snapshots ---- */
    const s1 = await raw('POST', '/api/room/snapshot', jpg);
    check('Snapshot', 'a frame is kept in ~/jarvis/Watch', s1.status === 200 && /^Watch\/watch-\d{8}-\d{6}\.jpg$/.test(s1.json.file) && fs.existsSync(path.join(S.sandbox, s1.json.file)), s1.text);
    const s2 = await raw('POST', '/api/room/snapshot', jpg);
    check('Snapshot', 'two in the same second do not overwrite each other', s2.status === 200 && s2.json.file !== s1.json.file);
    check('Snapshot', 'only JPEGs are kept', (await raw('POST', '/api/room/snapshot', Buffer.from('this is certainly not a jpeg picture'))).status === 400);
    const dir = path.join(S.sandbox, 'Watch');
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, 'watch-20200101-' + String(100000 + i) + '.jpg'), jpg);
    await raw('POST', '/api/room/snapshot', jpg);
    const left = fs.readdirSync(dir).filter(x => x.endsWith('.jpg'));
    check('Snapshot', 'only the newest 50 are kept', left.length === 50 && left.some(x => x === path.basename(s1.json.file) || /^watch-20\d{6}/.test(x)), left.length);
    check('Snapshot', 'the newest one just saved is among them', left.some(x => !x.startsWith('watch-2020')), left.slice(-3));
    check('Snapshot', 'a request from another site is refused', (await raw('POST', '/api/room/snapshot', jpg, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status >= 400);

    /* ---- phone alert ---- */
    const noPhone = await S.post('/api/phone/alert', { text: 'Movement seen' });
    check('Phone alert', 'with phone alerts off it says so (nothing is sent)', noPhone.status === 400 && /off/i.test(noPhone.json.error), noPhone.text);
    check('Phone alert', 'from another site it is refused', (await S.post('/api/phone/alert', { text: 'x' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
    check('Phone alert', 'an empty alert is refused', (await S.post('/api/phone/alert', { text: '   ' })).status === 400);
  } finally {
    await S.stop();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  clearInterval(keep);
  process.exitCode = done() ? 1 : 0;
})().catch(e => { console.log('FAIL  scan suite crashed — ' + (e && e.stack || e)); process.exit(1); });
