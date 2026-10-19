// Study additions (study.js): classes that just ended, free gaps, a study plan fitted to the timetable, and the end-sem marks calculator.
// Fixed "now": Friday 9 October 2026, 15:00. Run: node tests/studyplus.test.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'study.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(9, 15, 0);                                    // Friday = day 5

/* ---------- attendanceDue ---------- */
const cls = [{ id: 'a', name: 'DBMS', day: 5, h: 13, m: 30 }, { id: 'b', name: 'OS', day: 5, h: 14, m: 30 }, { id: 'c', name: 'CN', day: 5, h: 16, m: 0 }, { id: 'd', name: 'Maths', day: 4, h: 9, m: 0 }, { id: 'e', name: 'AI', day: 5, h: 8, m: 0, dur: 50 }];
let due = S.attendanceDue({ classes: cls, attendance: {}, now: NOW });
check('due: only classes that have ended today, within 4 hours: DBMS (ended 14:30) and OS (ended 15:30? no, still on)', due.map(x => x.c.id).join() === 'a', due.map(x => x.c.id));
due = S.attendanceDue({ classes: cls, attendance: {}, now: at(9, 15, 40) });
check('due: DBMS and OS once OS has ended; CN (16:00) and Thursday\'s Maths are not due; AI ended at 08:50, 6 hours ago, so too old', due.map(x => x.c.id).join() === 'a,b', due.map(x => x.c.id));
check('due: a class is not due before it ends', S.attendanceDue({ classes: cls, attendance: {}, now: at(9, 14, 29) }).length === 0);
check('due: default length is 60 minutes, `dur` overrides it', S.attendanceDue({ classes: [{ id: 'x', name: 'Lab', day: 5, h: 13, m: 0, dur: 120 }], now: at(9, 14, 30) }).length === 0 && S.attendanceDue({ classes: [{ id: 'x', name: 'Lab', day: 5, h: 13, m: 0, dur: 120 }], now: at(9, 15, 1) }).length === 1);
check('due: a class already asked about (classId|date) is skipped', S.attendanceDue({ classes: cls, attendance: {}, now: NOW, asked: ['a|2026-10-09'] }).length === 0 && S.attendanceDue({ classes: cls, attendance: {}, now: NOW, asked: ['a|2026-10-08'] }).length === 1);
check('due: a subject already marked today is skipped (any case)', S.attendanceDue({ classes: cls, attendance: { dbms: { held: 3, attended: 3, log: [{ d: '2026-10-09', s: 'p' }] } }, now: NOW }).length === 0 && S.attendanceDue({ classes: cls, attendance: { DBMS: { held: 3, attended: 3, log: [{ d: '2026-10-08', s: 'p' }] } }, now: NOW }).length === 1);
const two = [{ id: 'p', name: 'DBMS', day: 5, h: 9, m: 0 }, { id: 'q', name: 'DBMS', day: 5, h: 13, m: 30 }];
check('due: two DBMS classes in a day need two marks (one mark covers only the first)', S.attendanceDue({ classes: two, attendance: { DBMS: { held: 1, attended: 1, log: [{ d: '2026-10-09', s: 'p' }] } }, now: NOW }).map(x => x.c.id).join() === 'q' && S.attendanceDue({ classes: two, attendance: { DBMS: { held: 2, attended: 2, log: [{ d: '2026-10-09', s: 'p' }, { d: '2026-10-09', s: 'p' }] } }, now: NOW }).length === 0);
check('due: junk input does not throw', S.attendanceDue().length === 0 && S.attendanceDue({ classes: [null, {}, { name: 'x' }], now: NOW }).length === 0);

/* ---------- freeSlots ---------- */
const day = [{ id: '1', name: 'DBMS', day: 1, h: 9, m: 0 }, { id: '2', name: 'OS', day: 1, h: 10, m: 0 }, { id: '3', name: 'CN', day: 1, h: 14, m: 0, dur: 90 }];
let fs = S.freeSlots({ classes: day, from: at(12, 0, 0), days: 1 });      // Monday 12 Oct
check('free: before the first class (8–9), between 11–14, after 15:30–21', fs.length === 3 && fs[0].min === 60 && fs[1].start === at(12, 11) && fs[1].end === at(12, 14) && fs[1].min === 180 && fs[2].start === at(12, 15, 30) && fs[2].end === at(12, 21), fs);
fs = S.freeSlots({ classes: day, from: at(12, 12, 10), days: 1 });
check('free: today starts from the next 5 minutes, and earlier gaps are gone', fs[0].start === at(12, 12, 10) && fs.length === 2, fs);
check('free: gaps under the minimum are dropped', S.freeSlots({ classes: [{ id: 'x', name: 'A', day: 1, h: 8, m: 30 }, { id: 'y', name: 'B', day: 1, h: 20, m: 0 }], from: at(12, 0), days: 1, minMin: 45 }).every(s => s.min >= 45));
check('free: a day with no classes is one long slot, and a full day has none', S.freeSlots({ classes: [], from: at(13, 0), days: 1 }).length === 1 && S.freeSlots({ classes: [{ id: 'f', name: 'All', day: 2, h: 8, m: 0, dur: 780 }], from: at(13, 0), days: 1 }).length === 0);
check('free: several days, each tagged with its date', new Set(S.freeSlots({ classes: [], from: at(12, 0), days: 3 }).map(s => s.date)).size === 3);
check('free: junk does not throw', S.freeSlots().length >= 0 && S.freeSlots({ classes: [null], from: NOW, days: 1 }).length === 1);

/* ---------- fitPlan ---------- */
const plan = { name: 'DBMS', examDate: '2026-10-20', days: [{ date: '2026-10-09', topic: 'ER', done: true }, { date: '2026-10-12', topic: 'Normalization' }, { date: '2026-10-13', topic: 'SQL' }, { date: '2026-10-14', topic: 'Transactions', done: true }, { date: '2026-10-25', topic: 'late' }] };
const fit = S.fitPlan({ plan, classes: [...day, { id: 'z', name: 'Full', day: 2, h: 8, m: 0, dur: 780 }], now: at(9, 15), studyMin: 60 });
check('fit: only not-done days up to the exam; the longest gap of its day (15:30–21:00); one hour from its start', fit.length === 2 && fit[0].topic === 'Normalization' && fit[0].start === at(12, 15, 30) && fit[0].end === at(12, 16, 30) && fit[0].min === 60, fit);
check('fit: a day with no gap is returned as `none`', fit[1].topic === 'SQL' && fit[1].none === true, fit[1]);
check('fit: a session is cut to the gap when the gap is shorter', S.fitPlan({ plan: { examDate: '2026-10-20', days: [{ date: '2026-10-12', topic: 'T' }] }, classes: [{ id: 'a', name: 'A', day: 1, h: 8, m: 0, dur: 60 }, { id: 'b', name: 'B', day: 1, h: 9, m: 50, dur: 660 }], now: at(9, 15), studyMin: 120 })[0].min === 50);
check('fit: no plan / junk gives an empty list', S.fitPlan().length === 0 && S.fitPlan({ plan: {} }).length === 0);
check('fit: past days are not scheduled', S.fitPlan({ plan: { examDate: '2026-10-20', days: [{ date: '2026-10-05', topic: 'old' }] }, classes: [], now: NOW }).length === 0);

/* ---------- endSemNeeded ---------- */
let e = S.endSemNeeded({ internal: 32, internalMax: 40, endMax: 60, targetPct: 80 });
check('endsem: 80% of 100 = 80 marks; 32 from internals → 48 of 60 needed', e.needed === 48 && e.endMax === 60 && e.possible && !e.already && e.total === 100, e);
e = S.endSemNeeded({ internal: 38, internalMax: 40, targetPct: 35 }); check('endsem: the end-sem maximum defaults to what is left of 100; 38/40 already covers 35%', e.endMax === 60 && e.already && e.needed === 0, e);
e = S.endSemNeeded({ internal: 10, internalMax: 40, endMax: 60, targetPct: 90 }); check('endsem: out of reach is flagged (needs 80 of 60)', e.needed === 80 && !e.possible, e);
e = S.endSemNeeded({ internal: 25, internalMax: 50, endMax: 50, targetPct: 55 }); check('endsem: rounds up to a whole mark (55 − 25 = 30)', e.needed === 30);
e = S.endSemNeeded({ internal: 20, internalMax: 30, endMax: 70, targetPct: 61.5 }); check('endsem: a fraction rounds up (61.5 − 20 = 41.5 → 42)', e.needed === 42, e);
for (const bad of [{ internal: -1, internalMax: 40, targetPct: 50 }, { internal: 41, internalMax: 40, targetPct: 50 }, { internal: 10, internalMax: 0, targetPct: 50 }, { internal: 10, internalMax: 40, targetPct: 0 }, { internal: 10, internalMax: 40, targetPct: 101 }, { internal: NaN, internalMax: 40, targetPct: 50 }, {}]) check('endsem: bad input is an error, not a number: ' + JSON.stringify(bad), !!S.endSemNeeded(bad).error, S.endSemNeeded(bad));

/* ---------- parseEndSem ---------- */
const pe = t => S.parseEndSem(t);
let p = pe('I got 32/40 in internals, what do I need in the end sem to get 80%?');
check('parse: marks, max, target', p && p.internal === 32 && p.internalMax === 40 && p.targetPct === 80, p);
p = pe('what do I need in end-sem to get an A grade, my internals are 28 out of 40'); check('parse: grade letter A = 70%, "internals are 28 out of 40"', p && p.internal === 28 && p.internalMax === 40 && p.targetPct === 70 && /grade A/.test(p.target), p);
p = pe('how many marks do I need in the end sem to pass if I got 15/30 in IA, end sem is out of 70'); check('parse: pass = 40%, end-sem out of 70', p && p.targetPct === 40 && p.endMax === 70 && p.internal === 15 && p.internalMax === 30, p);
p = pe('I scored 35 in internals (out of 40) what do I need in the final exam for 90 percent'); check('parse: "scored 35 in internals (out of 40)", final exam, percent word', p && p.internal === 35 && p.internalMax === 40 && p.targetPct === 90, p);
p = pe('what should I score in the endsem for O grade, internals 36/40'); check('parse: O grade = 90%', p && p.targetPct === 90, p);
for (const t of ['what is my cgpa', 'I got 32/40 in internals', 'what do I need to pass', 'I need an A grade in end sem', 'how are internals calculated', 'what do I need in the end sem', 'I need 80% in end sem']) check('parse: not taken: "' + t + '"', pe(t) === null, pe(t));

console.log(`studyplus: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
