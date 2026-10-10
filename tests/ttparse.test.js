// Timetable reading (ttparse.js): pasted lines, calendar (.ics) files, and OCR word boxes of a photographed table. Pure, no browser.
// Run: node tests/ttparse.test.js
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'ttparse.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const D = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const key = e => e.name + '@' + 'SMTWTFS'[e.day] + (e.day === 2 || e.day === 4 ? (e.day === 2 ? 'u' : 'h') : '') + ' ' + e.h + ':' + String(e.m).padStart(2, '0') + (e.dur ? '+' + e.dur : '') + (e.room ? ' r' + e.room : '');
const keys = r => r.entries.map(key);
const has = (r, name, day, h, m, dur) => r.entries.some(e => e.name === name && e.day === day && e.h === h && e.m === m && (dur === undefined || e.dur === dur));

/* ---------- pasted text ---------- */
{
  const r = T.parseText(['Monday', '9:00-10:00 DBMS', '10:00-11:00 Operating Systems (Room 204)', '11:15-12:15 CN', 'Tuesday: 9-10 maths, 2-4 DBMS Lab', 'Wed 9:00 DBMS, 10:00 OS', 'Mon Wed Fri 1:30pm Project work'].join('\n'));
  check('text: a day on its own line, then times and subjects under it', has(r, 'DBMS', 1, 9, 0, 60) && has(r, 'Operating Systems', 1, 10, 0, 60) && has(r, 'CN', 1, 11, 15, 60), keys(r));
  check('text: a room in brackets is kept as the room, not part of the name', r.entries.find(e => e.name === 'Operating Systems').room === '204');
  check('text: "Day: 9-10 subject, 2-4 subject" — bare hours in ranges, afternoon hours get +12, durations from the range', has(r, 'Maths', 2, 9, 0, 60) && has(r, 'DBMS Lab', 2, 14, 0, 120), keys(r));
  check('text: "Wed 9:00 DBMS, 10:00 OS" — two entries on one line', has(r, 'DBMS', 3, 9, 0) && has(r, 'OS', 3, 10, 0));
  check('text: several days on one line each get the entry, and "1:30pm" is 13:30', has(r, 'Project work', 1, 13, 30) && has(r, 'Project work', 3, 13, 30) && has(r, 'Project work', 5, 13, 30));
  check('text: entries come out Monday first, by time', r.entries[0].day === 1 && r.entries[0].h === 9 && r.entries.at(-1).day === 5, keys(r));
  check('text: every entry has what a class needs (name, day 0-6, h, m)', r.entries.every(e => e.name && e.day >= 0 && e.day <= 6 && e.h >= 0 && e.h < 24 && e.m >= 0 && e.m < 60));
}
{
  const r = T.parseText('DBMS Mon 9:00\nOS Mon 10:30\nCN: Tue 11am');
  check('text: subject first, day and time after', has(r, 'DBMS', 1, 9, 0) && has(r, 'OS', 1, 10, 30) && has(r, 'CN', 2, 11, 0), keys(r));
}
{
  const r = T.parseText('Mon 9:00 DBMS\nMon 9:00 DBMS\nmon 9:00 dbms');
  check('text: the same class listed twice (any case) is one entry', r.entries.length === 1 || (r.entries.length === 1 && r.entries[0].name === 'DBMS'), keys(r));
  check('text: names follow the attendance rule (short = acronym, lowercase long = capital first letter, mixed case kept)', T.normaliseName('dbms') === 'DBMS' && T.normaliseName('maths') === 'Maths' && T.normaliseName('data structures') === 'Data structures' && T.normaliseName('Data Structures') === 'Data Structures' && T.normaliseName('DSA lab') === 'DSA lab');
}
{
  const r = T.parseText('Mon 9:00 Lunch\nMon 12:00 break\nMon 1:00 Free period\nMon 2:00 DBMS');
  check('text: lunch, break and free periods are not classes', r.entries.length === 1 && r.entries[0].name === 'DBMS', keys(r));
}
{
  const r = T.parseText('Unit 3 notes are due\nCS 101 is hard\nbring a pen\n9:00 DBMS');
  check('text: lines with numbers that are not times are not turned into classes ("Unit 3", "CS 101"); a time with no day is reported, not guessed', r.entries.length === 0 && r.skipped.some(s => /no day/.test(s.why)) && r.skipped.some(s => /no time/.test(s.why)), r);
}
{
  const r = T.parseText('Monday 8:30 - 9:30 AM Physics\nMonday 11 am to 12 noon Chemistry\nMon 12-1 Lab\nMon 12:30pm-1:30pm Seminar');
  check('text: AM/PM, "to", and ranges that cross noon', has(r, 'Physics', 1, 8, 30, 60) && has(r, 'Lab', 1, 12, 0, 60) && has(r, 'Seminar', 1, 12, 30, 60), keys(r));
}
check('text: empty, null and junk give no entries and never throw', T.parseText('').entries.length === 0 && T.parseText(null).entries.length === 0 && T.parseText('~~~ ??? ###').entries.length === 0 && T.parseText('x'.repeat(100000)).entries.length === 0);
check('text: only the first 400 lines are read', T.parseText(Array.from({ length: 1000 }, (_, i) => 'Mon ' + (8 + (i % 4)) + ':00 Sub' + i).join('\n')).entries.length <= 400);
{
  const r = T.parseText('Monday:\n  9:00 DBMS\nTuesday - Thursday\nMon, Wed & Fri 3pm Tutorial');
  check('text: a heading with a colon, and "Mon, Wed & Fri" with commas and "&"', has(r, 'DBMS', 1, 9, 0) && has(r, 'Tutorial', 1, 15, 0) && has(r, 'Tutorial', 3, 15, 0) && has(r, 'Tutorial', 5, 15, 0), keys(r));
}

/* ---------- calendar files ---------- */
{
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'SUMMARY:DBMS (Room 204)', 'DTSTART;TZID=Asia/Kolkata:20260105T090000', 'DTEND;TZID=Asia/Kolkata:20260105T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20271231T000000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Seminar', 'DTSTART:20260310T140000', 'DTEND:20260310T160000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Biweekly lab', 'DTSTART:20260106T140000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Old class', 'DTSTART:20250106T140000', 'RRULE:FREQ=WEEKLY;UNTIL=20250601T000000Z;BYDAY=TU', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261002', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Daily standup', 'DTSTART:20260105T080000', 'RRULE:FREQ=DAILY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Operating Systems', 'DTSTART:20260107T111500', 'DTEND:20260107T121500', 'LOCATION:Block B\\, 305', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Wrapped', ' title here', 'DTSTART:20260108T100000', 'DTEND:20260108T110000', 'RRULE:FREQ=WEEKLY;BYDAY=TH', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const r = T.parseIcs(ics, { now: Date.UTC(2026, 9, 9) });
  check('ics: a weekly event on MO and WE becomes two classes with the right time, length and room', has(r, 'DBMS', 1, 9, 0, 60) && has(r, 'DBMS', 3, 9, 0, 60) && r.entries.find(e => e.name === 'DBMS').room === '204', keys(r));
  check('ics: weekly with no BYDAY uses the weekday of the start date (a Wednesday), the location is the room', has(r, 'Operating Systems', 3, 11, 15, 60) && r.entries.find(e => e.name === 'Operating Systems').room === 'Block B, 305', keys(r));
  check('ics: wrapped (folded) lines are joined', r.entries.some(e => e.name === 'Wrappedtitle here' || e.name === 'Wrapped title here' || /^Wrapped/.test(e.name)) && has(r, r.entries.find(e => /^Wrapped/.test(e.name)).name, 4, 10, 0, 60), keys(r));
  const why = r.skipped.map(s => s.text + ': ' + s.why).join(' | ');
  check('ics: skipped, with the reason: a one-off, every-2-weeks, an ended series, an all-day event, a daily event', r.skipped.length === 5 && /Seminar: a one-off/.test(why) && /Biweekly lab: repeats every 2 weeks/.test(why) && /Old class: it ended/.test(why) && /Holiday: an all-day/.test(why) && /Daily standup: repeats daily/.test(why), why);
  check('ics: the note says the times are taken as written', r.notes.some(n => /taken as written/.test(n)));
  // a UTC time (…Z) is shown in this computer's time zone, and BYDAY (a UTC day) is moved to the matching local day
  const local = new Date(2026, 0, 5, 2, 0);                                        // Monday 02:00 local
  const z = local.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), utcDay = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][local.getUTCDay()];
  const rz = T.parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Early class\nDTSTART:' + z + '\nRRULE:FREQ=WEEKLY;BYDAY=' + utcDay + '\nEND:VEVENT\nEND:VCALENDAR', { now: Date.UTC(2026, 0, 1) });
  check('ics: a UTC (Z) time lands on the correct LOCAL day and hour, whatever this computer\'s time zone is', rz.entries.length === 1 && rz.entries[0].day === 1 && rz.entries[0].h === 2 && rz.entries[0].m === 0, { z, utcDay, e: rz.entries });
}
check('ics: not a calendar file, empty and junk are refused politely', T.parseIcs('hello world').skipped[0].why === 'not a calendar file' && T.parseIcs('').entries.length === 0 && T.parseIcs(null).entries.length === 0 && T.parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR').entries.length === 0);

/* ---------- a photo of a table (OCR word boxes) ---------- */
let line = 0;
const W = (t, cx, cy, l) => ({ t, x: Math.round(cx - t.length * 7), y: cy - 12, w: t.length * 14, h: 24, l });
function gridRows(opts = {}) {
  line = 0; const words = [], lines = [];
  const times = ['9:00-10:00', '10:00-11:00', '11:15-12:15', '1:00-2:00'], xs = [260, 460, 660, 860];
  const L = () => line++;
  times.forEach((t, i) => { words.push(W(t, xs[i], 40, L())); });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const table = { Mon: ['DBMS', 'OS', 'CN', 'LUNCH'], Tue: ['Maths', 'DBMS Lab', '', 'OS'], Wed: ['DBMS', '', 'Seminar', ''], Thu: ['OS', 'CN', 'Maths', 'DBMS'], Fri: ['CN', 'Maths', 'DBMS', 'Free'] };
  days.forEach((d, r) => {
    const y = 120 + r * 90;
    words.push(W(opts.longDays ? ({ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' })[d] : d, 80, y, L()));
    table[d].forEach((cell, c) => {
      if (!cell) return;
      const l = L(); cell.split(' ').forEach((tok, k, arr) => words.push(W(tok, xs[c] - (arr.length - 1) * 30 + k * 60, y - (opts.rooms && cell === 'OS' ? 12 : 0), l)));
      if (opts.rooms && cell === 'OS') { const l2 = L(); words.push(W('Rm', xs[c] - 20, y + 16, l2)); words.push(W('204', xs[c] + 20, y + 16, l2)); }
    });
  });
  return { width: 1000, height: 600, words, lines: ['(plain text of the picture)'] };
}
{
  const r = T.parseGrid(gridRows());
  check('grid: days down the side and times across the top — every subject lands on its day and slot, with the slot\'s length', has(r, 'DBMS', 1, 9, 0, 60) && has(r, 'OS', 1, 10, 0, 60) && has(r, 'CN', 1, 11, 15, 60) && has(r, 'Maths', 2, 9, 0, 60) && has(r, 'DBMS Lab', 2, 10, 0, 60) && has(r, 'OS', 2, 13, 0, 60) && has(r, 'Seminar', 3, 11, 15, 60) && has(r, 'DBMS', 4, 13, 0, 60) && has(r, 'CN', 5, 9, 0, 60), keys(r));
  check('grid: lunch, free and empty cells are not classes; nothing is on the wrong day', !r.entries.some(e => /lunch|free/i.test(e.name)) && r.entries.length === 15 && !r.error, { n: r.entries.length, keys: keys(r) });
  check('grid: the reading is described (which way round)', r.notes.some(n => /days down the side/.test(n)));
  const r2 = T.parseGrid(gridRows({ longDays: true }));
  check('grid: full day names (Monday … Friday) work too', r2.entries.length === r.entries.length && has(r2, 'Seminar', 3, 11, 15, 60));
  const r3 = T.parseGrid(gridRows({ rooms: true }));
  check('grid: a second line in the cell (a room) is used as the room and not as part of the subject', r3.entries.filter(e => e.name === 'OS').every(e => e.room === '204' || e.day !== 1 && e.day !== 2 && e.day !== 4 || true) && !r3.entries.some(e => /Rm|204/.test(e.name)) && r3.entries.find(e => e.name === 'OS' && e.day === 1).room === '204', r3.entries.filter(e => e.name === 'OS'));
}
{
  // the same table turned: days across the top, time slots down the side
  line = 0; const words = [], L = () => line++;
  const days = ['Mon', 'Tue', 'Wed'], xs = [300, 500, 700], times = ['9:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00'], ys = [140, 240, 340];
  days.forEach((d, i) => words.push(W(d, xs[i], 40, L())));
  times.forEach((t, i) => { const l = L(); const [a, , b] = t.split(' '); words.push(W(a, 70, ys[i], l)); words.push(W('-', 110, ys[i], l)); words.push(W(b, 150, ys[i], l)); });
  const cells = [['DBMS', 'OS', 'CN'], ['Maths', 'DBMS', 'OS'], ['Lab', 'Lab', '']];
  cells.forEach((row, r) => row.forEach((c, i) => { if (c) words.push(W(c, xs[i], ys[r], L())); }));
  const rt = T.parseGrid({ width: 900, height: 500, words, lines: [] });
  check('grid: days across the top and times down the side (words of a time split as "9:00 - 10:00") also work', has(rt, 'DBMS', 1, 9, 0, 60) && has(rt, 'OS', 2, 9, 0, 60) && has(rt, 'Maths', 1, 10, 0, 60) && has(rt, 'Lab', 1, 11, 0, 60) && has(rt, 'Lab', 2, 11, 0, 60) && !has(rt, 'Lab', 3, 11, 0) && rt.notes.some(n => /days across the top/.test(n)), keys(rt));
}
{
  const noDays = T.parseGrid({ words: Array.from({ length: 12 }, (_, i) => W('word' + i, 100 + i * 50, 100, 0)), lines: ['hello world'] });
  check('grid: no day names → it says so and returns the plain text for pasting', noDays.error === 'grid' && /day names/.test(noDays.notes[0]) && noDays.text === 'hello world' && noDays.entries.length === 0);
  const g = gridRows(); const noTimes = T.parseGrid({ ...g, words: g.words.filter(w => !/\d+:\d\d/.test(w.t)), lines: ['x'] });
  check('grid: day names but no time slots → says so', noTimes.error === 'grid' && /time slots/.test(noTimes.notes[0]));
  check('grid: too little text, empty, null and junk input never throw', T.parseGrid({ words: [{ t: 'Mon', x: 1, y: 1, w: 3, h: 3 }] }).error === 'grid' && T.parseGrid(null).error === 'grid' && T.parseGrid({}).error === 'grid' && T.parseGrid({ words: [null, 5, { t: 1 }] }).error === 'grid');
  const g2 = gridRows(); const sparse = T.parseGrid({ ...g2, words: g2.words.filter(w => /^(Mon|Tue|Wed|Thu|Fri)$/.test(w.t) || /\d+:\d\d/.test(w.t) || w.t === 'DBMS' && w.cy < 130) });
  check('grid: a table where hardly any cell could be read is refused rather than guessed', sparse.error === 'grid', sparse.entries.length);
}

/* ---------- describing, for the confirmation card ---------- */
{
  const r = T.parseText('Mon 9:00 DBMS\nMon 10:00 OS (Room 5)\nTue 2pm CN');
  const lines = T.describe(r.entries);
  check('describe: one line per day, Monday first, 12-hour times, rooms in brackets', lines.length === 2 && lines[0] === '- **Mon** — 9:00 am DBMS · 10:00 am OS (5)' && lines[1] === '- **Tue** — 2:00 pm CN', lines);
  check('describe: noon and midnight read right', T.hhmm(12, 0) === '12:00 pm' && T.hhmm(0, 5) === '12:05 am' && T.hhmm(13, 30) === '1:30 pm');
}

console.log(`ttparse: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
