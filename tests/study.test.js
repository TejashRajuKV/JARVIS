// Study planner + progress maths (study.js). Run: node tests/study.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'study.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const D = (y, m, d) => new Date(y, m - 1, d);

// topics
{
  const t = S.parseTopics('OS, DBMS:3, computer networks; algorithms and Compilers');
  check('splits on commas, semicolons and "and"', t.map(x => x.name).join('|') === 'OS|DBMS|computer networks|algorithms|Compilers', t);
  check('":3" is a weight', t[1].weight === 3 && t[0].weight === 1);
  check('drops bullets/numbers/duplicates', JSON.stringify(S.parseTopics('1. OS\n- os\n• DBMS').map(x => x.name)) === '["OS","DBMS"]');
  check('empty → none', S.parseTopics('  ,, ').length === 0);
}

// plan: 20 days, 4 topics
{
  const topics = S.parseTopics('OS, DBMS, CN, Algorithms');
  const p = S.buildStudyPlan({ topics, examDate: D(2026, 10, 21), today: D(2026, 10, 1) });
  check('one entry per day until the day before the exam', p.days.length === 20 && p.days[0].date === '2026-10-01' && p.days[19].date === '2026-10-20', p.days.length);
  check('dates are consecutive', p.days.every((d, i) => d.date === S.ymd(S.addDays(D(2026, 10, 1), i))));
  check('ends with a mock test', p.days[19].kind === 'mock');
  check('has revision days before it', p.days.slice(-3, -1).every(d => d.kind === 'revise'));
  check('every 7th study day is a review', p.days[6].kind === 'review' && p.days[13].kind === 'review');
  check('every topic gets studied', topics.every(t => p.days.some(d => d.kind === 'study' && d.topic.startsWith(t.name))));
  check('no warnings when there is room', p.warnings.length === 0);
}
{
  const p = S.buildStudyPlan({ topics: S.parseTopics('OS:4, DBMS:1'), examDate: D(2026, 10, 9), today: D(2026, 10, 1) });
  const os = p.days.filter(d => /^OS/.test(d.topic) && d.kind === 'study').length, db = p.days.filter(d => /^DBMS/.test(d.topic) && d.kind === 'study').length;
  check('heavier topics get more days', os > db, { os, db });
}
{
  const p = S.buildStudyPlan({ topics: S.parseTopics('A, B, C, D, E, F'), examDate: D(2026, 10, 4), today: D(2026, 10, 1) });
  check('fewer days than topics → topics share days, with a warning', p.days.length === 3 && p.warnings.length === 1 && p.days.some(d => d.topic.includes('+')), p);
}
check('exam in the past → nothing + a message', S.buildStudyPlan({ topics: S.parseTopics('OS'), examDate: D(2026, 9, 1), today: D(2026, 10, 1) }).warnings.length === 1);
check('no topics → nothing', S.buildStudyPlan({ topics: [], examDate: D(2026, 12, 1), today: D(2026, 10, 1) }).days.length === 0);
check('exam tomorrow → one day', S.buildStudyPlan({ topics: S.parseTopics('OS'), examDate: D(2026, 10, 2), today: D(2026, 10, 1) }).days.length === 1);

// progress
const stats = { '2026-10-05': { focusMin: 50, focusSessions: 2, todosDone: 1 }, '2026-10-06': { focusMin: 25, focusSessions: 1 }, '2026-10-07': { aiQuestions: 5 }, '2026-10-08': { flashReviewed: 10 }, '2026-10-09': { focusMin: 30, focusSessions: 1, deadlinesDone: 1 } };
check('streak counts back through active days', S.streak(stats, '2026-10-09') === 2, S.streak(stats, '2026-10-09'));
check('streak survives a day you haven’t started yet', S.streak(stats, '2026-10-10') === 2, S.streak(stats, '2026-10-10'));
check('inactive day breaks it', S.streak(stats, '2026-10-12') === 0);
const ld = S.lastDays(stats, 7, '2026-10-09');
check('lastDays: 7 entries ending today', ld.length === 7 && ld[6].key === '2026-10-09' && ld[6].focusMin === 30 && ld[0].key === '2026-10-03');
const now = Date.parse('2026-10-09T12:00:00Z');
const sessions = [{ t: now - 3600e3, min: 25, subject: 'DBMS' }, { t: now - 86400e3, min: 50, subject: 'OS' }, { t: now - 2 * 86400e3, min: 25, subject: 'OS' }, { t: now - 30 * 86400e3, min: 99, subject: 'Old' }];
const st = S.subjectTotals(sessions, now - 7 * 864e5);
check('subjectTotals: sorted, ignores old sessions', st[0].subject === 'OS' && st[0].min === 75 && !st.some(x => x.subject === 'Old'), st);
const w = S.weekSummary(stats, sessions, '2026-10-09', now);
check('weekSummary totals', w.totals.focusMin === 105 && w.totals.sessions === 4 && w.totals.todos === 1 && w.totals.deadlines === 1 && w.totals.cards === 10, w.totals);
check('weekSummary text mentions top subject and best day', w.lines.some(l => /Top subject: OS/.test(l)) && w.lines.some(l => /Best day/.test(l)), w.lines);
check('weekSummary of nothing is not "any"', S.weekSummary({}, [], '2026-10-09', now).any === false);
check('weekId differs across weeks, same within', S.weekId(D(2026, 10, 5)) === S.weekId(D(2026, 10, 11)) && S.weekId(D(2026, 10, 11)) !== S.weekId(D(2026, 10, 12)));

// one subject, many spellings
for (const [x, y] of [['DBMS', 'Database Management Systems'], ['dbms', 'database management system'], ['OS', 'Operating Systems'], ['DSA', 'Data Structures & Algorithms'], ['ML', 'Machine Learning'], ['COA', 'Computer Organisation and Architecture']])
  check('subjectKey: "' + x + '" and "' + y + '" are one subject', S.subjectKey(x) === S.subjectKey(y), [S.subjectKey(x), S.subjectKey(y)]);
check('subjectKey: different subjects stay different (DBMS vs DBMS lab, OS vs Physics, Data Science vs Data Structures)', S.subjectKey('DBMS') !== S.subjectKey('DBMS lab') && S.subjectKey('OS') !== S.subjectKey('Physics') && S.subjectKey('Data Science') !== S.subjectKey('Data Structures'));
check('subjectKey: an unknown name is just itself, tidied (case, spaces, punctuation)', S.subjectKey('  Engineering   Physics-II ') === 'engineering physics ii' && S.subjectKey('') === '' && S.subjectKey(null) === '');
{   // the "did you attend?" prompt finds the existing subject under its other spelling
  const now = new Date(2026, 9, 9, 15, 0).getTime();
  const due = S.attendanceDue({ classes: [{ id: 'k1', name: 'Database Management Systems', day: 5, h: 13, m: 30 }], attendance: { DBMS: { held: 1, attended: 1, log: [{ d: '2026-10-09', s: 'p' }] } }, now, asked: [] });
  check('attendanceDue: a class already marked today under its short name (DBMS) is not asked about under its full name', due.length === 0, due);
}

// the college's own grade scale
{ const G = S.parseGradeCuts;
  check('gradecuts: a full scale is read', JSON.stringify(G('my grade cutoffs are O 85, A+ 75, A 65, B+ 55, B 50, C 45, P 40')) === JSON.stringify({ O: 85, 'A+': 75, A: 65, 'B+': 55, B: 50, C: 45, P: 40 }), G('my grade cutoffs are O 85, A+ 75, A 65, B+ 55, B 50, C 45, P 40'));
  check('gradecuts: "=" and a partial scale work', JSON.stringify(G('grade scale: O=90 A+=80 A=70 B=60')) === JSON.stringify({ O: 90, 'A+': 80, A: 70, B: 60 }));
  check('gradecuts: the order of the words does not matter, only the values', JSON.stringify(G('grade cutoffs A 60 O 80')) === JSON.stringify({ A: 60, O: 80 }));
  for (const x of ['cutoffs: O 70, A 80', 'what grade cutoffs', 'I got A 80 in dbms', 'grade cutoffs O 85', 'grade cutoffs O 60 A 80', 'grade cutoffs O 150 A 80', 'grade cutoffs O 80 A 80']) check('gradecuts: not taken / refused: "' + x + '"', G(x) === null, G(x));
  check('gradeCuts: your numbers replace the usual ones; the grades you left out keep the usual cut-off', S.gradeCuts({ A: 65 }).A === 65 && S.gradeCuts({ A: 65 }).O === 90 && S.gradeCuts(null).A === 70 && S.GRADE_CUTS.A === 70);
  check('parseEndSem: a grade target uses the cuts you pass in', S.parseEndSem('i got 32/40 in internals what do i need in the end sem to get an A', S.gradeCuts({ A: 65 })).targetPct === 65 && S.parseEndSem('i got 32/40 in internals what do i need in the end sem to get an A').targetPct === 70);
}

// your own reminders keep their time free
{ const from = new Date(2026, 9, 10, 7, 0).getTime(), six = new Date(2026, 9, 10, 18, 0).getTime();     // a Saturday, no classes
  const plain = S.freeSlots({ classes: [], from, days: 1 }), withGym = S.freeSlots({ classes: [], busy: [{ at: six, min: 30 }], from, days: 1 });
  check('freeSlots: with no classes the day is one stretch 8 am–9 pm', plain.length === 1 && plain[0].min === 13 * 60, plain);
  check('freeSlots: a reminder at 6 pm (30 min) splits it: 8:00–18:00 and 18:30–21:00', withGym.length === 2 && new Date(withGym[0].end).getHours() === 18 && new Date(withGym[1].start).getHours() === 18 && new Date(withGym[1].start).getMinutes() === 30, withGym.map(x => [new Date(x.start).toTimeString().slice(0, 5), new Date(x.end).toTimeString().slice(0, 5)]));
  const day = S.ymd(from), plan = { examDate: day, days: [{ date: day, topic: 'Graphs', done: false }] };
  const busyAll = [{ at: new Date(2026, 9, 10, 8, 0).getTime(), min: 600 }];      // 8 am–6 pm taken
  const fit = S.fitPlan({ plan, classes: [], busy: busyAll, now: from, studyMin: 60 });
  check('fitPlan: the study session goes around what is already booked (after 6 pm here)', fit.length === 1 && !fit[0].none && new Date(fit[0].start).getHours() >= 18, fit);
  check('freeSlots: a reminder on another day does not touch this one', S.freeSlots({ classes: [], busy: [{ at: six + 864e5, min: 30 }], from, days: 1 }).length === 1);
}
console.log(`study: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
