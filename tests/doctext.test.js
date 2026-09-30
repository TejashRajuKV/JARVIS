// doctext.js: the minimal ZIP reader + OOXML text extraction (docx/pptx/xlsx).
// Fixtures are real ZIP archives built here with zlib (a valid end-of-central-directory is required).
// Run: node tests/doctext.test.js
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const D = require(path.join(__dirname, '..', 'doctext.js'));

let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- fixture builders ---------- */
const crc32Table = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32Table[n] = c >>> 0; }
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crc32Table[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const dosTime = d => { d = d || new Date(); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; };

// A real (stored or deflated) zip from a plain object: { name: string|Buffer }
function buildZip(entries, { deflate = true } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, contentRaw] of Object.entries(entries)) {
    const content = Buffer.isBuffer(contentRaw) ? contentRaw : Buffer.from(contentRaw, 'utf8');
    const nb = Buffer.from(name, 'utf8'), t = dosTime();
    const method = deflate && content.length > 20 ? 8 : 0;
    const data = method === 8 ? zlib.deflateRawSync(content) : content;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(t.time, 10); local.writeUInt16LE(t.date, 12);
    local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nb.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nb, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10); cen.writeUInt16LE(t.time, 12); cen.writeUInt16LE(t.date, 14);
    cen.writeUInt32LE(crc32(content), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(content.length, 24);
    cen.writeUInt16LE(nb.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nb]));
    offset += local.length + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Operating systems</w:t></w:r></w:p>
<w:p><w:r><w:t>A </w:t></w:r><w:r><w:t>deadlock</w:t></w:r><w:r><w:t> needs mutual exclusion &amp; hold and wait.</w:t></w:r></w:p>
<w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>File</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Size</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:p>
</w:body></w:document>`;
const SLIDE1 = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:txBody><a:p><a:r><a:t>DBMS</a:t></a:r></a:p><a:p><a:r><a:t>Third normal form</a:t></a:r></a:p></p:txBody></p:sld>`;
const SLIDE2 = `<p:sld><p:txBody><a:p><a:r><a:t>Boyce Codd normal form</a:t></a:r></a:p></p:txBody></p:sld>`;
const STRINGS = `<sst><si><t>Name</t></si><si><t>Tejas</t></si><si><t>Roll number</t></si></sst>`;

/* ---------- xmlToText ---------- */
{
  check('docx paragraphs become newlines', D.xmlToText('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p>') === 'a\nb');
  check('table cells become pipes', D.xmlToText('<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>') === 'x |');
  check('entities decode, amp last', D.xmlToText('a &amp;lt; b') === 'a &lt; b' && D.xmlToText('a &amp; b') === 'a & b');
  check('numeric entities decode', D.xmlToText('&#65;&#66;') === 'AB');
  check('tags stripped from arbitrary xml', D.xmlToText('<root><x>hello</x><y>  world </y></root>') === 'hello world');
  check('blank space collapsed', D.xmlToText('<a>  a   b  </a>') === 'a b');
}

/* ---------- docx ---------- */
{
  const buf = buildZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOC_XML });
  const r = D.extractDocText('notes.docx', buf);
  check('docx: extracts', !r.error && r.pages.length === 1, r);
  const t = (r.pages || [''])[0];
  check('docx: body text present', /Operating systems/.test(t) && /deadlock/.test(t), t);
  check('docx: entity in text decoded', /&/.test(t));
  check('docx: paragraph break kept', /\n/.test(t));
  check('docx: table cell separator', /\|/.test(t));
  const saved = path.join(__dirname, '.fixture.docx');
  fs.writeFileSync(saved, buf);
  check('docx: works from a file path too', !D.extractDocText(saved, fs.readFileSync(saved)).error);
  fs.unlinkSync(saved);
}

/* ---------- pptx ---------- */
{
  const buf = buildZip({ 'ppt/presentation.xml': '<p/>', 'ppt/slides/slide1.xml': SLIDE1, 'ppt/slides/slide2.xml': SLIDE2, 'ppt/slides/slide10.xml': '<p:sl><a:t>end</a:t></p:sl>' });
  const r = D.extractDocText('deck.pptx', buf);
  check('pptx: one page per slide', !r.error && r.pages.length === 3, r);
  check('pptx: slides in numeric order (slide10 last)', /DBMS/.test(r.pages[0]) && /Boyce/.test(r.pages[1]) && /end/.test(r.pages[2]), r.pages && r.pages.map(p => p.slice(0, 12)));
  check('pptx: text extracted', /Third normal form/.test(r.pages[0]));
}

/* ---------- xlsx ---------- */
{
  const buf = buildZip({ 'xl/workbook.xml': '<w/>', 'xl/sharedStrings.xml': STRINGS, 'xl/worksheets/sheet1.xml': '<ws/>' });
  const r = D.extractDocText('marks.xlsx', buf);
  check('xlsx: shared strings become text', !r.error && /Tejas/.test(r.pages[0]) && /Roll number/.test(r.pages[0]), r);
}

/* ---------- rejections ---------- */
{
  check('empty buffer rejected', !!D.extractDocText('a.docx', Buffer.alloc(0)).error);
  check('not a zip rejected', !!D.extractDocText('a.docx', Buffer.from('hello world, not a zip at all')).error);
  const good = buildZip({ 'word/document.xml': DOC_XML });
  const truncated = good.slice(0, good.length - 20);
  check('truncated zip → error or partial (no throw)', (() => { try { const r = D.extractDocText('a.docx', truncated); return !r.error || typeof r.error === 'string'; } catch (e) { return false; } })());
  const wrongParts = buildZip({ 'word/document.xml': DOC_XML }); wrongParts.writeUInt16LE(99, 8); // impossible entry count
  const rw = D.extractDocText('a.docx', wrongParts);
  check('corrupt central directory → error, never throws', rw.error === undefined ? /Operating/.test(rw.pages[0]) : typeof rw.error === 'string', rw);
  check('docx without document.xml → error', !!D.extractDocText('a.docx', buildZip({ 'other.xml': '<a>hi</a>' })).error);
  check('pptx without slides → error', !!D.extractDocText('a.pptx', buildZip({ 'word/document.xml': DOC_XML })).error);
}

/* ---------- guards ---------- */
{
  const big = Buffer.alloc(9 * 1024 * 1024 + 7, 97); // over MAX_ENTRY when stored
  const r = D.extractDocText('big.docx', buildZip({ 'word/document.xml': big }, { deflate: false }));
  check('oversized entry refused', !!r.error, r && r.error);
  check('oversized archive refused', !!D.extractDocText('big.docx', Buffer.alloc(D.MAX_FILE + 1)).error);
  // 40 MB of ZIP64-style huge declared sizes must not be trusted
  const bomb = buildZip({ 'word/document.xml': '<w:p><w:r><w:t>tiny</w:t></w:r></w:p>' });
  bomb.writeUInt32LE(0xFFFFFFFF, bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
  const rb = D.extractDocText('a.docx', bomb);
  check('lying decompressed size handled safely', rb.error !== undefined ? typeof rb.error === 'string' : /tiny/.test(rb.pages[0]), rb);
}

/* ---------- rag integration: docx files get indexed with page numbers ---------- */
{
  const { DOC_EXT } = require(path.join(__dirname, '..', 'rag.js'));
  check('rag exports DOC_EXT with the three office types', DOC_EXT.has('.docx') && DOC_EXT.has('.pptx') && DOC_EXT.has('.xlsx') && !DOC_EXT.has('.doc'));
}

console.log((total - fail) + '/' + total + (fail ? ' FAILED' : ' — all passed'));
process.exitCode = fail ? 1 : 0;
