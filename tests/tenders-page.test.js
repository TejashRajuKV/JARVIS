// Karnataka tenders, chat side (tenders-page.js): reading the copied KPPP list, listing and counting, freshness, new-since-last-import, the 6 PM digest
// (one daily reminder), and what the phone may do. Page globals are stubbed; the clipboard and KPPP are fakes. Run: node tests/tenders-page.test.js
'use strict';
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);

// a clock the test controls (NLU.parseWhen and the page both read it)
const RealDate = Date; let NOW = new RealDate(2026, 9, 17, 12, 0).getTime();
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };

const calls = [], said = [], undo = [];
let replies = {}, ids = 0;
const store = (() => { const d = {}; return { get: (k, f) => (k in d ? JSON.parse(JSON.stringify(d[k])) : f), set: (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); }, d }; })();
global.store = store; global.rid = () => 'r' + (++ids); global.Undo = { push: (l, fn) => undo.push([l, fn]) };
global.callTool = async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
global.jarvisSay = m => said.push(m); global.settings = { online: false }; global.reminders = []; global.saveTasks = () => { global.saved = (global.saved || 0) + 1; };
global.fmtDay = t => new RealDate(t).toDateString(); global.fmtTime = t => new RealDate(t).toTimeString().slice(0, 5);
eval(fs.readFileSync(root('nlu.js'), 'utf8') + ';global.NLU = NLU;');
const src = fs.readFileSync(root('script.js'), 'utf8'), fn = name => { const s = src.indexOf('function ' + name + '('); return src.slice(s, src.indexOf('\n}', s) + 2); };
eval(fn('repeatStart') + ';global.repeatStart = repeatStart;');
global.TenderParse = require(root('tenderparse.js'));
const Tenders = require(root('tenders-page.js'));
const S = (t, source) => Tenders.intercept(t, source || 'text');

const HEAD = 'S.No\tLocation\tTender Number\tTender Name\tType\tProcuring Entity\tCategory\tSub Category\tEstimated Value\tNIT Published Date\tLast Date & Time for Bid Closure\tActions';
const ROW = (n, place, no, name, sub, val, pub, closes) => [n, place, no, name, 'Open', 'Dept ' + place, 'Works', sub, val, pub, closes, 'View Tender Details'].join('\t');
const LIST1 = [HEAD,
  ROW(1, 'Mysuru', 'PWD/26/BLD/1', 'Construction of girls hostel building', 'Buildings', '1,25,00,000', '17-10-2026 09:00', '24-10-2026 17:30'),
  ROW(2, 'Mysore', 'PWD/26/BLD/2', 'Repairs to school building', 'Buildings', '6,00,000', '01-10-2026', '20-10-2026 15:00'),
  ROW(3, 'Bengaluru Urban', 'BBMP/26/RD/3', 'Asphalting of road', 'Roads', '45,00,000', '10-10-2026', '22-10-2026 15:00'),
  ROW(4, 'Mysuru', 'PWD/26/BLD/4', 'Anganwadi building at Hunsur', 'Buildings', '20,00,000', '01-10-2026', '15-10-2026 17:30')].join('\n');
const reset = () => { calls.length = 0; said.length = 0; undo.length = 0; replies = {}; };

(async () => {
  // ---- before anything is copied
  let r = await S('list building tenders in mysore');
  check('no list yet: says so plainly, the 3 steps, OPEN KPPP — no made-up tenders', /no copied KPPP list/.test(r.text) && /Ctrl\+A/.test(r.text) && r.actions.some(a => a.label === 'OPEN KPPP') && !/PWD/.test(r.text), r.text);
  check('not a tender sentence → not answered here', (await S('list my files')) === null && (await S('the meat is tender')) === null);

  // ---- reading the copied list
  reset(); replies['/tool/readClipboard'] = { success: true, content: LIST1 };
  r = await S('read these tenders');
  const snap = store.d['jarvis.tenders'];
  check('import: reads the clipboard, saves the list with the time, says how many and how many are building', calls[0][0] === '/tool/readClipboard' && snap && snap.rows.length === 4 && snap.at === NOW && /Read \*\*4 tenders\*\*/.test(r.text) && /3 still open/.test(r.text) && /2 building/.test(r.text), [r.text, snap && snap.rows.length]);
  check('import: every tender number is remembered (not just the ones shown), with when it was first seen', Object.keys(store.d['jarvis.tendersKnown']).length === 4 && store.d['jarvis.tendersKnown']['PWD/26/BLD/1'] === NOW);
  check('import: the first import does not call everything "new"', !/new since/.test(r.text) && undo.length === 1, r.text);
  reset(); replies['/tool/readClipboard'] = { success: true, content: 'Dear sir, please find attached.' };
  r = await S('read these tenders');
  check('import: a clipboard with no KPPP table is refused with the reason and the steps; the saved list is untouched', /could not find a KPPP tender table/.test(r.text) && /Ctrl\+A/.test(r.text) && store.d['jarvis.tenders'].rows.length === 4, r.text);
  reset(); r = await S('read these tenders', 'phone');
  check('import: from the phone it is refused (it needs the laptop clipboard) and nothing is read', !calls.length && /laptop/.test(r.text));

  // ---- listing and counting
  reset(); r = await S('hey jarvis list me buildings tenders in mysore');
  check('list: the open building tenders in Mysuru, soonest deadline first, with the list age', /\*\*2 open building tenders in Mysuru\*\*/.test(r.text) && r.text.indexOf('PWD/26/BLD/2') < r.text.indexOf('PWD/26/BLD/1') && /copied just now/.test(r.text), r.text);
  check('list: a closed one is left out and counted; no freshness warning for a fresh list', !/BLD\/4\*\*/.test(r.text) && /1 matching tender in the list has already closed/.test(r.text) && !/may have been/.test(r.text), r.text);
  check('list: "published in the last 24 hours" only from the NIT Published Date (the hostel, published today 9:00)', /1 was published on KPPP in the last 24 hours/.test(r.text), r.text);
  check('list: OPEN KPPP and READ COPIED LIST buttons; the link is the search page + the number', r.actions.some(a => a.label === 'OPEN KPPP') && r.actions.some(a => a.label === 'READ COPIED LIST') && /search by its tender number/.test(r.text));
  r = await S('how many tenders are there'); check('count: 3 open in the copied list (1 more closed), with the list since it is short', /\*\*3\*\* open tenders/.test(r.text) && /1 more already closed/.test(r.text), r.text);
  r = await S('tenders closing this week'); check('this week (Saturday): nothing in this list closes by Sunday night', /No open tenders closing this week/.test(r.text), r.text);
  r = await S('road tenders in bangalore'); check('road tenders in Bangalore → the BBMP one', /1 open road tender in Bengaluru/.test(r.text) && /BBMP\/26\/RD\/3/.test(r.text), r.text);

  // ---- the KPPP total (public) only when Online is on
  reset(); replies['/tenders/count'] = { success: true, available: true, live: 2925 };
  r = await S('list building tenders'); check('total: with Online off, KPPP is not asked', !calls.some(c => c[0] === '/tenders/count') && !/2,925/.test(r.text));
  settings.online = true; reset(); replies['/tenders/count'] = { success: true, available: true, live: 2925 };
  r = await S('list building tenders'); check('total: with Online on, the public total is added and labelled as the total of every category', /2,925/.test(r.text) && /only the total is public/.test(r.text), r.text);
  reset(); replies['/tenders/count'] = { success: true, available: false, why: 'unreachable' };
  r = await S('list building tenders'); check('total: when KPPP cannot be reached the list still comes, with no total', /open building tenders/.test(r.text) && !/live tenders in all/.test(r.text)); settings.online = false;

  // ---- new since the last import, repeated imports
  NOW += 3600e3; reset();
  replies['/tool/readClipboard'] = { success: true, content: LIST1 + '\n' + ROW(5, 'Mysuru', 'PWD/26/BLD/5', 'Office building for taluk panchayat', 'Buildings', '80,00,000', '16-10-2026', '29-10-2026 17:30') };
  r = await S('read these tenders');
  check('second import: exactly one new since the last import', /1 new since your last import/.test(r.text) && JSON.stringify(store.d['jarvis.tenders'].freshNos) === '["PWD/26/BLD/5"]', r.text);
  r = await S('new building tenders'); check('"new building tenders" lists only the new one, marked 🆕, with the note that it is new to JARVIS', /\*\*1 open new building tender\*\*/.test(r.text) && /🆕 \*\*PWD\/26\/BLD\/5/.test(r.text) && /not necessarily newly published/.test(r.text), r.text);
  { const same = replies['/tool/readClipboard']; reset(); replies['/tool/readClipboard'] = same; } r = await S('read these tenders'); check('the same copy again: nothing new', /0 new since your last import/.test(r.text) && store.d['jarvis.tenders'].freshNos.length === 0, r.text);
  undo[0][1](); check('undo of an import puts the earlier list back', store.d['jarvis.tenders'].freshNos.length === 1);

  // ---- freshness
  NOW += 13 * 3600e3; reset();
  r = await S('list building tenders in mysore');
  check('stale (13 h): the list still comes, marked with its age, AND a separate warning to copy a fresh one', /open building tenders in Mysuru/.test(r.text) && /may have been added or closed since/.test(r.text) && /Ctrl\+A/.test(r.text), r.text);
  const fr = Tenders.freshness(store.d['jarvis.tenders'], NOW), fr0 = Tenders.freshness(store.d['jarvis.tenders'], store.d['jarvis.tenders'].at + 3600e3), frNone = Tenders.freshness(null, NOW);
  check('freshness: null when fresh, a warning when 12+ hours old, the steps when there is no list', fr0 === null && /may have been added/.test(fr) && /no copied KPPP list/.test(frNone));

  // ---- the 6 PM digest
  NOW = new RealDate(2026, 9, 18, 15, 0).getTime(); reset(); global.reminders = [];
  r = await S('send me building tenders in mysore every day at 6pm');
  let d = reminders.filter(x => x.kind === 'tenders');
  check('digest: one daily reminder at 18:00, kind tenders, with the filters', d.length === 1 && d[0].repeat && new RealDate(d[0].at).getHours() === 18 && d[0].tenderQuery.place === 'Mysuru' && d[0].tenderQuery.cats.join() === 'building' && /every day at \*\*6pm\*\*/i.test(r.text), [d.length, !!d[0].repeat, new RealDate(d[0].at).getHours(), d[0].tenderQuery.place, d[0].tenderQuery.cats.join(), r.text.slice(0, 60)]);
  check('digest: before 6 PM the first one is today', new RealDate(d[0].at).getDate() === 18);
  NOW = new RealDate(2026, 9, 18, 19, 0).getTime();
  r = await S('daily tender digest at 6pm');
  d = reminders.filter(x => x.kind === 'tenders');
  check('digest: setting it again replaces it (still one); after 6 PM the first one is tomorrow', d.length === 1 && new RealDate(d[0].at).getDate() === 19 && d[0].tenderQuery.cats.join() === 'building', d);
  const rem = d[0]; NOW = new RealDate(2026, 9, 19, 18, 0).getTime();
  let dg = Tenders.buildDigest({ kind: 'tenders', tenderQuery: { cats: ['building'], place: 'Mysuru' } }, NOW);
  check('digest: two outputs — the report from the copied list (with its age) and, because it is old, the freshness reminder', /open building tenders in Mysuru/.test(dg.report) && /copied/.test(dg.report) && /may have been added/.test(dg.freshness), dg);
  check('digest: never lists a closed tender as open (the 20 Oct one closed? no — 19 Oct 18:00: it is still open; the 15 Oct one is left out)', !/BLD\/4\*\*/.test(dg.report), dg.report);
  said.length = 0; Tenders.digest(rem);
  check('digest: when it fires, it says the report and then the freshness reminder with OPEN KPPP', said.length === 2 && /tender digest/.test(said[0].text) && said[1].actions.some(a => a.label === 'OPEN KPPP'), said.map(s => s.text.slice(0, 60)));
  store.d['jarvis.tenders'] = undefined; delete store.d['jarvis.tenders']; said.length = 0;
  dg = Tenders.digest(rem); check('digest: with no list it says only how to copy one (no empty report)', dg.report === null && said.length === 1 && /no copied KPPP list/.test(said[0].text));
  undo.length = 0; r = await S('stop the tender digest');
  check('digest: stopped, one undo brings it back', !reminders.some(x => x.kind === 'tenders') && undo.length === 1 && /Stopped/.test(r.text)); undo[0][1](); check('digest: undo', reminders.filter(x => x.kind === 'tenders').length === 1);
  reminders.length = 0; r = await S('stop the tender digest'); check('digest: stopping when there is none says so', /no tender digest/.test(r.text));

  // ---- open KPPP
  reset(); r = await S('open kppp');
  check('open: the live tender search page, then the steps', calls[0][0] === '/tool/openUrl' && calls[0][1].url === 'https://kppp.karnataka.gov.in/#/portal/searchTender/live' && /CAPTCHA/.test(r.text));
  reset(); r = await S('open kppp', 'phone'); check('open: from the phone it gives the address instead of opening it on the laptop', !calls.length && /kppp\.karnataka\.gov\.in/.test(r.text));

  global.Date = RealDate;
  console.log(`tenders-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { global.Date = RealDate; console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
