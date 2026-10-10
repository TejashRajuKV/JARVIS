// PDF tools (pdftools.js): page selections, merging, taking pages out, turning pages, text → PDF, watermark, files and routes.
// Real PDFs are made in a temp folder and read back with the project's own PDF reader (pdftext.js). Run: node tests/pdftools.test.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const T = require(path.join(__dirname, '..', 'pdftools.js'));
const { pdfPages } = require(path.join(__dirname, '..', 'pdftext.js'));
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const throwsMsg = async (fn, re) => { try { await fn(); return false; } catch (e) { return e instanceof T.PdfError ? (re ? re.test(e.message) : true) : false; } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const zlib = require('zlib');
// the text-drawing instructions of every page, with the PDF's compression undone
const drawn = buf => [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));

// A PDF whose pages say "<label> page 1", "<label> page 2", …
async function makePdf(label, pages) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([300, 400]).drawText(label + ' page ' + i, { x: 40, y: 200, size: 18, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save());
}
const readText = async (buf, name = 'x.pdf') => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return (await pdfPages(f)).pages.map(p => p.replace(/\s+/g, ' ').trim()); };
const angles = async buf => (await PDFDocument.load(buf)).getPages().map(p => p.getRotation().angle);

/* ---------- which pages ---------- */
{
  const p = (s, n) => T.parsePages(s, n);
  check('pages: numbers, ranges and lists (0-based inside)', p('1-3,7', 10).join() === '0,1,2,6' && p('2', 5).join() === '1' && p(' 3 - 5 ', 9).join() === '2,3,4' && p('1,3,5', 5).join() === '0,2,4');
  check('pages: open ends', p('5-', 8).join() === '4,5,6,7' && p('-3', 8).join() === '0,1,2');
  check('pages: words — all, first, last, odd, even, "and", "to"', p('all', 3).join() === '0,1,2' && p('', 3).join() === '0,1,2' && p(null, 2).join() === '0,1' && p('first 2', 9).join() === '0,1' && p('last 2', 9).join() === '7,8' && p('last', 9).join() === '8' && p('first', 9).join() === '0' && p('odd', 5).join() === '0,2,4' && p('even', 5).join() === '1,3' && p('1 and 3', 5).join() === '0,2' && p('2 to 4', 9).join() === '1,2,3');
  check('pages: "first 50" on a 3-page file is just the 3 pages; repeats are dropped, order kept', p('first 50', 3).join() === '0,1,2' && p('last 50', 3).join() === '0,1,2' && p('3,1,3,2', 5).join() === '2,0,1');
  check('pages: a page that does not exist says how many there are', (() => { try { p('15', 12); } catch (e) { return /12 pages, so page 15 doesn’t exist/.test(e.message); } })() && (() => { try { p('2-9', 1); } catch (e) { return /1 page, so page 9/.test(e.message); } })());
  for (const [bad, re] of [['0', /start at 1/], ['3-1', /runs backwards/], ['abc', /don’t understand “abc”/], ['1;2', /don’t understand/], ['1-2-3', /don’t understand/], ['page 2', /don’t understand/], ['-0', /start at 1/]]) {
    check('pages: refused: ' + bad, (() => { try { p(bad, 9); return false; } catch (e) { return e instanceof T.PdfError && re.test(e.message); } })());
  }
  check('pages: described back as ranges', T.describePages([0, 1, 2, 6]) === '1-3,7' && T.describePages([4]) === '5' && T.describePages([5, 3, 4, 0]) === '1,4-6' && T.describePages([]) === '');
  check('rotation: degrees and words, always 90 / 180 / 270', T.parseRotation(90) === 90 && T.parseRotation('180') === 180 && T.parseRotation('left') === 270 && T.parseRotation('right') === 90 && T.parseRotation('clockwise') === 90 && T.parseRotation('anticlockwise') === 270 && T.parseRotation('counter-clockwise') === 270 && T.parseRotation(-90) === 270 && T.parseRotation(450) === 90 && T.parseRotation('90 ') === 90);
  for (const bad of [45, 0, 'abc', '', null, 360, '10']) check('rotation: refused: ' + JSON.stringify(bad), (() => { try { T.parseRotation(bad); return false; } catch (e) { return e instanceof T.PdfError && /90, 180 or 270/.test(e.message); } })());
}

(async () => {
  const A = await makePdf('Alpha', 2), B = await makePdf('Beta', 1), C = await makePdf('Gamma', 3);

  /* ---------- reading problems ---------- */
  check('load: not a PDF / empty / too short', await throwsMsg(() => T.loadPdf(Buffer.from('hello world, definitely text')), /doesn’t look like a PDF/) && await throwsMsg(() => T.loadPdf(Buffer.alloc(0)), /doesn’t look like a PDF/) && await throwsMsg(() => T.loadPdf(null), /doesn’t look like a PDF/) && await throwsMsg(() => T.loadPdf(Buffer.from('%PDF-')), /doesn’t look like a PDF/));
  check('load: damaged PDF', await throwsMsg(() => T.loadPdf(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('this is not a real pdf body at all, no objects here')])), /couldn’t read that PDF/));
  check('load: an over-size buffer is refused with 413', await (async () => { try { await T.loadPdf(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(T.MAX_BYTES)])); return false; } catch (e) { return e.status === 413 && /MB/.test(e.message); } })());
  // password-protected: a PDF whose trailer names an /Encrypt dictionary
  const plain = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save({ useObjectStreams: false }); })()).toString('latin1');
  const locked = Buffer.from(plain.replace(/trailer\s*<</, 'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>'), 'latin1');
  check('load: a password-protected PDF is refused with advice, not an error dump', await throwsMsg(() => T.loadPdf(locked), /password-protected/), plain.slice(-120));

  /* ---------- merge ---------- */
  const before = [sha(A), sha(B), sha(C)];
  let m = await T.mergePdfs([A, B, C]);
  check('merge: pages in the order given — Alpha 1-2, Beta 1, Gamma 1-3', m.pages === 6 && (await readText(m.buf)).join('|') === 'Alpha page 1|Alpha page 2|Beta page 1|Gamma page 1|Gamma page 2|Gamma page 3', await readText(m.buf));
  check('merge: the inputs are not changed', sha(A) === before[0] && sha(B) === before[1] && sha(C) === before[2]);
  const info = await PDFDocument.load(m.buf, { updateMetadata: false });
  check('merge: marked as made by JARVIS', info.getProducer() === 'JARVIS' && info.getPageCount() === 6);
  check('merge: needs two, at most ten', await throwsMsg(() => T.mergePdfs([A]), /at least two/) && await throwsMsg(() => T.mergePdfs([]), /at least two/) && await throwsMsg(() => T.mergePdfs(Array(11).fill(B)), /up to 10/));
  check('merge: one bad file stops it with the reason', await throwsMsg(() => T.mergePdfs([A, Buffer.from('nope nope nope')]), /doesn’t look like a PDF/) && await throwsMsg(() => T.mergePdfs([A, locked]), /password-protected/));
  const manyPages = await makePdf('Big', 250);
  check('merge: over 400 pages in total is refused (413)', await (async () => { try { await T.mergePdfs([manyPages, manyPages]); return false; } catch (e) { return e.status === 413 && /400 pages/.test(e.message); } })());

  /* ---------- take pages out ---------- */
  let x = await T.extractPages(C, '2-3');
  check('pages: the chosen pages, in order, as a new PDF', x.pages === 2 && x.total === 3 && x.selected === '2-3' && (await readText(x.buf)).join('|') === 'Gamma page 2|Gamma page 3');
  x = await T.extractPages(C, 'last'); check('pages: "last"', (await readText(x.buf)).join('|') === 'Gamma page 3');
  x = await T.extractPages(C, '3,1'); check('pages: the order you ask for is kept', (await readText(x.buf)).join('|') === 'Gamma page 3|Gamma page 1');
  check('pages: out of range / garbage are refused with the reason', await throwsMsg(() => T.extractPages(C, '9'), /3 pages, so page 9/) && await throwsMsg(() => T.extractPages(C, 'zzz'), /don’t understand/));
  check('pages: the source is untouched', sha(C) === before[2]);

  /* ---------- turn pages ---------- */
  let r = await T.rotatePdf(C, 90, '1,3');
  check('rotate: only the chosen pages turn', r.pages === 2 && r.degrees === 90 && (await angles(r.buf)).join() === '90,0,90');
  const r2 = await T.rotatePdf(r.buf, 'right', '1'); check('rotate: turning again adds up (90 + 90 = 180)', (await angles(r2.buf)).join() === '180,0,90');
  const r3 = await T.rotatePdf(r2.buf, 'left'); check('rotate: left is 270 — on all pages when none are named; it wraps around', (await angles(r3.buf)).join() === '90,270,0', await angles(r3.buf));
  check('rotate: text is still there after turning', (await readText(r.buf)).join('|') === 'Gamma page 1|Gamma page 2|Gamma page 3');
  check('rotate: bad angle or page', await throwsMsg(() => T.rotatePdf(C, 45), /90, 180 or 270/) && await throwsMsg(() => T.rotatePdf(C, 90, '7'), /3 pages/) && sha(C) === before[2]);

  /* ---------- text → PDF ---------- */
  let t = await T.textToPdf({ title: 'Study notes', text: '# Operating systems\n\nA process is a program in execution.\n\n## Scheduling\n- First come first served\n- Round robin\n\nThe end.', author: 'Tejas' });
  const tt = await readText(t.buf);
  check('text: one page with the title, headings, bullets and body', t.pages === 1 && tt.length === 1 && /Study notes/.test(tt[0]) && /Operating systems/.test(tt[0]) && /A process is a program in execution\./.test(tt[0]) && /Scheduling/.test(tt[0]) && /First come first served/.test(tt[0]) && /Round robin/.test(tt[0]) && /The end\./.test(tt[0]), tt);
  check('text: "#" and "-" are formatting, not printed', !/#/.test(tt[0]));
  check('text: a page number footer', /Page 1 of 1/.test(tt[0]));
  const meta = await PDFDocument.load(t.buf, { updateMetadata: false });
  check('text: title, author and producer are set; A4 size', meta.getTitle() === 'Study notes' && meta.getAuthor() === 'Tejas' && meta.getProducer() === 'JARVIS' && Math.round(meta.getPage(0).getWidth()) === 595 && Math.round(meta.getPage(0).getHeight()) === 842);
  const long = Array.from({ length: 140 }, (_, i) => 'Line number ' + (i + 1) + ' of a long document that keeps going.').join('\n');
  t = await T.textToPdf({ title: 'Long', text: long });
  const lt = await readText(t.buf, 'long.pdf');
  check('text: a long text flows onto more pages, with numbered footers, nothing lost', t.pages >= 3 && lt.length === t.pages && lt.map((p, i) => new RegExp('Page ' + (i + 1) + ' of ' + t.pages).test(p)).every(Boolean) && /Line number 1 of/.test(lt[0]) && new RegExp('Line number 140 of').test(lt[lt.length - 1]) && lt.join(' ').match(/Line number \d+ of/g).length === 140, { pages: t.pages });
  t = await T.textToPdf({ text: 'Supercalifragilistic' + 'x'.repeat(300) + ' ends here' });
  check('text: a word longer than the line is cut instead of running off the page', (await readText(t.buf, 'w.pdf'))[0].includes('ends here') && t.pages === 1);
  t = await T.textToPdf({ text: '“Smart quotes” – dashes — and… bullets • plus ✓ and → arrows' });
  check('text: smart quotes, dashes and arrows are written plainly (nothing is lost as “?”)', t.replaced === 0 && /"Smart quotes" - dashes - and\.\.\. bullets - plus v and -> arrows/.test((await readText(t.buf, 'q.pdf'))[0]));
  t = await T.textToPdf({ title: 'తెలుగు', text: 'Hello ಕನ್ನಡ 😀 world' });
  check('text: letters the built-in font does not have become “?” and are counted, so the answer can say so', t.replaced > 5 && /Hello \?+ \?+ world/.test((await readText(t.buf, 'u.pdf'))[0]), t.replaced);
  check('text: empty or whitespace is refused; over 200,000 characters is refused (413)', await throwsMsg(() => T.textToPdf({ text: '   \n ' }), /no text/) && await throwsMsg(() => T.textToPdf({}), /no text/) && await (async () => { try { await T.textToPdf({ text: 'x'.repeat(T.MAX_TEXT + 1) }); return false; } catch (e) { return e.status === 413; } })());
  const charset = new Set((await (async () => { const d = await PDFDocument.create(); return (await d.embedFont(StandardFonts.Helvetica)).getCharacterSet(); })()));
  check('text: toLatin keeps normal letters and newlines, counts replacements', T.toLatin('Héllo\nwörld', charset).replaced === 0 && T.toLatin('日本', charset).text === '??' && T.toLatin('a\tb', charset).text === 'a    b' && T.toLatin('x\r\ny', charset).text === 'x\ny');

  /* ---------- watermark ---------- */
  let w = await T.watermarkPdf(C, 'DRAFT', '1-2');
  const wd = await PDFDocument.load(w.buf);
  check('watermark: pages kept, only the chosen ones stamped', w.pages === 2 && w.total === 3 && wd.getPageCount() === 3 && (await readText(w.buf, 'w1.pdf')).join('|').includes('Gamma page 3'));
  const stamped = s => (drawn(s).match(/<4452414654> Tj/g) || []).length;
  check('watermark: the word is drawn on exactly the chosen pages, at 45°, in grey', stamped(w.buf) === 2 && stamped((await T.watermarkPdf(C, 'DRAFT')).buf) === 3 && stamped(C) === 0 && /0\.7071\d* 0\.7071\d* -0\.7071\d* 0\.7071\d* [\d.]+ [\d.]+ Tm/.test(drawn(w.buf)) && /0\.55 0\.55 0\.6 rg/.test(drawn(w.buf)), stamped(w.buf));
  check('watermark: nothing to say / a source that is not changed', await throwsMsg(() => T.watermarkPdf(C, '   '), /watermark say/) && await throwsMsg(() => T.watermarkPdf(C, 'X', '9'), /3 pages/) && sha(C) === before[2]);
  w = await T.watermarkPdf(C, 'ಕನ್ನಡ'); check('watermark: letters the font lacks are replaced and counted', w.replaced > 0);
  check('watermark: a very long text is cut to 40 characters', (await T.watermarkPdf(C, 'x'.repeat(200))).buf.length > C.length);

  /* ---------- files and routes ---------- */
  const sandbox = path.join(tmp, 'sandbox'), docs = path.join(sandbox, 'Documents'); fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'a.pdf'), A); fs.writeFileSync(path.join(docs, 'b.pdf'), B); fs.writeFileSync(path.join(docs, 'c.pdf'), C); fs.writeFileSync(path.join(docs, 'locked.pdf'), locked); fs.writeFileSync(path.join(docs, 'notes.txt'), 'hello'); fs.writeFileSync(path.join(docs, 'fake.pdf'), 'this is not a pdf');
  const opened = [], approvals = []; let approve = true;
  const routes = {}, app = { post: (p, h) => { routes[p] = h; } };
  T(app, { findAllowed: n => { const f = path.join(docs, path.basename(String(n))); return !/[\\/]/.test(String(n)) && fs.existsSync(f) ? f : null; }, anyPath: n => (/blocked/.test(n) ? null : path.resolve(n)),
    approvedChange: (req, res, action, ...ps) => { approvals.push([action, ps]); if (!approve) { res.status(409).json({ needsApproval: true, action }); return false; } return true; },
    openPath: p => opened.push(p), rel: p => path.relative(sandbox, p).split(path.sep).join('/'), SANDBOX: sandbox });
  const call = async (ep, body) => { let o, code = 200, sent = false; await routes['/api/pdf/' + ep]({ body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  const orig = [sha(fs.readFileSync(path.join(docs, 'a.pdf'))), sha(fs.readFileSync(path.join(docs, 'b.pdf')))];

  let q = await call('merge', { files: ['a.pdf', 'b.pdf'] });
  check('route merge: a new PDF under ~/jarvis/PDFs, named from the inputs, opened, with the page count', q.code === 200 && q.success && q.file === 'PDFs/a-and-b-merged.pdf' && q.pages === 3 && q.parts === 2 && opened.length === 1 && (await readText(fs.readFileSync(q.path))).join('|') === 'Alpha page 1|Alpha page 2|Beta page 1', q);
  q = await call('merge', { files: ['a.pdf', 'b.pdf'] }); check('route merge: the same again never overwrites (…-2)', q.file === 'PDFs/a-and-b-merged-2.pdf' && fs.existsSync(path.join(sandbox, 'PDFs', 'a-and-b-merged.pdf')));
  q = await call('merge', { files: ['a.pdf', 'b.pdf', 'c.pdf'], name: 'My Study Pack!', open: false }); check('route merge: your own name, a three-way merge, open:false', q.file === 'PDFs/my-study-pack.pdf' && q.pages === 6 && opened.length === 2);
  q = await call('merge', { files: ['a.pdf', 'b.pdf', 'c.pdf'] }); check('route merge: 3+ files are named "…-and-2-more-merged"', q.file === 'PDFs/a-and-2-more-merged.pdf');
  check('route merge: originals untouched', sha(fs.readFileSync(path.join(docs, 'a.pdf'))) === orig[0] && sha(fs.readFileSync(path.join(docs, 'b.pdf'))) === orig[1]);
  check('route merge: errors — one file, missing file, not a PDF, locked, fake', (await call('merge', { files: ['a.pdf'] })).code === 400 && (await call('merge', {})).code === 400 && (await call('merge', { files: ['a.pdf', 'nope.pdf'] })).code === 404 && /isn’t a PDF/.test((await call('merge', { files: ['a.pdf', 'notes.txt'] })).error) && /password-protected/.test((await call('merge', { files: ['a.pdf', 'locked.pdf'] })).error) && /doesn’t look like a PDF/.test((await call('merge', { files: ['a.pdf', 'fake.pdf'] })).error));
  check('route merge: a blocked full path is "not found"', (await call('merge', { files: ['a.pdf', 'C:\\blocked\\x.pdf'] })).code === 404);
  q = await call('pages', { file: 'c.pdf', pages: '1-2', open: false });
  check('route pages: "c-pages-1-2.pdf" with the pages kept', q.file === 'PDFs/c-pages-1-2.pdf' && q.pages === 2 && q.total === 3 && q.selected === '1-2' && (await readText(fs.readFileSync(q.path))).join('|') === 'Gamma page 1|Gamma page 2', q);
  q = await call('pages', { file: 'c.pdf', pages: '1,3', open: false }); check('route pages: a list is named with underscores (a comma is a bad file-name habit)', q.file === 'PDFs/c-pages-1_3.pdf');
  check('route pages: out of range → 400 with the page count; missing file → 404', /3 pages, so page 9/.test((await call('pages', { file: 'c.pdf', pages: '9' })).error) && (await call('pages', { file: 'zzz.pdf', pages: '1' })).code === 404);
  q = await call('rotate', { file: 'c.pdf', degrees: 'right', pages: '2', open: false });
  check('route rotate: "c-rotated.pdf" with page 2 turned', q.file === 'PDFs/c-rotated.pdf' && q.degrees === 90 && (await angles(fs.readFileSync(q.path))).join() === '0,90,0', q);
  check('route rotate: bad angle → 400', (await call('rotate', { file: 'c.pdf', degrees: 33 })).code === 400);
  q = await call('watermark', { file: 'a.pdf', text: 'CONFIDENTIAL', open: false }); check('route watermark: "a-watermarked.pdf"', q.file === 'PDFs/a-watermarked.pdf' && q.pages === 2 && q.replaced === 0);
  check('route watermark: no text → 400', (await call('watermark', { file: 'a.pdf', text: ' ' })).code === 400);
  q = await call('make', { title: 'OS Notes', text: '# Processes\n- ready\n- running', open: false });
  check('route make: a PDF named from the title in ~/jarvis/PDFs', q.file === 'PDFs/os-notes.pdf' && q.pages === 1 && q.replaced === 0 && /Processes/.test((await readText(fs.readFileSync(q.path), 'm.pdf'))[0]));
  q = await call('make', { text: 'First line becomes the name\nsecond line', open: false }); check('route make: no title → named from the first line', q.file === 'PDFs/first-line-becomes-the-name.pdf');
  q = await call('make', { text: 'తెలుగు text', open: false }); check('route make: reports how many characters could not be drawn', q.replaced > 0);
  check('route make: no text → 400; huge text → 413', (await call('make', {})).code === 400 && (await call('make', { text: 'x'.repeat(T.MAX_TEXT + 1) })).code === 413);
  // beside the original: outside ~/jarvis needs approval
  approve = false; approvals.length = 0;
  q = await call('pages', { file: 'c.pdf', pages: '1', beside: true });
  check('route beside: asks for approval first; when refused nothing is written', q.code === 409 && approvals[0][0] === 'save the new PDF next to' && !fs.readdirSync(docs).some(f => /pages/.test(f)));
  approve = true; q = await call('pages', { file: 'c.pdf', pages: '1', beside: true, open: false });
  check('route beside: once approved the new file sits next to the original', q.success && path.dirname(q.path) === docs && fs.existsSync(path.join(docs, 'c-pages-1.pdf')) && sha(fs.readFileSync(path.join(docs, 'c.pdf'))) === before[2]);
  // size guard before reading
  const huge = path.join(docs, 'huge.pdf'); fs.writeFileSync(huge, Buffer.alloc(T.MAX_BYTES + 1, 0x20));
  q = await call('pages', { file: 'huge.pdf', pages: '1' }); check('route: a PDF over 40 MB is a 413 that says so, without reading it', q.code === 413 && /40 MB/.test(q.error));
  fs.unlinkSync(huge);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pdftools: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
