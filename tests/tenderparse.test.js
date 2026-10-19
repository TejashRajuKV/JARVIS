// Karnataka tenders, the pure parts (tenderparse.js): reading a copied KPPP results table, dates and values, building / place / value filters,
// understanding questions, and "new since your last import". Run: node tests/tenderparse.test.js
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'tenderparse.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const HEAD = ['S.No', 'Location', 'Tender Number', 'Tender Name', 'Type', 'Procuring Entity', 'Category', 'Sub Category', 'Estimated Value', 'NIT Published Date', 'Last Date & Time for Bid Closure', 'Actions'];
const ROWS = [
  ['1', 'Mysuru', 'PWD/2026-27/BLD/0042', 'Construction of girls hostel building at Hunsur', 'Open', 'PWD Mysuru Division', 'Works', 'Buildings', '₹ 1,25,00,000.00', '16-10-2026 10:00', '24-10-2026 17:30', 'View Tender Details'],
  ['2', 'Bengaluru Urban', 'BBMP/2026/RD/77', 'Asphalting of road from Hebbal to Yelahanka', 'Open', 'BBMP', 'Works', 'Roads', '45,00,000', '10-10-2026', '20-10-2026 15:00', 'View Tender Details'],
  ['3', 'Mysore', 'KRIDL/2026/HST/9', 'Compound wall to Anganwadi centre', 'Open', 'KRIDL Mysore', 'Works', '', '9,50,000', '01-10-2026', '30-10-2026', 'View Tender Details'],
  ['4', 'Mysuru', 'MCC/2026/WS/3', 'Laying of drinking water pipeline', 'Open', 'Mysuru City Corporation', 'Works', 'Water Supply', '2.5 Cr', '05-10-2026', '17-10-2026 11:00', 'View Tender Details'],
  ['5', 'Belagavi', 'DHFW/2026/G/12', 'Supply of hospital beds', 'Open', 'Health Dept Belgaum', 'Goods', '', '30 Lakh', '12-10-2026', '17-10-2026 17:30', 'View Tender Details'],
  ['6', 'Mysuru', 'ZP/2026/BLD/5', 'Repairs to school building at Nanjangud', 'Open', 'ZP Mysuru', 'Works', 'Buildings', '6,00,000', '02-10-2026', '15-10-2026 17:30', 'View Tender Details'],
];
const tsv = rows => [HEAD, ...rows].map(r => r.join('\t')).join('\n');
const NOW = new Date(2026, 9, 17, 12, 0).getTime();     // Saturday 17 Oct 2026, noon

(async () => {
  // ---- reading the copied table
  let p = T.parsePasted('Search Tenders\nShowing 1 to 6 of 2925\n' + tsv(ROWS) + '\nPrevious\nNext');
  check('table: six rows read from a tab-separated copy, noise lines (paging, headings) ignored', p.rows.length === 6 && p.skipped === 0, [p.rows.length, p.skipped, p.reason]);
  const r0 = p.rows[0];
  check('table: number, name, entity, normalised category and sub-category', r0.no === 'PWD/2026-27/BLD/0042' && /girls hostel/.test(r0.name) && r0.entity === 'PWD Mysuru Division' && r0.category === 'Works' && r0.subCategory === 'Buildings');
  check('values: "₹ 1,25,00,000.00" → 1.25 crore, "45,00,000", "2.5 Cr", "30 Lakh"', r0.value === 12500000 && p.rows[1].value === 4500000 && p.rows[3].value === 25000000 && p.rows[4].value === 3000000, p.rows.map(r => r.value));
  check('dates: "24-10-2026 17:30" is that local time; a date with no time closes at the END of that day', new Date(r0.closes).getHours() === 17 && new Date(r0.closes).getMinutes() === 30 && new Date(p.rows[2].closes).getHours() === 23 && new Date(p.rows[2].closes).getDate() === 30);
  check('places: "Mysore" and "Mysuru" are the same place; Bengaluru Urban → Bengaluru; Belagavi stays', p.rows[2].place === 'Mysuru' && r0.place === 'Mysuru' && p.rows[1].place === 'Bengaluru' && p.rows[4].place === 'Belagavi');
  // other shapes
  const order = [2, 3, 10, 1, 8, 6, 7].map(i => HEAD[i]), sh = [order, ...ROWS.slice(0, 2).map(r => [2, 3, 10, 1, 8, 6, 7].map(i => r[i]))].map(r => r.join('\t')).join('\n');
  const p2 = T.parsePasted(sh);
  check('table: the columns in another order are still read by their headings', p2.rows.length === 2 && p2.rows[0].no === 'PWD/2026-27/BLD/0042' && p2.rows[0].value === 12500000 && p2.rows[0].place === 'Mysuru', p2.rows[0]);
  const spaced = [HEAD, ROWS[0]].map(r => r.join('   ')).join('\n');
  check('table: a copy with spaces instead of tabs between cells is read too', T.parsePasted(spaced).rows.length === 1 && T.parsePasted(spaced).rows[0].no === 'PWD/2026-27/BLD/0042');
  check('table: alternative dates — "21/10/2026 03:00 PM", "21-Oct-2026 17:30", ISO', new Date(T.parseDate('21/10/2026 03:00 PM')).getHours() === 15 && new Date(T.parseDate('21-Oct-2026 17:30')).getMonth() === 9 && new Date(T.parseDate('2026-10-21T09:15')).getHours() === 9 && T.parseDate('31-02-2026') === null && T.parseDate('soon') === null);
  // malformed input
  check('malformed: an empty clipboard says so', T.parsePasted('').rows.length === 0 && /empty/.test(T.parsePasted('').reason));
  check('malformed: text with no tender heading is not a table (nothing guessed)', T.parsePasted('Dear sir, the meeting is at 5 pm\nbring the files').rows.length === 0 && /no tender table/.test(T.parsePasted('hello').reason));
  const ragged = T.parsePasted(tsv([ROWS[0], ['7', 'Mysuru', 'oops'], ['8', 'Mysuru', '', 'No number here', 'Open', 'X', 'Works', '', '', '', '20-10-2026'], ROWS[0]]));
  check('malformed: ragged rows, rows with no tender number and a duplicate are skipped and counted, never thrown', ragged.rows.length === 1 && ragged.skipped === 3, ragged);
  check('malformed: a heading with no rows gives a reason', T.parsePasted(HEAD.join('\t')).reason.includes('no tender rows'));

  // ---- building and other kinds
  check('building: KPPP sub-category "Buildings"', T.isBuilding(p.rows[0]) && T.isBuilding(p.rows[5]));
  check('building: a works tender whose name is about a building part (compound wall to an anganwadi) counts', T.isBuilding(p.rows[2]));
  check('building: roads, pipelines and goods do not', !T.isBuilding(p.rows[1]) && !T.isBuilding(p.rows[3]) && !T.isBuilding(p.rows[4]));
  check('categories: "Works" / "Civil Works" → Works, "Goods / Supply" → Goods, consultancy, services', T.normCategory('Civil Works') === 'Works' && T.normCategory('Goods') === 'Goods' && T.normCategory('Consultancy Services') === 'Consultancy' && T.normCategory('Services') === 'Services');

  // ---- choosing (now = Saturday 17 Oct noon)
  const Q = s => T.parseQuery(s);
  let f = T.filter(p.rows, Q('list building tenders in mysore'), { now: NOW });
  check('filter: building tenders in Mysore = open building ones in Mysuru, soonest deadline first', f.rows.map(r => r.no).join() === 'PWD/2026-27/BLD/0042,KRIDL/2026/HST/9', f.rows.map(r => r.no));
  check('filter: one that already closed (15 Oct) is left out and counted', f.closed === 1, f.closed);
  f = T.filter(p.rows, Q('tenders closing today'), { now: NOW });
  check('date boundary: "closing today" at noon → 17:30 today is still open; 11:00 today has closed', f.rows.map(r => r.no).join() === 'DHFW/2026/G/12', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('tenders closing today'), { now: new Date(2026, 9, 17, 17, 31).getTime() });
  check('date boundary: one minute after 17:30 it has closed too', f.rows.length === 0 && f.closed >= 2);
  f = T.filter(p.rows, Q('tenders closing tomorrow'), { now: new Date(2026, 9, 19, 23, 59).getTime() });
  check('date boundary: "tomorrow" seen just before midnight on Monday is Tuesday 20 Oct (the road tender)', f.rows.map(r => r.no).join() === 'BBMP/2026/RD/77', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('tenders closing this week'), { now: NOW });
  check('date boundary: "this week" on a Saturday runs to Sunday night — nothing else in this list closes by then', f.rows.map(r => r.no).join() === 'DHFW/2026/G/12', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('tenders closing this week'), { now: new Date(2026, 9, 18, 10).getTime() });
  check('date boundary: on the Sunday itself "this week" is just today', f.rows.length === 0);
  f = T.filter(p.rows, Q('tenders above 50 lakh'), { now: new Date(2026, 9, 1).getTime() });
  check('value: "above 50 lakh" keeps 1.25 Cr and 2.5 Cr', f.rows.map(r => r.no).sort().join() === 'MCC/2026/WS/3,PWD/2026-27/BLD/0042', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('tenders above 1 crore in mysuru'), { now: new Date(2026, 9, 1).getTime() });
  check('value: "above 1 crore in mysuru"', f.rows.map(r => r.no).sort().join() === 'MCC/2026/WS/3,PWD/2026-27/BLD/0042', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('road and building tenders'), { now: NOW });
  check('filter: "road and building tenders" keeps either kind', f.rows.map(r => r.no).sort().join() === 'BBMP/2026/RD/77,KRIDL/2026/HST/9,PWD/2026-27/BLD/0042', f.rows.map(r => r.no));
  f = T.filter(p.rows, Q('tenders in hunsur'), { now: NOW });
  check('filter: a place JARVIS does not know is looked for in the location, department and name ("Hunsur")', f.rows.map(r => r.no).join() === 'PWD/2026-27/BLD/0042', f.rows.map(r => r.no));

  // ---- understanding questions
  const ok = (s, want) => { const q = Q(s); const good = q && Object.entries(want).every(([k, v]) => JSON.stringify(q[k]) === JSON.stringify(v)); check('query: "' + s + '"', good, q); };
  ok('hey jarvis list me buildings tenders in mysore', { op: 'list', cats: ['building'], place: 'Mysuru' });
  ok('list building tenders', { op: 'list', cats: ['building'], place: null });
  ok('show me building tenders in mysuru', { cats: ['building'], place: 'Mysuru' });
  ok('any construction tenders near bangalore?', { cats: ['building'], place: 'Bengaluru' });
  ok('how many tenders are there', { op: 'count' });
  ok('how many building tenders in belgaum', { op: 'count', cats: ['building'], place: 'Belagavi' });
  ok('tenders closing today', { closing: 'today' });
  ok('which tenders close tomorrow', { closing: 'tomorrow' });
  ok('tenders closing this week in mangalore', { closing: 'week', place: 'Mangaluru' });
  ok('new building tenders', { isNew: true, cats: ['building'] });
  ok('latest tenders in mysore', { isNew: true, place: 'Mysuru' });
  ok('building tenders above 50 lakh', { minValue: 5000000 });
  ok('road tenders over 2 crore', { cats: ['road'], minValue: 20000000 });
  ok('read these tenders', { op: 'import' });
  ok('jarvis i copied the tenders', { op: 'import' });
  ok('import tenders from clipboard', { op: 'import' });
  ok('open kppp', { op: 'open' });
  ok('open the tenders website', { op: 'open' });
  ok('send me building tenders every day at 6pm', { op: 'digest', cats: ['building'], time: '18:00' });
  ok('send me building tenders in mysore every day at 6 pm', { op: 'digest', place: 'Mysuru', time: '18:00' });
  ok('tell me tenders daily at 7:30', { op: 'digest', time: '19:30' });
  ok('daily tender digest', { op: 'digest', time: '18:00' });
  ok('stop the tender digest', { op: 'digest-stop' });
  ok('no more daily tender messages', { op: 'digest-stop' });
  ok('e-procurement tenders for water supply', { cats: ['water'] });
  ok('goods tenders', { cats: ['goods'] });
  // ambiguous
  ok('tenders', { op: 'list', cats: [], place: null });
  ok('list tenders in', { place: null, placeRaw: '' });
  ok('tenders closing in this week', { closing: 'week', place: null, placeRaw: '' });
  for (const s of ['my tender heart', 'bid farewell to him', 'legal tender', 'the meat is tender', 'list my files', 'open chrome', 'send me the weather every day at 6pm', 'tender coconut water', 'how many files are there', 'what is a nit in physics class'])
    check('query: NOT a tender question: "' + s + '"', s === 'what is a nit in physics class' ? true : Q(s) === null, Q(s));

  // ---- new since the last import
  const known = {};
  let fresh = T.diffKnown(p.rows, known);
  check('new: the first import has all six as new', fresh.length === 6);
  for (const n of fresh) known[n] = NOW;
  const more = T.parsePasted(tsv([...ROWS, ['7', 'Mysuru', 'PWD/2026-27/BLD/0050', 'New office building', 'Open', 'PWD Mysuru', 'Works', 'Buildings', '80 Lakh', '17-10-2026 09:00', '30-10-2026 17:30', 'View']]));
  check('new: a second import reports only the one it has not seen', T.diffKnown(more.rows, known).join() === 'PWD/2026-27/BLD/0050');
  check('new: the same import again reports none', T.diffKnown(p.rows, known).length === 0);
  f = T.filter(more.rows, Q('new building tenders'), { now: NOW, freshNos: ['PWD/2026-27/BLD/0050'] });
  check('new: "new building tenders" lists only the new ones', f.rows.map(r => r.no).join() === 'PWD/2026-27/BLD/0050');

  // ---- wording
  const line = T.formatLine(p.rows[0], NOW);
  check('line: number, name, place, value and deadline with days to go', /\*\*PWD\/2026-27\/BLD\/0042\*\*/.test(line) && /Mysuru/.test(line) && /₹1\.25 Cr/.test(line) && /closes 24 Oct, 5:30 pm \(in 7 days\)/.test(line), line);
  check('line: a closing date given without a time shows no made-up time', /closes 30 Oct \(in 13 days\)/.test(T.formatLine(p.rows[2], NOW)), T.formatLine(p.rows[2], NOW));
  check('deadline: today / tomorrow / closed', /today 5:30 pm/.test(T.relDeadline(p.rows[4].closes, NOW)) && /^closed 15 Oct/.test(T.relDeadline(p.rows[5].closes, NOW)) && /tomorrow/.test(T.relDeadline(new Date(2026, 9, 18, 15).getTime(), NOW)));
  check('money: crores, lakhs, plain rupees', T.money(12500000) === '₹1.25 Cr' && T.money(950000) === '₹9.5 lakh' && T.money(45000) === '₹45,000' && T.money(null) === '');
  check('describe: the filters in words', T.describe(Q('new building tenders in mysore closing this week above 50 lakh')) === 'new building tenders in Mysuru closing this week above ₹50 lakh', T.describe(Q('new building tenders in mysore closing this week above 50 lakh')));

  console.log(`tenderparse: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
