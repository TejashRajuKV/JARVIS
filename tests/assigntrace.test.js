// Assignment sheets (assignparse.js) and error traces (traceparse.js). Fixed "now": Friday 9 October 2026, 15:00. Run: node tests/assigntrace.test.js
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'assignparse.js'));
const T = require(path.join(__dirname, '..', 'traceparse.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const ymd = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const hm = t => { const d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

/* ---------- dates ---------- */
const fd = t => A.findDate(t, NOW);
for (const [t, want] of [['15/10/2026', '2026-10-15'], ['03-04-2027', '2027-04-03'], ['15.10.26', '2026-10-15'], ['15 Oct 2026', '2026-10-15'], ['15th October', '2026-10-15'], ['October 20', '2026-10-20'], ['Oct 20th, 2026', '2026-10-20'], ['tomorrow', '2026-10-10'], ['today', '2026-10-09'], ['by Monday', '2026-10-12'], ['next friday', '2026-10-16'], ['1 Jan', '2027-01-01'], ['12/25/2026', '2026-12-25']]) {
  const r = fd(t); check('date: "' + t + '"', r && ymd(r.at) === want, r && ymd(r.at));
}
for (const t of ['no date here', '32/13/2026', '31 Feb 2026', '']) check('date: not taken: "' + t + '"', fd(t) === null, fd(t));
check('date: 03/04/2026 is 3 April (day first) and says so', /day first/.test(fd('03/04/2026').assumed) && ymd(fd('03/04/2026').at) === '2026-04-03');
check('date: a weekday name says which one was assumed', /next Monday/i.test(fd('by Monday').assumed));
check('date: a past day with no year is next year', ymd(fd('2 Feb').at) === '2027-02-02' && /next year/.test(fd('2 Feb').assumed));
check('time: 5 pm, 11:30 am, 12 am, by 17:00, none', JSON.stringify(A.findTime('by 5 pm')) === '{"h":17,"m":0}' && A.findTime('11:30 am').h === 11 && A.findTime('12 am').h === 0 && A.findTime('before 17:00').h === 17 && A.findTime('no time') === null);

/* ---------- a whole sheet ---------- */
const SHEET = `Dept of Computer Science
Subject: Database Management Systems
Assignment 2
Max Marks: 20
Last date of submission: 15/10/2026 by 5 pm
1. Explain the ACID properties with an example.
2. Draw the ER diagram for a library system.
3) Normalise the given table up to 3NF.
Note: handwritten only`;
let r = A.parseAssignment(SHEET, { now: NOW, subjects: ['DBMS', 'OS'] });
check('sheet: title has the subject and the kind', /Database Management Systems/.test(r.title) && /Assignment 2/.test(r.title), r.title);
check('sheet: due date and time', ymd(r.due) === '2026-10-15' && hm(r.due) === '17:00', [ymd(r.due), hm(r.due)]);
check('sheet: marks and three questions', r.marks === 20 && r.questions.length === 3 && /ACID/.test(r.questions[0]) && /3NF/.test(r.questions[2]), r);
check('sheet: no worrying notes', r.notes.every(n => !/past/.test(n)), r.notes);
r = A.parseAssignment('OS lab record 3\nsubmit by 20 Oct', { now: NOW, subjects: ['DBMS', 'OS'] });
check('sheet: a subject you already track is picked up from the text', r.subject === 'OS' && ymd(r.due) === '2026-10-20' && hm(r.due) === '23:59' && /OS/.test(r.title), r);
r = A.parseAssignment('Tutorial sheet 4\nDue: 1 Oct 2026', { now: NOW });
check('sheet: a date in the past is flagged', r.due && /past/.test(r.notes.join(' ')), r.notes);
r = A.parseAssignment('Mini project\nPhase 1 on 12 Oct\nFinal on 30 Oct', { now: NOW });
check('sheet: several dates and no "due" word: none is picked', r.due === null && /several dates/.test(r.notes.join(' ')), r);
r = A.parseAssignment('Worksheet 1\nSubmit on 14 Oct 2026', { now: NOW });
check('sheet: one date after a submit word', ymd(r.due) === '2026-10-14');
r = A.parseAssignment('Hello world, nothing useful', { now: NOW });
check('sheet: nothing found gives a null due, no questions, no throw', r.due === null && r.questions.length === 0);
check('sheet: junk input never throws', A.parseAssignment('', { now: NOW }).due === null && A.parseAssignment(null).title === '' && A.parseAssignment('x'.repeat(100000), { now: NOW }).questions.length === 0);
check('sheet: questions must be numbered in order from 1', A.parseAssignment('1. first question here\n3. skipped number', { now: NOW }).questions.length === 1);

/* ---------- traces ---------- */
const NODE = `C:\\proj\\app.js:14
    const n = user.name.length;
                       ^

TypeError: Cannot read properties of undefined (reading 'length')
    at getName (C:\\proj\\app.js:14:24)
    at Object.<anonymous> (C:\\proj\\app.js:20:1)
    at Module._compile (node:internal/modules/cjs/loader:1256:14)
    at Object.<anonymous> (C:\\proj\\node_modules\\express\\lib\\router.js:5:3)`;
let p = T.parseTrace(NODE);
check('node: error type and message', p.error && p.error.type === 'TypeError' && /reading 'length'/.test(p.error.message), p.error);
check('node: my frames exclude node: internals and node_modules, in order', p.mine.length === 2 && p.mine[0].file === 'C:\\proj\\app.js' && p.mine[0].line === 14 && p.mine[0].col === 24 && p.mine[1].line === 20, p.mine);
check('node: internals are kept apart, not lost', p.frames.some(f => f.internal && /node_modules/.test(f.file)), p.frames);
const PY = `Traceback (most recent call last):
  File "C:\\lab\\main.py", line 12, in <module>
    run()
  File "C:\\lab\\util.py", line 5, in run
    return 1 / 0
ZeroDivisionError: division by zero`;
p = T.parseTrace(PY);
check('python: error type, message', p.error.type === 'ZeroDivisionError' && p.error.message === 'division by zero', p.error);
check('python: frames found, and reading order starts at the failing line', p.mine.length === 2 && T.orderForReading(p)[0].file === 'C:\\lab\\util.py' && T.orderForReading(p)[0].line === 5, T.orderForReading(p));
const PYLIB = 'Traceback (most recent call last):\n  File "C:\\Python312\\lib\\json\\decoder.py", line 355, in raw_decode\n  File "C:\\Users\\a\\venv\\Lib\\site-packages\\x\\y.py", line 3, in f\nValueError: bad';
check('python: library frames (site-packages, the python lib folder) are not "mine"', T.parseTrace(PYLIB).mine.length === 0, T.parseTrace(PYLIB).mine);
const JAVA = `Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()"
\tat com.school.Main.run(Main.java:34)
\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)`;
p = T.parseTrace(JAVA);
check('java: frame in my code, the JDK frame is internal', p.mine.length === 1 && p.mine[0].file === 'Main.java' && p.mine[0].line === 34, p.frames);
const GCC = `src/main.c: In function 'main':
src/main.c:7:5: error: 'x' undeclared (first use in this function)
    7 |     x = 5;`;
p = T.parseTrace(GCC);
check('gcc: file, line, column and the message', p.mine[0].file === 'src\\main.c' && p.mine[0].line === 7 && p.mine[0].col === 5 && p.error && /undeclared/.test(p.error.message), p);
p = T.parseTrace('src/app.ts(12,5): error TS2322: Type string is not assignable to type number.');
check('typescript: location and message', p.mine[0].line === 12 && p.mine[0].col === 5 && /not assignable/.test(p.error.message), p);
p = T.parseTrace('npm ERR! code ELIFECYCLE\nnpm ERR! errno 1');
check('npm: an error with no file still counts as an error', p.looksLikeError && p.mine.length === 0 && p.error, p);
p = T.parseTrace('Error: Cannot find module \'express\'\n    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:1039:15)\n    at require (C:\\proj\\server.js:3:17)');
check('node: cannot find module + my require line', p.error && /express/.test(p.error.message) && p.mine[0].file === 'C:\\proj\\server.js' && p.mine[0].line === 3, p);
check('trace: ordinary text is not an error', !T.parseTrace('what is the capital of france').looksLikeError && T.parseTrace('what is the capital of france').error === null);
check('trace: junk never throws', T.parseTrace('').frames.length === 0 && T.parseTrace(null).mine.length === 0 && T.parseTrace('at '.repeat(20000)).frames.length === 0);
check('trace: a file:/// URL becomes a Windows path', T.parseTrace('    at f (file:///C:/proj/a.mjs:3:9)').mine[0].file === 'C:\\proj\\a.mjs');

console.log(`assigntrace: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
