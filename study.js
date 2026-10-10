'use strict';
/* Study planner + progress maths. Pure functions, used by the page (global `Study`) and by the server scheduler and tests. */
const Study = (() => {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }; // local date
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY); // DST-safe enough: rounds
  const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };

  // "OS, DBMS:3, computer networks; algorithms" → [{name, weight}]. A ":n" after a topic says it needs n times the time.
  function parseTopics(text) {
    const out = [];
    for (let part of String(text || '').split(/[,;\n]|\band\b|&/i)) {
      part = part.replace(/^[\s\-–•*\d.)]+/, '').trim();
      const m = part.match(/^(.*?)\s*[:x×]\s*(\d{1,2})$/i);
      const name = (m ? m[1] : part).replace(/\s+/g, ' ').trim();
      if (!name || name.length > 60) continue;
      if (!out.some(t => t.name.toLowerCase() === name.toLowerCase())) out.push({ name, weight: m ? Math.max(1, Math.min(10, +m[2])) : 1 });
    }
    return out.slice(0, 40);
  }

  // Shares `total` days between topics in proportion to their weight (largest remainder), at least one day each when it fits.
  function allocate(topics, total) {
    const w = topics.reduce((s, t) => s + t.weight, 0);
    const base = topics.map(t => Math.max(1, Math.floor(total * t.weight / w)));
    let used = base.reduce((s, n) => s + n, 0);
    const order = topics.map((t, i) => ({ i, frac: total * t.weight / w - Math.floor(total * t.weight / w) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; used < total; k++, used++) base[order[k % order.length].i]++;
    for (let k = topics.length - 1; used > total && k >= 0; k--) { if (base[k] > 1) { base[k]--; used--; } if (k === 0 && used > total) k = topics.length; }
    return base;
  }

  // Day-by-day plan from today until the day before the exam.
  // Every 7th study day is a review day, and the last days are revision, ending with a mock test.
  function buildStudyPlan({ topics, examDate, today = new Date(), revisionDays = 3 }) {
    const warnings = [];
    if (!topics || !topics.length) return { days: [], warnings: ['No topics given'] };
    const t0 = startOfDay(today), exam = startOfDay(examDate);
    const left = daysBetween(t0, exam);
    if (!(left >= 1)) return { days: [], warnings: ['The exam date has to be after today'] };
    const revise = left >= 8 ? Math.min(revisionDays, Math.floor(left / 4)) : left >= 4 ? 1 : 0;
    const studySlots = left - revise;
    const reviews = studySlots >= 10 ? Math.floor(studySlots / 7) : 0;
    const topicDays = studySlots - reviews;
    const days = [];
    let per;
    if (topicDays >= topics.length) per = allocate(topics, topicDays);
    else {
      warnings.push('Only ' + topicDays + ' study day' + (topicDays === 1 ? '' : 's') + ' for ' + topics.length + ' topics, so some topics share a day.');
      per = topics.map(() => 0);
    }
    const queue = [];
    if (topicDays >= topics.length) topics.forEach((t, i) => { for (let k = 0; k < per[i]; k++) queue.push(t.name + (per[i] > 1 ? ' (' + (k + 1) + '/' + per[i] + ')' : '')); });
    else { // fewer days than topics: split the topics evenly across the days
      const size = Math.ceil(topics.length / Math.max(topicDays, 1));
      for (let i = 0; i < topics.length; i += size) queue.push(topics.slice(i, i + size).map(t => t.name).join(' + '));
    }
    const done = [];
    let qi = 0;
    for (let i = 0; i < studySlots; i++) {
      const date = ymd(addDays(t0, i));
      if (reviews && (i + 1) % 7 === 0) {
        const recent = [...new Set(done.slice(-6).map(x => x.replace(/ \(\d+\/\d+\)$/, '')))];
        days.push({ date, topic: 'Review: ' + (recent.join(', ') || 'this week'), kind: 'review' });
      } else if (qi < queue.length) { days.push({ date, topic: queue[qi], kind: 'study' }); done.push(queue[qi++]); }
      else days.push({ date, topic: 'Extra practice: weak areas', kind: 'review' });
    }
    for (let j = 0; j < revise; j++) {
      const date = ymd(addDays(t0, studySlots + j));
      const last = j === revise - 1;
      days.push(last ? { date, topic: 'Full mock test + fix weak areas', kind: 'mock' } : { date, topic: 'Revise: ' + topics.filter((_, i) => i % Math.max(revise - 1, 1) === j).map(t => t.name).join(', '), kind: 'revise' });
    }
    return { days, warnings, daysLeft: left };
  }

  /* ---------- progress ---------- */
  // stats is {'YYYY-MM-DD': {focusMin, todosDone, ...}} keyed by the page's todayKey() (UTC date).
  const active = s => !!s && ((s.focusMin || 0) > 0 || (s.todosDone || 0) > 0 || (s.deadlinesDone || 0) > 0 || (s.flashReviewed || 0) > 0);
  const shiftKey = (key, n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Consecutive active days ending today (or yesterday, so the streak isn't lost before you've started today).
  function streak(stats, todayKey) {
    let k = active((stats || {})[todayKey]) ? todayKey : shiftKey(todayKey, -1), n = 0;
    while (active((stats || {})[k])) { n++; k = shiftKey(k, -1); }
    return n;
  }
  function lastDays(stats, n, todayKey) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = shiftKey(todayKey, -i), s = (stats || {})[key] || {};
      out.push({ key, label: new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), focusMin: s.focusMin || 0, active: active(s) });
    }
    return out;
  }
  function subjectTotals(sessions, sinceMs) {
    const m = new Map();
    for (const s of sessions || []) { if (!s || s.t < sinceMs || !s.subject) continue; m.set(s.subject, (m.get(s.subject) || 0) + (s.min || 0)); }
    return [...m].map(([subject, min]) => ({ subject, min })).sort((a, b) => b.min - a.min);
  }
  const fmtMin = m => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min');
  function weekSummary(stats, sessions, todayKey, now = Date.now()) {
    const days = lastDays(stats, 7, todayKey);
    const sum = f => days.reduce((s, d) => s + (((stats || {})[d.key] || {})[f] || 0), 0);
    const focusMin = days.reduce((s, d) => s + d.focusMin, 0);
    const best = days.slice().sort((a, b) => b.focusMin - a.focusMin)[0];
    const subjects = subjectTotals(sessions, now - 7 * DAY);
    const t = { focusMin, sessions: sum('focusSessions'), todos: sum('todosDone'), deadlines: sum('deadlinesDone'), cards: sum('flashReviewed'), activeDays: days.filter(d => d.active).length, streak: streak(stats, todayKey) };
    const lines = ['Focused ' + fmtMin(focusMin) + ' over ' + t.sessions + ' session' + (t.sessions === 1 ? '' : 's'), 'Finished ' + t.todos + ' to-do' + (t.todos === 1 ? '' : 's') + ' and ' + t.deadlines + ' deadline' + (t.deadlines === 1 ? '' : 's'),
      t.cards ? 'Reviewed ' + t.cards + ' flashcards' : null, 'Active ' + t.activeDays + ' of 7 days · streak ' + t.streak, best && best.focusMin ? 'Best day: ' + best.label + ' (' + fmtMin(best.focusMin) + ')' : null,
      subjects.length ? 'Top subject: ' + subjects[0].subject + ' (' + fmtMin(subjects[0].min) + ')' : null].filter(Boolean);
    return { days, totals: t, subjects, lines, any: focusMin > 0 || t.todos > 0 || t.deadlines > 0 || t.cards > 0 };
  }
  // ISO-ish week id, so the Sunday digest is sent once per week.
  const weekId = d => { d = new Date(d); const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7)); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return x.getUTCFullYear() + '-W' + pad(Math.ceil(((x - y) / DAY + 1) / 7)); };

  /* ---------- attendance & grades ---------- */
  const cleanInt = (v, max) => Math.max(0, Math.min(max === undefined ? Infinity : max, Math.floor(+v || 0)));
  // Percentage attended, one decimal. held = 0 → null (nothing recorded yet).
  function attendancePct(held, attended) {
    held = cleanInt(held); attended = cleanInt(attended, held);
    return held ? Math.round(1000 * attended / held) / 10 : null;
  }
  // How many classes in a row can still be skipped before `threshold`% is breached (never negative).
  // attended/(held+bunk) >= threshold/100  ⇔  bunk <= attended·100/threshold − held.
  function bunkable(held, attended, threshold = 75) {
    held = cleanInt(held); attended = cleanInt(attended, held);
    if (!held || !(threshold > 0)) return 0;
    return Math.max(0, Math.floor(attended * 100 / threshold - held));
  }
  // How many future classes must be attended in a row to reach `target`% (0 when already there).
  function neededToReach(held, attended, target = 75) {
    held = cleanInt(held); attended = cleanInt(attended, held);
    target = Math.min(99, Math.max(1, +target || 0));
    if (!held || 100 * attended / held >= target) return 0;
    return Math.max(1, Math.ceil((target * held - 100 * attended) / (100 - target)));
  }
  // Grade letters (Indian 10-point) a student may type instead of a number.
  const LETTER_POINTS = { o: 10, 'a+': 9, a: 8, 'b+': 7, b: 6, c: 5, p: 4, f: 0 };
  // Credit-weighted average: sgpa([{credits, points}]) → number (2 dp) or null when credits/points are missing.
  function sgpa(entries) {
    let cr = 0, pts = 0;
    for (const e of entries || []) {
      const c = cleanInt(e && e.credits, 100), p = Number(e && e.points);
      if (!c || !(p >= 0 && p <= 10)) continue;
      cr += c; pts += c * p;
    }
    return cr ? Math.round(100 * pts / cr) / 100 : null;
  }
  // cgpa([{sgpa, credits}]) — each semester's sgpa weighted by that semester's credits.
  function cgpa(semesters) {
    return sgpa((semesters || []).map(s => ({ credits: s && s.credits, points: s && s.sgpa })));
  }
  // "What do I need on the final for 8.5?" → the grade point to average in the remaining credits,
  // or null when it is out of reach (would need > 10) or the inputs are bad.
  function gradeNeeded(doneCredits, donePoints, target, remainingCredits) {
    doneCredits = cleanInt(doneCredits); remainingCredits = cleanInt(remainingCredits);
    if (!remainingCredits || !(target >= 0 && target <= 10)) return null;
    const need = (target * (doneCredits + remainingCredits) - (donePoints || 0)) / remainingCredits;
    return need > 10 ? null : Math.round(100 * Math.max(0, need)) / 100;
  }

  /* ---- classes that just ended and have no attendance mark yet ("did you attend DBMS?") ----
     A class is due once it has ended (start + dur, 60 min when unknown), for up to maxAgeMin minutes after, unless it was asked about already (`asked`
     holds "classId|date" keys) or the subject already has as many marks today as classes that have ended (so two DBMS classes need two marks). */
  function attendanceDue({ classes = [], attendance = {}, now = Date.now(), asked = [], maxAgeMin = 240, defaultDur = 60 } = {}) {
    const d0 = new Date(now), today = ymd(d0), askedSet = new Set(asked), nk = n => String(n).toLowerCase().replace(/\s+/g, ' ').trim();
    const todays = classes.filter(c => c && c.day === d0.getDay() && c.h >= 0).map(c => { const start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), c.h, c.m || 0).getTime(); return { c, start, end: start + (c.dur || defaultDur) * 60000 }; }).sort((a, b) => a.start - b.start);
    const seen = new Map(), out = [];
    for (const t of todays) {
      const k = nk(t.c.name), nth = (seen.get(k) || 0) + 1; seen.set(k, nth);
      if (t.end > now || now - t.end > maxAgeMin * 60000) continue;
      const key = t.c.id + '|' + today;
      if (askedSet.has(key)) continue;
      const att = Object.entries(attendance || {}).find(([n]) => nk(n) === k);
      if (att && (att[1].log || []).filter(x => x.d === today).length >= nth) continue;
      out.push({ c: t.c, key, end: t.end });
    }
    return out;
  }
  /* ---- gaps in the day's timetable ---- */
  // → [{ date:'YYYY-MM-DD', start, end, min }] — for `days` days from `from`: the stretches between classes (and before the first / after the last) inside
  //   [dayStart, dayEnd] hours that are at least minMin long.
  function freeSlots({ classes = [], from = Date.now(), days = 14, dayStart = 8, dayEnd = 21, minMin = 45, defaultDur = 60 } = {}) {
    const out = [], base = new Date(from);
    for (let i = 0; i < days; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const lo = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStart).getTime(), hi = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayEnd).getTime();
      let cursor = Math.max(lo, i === 0 ? Math.ceil(from / 300000) * 300000 : lo);
      const busy = classes.filter(c => c && c.day === d.getDay()).map(c => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), c.h, c.m || 0).getTime(); return [s, s + (c.dur || defaultDur) * 60000]; }).sort((a, b) => a[0] - b[0]);
      const push = (s, e) => { if (e - s >= minMin * 60000) out.push({ date: ymd(d), start: s, end: e, min: Math.round((e - s) / 60000) }); };
      for (const [s, e] of busy) { if (s > cursor) push(cursor, Math.min(s, hi)); cursor = Math.max(cursor, e); if (cursor >= hi) break; }
      if (cursor < hi) push(cursor, hi);
    }
    return out;
  }
  // The plan's days that are still to do, each put into the longest free stretch of ITS day (earliest on a tie); a day with no stretch is returned with
  // `none: true`. → [{ date, topic, start, end, min }]
  function fitPlan({ plan, classes = [], now = Date.now(), studyMin = 60, dayStart = 8, dayEnd = 21 } = {}) {
    if (!plan || !Array.isArray(plan.days)) return [];
    const slots = freeSlots({ classes, from: now, days: 60, dayStart, dayEnd, minMin: Math.min(studyMin, 45) });
    const today = ymd(now);
    return plan.days.filter(d => !d.done && d.date >= today && d.date <= plan.examDate).map(d => {
      const best = slots.filter(s => s.date === d.date).sort((a, b) => b.min - a.min || a.start - b.start)[0];
      if (!best) return { date: d.date, topic: d.topic, none: true };
      const len = Math.min(best.min, studyMin);
      return { date: d.date, topic: d.topic, start: best.start, end: best.start + len * 60000, min: len };
    });
  }
  /* ---- "what do I need in the end-sem?" ---- */
  const GRADE_CUTS = { 'O': 90, 'A+': 80, 'A': 70, 'B+': 60, 'B': 55, 'C': 50, 'P': 40 };
  // internal marks (e.g. 32 of 40), the end-sem paper's maximum (default: what is left of 100), and a target (a % or a grade letter or "pass")
  // → { needed, endMax, targetPct, total, possible, already, target }
  function endSemNeeded({ internal, internalMax, endMax, targetPct }) {
    const ok = n => typeof n === 'number' && isFinite(n);
    if (!ok(internal) || !ok(internalMax) || internalMax <= 0 || internal < 0 || internal > internalMax) return { error: 'The internal marks have to be between 0 and their maximum.' };
    if (!ok(targetPct) || targetPct <= 0 || targetPct > 100) return { error: 'The target has to be a percentage between 1 and 100.' };
    const em = ok(endMax) && endMax > 0 ? endMax : Math.max(1, 100 - internalMax), total = internalMax + em;
    const need = Math.ceil((targetPct / 100) * total - internal - 1e-9);
    return { needed: Math.max(0, need), endMax: em, total, targetPct, possible: need <= em, already: need <= 0, internalPct: Math.round(1000 * internal / internalMax) / 10 };
  }
  const nums = s => { const x = parseFloat(s); return isFinite(x) ? x : NaN; };
  // Sentence → inputs for endSemNeeded, or null. Needs "need/require/score" AND the end-sem words.
  function parseEndSem(text) {
    const t = String(text || '').trim();
    if (!/\b(?:end[\s-]?sem(?:ester)?|final\s+exam|finals?|external|semester\s+exam)\b/i.test(t) || !/\b(?:need|require|should\s+(?:i\s+)?(?:score|get)|must\s+(?:i\s+)?(?:score|get)|have\s+to\s+(?:score|get))\b/i.test(t)) return null;
    let m, internal = NaN, internalMax = NaN;
    const IN = '(?:internals?|internal\\s+marks?|ia|cia|sessionals?|mid[\\s-]?sems?|continuous\\s+assessment)';
    if ((m = t.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:/|out\\s+of)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:marks?\\s*)?(?:in|for|on)?\\s*(?:my\\s+|the\\s+)?' + IN, 'i'))) || (m = t.match(new RegExp(IN + '\\s*(?:marks?\\s*)?(?:are|is|was|=|:|of)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/|out\\s+of)\\s*(\\d+(?:\\.\\d+)?)', 'i')))) { internal = nums(m[1]); internalMax = nums(m[2]); }
    else if ((m = t.match(new RegExp('(?:got|scored|have|had)\\s+(\\d+(?:\\.\\d+)?)\\s+(?:in|for|on)\\s+(?:my\\s+|the\\s+)?' + IN + '(?:\\s*(?:\\(|out\\s+of|/)\\s*(\\d+))?', 'i')))) { internal = nums(m[1]); internalMax = m[2] ? nums(m[2]) : 40; }
    if (!isFinite(internal)) return null;
    let endMax = NaN;
    if ((m = t.match(/(?:end[\s-]?sem(?:ester)?|final|external)[^.\d]{0,25}(?:out\s+of|is\s+of|of|is|\/|for)\s*(\d{2,3})\b/i)) || (m = t.match(/\b(\d{2,3})\s*marks?\s+(?:end[\s-]?sem|final|external)/i))) endMax = nums(m[1]);
    let targetPct = NaN, target = '';
    if ((m = t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:%|percent|percentage)/i))) { targetPct = nums(m[1]); target = m[1] + '%'; }
    else if ((m = t.match(/\b(?:an?\s+|the\s+)?(O|A\+|A|B\+|B|C|P)\s+grade\b|\bgrade\s+(?:of\s+)?(O|A\+|A|B\+|B|C|P)\b|\bto\s+(?:get|score|secure|reach)\s+(?:an?\s+)?(O|A\+|A|B\+|B|C)\b(?!\w)/)) ) { const g = m[1] || m[2] || m[3]; targetPct = GRADE_CUTS[g]; target = 'grade ' + g; }
    else if (/\bpass\b/i.test(t)) { targetPct = 40; target = 'a pass (40%)'; }
    if (!isFinite(targetPct)) return null;
    return { internal, internalMax, endMax, targetPct, target };
  }
  return { ymd, daysBetween, addDays, parseTopics, buildStudyPlan, streak, lastDays, subjectTotals, weekSummary, weekId, fmtMin,
    attendancePct, bunkable, neededToReach, LETTER_POINTS, sgpa, cgpa, gradeNeeded, attendanceDue, freeSlots, fitPlan, endSemNeeded, parseEndSem, GRADE_CUTS };
})();
if (typeof module !== 'undefined') module.exports = Study;
