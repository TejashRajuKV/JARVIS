// CSV analysis (csvtools.js): parsing, column statistics, the safe filter language, group-by, charts, the AI digest, the routes.
// Run: node tests/csvtools.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const C = require(path.join(__dirname, '..', 'csvtools.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

const MARKS = 'name,dept,marks,attendance,email\nAsha,CSE,82,91,asha@x.com\nBen,CSE,67,78,ben@x.com\nChitra,ECE,45,60,chitra@x.com\nDev,ECE,91,95,dev@x.com\nEsha,ME,58,72,esha@x.com\nFarid,ME,,80,farid@x.com\nGita,CSE,73,85,gita@x.com\nHari,ECE,39,55,hari@x.com\n';

/* ---------- parsing ---------- */
{
  let d = C.parseCSV(MARKS);
  check('parse: header, rows, delimiter', d.header.join() === 'name,dept,marks,attendance,email' && d.rows.length === 8 && d.delimiter === ',' && d.ragged === 0 && !d.truncated, d);
  d = C.parseCSV('a,b\n"x, y","say ""hi"""\n"line1\nline2",3\n');
  check('parse: quoted commas, doubled quotes and line breaks inside quotes', d.rows[0][0] === 'x, y' && d.rows[0][1] === 'say "hi"' && d.rows[1][0] === 'line1\nline2' && d.rows.length === 2, d.rows);
  check('parse: Windows and old-Mac line endings, a BOM, trailing blank lines', C.parseCSV('\uFEFFa,b\r\n1,2\r\n3,4\r\n\r\n\r\n').rows.length === 2 && C.parseCSV('a,b\r1,2\r3,4').rows.length === 2 && C.parseCSV('\uFEFFa,b\n1,2').header[0] === 'a');
  check('parse: a quote in the middle of a field is just a quote', C.parseCSV('a,b\n5" pipe,2').rows[0][0] === '5" pipe');
  check('parse: semicolon, tab and pipe files are recognised', C.parseCSV('a;b;c\n1;2;3\n4;5;6').delimiter === ';' && C.parseCSV('a\tb\n1\t2').delimiter === '\t' && C.parseCSV('a|b\n1|2').delimiter === '|' && C.parseCSV('a,b;c\n1,2;3').delimiter === ',');
  check('parse: a comma inside quotes does not make a comma file', C.parseCSV('"a,b";c\n"1,2";3\n"4,5";6').delimiter === ';');
  d = C.parseCSV('a,b,c\n1,2\n1,2,3,4\n5,6,7');
  check('parse: short rows are padded, long rows cut, and counted', d.ragged === 2 && d.rows[0].join('|') === '1|2|' && d.rows[1].join('|') === '1|2|3', d);
  d = C.parseCSV('Name,,name,NAME,\n1,2,3,4,5');
  check('parse: blank and repeated headers get unique names', d.header.join('|') === 'Name|Column 2|name_2|NAME_3|Column 5', d.header);
  check('parse: refused with a plain reason', throws(() => C.parseCSV(''), /empty/) && throws(() => C.parseCSV('   \n  '), /empty/) && throws(() => C.parseCSV('a,b,c'), /header row and at least one/) && throws(() => C.parseCSV('abc\u0000def,x\n1,2'), /doesn’t look like a text/) && throws(() => C.parseCSV(null), /empty/));
  const big = 'a,b\n' + Array.from({ length: C.MAX_ROWS + 50 }, (_, i) => i + ',x').join('\n');
  d = C.parseCSV(big);
  check('parse: more than 100,000 rows are cut and flagged', d.rows.length === C.MAX_ROWS && d.truncated === true);
  d = C.parseCSV(Array.from({ length: 250 }, (_, i) => 'c' + i).join(',') + '\n' + Array.from({ length: 250 }, (_, i) => i).join(','));
  check('parse: more than 200 columns are cut and flagged', d.header.length === C.MAX_COLS && d.truncated && d.rows[0].length === C.MAX_COLS);
}

/* ---------- numbers, missing values, types ---------- */
{
  const n = C.toNumber;
  check('number: plain, signed, decimal, exponent', n('42') === 42 && n(' -3.5 ') === -3.5 && n('.5') === 0.5 && n('1e3') === 1000 && n('+7') === 7);
  check('number: percent, currency, thousands separators', n('85%') === 85 && n('₹1,234.50') === 1234.5 && n('$ 20') === 20 && n('1,234,567') === 1234567);
  check('number: not numbers', Number.isNaN(n('abc')) && Number.isNaN(n('')) && Number.isNaN(n('1,2')) && Number.isNaN(n('12abc')) && Number.isNaN(n('1.2.3')) && Number.isNaN(n('--5')) && Number.isNaN(n('0x1f')));
  check('missing: the usual spellings', ['', ' ', 'NA', 'n/a', 'NaN', 'null', 'None', '-', '--', '?', 'nil'].every(C.isMissing) && !['0', 'no', 'x'].some(C.isMissing));
  const cols = C.typeColumns(C.parseCSV(MARKS));
  check('types: text, number (with a gap), number', cols.map(c => c.type).join() === 'text,text,number,number,text', cols.map(c => c.type));
  const mixed = C.typeColumns(C.parseCSV('a,b,c\n1,x,2024-01-02\n2,y,2024-02-03\n3,z,2024-03-04\n4,w,2024-04-05\n5,v,2024-05-06\n6,u,2024-06-07\n7,t,2024-07-08\n8,s,2024-08-09\n9,r,2024-09-10\nten,q,not a date'));
  check('types: 90% numbers is a number column; ISO dates are dates', mixed[0].type === 'number' && mixed[1].type === 'text' && mixed[2].type === 'date', mixed.map(c => c.type));
  check('types: mostly text with some numbers stays text', C.typeColumns(C.parseCSV('a\n1\nx\ny\n2\nz'))[0].type === 'text');
}

/* ---------- column statistics ---------- */
{
  const data = C.parseCSV(MARKS), cols = C.typeColumns(data);
  const m = C.profileColumn(data, cols[2]);
  check('stats: marks — count, missing, min, max, mean, median, sum', m.count === 7 && m.missing === 1 && m.min === 39 && m.max === 91 && m.mean === 65 && m.median === 67 && m.sum === 455 && m.unique === 7, m);
  const five = C.parseCSV('x\n10\n20\n30\n40\n50'), p5 = C.profileColumn(five, C.typeColumns(five)[0]);
  check('stats: spread (sample std), quartiles', p5.std === 15.8114 && p5.q1 === 20 && p5.q3 === 40 && p5.outliers === 0, p5);
  const out = C.parseCSV('x\n10\n11\n12\n13\n14\n1000'), po = C.profileColumn(out, C.typeColumns(out)[0]);
  check('stats: an extreme value is counted as an outlier', po.outliers === 1 && po.max === 1000, po);
  const one = C.parseCSV('x\n5'), p1 = C.profileColumn(one, C.typeColumns(one)[0]);
  check('stats: one value does not divide by zero', p1.std === 0 && p1.mean === 5 && p1.median === 5);
  const bad = C.parseCSV('x\n1\n2\n3\n4\n5\n6\n7\n8\n9\nabc'), pb = C.profileColumn(bad, C.typeColumns(bad)[0]);
  check('stats: a stray non-number in a number column is counted, not averaged', pb.invalid === 1 && pb.mean === 5 && pb.count === 10, pb);
  const t = C.profileColumn(data, cols[1]);
  check('stats: text column — distinct values, most common first, flagged as categories', t.unique === 3 && t.top[0].value === 'CSE' && t.top[0].count === 3 && t.top.length === 3 && t.categorical === true, t);
  check('stats: names / emails (all different) are not categories', C.profileColumn(data, cols[0]).categorical === false && C.profileColumn(data, cols[4]).categorical === false);
  const dt = C.parseCSV('d\n2024-03-01\n2024-01-15\n2024-02-10'), pd = C.profileColumn(dt, C.typeColumns(dt)[0]);
  check('stats: dates — first and last', pd.type === 'date' && pd.min === '2024-01-15' && pd.max === '2024-03-01', pd);
  check('stats: quantiles', C.quantile([1, 2, 3, 4], 0.5) === 2.5 && C.quantile([7], 0.9) === 7 && Number.isNaN(C.quantile([], 0.5)));
}

/* ---------- relationships ---------- */
{
  check('correlation: perfect, negative, none, too few, constant', C.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) > 0.9999 && C.pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]) < -0.9999 && Math.abs(C.pearson([1, 2, 3, 4, 5, 6], [1, -1, 1, -1, 1, -1])) < 0.5 && C.pearson([1, 2], [3, 4]) === null && C.pearson([1, 2, 3, 4, 5], [7, 7, 7, 7, 7]) === null);
  const data = C.parseCSV(MARKS), r = C.analyze(data);
  check('correlation: marks and attendance move together (strong, ranked, with the direction)', r.correlations.length === 1 && r.correlations[0].a === 'marks' && r.correlations[0].b === 'attendance' && r.correlations[0].r > 0.8 && r.correlations[0].strength === 'strong' && r.correlations[0].direction === 'rise together' && r.correlations[0].n === 7, r.correlations);
  const mixed = C.parseCSV('a,b,c\n1,5,1\n2,4,9\n3,3,2\n4,2,8\n5,1,3\n6,0,7');
  const cs = C.analyze(mixed).correlations;
  check('correlation: only |r| ≥ 0.3, strongest first', cs[0].a === 'a' && cs[0].b === 'b' && cs[0].r === -1 && cs[0].direction === 'move in opposite directions' && cs.every((c, i) => !i || Math.abs(cs[i - 1].r) >= Math.abs(c.r)), cs);
}

/* ---------- the overall report ---------- */
{
  const r = C.analyze(C.parseCSV(MARKS));
  check('report: rows, columns, a profile per column', r.rows === 8 && r.cols === 5 && r.columns.length === 5 && r.columns[2].mean === 65 && r.duplicates === 0);
  const messy = C.parseCSV('a,b,c\n1,x,\n1,x,\n2,y,\n3,z,\n4,w,\n5,v,9\n6,u\n7,t,\n8,s,\n100000,r,\n');
  const notes = C.analyze(messy).notes.join(' ');
  check('report: notes for gaps, duplicates, odd rows and outliers', /duplicate row/.test(notes) && /“c” is empty in/.test(notes) && /different number of columns/.test(notes) && /unusually high or low/.test(notes), notes);
  const dup = C.analyze(C.parseCSV('a,b\n1,2\n1,2\n1,2'));
  check('report: duplicates counted', dup.duplicates === 2);
}

/* ---------- what the AI is given ---------- */
{
  const data = C.parseCSV('student,dept,marks,email,city\nSECRETNAME-1,CSE,80,s1@x.com,Mysuru\nSECRETNAME-2,CSE,70,s2@x.com,Mysuru\nSECRETNAME-3,ECE,60,s3@x.com,Hubli\nSECRETNAME-4,ECE,50,s4@x.com,Hubli\nSECRETNAME-5,ME,90,s5@x.com,Mysuru\nSECRETNAME-6,ME,40,s6@x.com,Hubli\nSECRETNAME-7,CSE,55,s7@x.com,Mysuru\nSECRETNAME-8,CSE,65,s8@x.com,Hubli\n');
  const rep = C.analyze(data), dg = C.digest(rep, 'results.csv');
  check('digest: column names, types and numbers are there', /results\.csv — 8 rows × 5 columns/.test(dg) && /- marks \(number\): 8 filled, 8 distinct; min 40, median 62\.5/.test(dg) && /mean 63\.75/.test(dg) && /- dept \(text\).*most common: CSE \(4\)/.test(dg), dg);
  check('digest: NO row values — not the names, not the emails', !/SECRETNAME/.test(dg) && !/@x\.com/.test(dg) && !/s1@/.test(dg), dg);
  const emailish = C.parseCSV('k,v\n' + Array.from({ length: 12 }, (_, i) => (i % 2 ? 'a@b.com' : 'c@d.com') + ',' + i).join('\n'));
  check('digest: even a few repeated values are left out if they look like emails', !/@/.test(C.digest(C.analyze(emailish), 'x.csv')));
  const wide = C.parseCSV(Array.from({ length: 60 }, (_, i) => 'column_number_' + i).join(',') + '\n' + Array.from({ length: 60 }, (_, i) => i * 1000.123456).join(','));
  const dw = C.digest(C.analyze(wide), 'wide.csv');
  const shownCols = (dw.match(/^- column_number_/gm) || []).length, leftOut = +((dw.match(/\((\d+) more columns not shown\)/) || [])[1] || 0);
  check('digest: stays under 3800 characters and says exactly how many columns were left out', dw.length <= 3800 && leftOut > 0 && shownCols + leftOut === 60 && shownCols >= 20, { len: dw.length, shownCols, leftOut });
  check('digest: nothing is cut in the middle of a line', dw.split('\n').filter(l => l.startsWith('- ')).every(l => /distinct/.test(l)));
}

/* ---------- the filter language ---------- */
{
  const data = C.parseCSV(MARKS), cols = C.typeColumns(data);
  const f = (src) => data.rows.filter(C.compileFilter(src, cols)).map(r => r[0]).join(',');
  check('filter: numbers', f('marks > 80') === 'Asha,Dev' && f('marks >= 82') === 'Asha,Dev' && f('marks < 45') === 'Hari' && f('marks <= 45') === 'Chitra,Hari' && f('marks = 58') === 'Esha' && f('marks == 58') === 'Esha' && f('marks != 58') === 'Asha,Ben,Chitra,Dev,Farid,Gita,Hari');
  check('filter: a missing value is never greater or less than anything', !f('marks > 0').includes('Farid') && !f('marks < 1000').includes('Farid') && f('marks != 58').includes('Farid'));
  check('filter: text is compared ignoring case', f('dept = cse') === 'Asha,Ben,Gita' && f('dept = "CSE"') === 'Asha,Ben,Gita' && f("dept = 'Ece'") === 'Chitra,Dev,Hari' && f('dept != CSE').split(',').length === 5);
  check('filter: and, or, not and their symbols', f('dept = CSE and marks > 70') === 'Asha,Gita' && f('dept = ME or marks > 90') === 'Dev,Esha,Farid' && f('not dept = CSE') === 'Chitra,Dev,Esha,Farid,Hari' && f('dept = CSE && marks > 70') === 'Asha,Gita' && f('dept = ME || marks > 90') === 'Dev,Esha,Farid' && f('!(dept = CSE)') === 'Chitra,Dev,Esha,Farid,Hari');
  check('filter: and binds tighter than or; brackets change that', f('dept = ME or dept = CSE and marks > 80') === 'Asha,Esha,Farid' && f('(dept = ME or dept = CSE) and marks > 80') === 'Asha');
  check('filter: in (list), between, contains, starts with, ends with', f('dept in (CSE, ME)') === 'Asha,Ben,Esha,Farid,Gita' && f('marks in (82, 91)') === 'Asha,Dev' && f('marks between 40 and 60') === 'Chitra,Esha' && f('name contains "a"') === 'Asha,Chitra,Esha,Farid,Gita,Hari' && f('name starts with b') === 'Ben' && f('email ends with x.com').split(',').length === 8);
  check('filter: is empty / is not empty / is missing', f('marks is empty') === 'Farid' && f('marks is missing') === 'Farid' && f('marks is not empty').split(',').length === 7);
  check('filter: column names ignore case, spaces and underscores', f('MARKS > 90') === 'Dev' && C.compileFilter('total marks > 1', C.typeColumns(C.parseCSV('Total_Marks\n5'))) !== null && C.parseCSV('Total Marks\n5').rows.filter(C.compileFilter('"total marks" > 1', C.typeColumns(C.parseCSV('Total Marks\n5')))).length === 1);
  const dated = C.parseCSV('d,v\n2024-01-05,1\n2024-03-10,2\n2024-06-20,3'), dc = C.typeColumns(dated);
  check('filter: dates work without quotes (they compare as text, which sorts correctly)', dated.rows.filter(C.compileFilter('d > 2024-02-01', dc)).length === 2 && dated.rows.filter(C.compileFilter('d >= "2024-03-10" and v < 3', dc)).length === 1);
  check('filter: a number written as text in a text column is still compared as text', C.parseCSV('code\n007\n7\nA7').rows.filter(C.compileFilter('code = 7', C.typeColumns(C.parseCSV('code\n007\n7\nA7')))).length === 1);
  // errors in plain English
  check('filter: unknown column lists the real ones', throws(() => C.compileFilter('mark > 5', cols), /no column “mark”.*name, dept, marks, attendance, email/));
  check('filter: unclosed quote, bracket, list', throws(() => C.compileFilter('dept = "CSE', cols), /quote is not closed/) && throws(() => C.compileFilter('(marks > 5', cols), /bracket is not closed/) && throws(() => C.compileFilter('dept in (CSE, ME', cols), /bracket is not closed/) && throws(() => C.compileFilter('dept in CSE', cols), /brackets/));
  check('filter: empty, incomplete, junk after, odd characters', throws(() => C.compileFilter('', cols), /empty/) && throws(() => C.compileFilter('marks >', cols), /value is missing/) && throws(() => C.compileFilter('marks', cols), /compared with/) && throws(() => C.compileFilter('marks > 5 6', cols), /didn’t understand “6”/) && throws(() => C.compileFilter('marks > 5 ;', cols), /“;”/) && throws(() => C.compileFilter('marks ~ 5', cols), /“~”/) && throws(() => C.compileFilter('marks between 1 or 5', cols), /marks between 40 and 60/) && throws(() => C.compileFilter('marks is cheese', cols), /empty” or “missing/));
  // nothing is ever executed
  global.__pwned = false;
  for (const evil of ['marks > 1; global.__pwned = true', 'marks > (global.__pwned = true)', 'constructor', '__proto__ = 1', 'marks > process.exit(1)', 'require("fs")', 'name = `${global.__pwned=true}`', 'marks > 1 && eval("global.__pwned=true")', '(function(){global.__pwned=true})()', 'dept in (constructor)', 'toString > 1']) {
    let ran; try { ran = data.rows.filter(C.compileFilter(evil, cols)).length; } catch { ran = 'error'; }
    check('filter: hostile input is data or an error, never code: ' + evil.slice(0, 40), global.__pwned === false && (ran === 'error' || typeof ran === 'number'), ran);
  }
  check('filter: the source has no eval / Function / require of user text', !/\beval\s*\(|new Function|\bFunction\s*\(|vm\.run/.test(fs.readFileSync(path.join(__dirname, '..', 'csvtools.js'), 'utf8')));
}

/* ---------- questions ---------- */
{
  const data = C.parseCSV(MARKS), cols = C.typeColumns(data), q = o => C.runQuery(data, cols, o);
  let r = q({ groupBy: 'dept' });
  check('query: rows per group', r.kind === 'groups' && r.agg === 'count' && r.groups.map(g => g.group + ':' + g.value).join() === 'CSE:3,ECE:3,ME:2' && r.total === 8 && r.groupCount === 3, r);
  r = q({ groupBy: 'dept', column: 'marks' });
  check('query: average marks by department (a missing mark is left out, not counted as 0)', r.agg === 'mean' && r.groups.map(g => g.group + ':' + g.value).join() === 'CSE:74,ECE:58.3333,ME:58', r.groups);
  r = q({ groupBy: 'dept', column: 'marks', agg: 'max' }); check('query: max by group', r.groups[0].group === 'ECE' && r.groups[0].value === 91);
  r = q({ groupBy: 'dept', column: 'marks', agg: 'sum', filter: 'attendance > 75' });
  check('query: a filter applies before grouping', r.matched === 5 && r.groups.map(g => g.group + ':' + g.value).join() === 'CSE:222,ECE:91', r);
  r = q({ groupBy: 'dept', column: 'name', agg: 'unique' }); check('query: distinct values per group', r.groups[0].value === 3);
  r = q({ column: 'marks', agg: 'mean' }); check('query: one statistic', r.kind === 'stat' && r.value === 65 && r.used === 7 && r.column === 'marks', r);
  r = q({ column: 'marks', agg: 'median', filter: 'dept = ECE' }); check('query: statistic of a filtered part', r.value === 45 && r.matched === 3);
  r = q({ column: 'dept', agg: 'count' }); check('query: counting a text column works', r.value === 8);
  r = q({ column: 'dept', agg: 'unique' }); check('query: distinct values of a text column', r.value === 3);
  r = q({ filter: 'marks > 60', limit: 2 });
  check('query: matching rows, limited, with how many more', r.kind === 'rows' && r.rows.length === 2 && r.matched === 4 && r.more === 2 && r.columns.length === 5, r);
  r = q({ filter: 'marks > 1000' }); check('query: nothing matches is a normal answer', r.matched === 0 && r.rows.length === 0 && r.more === 0);
  r = q({ column: 'marks', agg: 'mean', filter: 'marks > 1000' }); check('query: a statistic of nothing is null, not NaN', r.value === null);
  check('query: refused with reasons', throws(() => q({ column: 'dept', agg: 'mean' }), /isn’t a number column/) && throws(() => q({ groupBy: 'dept', agg: 'mean' }), /needs a number column/) && throws(() => q({ column: 'marks', agg: 'average' }), /count, sum, mean/) && throws(() => q({ groupBy: 'nope' }), /no column to group by “nope”/) && throws(() => q({ column: 'nope', agg: 'sum' }), /no column “nope”/) && throws(() => q({ groupBy: 'dept', agg: 'unique' }), /Distinct values of which column/));
  check('query: column names are found loosely', C.findCol(cols, 'MARKS').name === 'marks' && C.findCol(cols, 'att').name === 'attendance' && C.findCol(cols, 'at') === undefined);
  check('query: limit is kept between 1 and 50', q({ limit: 9999 }).rows.length === 8 && q({ limit: -5 }).rows.length >= 1);
  const many = C.parseCSV('k,v\n' + Array.from({ length: 100 }, (_, i) => 'g' + i + ',' + i).join('\n'));
  const big = C.runQuery(many, C.typeColumns(many), { groupBy: 'k', column: 'v', agg: 'sum' });
  check('query: groups are capped at 30 but the total is reported', big.groups.length === 30 && big.groupCount === 100 && big.groups[0].value === 99);
}

/* ---------- charts ---------- */
{
  const evil = '<script>alert(1)</script>';
  const bar = C.barChartSvg({ title: evil + ' & "quotes"', items: [{ label: evil, value: 5 }, { label: `a'b"c&d<e>`, value: 10 }], valueLabel: '<b>x</b>' });
  check('bar chart: a valid SVG with a title', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 760 \d+"/.test(bar) && bar.endsWith('</svg>') && /<title>/.test(bar));
  check('bar chart: every piece of text is escaped (no script, no raw tags)', !/<script|<b>|alert\(1\)<\//.test(bar) && /&lt;script&gt;/.test(bar) && /a&#39;b&quot;c&amp;d&lt;e&gt;/.test(bar));
  check('bar chart: the longest bar is the biggest value', (bar.match(/<rect x="190" y="\d+" width="(\d+)"/g) || []).length === 2);
  const many = C.barChartSvg({ title: 't', items: Array.from({ length: 40 }, (_, i) => ({ label: 'l' + i, value: i })) });
  check('bar chart: at most 15 bars', (many.match(/<rect x="190"/g) || []).length === 15);
  check('bar chart: no data and negative / zero values do not break it', C.barChartSvg({ title: 't', items: [] }).includes('</svg>') && C.barChartSvg({ title: 't', items: [{ label: 'a', value: 0 }, { label: 'b', value: -3 }] }).includes('</svg>') && !/NaN|Infinity/.test(C.barChartSvg({ title: 't', items: [{ label: 'a', value: 0 }] })));
  const vals = [1, 2, 2, 3, 3, 3, 4, 4, 5, 10];
  const h = C.histogramSvg({ title: 'Marks', values: vals });
  const counts = [...h.matchAll(/font-size="10"[^>]*>(\d+)<\/text>/g)].map(m => +m[1]);
  check('histogram: the bar counts add up to the number of values', counts.reduce((s, x) => s + x, 0) === vals.length && /10 values/.test(h), counts);
  check('histogram: identical values and a single value still draw', C.histogramSvg({ title: 't', values: [5, 5, 5, 5] }).includes('</svg>') && C.histogramSvg({ title: 't', values: [5] }).includes('</svg>') && !/NaN/.test(C.histogramSvg({ title: 't', values: [5, 5] })));
  check('histogram: nothing to draw → a clear error; NaN / missing values are skipped', throws(() => C.histogramSvg({ title: 't', values: [] }), /no numbers/) && throws(() => C.histogramSvg({ title: 't', values: [NaN] }), /no numbers/) && /2 values/.test(C.histogramSvg({ title: 't', values: [1, NaN, 2] })));
  check('chart text escaping helper', C.xml('<&>"\'') === '&lt;&amp;&gt;&quot;&#39;');
}

/* ---------- reading files + the routes ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-'));
{
  const f = path.join(tmp, 'marks.csv'); fs.writeFileSync(f, MARKS);
  const a = C.loadFile(f), b = C.loadFile(f);
  check('file: read once and kept for the next question', a === b);
  fs.writeFileSync(f, MARKS + 'Zed,ME,10,50,z@x.com\n');
  check('file: a changed file is read again', C.loadFile(f).data.rows.length === 9);
  check('file: a folder is refused', throws(() => C.loadFile(tmp), /folder, not a file/));
  const huge = path.join(tmp, 'huge.csv'); fs.writeFileSync(huge, Buffer.alloc(C.MAX_BYTES + 1, 97));
  let status; try { C.loadFile(huge); } catch (e) { status = e.status; }
  check('file: over 10 MB is refused (413), without reading it', status === 413);
  fs.writeFileSync(f, MARKS);
}
{
  const safeDir = path.join(tmp, 'allowed'); fs.mkdirSync(safeDir);
  fs.writeFileSync(path.join(safeDir, 'marks.csv'), MARKS); fs.writeFileSync(path.join(safeDir, 'bad.csv'), 'only a header');
  const opened = [], routes = {};
  const app = { post: (p, h) => { routes[p] = h; } };
  const findAllowed = n => { const b = path.basename(String(n)); const p = path.join(safeDir, b); return !/[\\/]/.test(String(n)) && fs.existsSync(p) ? p : null; };
  const anyPath = n => (/blocked/.test(n) ? null : path.resolve(n));
  C(app, { findAllowed, anyPath, openPath: p => opened.push(p), rel: p => path.relative(tmp, p).split(path.sep).join('/'), SANDBOX: tmp });
  const call = async (p, body) => { let out, code = 200; await routes[p]({ body }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
  let r = await0(call('/api/csv/analyze', { name: 'marks.csv' }));
  r.then(async res => {
    check('route analyze: a full report with a digest and no rows', res.code === 200 && res.success && res.rows === 8 && res.cols === 5 && res.name === 'marks.csv' && /8 rows × 5 columns/.test(res.digest) && !/Asha/.test(JSON.stringify(res.digest)) && res.columns[2].mean === 65, res);
    check('route analyze: a file that is not there is a 404 that says where I looked', (await call('/api/csv/analyze', { name: 'nope.csv' })).code === 404 && /~\/jarvis or your project folders/.test((await call('/api/csv/analyze', { name: 'nope.csv' })).error));
    check('route analyze: a path out of the allowed folders is just "not found"', (await call('/api/csv/analyze', { name: '../../windows/system32/config' })).code === 404 && (await call('/api/csv/analyze', { name: '' })).code === 404 && (await call('/api/csv/analyze', {})).code === 404);
    check('route analyze: a full path is checked by anyPath (blocked zones are refused)', (await call('/api/csv/analyze', { name: 'C:\\blocked\\x.csv' })).code === 404 && (await call('/api/csv/analyze', { name: path.join(safeDir, 'marks.csv') })).code === 200);
    check('route analyze: a file that is not a real CSV is a 400 with the reason', (await call('/api/csv/analyze', { name: 'bad.csv' })).code === 400 && /header row/.test((await call('/api/csv/analyze', { name: 'bad.csv' })).error));
    let q = await call('/api/csv/query', { name: 'marks.csv', groupBy: 'dept', column: 'marks' });
    check('route query: average marks by department', q.code === 200 && q.groups[0].group === 'CSE' && q.groups[0].value === 74, q);
    q = await call('/api/csv/query', { name: 'marks.csv', filter: 'marks >' });
    check('route query: a bad filter is a 400 with the reason', q.code === 400 && /value is missing/.test(q.error), q);
    q = await call('/api/csv/query', { name: 'marks.csv', filter: 'marks > 60; process.exit()' });
    check('route query: hostile text is just an error', q.code === 400 && !!q.error);
    q = await call('/api/csv/query', { name: 'marks.csv', column: 'marks', agg: 'max' }); check('route query: one statistic', q.value === 91);
    let c = await call('/api/csv/chart', { name: 'marks.csv', column: 'marks' });
    check('route chart: a histogram is written under Charts/ and opened', c.code === 200 && c.kind === 'histogram' && c.file === 'Charts/marks-marks.svg' && fs.existsSync(path.join(tmp, 'Charts', 'marks-marks.svg')) && opened.length === 1 && opened[0].endsWith('marks-marks.svg') && /^<svg/.test(fs.readFileSync(path.join(tmp, 'Charts', 'marks-marks.svg'), 'utf8')), c);
    c = await call('/api/csv/chart', { name: 'marks.csv', column: 'dept' });
    check('route chart: a text column becomes a bar chart of counts', c.kind === 'bar' && /Rows per dept/.test(c.title) && /CSE/.test(fs.readFileSync(c.path, 'utf8')), c);
    c = await call('/api/csv/chart', { name: 'marks.csv', column: 'marks', groupBy: 'dept', agg: 'mean', open: false });
    check('route chart: average marks by department; open:false does not open it', c.kind === 'bar' && /Mean of marks by dept/.test(c.title) && c.file === 'Charts/marks-marks-by-dept.svg' && opened.length === 2, c);
    c = await call('/api/csv/chart', { name: 'marks.csv', column: 'marks', filter: 'dept = CSE' });
    check('route chart: filtered', /3 values/.test(fs.readFileSync(c.path, 'utf8')), c);
    check('route chart: unknown column / nothing to chart are 400s with reasons', (await call('/api/csv/chart', { name: 'marks.csv', column: 'zzz' })).code === 400 && /Nothing to chart/.test((await call('/api/csv/chart', { name: 'marks.csv', column: 'dept', filter: 'marks > 1000' })).error));
    check('route chart: a file name cannot place the chart anywhere but Charts/', !fs.existsSync(path.join(tmp, '..', 'marks-marks.svg')));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`csvtools: ${total - fail}/${total}`);
    process.exitCode = fail ? 1 : 0;
  });
}
function await0(p) { return p; }
