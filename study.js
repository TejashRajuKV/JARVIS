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

  return { ymd, daysBetween, addDays, parseTopics, buildStudyPlan, streak, lastDays, subjectTotals, weekSummary, weekId, fmtMin,
    attendancePct, bunkable, neededToReach, LETTER_POINTS, sgpa, cgpa, gradeNeeded };
})();
if (typeof module !== 'undefined') module.exports = Study;
