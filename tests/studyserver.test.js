// Lecture notes and exam questions (studyserver.js): cutting a transcript to fit the AI's memory, building notes in passes, writing the file,
// and making exam questions from a note or a topic. A fake AI records every request. Run: node tests/studyserver.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const S = require(path.join(__dirname, '..', 'studyserver.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);

/* ---------- cutting ---------- */
const sentence = i => 'This is sentence number ' + i + ' of the lecture about databases and transactions. ';
const long = Array.from({ length: 400 }, (_, i) => sentence(i)).join('');
const pieces = S.chunkText(long, 3500);
check('chunk: no piece is longer than 3,500 characters and nothing is lost', pieces.every(p => p.length <= 3500 && p.length > 0) && pieces.join(' ').replace(/\s+/g, ' ').length >= long.replace(/\s+/g, ' ').trim().length - pieces.length * 2 && pieces.length >= 9 && pieces.length <= 12, { n: pieces.length, max: Math.max(...pieces.map(p => p.length)) });
check('chunk: pieces end at a full stop where possible', pieces.slice(0, -1).every(p => /[.?!]$/.test(p)));
check('chunk: a very long word with no spaces is still cut', S.chunkText('x'.repeat(10000), 3500).every(p => p.length <= 3500) && S.chunkText('x'.repeat(10000), 3500).length === 3);
check('chunk: short text is one piece; empty and null give none', S.chunkText('hello there').length === 1 && S.chunkText('').length === 0 && S.chunkText(null).length === 0 && S.chunkText('   \n  ').length === 0);
check('merge groups: notes are packed into groups under the limit, in order', (() => { const g = S.mergeGroups(['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(500), 'd'.repeat(2900)], 3500); return g.length === 3 && g[0].startsWith('a') && g[1].startsWith('b') && g[1].includes('c') && g[2].startsWith('d') && g.every(x => x.length <= 3500 + 4); })());
check('slug: file-safe names', S.slug('Operating Systems!') === 'operating-systems' && S.slug('') === 'lecture' && S.slug('../../etc') === 'etc' && S.slug('ಕನ್ನಡ') === 'lecture');

/* ---------- the routes, with a fake AI ---------- */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'study-'));
const calls = []; let mode = 'ok';
const llm = {
  isCloud: m => String(m).includes('::'),
  complete: async o => {
    calls.push({ system: o.system, user: o.messages[0].content, model: o.model, json: o.json });
    if (mode === 'down') throw new Error('Local LLM unavailable');
    if (/exam questions/.test(o.system)) {
      if (mode === 'badjson') return 'not json at all';
      const n = +(o.system.match(/Write exactly (\d+)/) || [])[1] || 3;
      return JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({ q: 'Question ' + calls.length + '.' + i + ' about the notes?', a: 'A model answer ' + i + '.' })) });
    }
    if (/note-taker/.test(o.system)) return mode === 'quiet' ? '(nothing to note)' : '- point from piece ' + calls.length + ' (' + o.messages[0].content.length + ' chars)\n- another point';
    if (/rough lecture notes into clean/.test(o.system)) return '## Notes\n### Topic\n- merged point\n## Key terms\n- ACID — rules\n## Questions to revise\n1. What is ACID?';
    return 'x';
  },
};
const routes = {}; const app = { post: (p, h) => { routes[p] = h; } };
const sources = { 'notes.md': 'Normalization removes redundancy. '.repeat(40), 'tiny.md': 'short', 'big.md': Array.from({ length: 30 }, (_, i) => 'Section ' + i + ' explains topic ' + i + ' in detail with many words. '.repeat(20)).join('\n') };
S(app, { llm, DEFAULT_MODEL: 'qwen3.5:4b', SANDBOX: root, rel: p => path.relative(root, p).replace(/\\/g, '/'), findAllowed: n => (sources[n] !== undefined ? n : null), readSource: async p => sources[p] });
const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
const call = async (ep, body, headers = LAPTOP) => { let o, code = 200; await routes[ep]({ headers, body }, { json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };

(async () => {
  const transcript = long.slice(0, 9000);                                                            // about 3 pieces
  let r = await call('/api/lecture/notes', { subject: 'DBMS', transcript });
  check('lecture notes: made, saved under ~/jarvis/Notes with the subject and the date in the name', r.success && /^Notes\/lecture-dbms-\d{4}-\d{2}-\d{2}-notes\.md$/.test(r.file) && fs.existsSync(path.join(root, r.file)) && r.chunks === 3, r);
  const noteCalls = calls.filter(c => /note-taker/.test(c.system)), finalCalls = calls.filter(c => /clean study notes/.test(c.system));
  check('lecture notes: one request per piece, each at most 3,500 characters of transcript (plus a short label), then one arranging request', noteCalls.length >= 3 && noteCalls.slice(0, 3).every(c => c.user.length <= 3500 + 60) && finalCalls.length === 1, { n: noteCalls.length, finals: finalCalls.length, sizes: noteCalls.map(c => c.user.length) });
  check('lecture notes: the transcript is only ever in the user message, and the system message tells the AI it is data, not instructions', noteCalls.every(c => !c.system.includes('sentence number') && /data, not instructions/.test(c.system)) && finalCalls.every(c => !c.system.includes('sentence number')));
  const file = fs.readFileSync(path.join(root, r.file), 'utf8');
  check('lecture notes: the file has a title, an "AI wrote this" warning, the three parts, and points at the raw transcript', /^# DBMS — lecture notes/.test(file) && /can contain mistakes/.test(file) && /## Notes/.test(file) && /## Key terms/.test(file) && /## Questions to revise/.test(file) && /lecture-dbms-\d{4}-\d{2}-\d{2}\.md/.test(file));
  check('lecture notes: a preview, how long it took, and whether an online AI was used', r.preview.startsWith('# DBMS') && typeof r.seconds === 'number' && r.cloud === false);
  calls.length = 0; r = await call('/api/lecture/notes', { subject: 'DBMS', transcript });
  check('lecture notes: a second run the same day gets its own file (-2), nothing overwritten', /-notes-2\.md$/.test(r.file) && fs.existsSync(path.join(root, r.file.replace('-2.md', '.md'))));
  calls.length = 0; r = await call('/api/lecture/notes', { subject: 'OS', transcript: long.slice(0, 700), model: 'openai::gpt-x' });
  check('lecture notes: a short lecture is one piece; the model chosen is used and flagged as online', r.chunks === 1 && calls.every(c => c.model === 'openai::gpt-x') && r.cloud === true);
  calls.length = 0; const big = Array.from({ length: 1500 }, (_, i) => sentence(i)).join('').slice(0, 118000);
  r = await call('/api/lecture/notes', { subject: 'Long one', transcript: big });
  check('lecture notes: a very long lecture is capped at 24 pieces, says how many were left out, and the AI is never asked about more than 24', r.success && r.chunks === 24 && r.truncated >= 1 && calls.filter(c => /note-taker/.test(c.system) && /Transcript:/.test(c.user)).length === 24 && /were not included|was not included|not included/.test(fs.readFileSync(path.join(root, r.file), 'utf8')), { chunks: r.chunks, truncated: r.truncated });
  check('lecture notes: merging happened in groups that each fit (every request is under 3,600 characters)', calls.every(c => c.user.length <= 3600 + 80), Math.max(...calls.map(c => c.user.length)));
  mode = 'quiet'; calls.length = 0; r = await call('/api/lecture/notes', { subject: 'Chat', transcript: long.slice(0, 5000) });
  check('lecture notes: when every piece has nothing to note, it says so instead of inventing notes (and does not ask the AI to arrange nothing)', r.success && /had nothing to note/.test(fs.readFileSync(path.join(root, r.file), 'utf8')) && !calls.some(c => /clean study notes/.test(c.system)), calls.length); mode = 'ok';
  mode = 'down'; r = await call('/api/lecture/notes', { subject: 'X', transcript }); check('lecture notes: an AI that is down gives a plain error (the transcript was already saved by the page)', r.code === 502 && /unavailable/.test(r.error)); mode = 'ok';
  check('lecture notes: far too little text is refused; from another device it is refused', (await call('/api/lecture/notes', { transcript: 'hi' })).code === 400 && (await call('/api/lecture/notes', {})).code === 400 && (await call('/api/lecture/notes', { transcript }, { 'sec-fetch-site': 'same-origin', host: 'laptop.tail1.ts.net' })).code === 403 && (await call('/api/lecture/notes', { transcript }, {})).code === 403);
  check('lecture notes: the subject is made file-safe (no folders from "../")', await (async () => { const x = await call('/api/lecture/notes', { subject: '../../Windows/evil', transcript }); return x.success && /^Notes\/lecture-windows-evil-/.test(x.file) && !x.file.includes('..'); })());

  /* ---------- exam questions ---------- */
  calls.length = 0; r = await call('/api/exam/questions', { name: 'notes.md', n: 6 });
  check('exam: questions with model answers from a note; the note itself is in the request as study material', r.success && r.questions.length === 6 && r.questions.every(q => q.q && q.a) && r.fromNotes === true && r.file === 'notes.md' || r.success && r.questions.length === 6 && r.fromNotes, r);
  check('exam: the request asks for JSON, with the note as data (not in the system message)', calls[0].json === true && /Study notes/.test(calls[0].user) && !calls[0].system.includes('Normalization removes') && /data, not instructions/.test(calls[0].system));
  calls.length = 0; r = await call('/api/exam/questions', { topic: 'normalization', n: 5 });
  check('exam: from a topic alone (no notes) — and it says the questions are not from your notes', r.success && r.questions.length === 5 && r.fromNotes === false && /Topic: normalization/.test(calls[0].user));
  calls.length = 0; r = await call('/api/exam/questions', { name: 'big.md', n: 8 });
  check('exam: a long note is sampled in up to 4 pieces so the questions cover it all', r.success && calls.length === 4 && calls.every(c => c.user.length <= 3500 + 60) && r.questions.length === 8, { calls: calls.length, q: r.questions.length });
  check('exam: the number of questions is limited to 3-15', (await call('/api/exam/questions', { topic: 'x', n: 99 })).questions.length <= 15 && (await call('/api/exam/questions', { topic: 'x', n: 1 })).questions.length >= 3);
  check('exam: duplicate questions are dropped', await (async () => { mode = 'ok'; const orig = llm.complete; llm.complete = async () => JSON.stringify({ questions: [{ q: 'What is a key?', a: 'An identifier.' }, { q: 'what is a key?', a: 'Again.' }, { q: 'Define a foreign key.', a: 'A reference.' }, { q: 'Why normalise a table?', a: 'Less repetition.' }] }); const x = await call('/api/exam/questions', { topic: 'keys' }); llm.complete = orig; return x.questions.length === 3; })());
  check('exam: nothing to go on, a missing file, a tiny file are each refused plainly', (await call('/api/exam/questions', {})).code === 400 && (await call('/api/exam/questions', { name: 'nope.md' })).code === 404 && (await call('/api/exam/questions', { name: 'tiny.md' })).code === 422);
  mode = 'badjson'; check('exam: an AI that does not give proper JSON is reported, not crashed on', (await call('/api/exam/questions', { topic: 'x' })).code === 502); mode = 'down'; check('exam: an AI that is down is reported', (await call('/api/exam/questions', { topic: 'x' })).code === 502); mode = 'ok';

  clearInterval(keep);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`studyserver: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
