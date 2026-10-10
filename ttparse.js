'use strict';
/* Reading a timetable from three kinds of source, into the same entries JARVIS keeps for classes: { name, day (0 = Sunday … 6), h, m, dur?, room? }.
     parseText(text)   pasted lines:  "Mon 9:00-10:00 DBMS", "Monday: DBMS 9am, OS 10am", a day on its own line then times and subjects below it;
     parseIcs(text)    a calendar file (.ics): weekly repeating events; one-off events are listed as skipped;
     parseGrid(ocr)    a photo of a timetable table: Windows OCR word boxes (/api/ocr/words) rebuilt into rows and columns by position.
   Every parser returns { entries, skipped:[{why, text}], notes:[…] } and never throws on odd input. Nothing is guessed silently: what could not be
   read is listed, and the page shows everything for a yes/no before anything is added. Pure, so it is tested in Node with sample text and boxes. */
const TtParse = (() => {
  const DAY_NAMES = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  const DAY_RE = /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b\.?/gi;
  const dayOf = w => { const k = String(w || '').toLowerCase().replace(/[^a-z]/g, ''); return k in DAY_NAMES ? DAY_NAMES[k] : -1; };
  const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NOT_A_CLASS = /^(?:break|lunch|lunch break|recess|free|free period|nil|none|library|-+|—+|–+|\/+|n\/a|na|holiday|tea|snacks)$/i;
  const SEP = /^[\s,;:|\-–—.]+|[\s,;:|\-–—.]+$/g;

  /* ---------- times ---------- */
  // "9", "9:30", "9.30", "9am", "9:30 pm" → minutes since midnight. ampm may be undefined. nextAfter: for a missing am/pm, assume afternoon when the hour is small.
  function toMinutes(h, m, ap) {
    h = +h; m = +(m || 0); if (!(h >= 0 && h <= 24 && m >= 0 && m <= 59)) return NaN;
    if (ap) { ap = ap.toLowerCase().replace(/[^ap]/g, ''); if (h === 12) h = ap === 'a' ? 0 : 12; else if (ap === 'p') h += 12; }
    else if (h >= 1 && h < 8) h += 12;                                    // "1" and "2" are afternoon; 8 and up are morning
    return h * 60 + m;
  }
  // A time or a range in text. Groups: h1 m1 ap1 – h2 m2 ap2.
  const SPAN = /(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)?(?![\d:]|\.\d)/gi;
  function spanToTimes(m) {
    const [, h1, m1, a1, h2, m2, a2] = m;
    let a = toMinutes(h1, m1, a1 || (h2 !== undefined && a2 && !a1 && +h1 <= 12 && +h1 <= +h2 ? a2 : undefined));
    if (!Number.isFinite(a)) return null;
    let b = null;
    if (h2 !== undefined) {
      b = toMinutes(h2, m2, a2);
      if (Number.isFinite(b) && b <= a) b += 12 * 60;                    // "11-1": the end is after the start
      if (!Number.isFinite(b) || b <= a || b - a > 6 * 60) b = null;
    }
    return { start: a, end: b };
  }
  const hasClock = m => m[2] !== undefined || m[3] !== undefined || m[5] !== undefined || m[6] !== undefined;     // 9:30, 9am, 9:00-10:00 … not a bare "9"

  /* ---------- names ---------- */
  function cleanName(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ');
    let room;
    s = s.replace(/[\(\[]([^)\]]{1,30})[\)\]]/g, (_, inner) => { if (/\d|room|lab|hall|block/i.test(inner)) { room = room || inner.trim().replace(/^(?:room|rm|hall)\.?\s*[:#-]?\s*/i, ''); return ' '; } return ' ' + inner + ' '; });
    s = s.replace(/\b(?:room|rm|hall)\.?\s*[:#-]?\s*([A-Za-z]?\d{1,4}[A-Za-z]?)\b/i, (_, r) => { room = room || r; return ' '; });
    s = s.replace(SEP, '').replace(/\s+/g, ' ').replace(/\b(?:class|lecture|period|hour|session|slot)\b$/i, m => m).trim();
    s = s.replace(SEP, '');
    if (!s || NOT_A_CLASS.test(s) || !/[A-Za-zऀ-෿]/.test(s) || s.length > 60) return { name: '', room };
    return { name: normaliseName(s), room };
  }
  // The rule the attendance tracker uses: short names are acronyms (DBMS), the rest start with a capital; mixed case you typed is kept.
  function normaliseName(s) {
    s = String(s).trim();
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
    return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  const entryOf = (name, day, t, room) => { const e = { name, day, h: Math.floor(t.start / 60) % 24, m: t.start % 60 }; if (t.end) e.dur = t.end - t.start; if (room) e.room = String(room).slice(0, 20); return e; };

  /* ---------- pasted text ---------- */
  function parseLine(line, ctxDays) {
    const skipped = [], entries = [];
    let work = String(line);
    const days = [];
    work = work.replace(DAY_RE, (m) => { const d = dayOf(m); if (d >= 0 && !days.includes(d)) days.push(d); return ' '; });
    const useDays = days.length ? days : ctxDays;
    // time spans, kept with their positions
    const spans = [];
    let m; SPAN.lastIndex = 0;
    while ((m = SPAN.exec(work))) {
      const before = work.slice(0, m.index).trimEnd();
      const bare = !hasClock(m);
      // a bare number ("Unit 3", "CS 101") is a time only when it starts the line or follows a separator, and the line has a day
      if (bare) { if (!useDays.length || (before && !/[,;|:–—-]$/.test(before))) continue; }
      const t = spanToTimes(m); if (!t) continue;
      spans.push({ i: m.index, j: m.index + m[0].length, t });
    }
    const rest = s => cleanName(s);
    if (!spans.length) return { entries, skipped, days, noTime: true, text: work };
    const after = work.slice(spans[spans.length - 1].j);
    const subjects = [];
    if (cleanName(after).name || spans.length === 1 && !cleanName(work.slice(0, spans[0].i)).name) {
      // times first, subject after each:  "9:00-10:00 DBMS  10:00-11:00 OS"
      spans.forEach((sp, k) => subjects.push(work.slice(sp.j, k + 1 < spans.length ? spans[k + 1].i : work.length)));
    } else {
      // subject first, time after each:  "DBMS 9:00, OS 10:00"
      spans.forEach((sp, k) => subjects.push(work.slice(k ? spans[k - 1].j : 0, sp.i)));
    }
    spans.forEach((sp, k) => {
      const c = rest(subjects[k]);
      if (!c.name) { if (String(subjects[k]).replace(SEP, '').trim() && !NOT_A_CLASS.test(String(subjects[k]).replace(SEP, '').trim())) skipped.push({ why: 'no subject name', text: String(line).trim().slice(0, 80) }); return; }
      if (!useDays.length) { skipped.push({ why: 'no day', text: String(line).trim().slice(0, 80) }); return; }
      for (const d of useDays) entries.push(entryOf(c.name, d, sp.t, c.room));
    });
    return { entries, skipped, days };
  }
  function parseText(text) {
    const entries = [], skipped = [], notes = [];
    let ctx = [];
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 400);
    for (const line of lines) {
      const onlyDays = line.replace(DAY_RE, ' ').replace(/[\s,;:|\-–—.&/]+|\band\b/gi, ' ').trim() === '' && DAY_RE.test(line);
      DAY_RE.lastIndex = 0;
      if (onlyDays) { ctx = [...new Set([...(line.match(DAY_RE) || [])].map(dayOf).filter(d => d >= 0))]; DAY_RE.lastIndex = 0; continue; }
      DAY_RE.lastIndex = 0;
      const r = parseLine(line, ctx);
      if (r.days.length && r.noTime) { ctx = r.days; continue; }          // "Monday:" with a note after it, no time: a heading
      entries.push(...r.entries); skipped.push(...r.skipped);
      if (r.noTime && !r.days.length) skipped.push({ why: 'no time found', text: line.slice(0, 80) });
    }
    return finish(entries, skipped, notes);
  }

  /* ---------- calendar files ---------- */
  const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function icsDate(v, tz) {                 // "20260105T090000" · "20260105T090000Z" → a Date in LOCAL time (written times are taken as they are)
    const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    if (m[7]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0));
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0);
  }
  const unesc = s => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  function parseIcs(text, { now = Date.now() } = {}) {
    const entries = [], skipped = [], notes = [];
    const raw = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');          // unfold wrapped lines
    if (!/BEGIN:VCALENDAR/i.test(raw)) return finish(entries, [{ why: 'not a calendar file', text: '' }], notes);
    const events = raw.split(/BEGIN:VEVENT/i).slice(1).map(b => b.split(/END:VEVENT/i)[0]).slice(0, 500);
    const prop = (block, name) => { const m = block.match(new RegExp('^' + name + '((?:;[^:\\n]*)?):(.*)$', 'im')); return m ? { params: m[1], value: m[2].trim() } : null; };
    for (const ev of events) {
      const sum = prop(ev, 'SUMMARY'), st = prop(ev, 'DTSTART'), en = prop(ev, 'DTEND'), rr = prop(ev, 'RRULE'), loc = prop(ev, 'LOCATION');
      const title = unesc(sum && sum.value).slice(0, 80) || '(no title)';
      if (!st) { skipped.push({ why: 'no start time', text: title }); continue; }
      const a = icsDate(st.value); if (!a || !/T/.test(st.value)) { skipped.push({ why: 'an all-day event', text: title }); continue; }
      if (!rr) { skipped.push({ why: 'a one-off event (only weekly classes are imported)', text: title }); continue; }
      const rule = {}; rr.value.split(';').forEach(p => { const [k, v] = p.split('='); if (k) rule[k.toUpperCase()] = v; });
      if (rule.FREQ !== 'WEEKLY') { skipped.push({ why: 'repeats ' + String(rule.FREQ || 'unknown').toLowerCase() + ', not weekly', text: title }); continue; }
      if (rule.INTERVAL && +rule.INTERVAL > 1) { skipped.push({ why: 'repeats every ' + rule.INTERVAL + ' weeks', text: title }); continue; }
      if (rule.UNTIL) { const u = icsDate(rule.UNTIL); if (u && u.getTime() < now) { skipped.push({ why: 'it ended on ' + u.toLocaleDateString('en-GB'), text: title }); continue; } }
      const b = en ? icsDate(en.value) : null;
      const startMin = a.getHours() * 60 + a.getMinutes();
      let dur; if (b && b > a && b - a <= 6 * 3600e3) dur = Math.round((b - a) / 60000);
      // BYDAY days are the days where the event STARTS in its own time zone; a UTC time can fall on another local day, so shift by that difference
      let days = rule.BYDAY ? rule.BYDAY.split(',').map(x => BYDAY[x.replace(/[^A-Z]/gi, '').slice(-2).toUpperCase()]).filter(d => d !== undefined) : [a.getDay()];
      if (/Z$/i.test(st.value) && rule.BYDAY) { const utcDay = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())).getUTCDay(), shift = (a.getDay() - utcDay + 7) % 7 || 0; const s2 = shift > 3 ? shift - 7 : shift; days = days.map(d => (d + s2 + 7) % 7); }
      if (!days.length) { skipped.push({ why: 'no weekday', text: title }); continue; }
      const c = cleanName(title);
      if (!c.name) { skipped.push({ why: 'no usable name', text: title }); continue; }
      const room = c.room || (loc && unesc(loc.value).slice(0, 20)) || undefined;
      for (const d of days) entries.push(entryOf(c.name, d, { start: startMin, end: dur ? startMin + dur : null }, room));
    }
    if (/;TZID=/i.test(raw) || /T\d{6}Z/.test(raw)) notes.push('Times are taken as written in the file' + (/T\d{6}Z/.test(raw) ? ' (UTC times are shown in this computer’s time zone).' : '.'));
    return finish(entries, skipped, notes);
  }

  /* ---------- a photo of a table ---------- */
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const norm = t => String(t || '').replace(/[^\w:.\-–—]/g, '').toLowerCase();
  // ocr: { width, height, words:[{t,x,y,w,h,l}], lines:[text] } → entries, or { error:'grid' } with the plain text for pasting
  function parseGrid(ocr) {
    const words = (ocr && Array.isArray(ocr.words) ? ocr.words : []).filter(w => w && Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.w) && Number.isFinite(w.h) && String(w.t || '').trim()).map(w => ({ ...w, t: String(w.t).trim(), cx: w.x + w.w / 2, cy: w.y + w.h / 2 }));
    const text = (ocr && Array.isArray(ocr.lines) ? ocr.lines.join('\n') : '') || '';
    const fail = why => ({ entries: [], skipped: [], notes: [why], error: 'grid', text });
    if (words.length < 8) return fail('There was too little text in the picture to be a timetable.');
    const lineH = median(words.map(w => w.h)) || 12;
    // 1. day labels
    const dayWords = [];
    for (const w of words) { const k = norm(w.t).replace(/[.:]+$/, ''); const d = k in DAY_NAMES ? DAY_NAMES[k] : -1; if (d >= 0) dayWords.push({ d, ...w }); }
    const byDay = new Map(); for (const w of dayWords) if (!byDay.has(w.d) || w.t.length > byDay.get(w.d).t.length) byDay.set(w.d, w);
    const days = [...byDay.values()];
    if (days.length < 2) return fail('I could not find the day names (Mon, Tue …) in the picture.');
    // 2. time headers: a time or range, possibly split over several words ("9:00", "-", "10:00") on one OCR line
    const lineGroups = new Map(); for (const w of words) { const k = w.l !== undefined ? 'L' + w.l : 'Y' + Math.round(w.cy / lineH); if (!lineGroups.has(k)) lineGroups.set(k, []); lineGroups.get(k).push(w); }
    const times = [], timeWordSet = new Set();
    for (const g of lineGroups.values()) {
      g.sort((a, b) => a.x - b.x);
      let joined = '', pos = [];
      g.forEach(w => { pos.push([joined.length, joined.length + w.t.length, w]); joined += w.t + ' '; });
      SPAN.lastIndex = 0; let m;
      while ((m = SPAN.exec(joined))) {
        if (!hasClock(m)) continue;
        const t = spanToTimes(m); if (!t) continue;
        const ws = pos.filter(([s, e]) => e > m.index && s < m.index + m[0].length).map(p => p[2]);
        if (!ws.length) continue;
        const x0 = Math.min(...ws.map(w => w.x)), x1 = Math.max(...ws.map(w => w.x + w.w)), y0 = Math.min(...ws.map(w => w.y)), y1 = Math.max(...ws.map(w => w.y + w.h));
        times.push({ t, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ws }); ws.forEach(w => timeWordSet.add(w));
      }
    }
    if (times.length < 2) return fail('I could not find the time slots (like 9:00-10:00) in the picture.');
    const spread = a => Math.max(...a) - Math.min(...a);
    const rows = spread(days.map(d => d.cy)) >= spread(days.map(d => d.cx));          // days down the side, times across the top
    // 3. bands
    const sortKey = rows ? 'cy' : 'cx';
    const bands = (items, key) => { const s = items.slice().sort((a, b) => a[key] - b[key]); return s.map((it, i) => { const lo = i ? (s[i - 1][key] + it[key]) / 2 : it[key] - ((s[1] ? s[1][key] - it[key] : lineH * 2) / 2), hi = i + 1 < s.length ? (it[key] + s[i + 1][key]) / 2 : it[key] + ((s[i - 1] ? it[key] - s[i - 1][key] : lineH * 2) / 2); return { it, lo, hi }; }); };
    // time headers on one line (days as rows) or in one column (days as columns): keep the biggest cluster
    const clusterBy = rows ? 'cy' : 'cx', tol = rows ? lineH * 1.5 : lineH * 4;
    let best = []; for (const t of times) { const grp = times.filter(u => Math.abs(u[clusterBy] - t[clusterBy]) <= tol); if (grp.length > best.length) best = grp; }
    if (best.length < 2) return fail('The time slots are not in one row or column, so I cannot tell which is which.');
    const dayBands = bands(days, rows ? 'cy' : 'cx'), timeBands = bands(best, rows ? 'cx' : 'cy');
    const dayWordSet = new Set(dayWords);
    const cells = new Map();
    for (const w of words) {
      if (dayWordSet.has(w) || timeWordSet.has(w)) continue;
      const dk = rows ? w.cy : w.cx, tk = rows ? w.cx : w.cy;
      const db = dayBands.find(b => dk >= b.lo && dk < b.hi), tb = timeBands.find(b => tk >= b.lo && tk < b.hi);
      if (!db || !tb) continue;
      const id = db.it.d + '|' + timeBands.indexOf(tb);
      if (!cells.has(id)) cells.set(id, { day: db.it.d, slot: tb.it, words: [] });
      cells.get(id).words.push(w);
    }
    const entries = [], skipped = [];
    for (const c of cells.values()) {
      // the first line of the cell is the subject; other lines (teacher, room) are only used to find a room
      const groups = new Map(); for (const w of c.words) { const k = w.l !== undefined ? 'L' + w.l : 'Y' + Math.round(w.cy / lineH); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
      const lines = [...groups.values()].map(g => ({ y: Math.min(...g.map(w => w.cy)), text: g.sort((a, b) => a.x - b.x).map(w => w.t).join(' ') })).sort((a, b) => a.y - b.y);
      const all = lines.map(l => l.text).join(' ');
      const first = cleanName(lines[0].text), roomFromRest = cleanName(lines.slice(1).map(l => l.text).join(' ') + ' ' + lines[0].text).room;
      if (!first.name) { if (all.replace(SEP, '') && !NOT_A_CLASS.test(all.replace(SEP, '').trim())) skipped.push({ why: 'could not read the subject', text: all.slice(0, 60) + ' (' + DAY_LABEL[c.day] + ')' }); continue; }
      entries.push(entryOf(first.name, c.day, c.slot.t, first.room || roomFromRest));
    }
    const res = finish(entries, skipped, [rows ? 'Read as days down the side and time slots across the top.' : 'Read as days across the top and time slots down the side.']);
    if (res.entries.length < 2) return fail('I found the table, but could not read subjects in it.');
    res.text = text;
    return res;
  }

  /* ---------- shared ---------- */
  function finish(entries, skipped, notes) {
    const seen = new Set(), out = [];
    for (const e of entries) { const k = e.day + '|' + e.h + ':' + e.m + '|' + e.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(e); } }
    out.sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.h - b.h || a.m - b.m || a.name.localeCompare(b.name));          // Monday first
    return { entries: out, skipped: skipped.slice(0, 40), notes: notes || [] };
  }
  const hhmm = (h, m) => { const ap = h >= 12 ? 'pm' : 'am', hh = h % 12 || 12; return hh + ':' + String(m).padStart(2, '0') + ' ' + ap; };
  // entries → "Mon: 9:00 am DBMS · 10:00 am OS" lines for the confirmation card
  function describe(entries) {
    const by = new Map();
    for (const e of entries) { if (!by.has(e.day)) by.set(e.day, []); by.get(e.day).push(e); }
    return [...by.entries()].sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7)).map(([d, list]) => '- **' + DAY_LABEL[d] + '** — ' + list.map(e => hhmm(e.h, e.m) + ' ' + e.name + (e.room ? ' (' + e.room + ')' : '')).join(' · '));
  }
  return { parseText, parseIcs, parseGrid, cleanName, normaliseName, describe, hhmm, dayOf, DAY_LABEL, toMinutes };
})();
if (typeof module !== 'undefined') module.exports = TtParse;
