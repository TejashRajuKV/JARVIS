// Student features: attendance & CGPA maths (study.js), monthly/yearly repeats (scheduler.js, nlu.js).
// Run: node tests/student.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'study.js'));
const sched = require(path.join(__dirname, '..', 'scheduler.js'));
let NLU;
{ const vm = require('vm'), fs = require('fs');
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';this.NLU = NLU;', sandbox);
  NLU = sandbox.NLU; }

let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

/* ---------- attendance maths ---------- */
{
  check('pct: 28/40 = 70%', S.attendancePct(40, 28) === 70);
  check('pct: one decimal', S.attendancePct(3, 2) === 66.7);
  check('pct: 0 held → null', S.attendancePct(0, 0) === null);
  check('pct: negative/NaN held → treated as 0', S.attendancePct(-5, 3) === null);
  check('pct: attended above held is clamped', S.attendancePct(10, 99) === 100);
  check('bunk: 28/40 is already below 75 → 0', S.bunkable(40, 28) === 0);
  check('bunk: 30/40 = 75% → 0', S.bunkable(40, 30) === 0);
  check('bunk: 31/40 → exactly 1', S.bunkable(40, 31) === 1);
  check('bunk: 36/40 (90%) → 4 bunks → 36/44 keeps exactly 75%', (() => { const b = S.bunkable(40, 36); return b === 8 && S.attendancePct(40 + b, 36) === 75; })(), S.bunkable(40, 36));
  check('bunk: custom threshold 50', S.bunkable(40, 21, 50) === 2);
  check('bunk: 0 held → 0', S.bunkable(0, 0) === 0);
  check('need: 20/40 (50%) → 40 in a row', S.neededToReach(40, 20) === 40);
  check('need: 0 when already at/above target', S.neededToReach(40, 31) === 0 && S.neededToReach(40, 40) === 0);
  check('need: recovers exactly at the boundary', (() => { const h = 40, a = 20, n = S.neededToReach(h, a); return S.attendancePct(h + n, a + n) >= 75; })());
  check('need: 100% target is capped to 99 so it stays reachable', S.neededToReach(10, 0, 100) > 0);
}

/* ---------- SGPA / CGPA ---------- */
{
  check('sgpa: credit-weighted mean', S.sgpa([{ credits: 24, points: 8.6 }, { credits: 22, points: 9.1 }]) === 8.84);
  check('sgpa: single subject', S.sgpa([{ credits: 4, points: 9 }]) === 9);
  check('sgpa: ignores entries without credits or points', S.sgpa([{ credits: 4 }, { credits: 0, points: 10 }, { credits: 3, points: 7 }]) === 7);
  check('sgpa: empty → null', S.sgpa([]) === null && S.sgpa(null) === null);
  check('sgpa: rejects points outside 0–10', S.sgpa([{ credits: 4, points: 12 }, { credits: 4, points: -1 }, { credits: 4, points: 8 }]) === 8);
  check('cgpa: reuses sgpa with semester credit weights', S.cgpa([{ credits: 24, sgpa: 8.6 }, { credits: 22, sgpa: 9.1 }]) === 8.84);
  check('gradeNeeded: (46cr @8.6, want 8.5 over 18cr) → 8.24', S.gradeNeeded(46, 8.6 * 46, 8.5, 18) === 8.24);
  check('gradeNeeded: out of reach → null', S.gradeNeeded(10, 2 * 10, 9.5, 10) === null);
  // The answer is the minimal remaining average that still reaches the target (6.5 here: (190+65)/30 = 8.5).
  check('gradeNeeded: already above target → the real minimum', S.gradeNeeded(20, 9.5 * 20, 8.5, 10) === 6.5);
  check('gradeNeeded: at target → target itself', S.gradeNeeded(20, 8.5 * 20, 8.5, 10) === 8.5);
  check('gradeNeeded: target locked in → 0', S.gradeNeeded(200, 10 * 200, 8.5, 10) === 0);
  check('gradeNeeded: no remaining credits → null', S.gradeNeeded(20, 180, 8.5, 0) === null);
}

/* ---------- monthly / yearly scheduling (server) ---------- */
{
  const jan31 = at(2026, 1, 31, 10);
  check('monthly: Jan 31 → Feb 28 (clamped)', sched.nextOccurrence({ at: jan31, repeat: { type: 'monthly', day: 31 } }, jan31) === at(2026, 2, 28, 10));
  const feb28 = at(2026, 2, 28, 10);
  check('monthly: Feb 28 → Mar 31', sched.nextOccurrence({ at: feb28, repeat: { type: 'monthly', day: 31 } }, feb28) === at(2026, 3, 31, 10));
  const may5 = at(2026, 5, 5, 18);
  // missed May/June are skipped (never replayed); Jul 5 is still in the future when "now" is Jul 1.
  check('monthly: keeps the time, skips missed months', sched.nextOccurrence({ at: may5, repeat: { type: 'monthly', day: 5 } }, at(2026, 7, 1, 12)) === at(2026, 7, 5, 18));
  check('monthly: one already fired this month → next month', sched.nextOccurrence({ at: may5, repeat: { type: 'monthly', day: 5 } }, at(2026, 7, 5, 19)) === at(2026, 8, 5, 18));
  const monthly = sched.nextOccurrence({ at: jan31, repeat: { type: 'monthly' } }, jan31);
  check('monthly: no day → same day-of-month next month', monthly === at(2026, 2, 28, 10), monthly);
  const mar15 = at(2026, 3, 15, 8);
  check('yearly: same date next year', sched.nextOccurrence({ at: mar15, repeat: { type: 'yearly' } }, mar15) === at(2027, 3, 15, 8));
  check('yearly: explicit month/day wins', sched.nextOccurrence({ at: mar15, repeat: { type: 'yearly', month: 0, day: 26 } }, mar15) === at(2027, 1, 26, 8));
  check('yearly: Feb 29 → Feb 28 on a non-leap year', sched.nextOccurrence({ at: at(2028, 2, 29, 9), repeat: { type: 'yearly' } }, at(2028, 2, 29, 9)) === at(2029, 2, 28, 9));
  const mar15b = at(2026, 3, 15, 8);
  check('yearly: skips missed years', sched.nextOccurrence({ at: mar15b, repeat: { type: 'yearly' } }, at(2029, 6, 1, 8)) === at(2030, 3, 15, 8));
  const jan31y = at(2026, 1, 31, 9);
  check('monthly: never loops forever on day 31 + now far ahead', sched.nextOccurrence({ at: jan31y, repeat: { type: 'monthly', day: 31 } }, at(2027, 3, 1, 9)) === at(2027, 3, 31, 9));
}

/* ---------- monthly / yearly parsing (nlu) ---------- */
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('parse: every month on the 5th', eq(NLU.parseRepeat('every month on the 5th at 10am'), { type: 'monthly', day: 5 }));
  check('parse: monthly on the 31st', eq(NLU.parseRepeat('monthly on the 31st'), { type: 'monthly', day: 31 }));
  check('parse: every month at 9am → no day (9 is a time)', eq(NLU.parseRepeat('every month at 9am'), { type: 'monthly' }));
  check('parse: every year on 12 march', eq(NLU.parseRepeat('every year on 12 march at 8am'), { type: 'yearly', month: 2, day: 12 }));
  check('parse: annually at 8am → no day', eq(NLU.parseRepeat('annually at 8am'), { type: 'yearly' }));
  check('parse: every january on the 26th', eq(NLU.parseRepeat('every january on the 26th'), { type: 'yearly', month: 0, day: 26 }));
  check('parse: plain monthly', eq(NLU.parseRepeat('monthly'), { type: 'monthly' }));
  check('parse: existing types still parse', eq(NLU.parseRepeat('every monday'), { type: 'weekly', day: 1 }) && eq(NLU.parseRepeat('every day'), { type: 'daily' }) && eq(NLU.parseRepeat('every 10 minutes'), { type: 'interval', ms: 6e5 }));
  // stripWhen removes the recurrence words from the reminder text
  check('strip: monthly words removed from text', NLU.stripWhen('to pay hostel fee every month on the 5th at 10am') === 'to pay hostel fee');
  check('strip: yearly words removed from text', NLU.stripWhen('to wish mom every year on 12 march at 8am') === 'to wish mom on 12 march');
}

/* ---------- reminder classification still routes ---------- */
{
  const intent = s => { const r = NLU.classify({ text: s.toLowerCase(), original: s, wake: 'jarvis' }, {}) || {}; return r.intent || '?'; };
  check('classify: monthly reminder', intent('remind me to pay hostel fee every month on the 5th at 10am') === 'REMIND');
  check('classify: yearly reminder', intent('remind me to wish mom every year on 12 march at 8am') === 'REMIND');
  check('classify: attendance mark', intent('mark dbms present') === 'ATTENDANCE_MARK');
  check('classify: attendance report', intent('how is my attendance') === 'ATTENDANCE_REPORT');
  check('classify: bunk check', intent('can i bunk tomorrow dbms class') === 'BUNK_CHECK');
  check('classify: cgpa', intent('what is my cgpa') === 'CGPA_REPORT');
  check('classify: add marks', intent('add s3: 8.6 gpa, 24 credits') === 'ADD_MARKS');
  check('classify: done todo still works', intent('mark task 2 as done') === 'DONE_TODO');
  check('classify: to-do add still works', intent('add revise graphs to my list') === 'ADD_TODO');
}

/* ---------- page-side nextOccurrence mirrors the server ---------- */
{
  // The page copy lives in script.js — extract and eval just that function so this test stays DOM-free.
  const fs2 = require('fs');
  const src = fs2.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const start = src.indexOf('function nextOccurrence(');
  const end = src.indexOf('\n}', start) + 2;
  const pageNext = new Function('return ' + src.slice(start, end))();
  const jan31 = at(2026, 1, 31, 10);
  check('page monthly matches server', pageNext({ at: jan31, repeat: { type: 'monthly', day: 31 } }, jan31) === sched.nextOccurrence({ at: jan31, repeat: { type: 'monthly', day: 31 } }, jan31));
  check('page yearly matches server', pageNext({ at: jan31, repeat: { type: 'yearly' } }, jan31) === sched.nextOccurrence({ at: jan31, repeat: { type: 'yearly' } }, jan31));
  const base = at(2026, 9, 28, 9);
  check('page daily unchanged', pageNext({ at: base, repeat: { type: 'daily' } }, base) === at(2026, 9, 29, 9));
  check('page weekly unchanged', pageNext({ at: base, repeat: { type: 'weekly', day: 1 } }, base) === base + 7 * 864e5);
}

console.log((total - fail) + '/' + total + (fail ? ' FAILED' : ' — all passed'));
process.exitCode = fail ? 1 : 0;
