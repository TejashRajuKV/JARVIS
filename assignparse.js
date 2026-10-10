'use strict';
/* Reading an assignment sheet (OCR text of a photo, or the text of a PDF) into what JARVIS keeps: a title, the subject, the due date, and the questions.
   parseAssignment(text, { now, subjects }) → { title, subject, due (ms or null), dueText, marks, questions, notes }.
   Dates are read the Indian way (day first: 03/04/2026 is 3 April). A date that is only a weekday ("by Friday") means the next one. Nothing is guessed
   silently: the page shows the result and asks before adding anything, and `notes` says what was assumed. Pure, tested in Node. */
const AssignParse = (() => {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const monthIdx = s => { s = s.toLowerCase(); const i = MONTHS.indexOf(s); return i >= 0 ? i : MON[s.slice(0, 4) === 'sept' ? 'sept' : s.slice(0, 3)]; };
  const MONTH_RE = '(?:' + MONTHS.join('|') + '|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.?';
  const startOfDay = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
  const fullYear = y => { y = +y; return y < 100 ? 2000 + y : y; };
  const mkDate = (y, m, d) => { const t = new Date(y, m, d); return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d ? t.getTime() : null; };

  // One date inside a piece of text → { at (start of that day), text, assumed? } or null
  function findDate(text, now) {
    const t = String(text);
    let m;
    // 15/10/2026 · 15-10-26 · 15.10.2026   (day first)
    if ((m = t.match(/(?<![\d/.-])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?![\d])/))) {
      let d = +m[1], mo = +m[2], y = fullYear(m[3]), swapped = false;
      if (mo > 12 && d <= 12) { [d, mo] = [mo, d]; swapped = true; }
      const at = mkDate(y, mo - 1, d);
      if (at !== null) return { at, text: m[0], assumed: !swapped && d <= 12 && mo <= 12 && d !== mo ? 'read as ' + d + ' ' + MONTHS[mo - 1].replace(/^./, c => c.toUpperCase()) + ' (day first)' : '' };
    }
    // 15 Oct 2026 · 15th October · 15 Oct
    if ((m = t.match(new RegExp('(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(' + MONTH_RE + ')(?:[,\\s]+(\\d{4}|\\d{2}))?(?![a-z])', 'i')))) {
      const d = +m[1], mo = monthIdx(m[2].replace('.', ''));
      if (mo !== undefined && d >= 1 && d <= 31) return resolve(d, mo, m[3], now, m[0]);
    }
    // October 15 · Oct 15th, 2026
    if ((m = t.match(new RegExp('(' + MONTH_RE + ')\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?(?!\\d)', 'i')))) {
      const d = +m[2], mo = monthIdx(m[1].replace('.', ''));
      if (mo !== undefined && d >= 1 && d <= 31) return resolve(d, mo, m[3], now, m[0]);
    }
    if (/\btomorrow\b/i.test(t)) return { at: addDays(startOfDay(now), 1), text: 'tomorrow', assumed: '' };
    if (/\btoday\b/i.test(t)) return { at: startOfDay(now), text: 'today', assumed: '' };
    if ((m = t.match(/\b(?:next\s+|this\s+|coming\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
      const wd = WD.indexOf(m[1].toLowerCase()); let d = startOfDay(now);
      for (let i = 0; i < 8; i++) { d = addDays(d, i ? 1 : 0); if (i && new Date(d).getDay() === wd) break; }
      return { at: d, text: m[0], assumed: 'the next ' + m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() };
    }
    return null;
  }
  function resolve(d, mo, yRaw, now, text) {
    if (yRaw) { const at = mkDate(fullYear(yRaw), mo, d); return at === null ? null : { at, text, assumed: '' }; }
    const base = new Date(now).getFullYear(); let at = mkDate(base, mo, d);
    if (at === null) return null;
    let assumed = '';
    if (at < startOfDay(now) - 14 * 864e5) { at = mkDate(base + 1, mo, d); assumed = 'next year, because that date has passed'; }
    return { at, text, assumed };
  }
  function findTime(text) {
    const m = String(text).match(/\b(?:by|before|at|till|until)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || String(text).match(/\b(?:by|before|at)\s+(\d{1,2}):(\d{2})\b/i);
    if (!m) return null;
    let h = +m[1], mi = +(m[2] || 0); const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    return h <= 23 && mi <= 59 ? { h, m: mi } : null;
  }

  const DUE_WORDS = /\b(due(?:\s+(?:date|on|by))?|submi(?:t|ssion)(?:\s+(?:on|by|before|date))?|deadline|last\s+date(?:\s+(?:of|for)\s+submission)?|hand(?:ed)?\s+in|to\s+be\s+submitted|before|by)\b/i;
  const TITLE_RE = /\b((?:assignment|tutorial\s+sheet|tutorial|lab(?:\s+record|\s+manual)?|practical|mini[- ]project|project|problem\s+set|worksheet|homework|home\s+assignment|case\s+study|seminar|record)\s*(?:no\.?|number|#|-)?\s*\d{0,2})\b/i;

  function parseAssignment(text, { now = Date.now(), subjects = [] } = {}) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').slice(0, 20000);
    const lines = raw.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const notes = [];
    // due date: a line that has a "due" word and a date; else any line with a date near such a word; else the only date in the text
    let due = null, dueText = '', dueLine = '';
    for (let i = 0; i < lines.length && !due; i++) {
      if (!DUE_WORDS.test(lines[i])) continue;
      for (const cand of [lines[i], (lines[i] + ' ' + (lines[i + 1] || ''))]) { const d = findDate(cand.slice(Math.max(0, cand.search(DUE_WORDS))), now) || findDate(cand, now); if (d) { due = d; dueLine = cand; break; } }
    }
    if (!due) {
      const all = lines.map(l => findDate(l, now)).filter(Boolean);
      if (all.length === 1) { due = all[0]; dueLine = lines.find(l => findDate(l, now)); notes.push('I found only one date, so I took it as the due date.'); }
      else if (all.length > 1) notes.push('I found several dates and none next to a “due” or “submit” word, so I did not pick one.');
    }
    let dueAt = null;
    if (due) {
      dueText = due.text; if (due.assumed) notes.push('The date “' + due.text + '” was ' + due.assumed + '.');
      const tm = findTime(dueLine); dueAt = new Date(due.at); dueAt.setHours(tm ? tm.h : 23, tm ? tm.m : 59, 0, 0); dueAt = dueAt.getTime();
      if (dueAt < now - 36e5) notes.push('That date is already in the past.');
    }
    // subject: "Subject: X" / "Course: X" first, else a subject you already track, mentioned in the text
    let subject = '';
    const sm = raw.match(/\b(?:subject|course|paper)\s*(?:name|title)?\s*[:\-]\s*(?:[A-Z]{2,4}\s?\d{2,4}[A-Z]?\s*[-–:]\s*)?([^\n,;|]{2,50})/i);
    if (sm) subject = sm[1].replace(/\b(assignment|date|due|marks)\b.*$/i, '').trim();
    const known = (subjects || []).find(n => new RegExp('(^|[^a-z0-9])' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(raw));
    if (known) subject = known;
    subject = subject.replace(/\s{2,}/g, ' ').slice(0, 40);
    // title
    let kind = ''; const tm2 = raw.match(TITLE_RE); if (tm2) kind = tm2[1].replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase());
    let title = kind;
    if (!title) title = (lines.find(l => l.length >= 5 && l.length <= 70 && !findDate(l, now) && !/^(name|roll|reg|usn|class|section|dept|department|date|marks?|max|time|page)\b/i.test(l) && /[A-Za-z]{3}/.test(l)) || '').slice(0, 60);
    if (subject && title && !title.toLowerCase().includes(subject.toLowerCase())) title = subject + ' — ' + title;
    if (!title && subject) title = subject + ' — assignment';
    const mk = raw.match(/\b(?:max(?:imum)?\s*)?marks?\s*[:\-]?\s*(\d{1,3})\b|\b(\d{1,3})\s*marks\b/i);
    const marks = mk ? +(mk[1] || mk[2]) : null;
    // questions: "Q1.", "1)", "Question 2:" lines
    const questions = [];
    for (let i = 0; i < lines.length && questions.length < 12; i++) {
      const m = lines[i].match(/^(?:q(?:uestion)?\.?\s*)?(\d{1,2})\s*[.):\-]\s*(.{8,})$/i) || lines[i].match(/^question\s+(\d{1,2})\s*[:.\-]?\s*(.{8,})$/i);
      if (m && +m[1] === questions.length + 1) questions.push(m[2].slice(0, 120));
    }
    return { title: title.slice(0, 80), subject, due: dueAt, dueText, marks, questions, notes };
  }
  return { parseAssignment, findDate, findTime };
})();
if (typeof module !== 'undefined') module.exports = AssignParse;
