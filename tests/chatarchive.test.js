// Chat archive (chatarchive.js): reading dates out of questions, ranking old chats, saving monthly files with a size cap, forgetting, and the routes.
// Everything in a temp folder, with a fixed "now" (Friday 9 October 2026, 22:30). Run: node tests/chatarchive.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const A = require(path.join(__dirname, '..', 'chatarchive.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const NOW = new Date(2026, 9, 9, 22, 30).getTime();                               // Fri 9 Oct 2026
const D = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const day = t => new Date(t).toLocaleDateString('en-CA');                          // yyyy-mm-dd, local

/* ---------- date phrases ---------- */
const w = (t) => A.parseWindow(t, NOW);
const win = (t, from, to, label) => { const r = w(t); check('window: "' + t + '"', r.from === from && r.to === to && (!label || (r.label || '').includes(label)), { got: [day(r.from), day(r.to), r.label], want: [day(from), day(to)] }); };
win('yesterday', D(2026, 10, 8), D(2026, 10, 9), 'yesterday');
win('what did i say today', D(2026, 10, 9), D(2026, 10, 10), 'today');
win('this morning', D(2026, 10, 9), D(2026, 10, 10));
win('last night', D(2026, 10, 8, 18), D(2026, 10, 9, 6), 'last night');
win('the day before yesterday', D(2026, 10, 7), D(2026, 10, 8));
win('last week', D(2026, 9, 28), D(2026, 10, 5), 'last week');                      // Monday 28 Sep to Sunday 4 Oct
win('this week', D(2026, 10, 5), D(2026, 10, 10));
win('last month', D(2026, 9, 1), D(2026, 10, 1), 'september');
win('this month', D(2026, 10, 1), D(2026, 10, 10));
win('last year', D(2025, 1, 1), D(2026, 1, 1), '2025');
win('this year', D(2026, 1, 1), D(2026, 10, 10));
win('in the last 10 days', D(2026, 9, 29), D(2026, 10, 10), 'last 10 days');
win('past two weeks', D(2026, 9, 25), D(2026, 10, 10));
win('last 3 months', D(2026, 7, 9), D(2026, 10, 10));
win('3 days ago', D(2026, 10, 6), D(2026, 10, 7));
win('two days ago', D(2026, 10, 7), D(2026, 10, 8));
win('a week ago', D(2026, 9, 28), D(2026, 10, 5));
win('in september', D(2026, 9, 1), D(2026, 10, 1), 'september 2026');
win('in October', D(2026, 10, 1), D(2026, 11, 1));
win('in november', D(2025, 11, 1), D(2025, 12, 1), 'november 2025');                // that November has not happened yet: last year's
win('in sept 2025', D(2025, 9, 1), D(2025, 10, 1));
win('in may', D(2026, 5, 1), D(2026, 6, 1));
win('on 5 october', D(2026, 10, 5), D(2026, 10, 6));
win('on october 5th', D(2026, 10, 5), D(2026, 10, 6));
win('on the 12th of december', D(2025, 12, 12), D(2025, 12, 13));
win('on 3 march 2024', D(2024, 3, 3), D(2024, 3, 4));
win('on monday', D(2026, 10, 5), D(2026, 10, 6));
win('on thursday', D(2026, 10, 8), D(2026, 10, 9));
win('on friday', D(2026, 10, 9), D(2026, 10, 10));
win('last tuesday', D(2026, 10, 6), D(2026, 10, 7));
win('in 2025', D(2025, 1, 1), D(2026, 1, 1), '2025');
check('window: no date phrase → no window, text kept', w('the demo project').from === null && w('the demo project').rest === 'the demo project');
check('window: the phrase is cut out of the text', w('the demo project last week').rest === 'the demo project' && w('what did i decide about the database in september').rest === 'what did i decide about the database' && w('login bug on 5 october please').rest.includes('login bug') && !/october/.test(w('login bug on 5 october please').rest));
check('window: "may" the verb is not a month', w('what may happen to the project').from === null && w('who may i ask').from === null);
check('window: empty, null and odd input never throw', w('').from === null && A.parseWindow(null, NOW).from === null && A.parseWindow(undefined, NOW).rest === '' && A.parseWindow('???', NOW).from === null);
check('window: it works across a new year ("last week" on 2 January)', (() => { const r = A.parseWindow('last week', D(2027, 1, 2, 10)); return day(r.from) === '2026-12-21' && day(r.to) === '2026-12-28'; })());
check('window: "last month" in January is December of the year before', (() => { const r = A.parseWindow('last month', D(2027, 1, 15)); return day(r.from) === '2026-12-01' && day(r.to) === '2027-01-01'; })());

/* ---------- what to look for ---------- */
const terms = t => A.queryTerms(A.parseWindow(t, NOW).rest).join(',');
check('terms: the question wrapper and the date are dropped, the topic stays', terms('what did I decide about the database last week') === 'database' && terms('what did we discuss about the attendance app') === 'attendance,app' && terms('search my chats for pandas dataframe') === 'panda,dataframe' && terms('when did i ask you about recursion') === 'recursion');
check('terms: only a date → no search words (everything in that window)', terms('what did I ask yesterday') === '' && terms('search my chats last week') === '');

/* ---------- saving ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
let clock = NOW;
const arch = A.createArchive({ dir: path.join(dir, '.chat-archive'), now: () => clock });
let r = arch.append([
  { role: 'user', text: 'How do I center a div?', t: D(2026, 9, 20, 10), source: 'text' }, { role: 'assistant', text: 'Use flexbox: display flex and justify-content center.', t: D(2026, 9, 20, 10, 1) },
  { role: 'user', text: 'Which database should I use for my attendance app?', t: D(2026, 10, 2, 16), source: 'voice' }, { role: 'assistant', text: 'Use SQLite because it needs no server and is a single file.', t: D(2026, 10, 2, 16, 1) },
  { role: 'user', text: 'Remind me about the database backup', t: D(2026, 10, 7, 9) }, { role: 'assistant', text: 'Okay, I will remind you.', t: D(2026, 10, 7, 9, 1) },
  { role: 'user', text: 'What is the capital of France', t: D(2026, 10, 8, 12) }, { role: 'assistant', text: 'Paris.', t: D(2026, 10, 8, 12, 1) },
]);
check('append: all eight stored, in one file per month', r.stored === 8 && arch.files().join() === '2026-09.jsonl,2026-10.jsonl' && fs.readFileSync(path.join(dir, '.chat-archive', '2026-09.jsonl'), 'utf8').trim().split('\n').length === 2, r);
check('append: the folder is a dot-folder (so file search and the index never see it)', path.basename(path.dirname(path.join(dir, '.chat-archive', '2026-09.jsonl'))).startsWith('.'));
check('append: junk is dropped (bad role, empty text, not an array), long text is cut, a bad time becomes "now"', (() => {
  const a = arch.append([{ role: 'system', text: 'x' }, { role: 'user', text: '   ' }, { role: 'user', text: 'y'.repeat(9000), t: 'garbage' }, null, 5, { role: 'assistant', text: 'z', t: 5 }]);
  const lines = fs.readFileSync(path.join(dir, '.chat-archive', '2026-10.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const long = lines.find(l => l.text.startsWith('yyyy')), small = lines.find(l => l.text === 'z');
  return a.stored === 2 && long.text.length === A.MAX_TEXT && long.t === NOW && small.t === NOW && arch.append('nope').stored === 0 && arch.append(null).stored === 0;
})());
check('append: at most 300 messages in one call', arch.append(Array.from({ length: 500 }, (_, i) => ({ role: 'user', text: 'bulk ' + i, t: NOW }))).stored === 300);
// remove the junk added above so the later checks are exact
arch.forget(); fs.rmSync(path.join(dir, '.chat-archive'), { recursive: true, force: true });
const arch2 = A.createArchive({ dir: path.join(dir, '.chat-archive'), now: () => clock });
const seed = [
  { role: 'user', text: 'How do I center a div?', t: D(2026, 9, 20, 10) }, { role: 'assistant', text: 'Use flexbox: display flex and justify-content center.', t: D(2026, 9, 20, 10, 1) },
  { role: 'user', text: 'Which database should I use for my attendance app?', t: D(2026, 10, 2, 16) }, { role: 'assistant', text: 'Use SQLite because it needs no server and is a single file.', t: D(2026, 10, 2, 16, 1) },
  { role: 'user', text: 'Remind me about the database backup', t: D(2026, 10, 7, 9) }, { role: 'assistant', text: 'Okay, I will remind you.', t: D(2026, 10, 7, 9, 1) },
  { role: 'user', text: 'What is the capital of France', t: D(2026, 10, 8, 12) }, { role: 'assistant', text: 'Paris.', t: D(2026, 10, 8, 12, 1) },
];
check('backfill: puts the current chat in when the archive is empty', arch2.backfill(seed).stored === 8 && arch2.backfill(seed).skipped === true && arch2.status().messages === 8, arch2.status());

/* ---------- searching ---------- */
let s = arch2.search({ text: 'what did I decide about the database last week' });
check('search: the date window limits it (only last week, not the database reminder from this week); the answer is the one from 2 October', s.total === 1 && s.exchanges[0].user.includes('Which database') && s.exchanges[0].assistant.includes('SQLite') && s.window.label.includes('last week') && s.terms.join() === 'database', s);
s = arch2.search({ text: 'database' });
check('search: with no date, both database chats; the one where the word is in your question and the answer comes first? (score then recency)', s.total === 2 && s.exchanges[0].score >= s.exchanges[1].score && s.exchanges.every(e => /database/i.test(e.user + e.assistant)), s.exchanges.map(e => [day(e.t), e.score]));
s = arch2.search({ text: 'what did I ask yesterday' });
check('search: only a date → everything in that window, newest first', s.total === 1 && s.exchanges[0].user.includes('France') && s.terms.length === 0, s);
s = arch2.search({ text: 'what did we say in september' });
check('search: a month', s.total === 1 && s.exchanges[0].user.includes('center a div'), s.total);
s = arch2.search({ text: 'quantum physics homework' }); check('search: nothing found is an empty list, not an error', s.total === 0 && s.exchanges.length === 0 && s.scanned > 0);
s = arch2.search({ text: 'what did I ask in august' }); check('search: an empty window finds nothing and scans nothing', s.total === 0 && s.scanned === 0);
s = arch2.search({ text: 'sqlite' }); check('search: a word only in the answer still finds the chat', s.total === 1 && s.exchanges[0].user.includes('Which database'));
check('search: stemming (database / databases, remind / reminding)', arch2.search({ text: 'databases' }).total === 2 && arch2.search({ text: 'reminding' }).total === 1);
check('search: results are exchanges with the time, the question and the reply', (() => { const e = arch2.search({ text: 'france' }).exchanges[0]; return e && e.t === D(2026, 10, 8, 12) && e.user === 'What is the capital of France' && e.assistant === 'Paris.'; })());
// assistant-only (a notification) and orphan replies are kept as their own entries
arch2.append([{ role: 'assistant', text: 'Reminder: submit the DBMS lab record', t: D(2026, 10, 9, 8) }]);
check('search: a message from JARVIS with no question before it is found too', arch2.search({ text: 'dbms lab record' }).exchanges[0].assistant.includes('submit the DBMS'));

/* ---------- status, forget ---------- */
let st = arch2.status();
check('status: months, bytes, how many messages, oldest and newest', st.files.length === 2 && st.bytes > 300 && st.messages === 9 && st.oldest === D(2026, 9, 20, 10) && st.newest === D(2026, 10, 9, 8) && st.capBytes === 20 * 1024 * 1024, st);
const fg = arch2.forget();
check('forget: every file and the folder are gone, and it says how many', fg.removed === 2 && fg.bytes > 300 && !fs.existsSync(path.join(dir, '.chat-archive')) && arch2.status().messages === 0 && arch2.search({ text: 'database' }).total === 0, fg);
check('forget: forgetting nothing is fine', arch2.forget().removed === 0);
check('status and search on a folder that never existed are fine', A.createArchive({ dir: path.join(dir, 'nope') }).status().messages === 0 && A.createArchive({ dir: path.join(dir, 'nope') }).search({ text: 'x' }).total === 0);

/* ---------- the size cap ---------- */
const capDir = path.join(dir, 'cap');
let clock2 = D(2026, 10, 9, 10);
const small = A.createArchive({ dir: capDir, now: () => clock2, cap: 700 });
const msg = (t, n) => [{ role: 'user', text: 'question q' + n + ' ' + 'x'.repeat(100), t }, { role: 'assistant', text: 'answer q' + n + ' ' + 'y'.repeat(100), t: t + 1000 }];
small.append(msg(D(2026, 8, 5, 10), 1)); small.append(msg(D(2026, 9, 5, 10), 2)); small.append(msg(D(2026, 10, 5, 10), 3));
check('cap: over the limit, the OLDEST month is deleted first, never the current one', small.files().join() === '2026-09.jsonl,2026-10.jsonl' || small.files().join() === '2026-10.jsonl', small.files());
for (let i = 0; i < 20; i++) small.append(msg(D(2026, 10, 9, 10, i), 10 + i));
check('cap: when only this month is left and it is too big, the oldest part of it goes and the newest stays', small.totalBytes() <= 700 + 400 && small.files().join() === '2026-10.jsonl' && small.search({ text: 'q29' }).total === 1 && small.search({ text: 'q10' }).total === 0, { bytes: small.totalBytes() });

(async () => {
/* ---------- routes ---------- */
const routes = {}; const app = { post: (p, h) => { routes['POST ' + p] = h; }, get: (p, h) => { routes['GET ' + p] = h; } };
const rdir = path.join(dir, 'routes');
const llm = { isCloud: m => String(m).includes('::'), complete: async o => { llm.last = o; return 'On 2 October you chose SQLite.'; } };
A(app, { SANDBOX: dir, llm, DEFAULT_MODEL: 'qwen3.5:4b', dir: rdir });
const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' }, REMOTE = { 'sec-fetch-site': 'same-origin', host: 'my-laptop.tail1234.ts.net' };
const call = async (key, body, headers = LAPTOP) => { let o, code = 200; await routes[key]({ headers, body }, { json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
check('routes: every route is for the laptop page only (another site, another device, no headers: refused, nothing stored)', (await Promise.all([['POST /api/chatarchive/append', { items: seed }], ['POST /api/chatarchive/backfill', { items: seed }], ['GET /api/chatarchive/status'], ['POST /api/chatarchive/search', { text: 'france' }], ['POST /api/chatarchive/forget', { confirm: true }]].flatMap(([k, b]) => [call(k, b, REMOTE), call(k, b, {}), call(k, b, { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' })]))).every(x => x.code === 403) && !fs.existsSync(rdir));
check('routes: append stores, status reports', (await call('POST /api/chatarchive/append', { items: seed })).stored === 8 && (await call('GET /api/chatarchive/status')).messages === 8);
check('routes: backfill is skipped once there is an archive', (await call('POST /api/chatarchive/backfill', { items: seed })).skipped === true);
let sr = await call('POST /api/chatarchive/search', { text: 'what did I decide about the database last week' });
check('routes: search without a summary makes no AI call', sr.success && sr.total === 1 && sr.summary === '' && !llm.last && sr.cloud === false, sr);
sr = await call('POST /api/chatarchive/search', { text: 'what did I decide about the database last week', summarize: true });
check('routes: with a summary the AI sees only the matching excerpts, with dates, and is told to use nothing else', sr.summary === 'On 2 October you chose SQLite.' && /SQLite/.test(llm.last.messages[0].content) && !/France/.test(llm.last.messages[0].content) && /ONLY/.test(llm.last.system) && sr.cloud === false, llm.last && llm.last.messages[0].content);
sr = await call('POST /api/chatarchive/search', { text: 'what did I decide about the database last week', summarize: true, model: 'openai::gpt' });
check('routes: an online model is flagged (the page asks you first)', sr.cloud === true);
check('routes: a summary is not asked for when nothing matched', (llm.last = null, (await call('POST /api/chatarchive/search', { text: 'quantum physics', summarize: true })).summary === '' && llm.last === null));
check('routes: an AI that fails still gives the matches', await (async () => { llm.complete = async () => { throw new Error('down'); }; const x = await call('POST /api/chatarchive/search', { text: 'france', summarize: true }); return x.success && x.total === 1 && x.summary === ''; })());
check('routes: search needs words', (await call('POST /api/chatarchive/search', { text: '  ' })).code === 400 && (await call('POST /api/chatarchive/search', {})).code === 400);
check('routes: forget needs an explicit confirmation, then erases', (await call('POST /api/chatarchive/forget', {})).code === 400 && (await call('POST /api/chatarchive/forget', { confirm: 'yes' })).code === 400 && fs.existsSync(rdir) && (await call('POST /api/chatarchive/forget', { confirm: true })).removed === 2 && !fs.existsSync(rdir));

clearInterval(keep);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`chatarchive: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
