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

console.log(`study: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
