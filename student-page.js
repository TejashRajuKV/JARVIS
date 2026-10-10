'use strict';
/* Student tools, chat side: timetable import, "can I bunk tomorrow?", lecture mode and exam mode. Explicit wording only (see match()); the page's own
   data (classes, attendance, flashcards, exam history) is changed here, and every change shows first and has one Undo.
     Timetable   "import my timetable": from a photo (OCR word boxes → ttparse.js), a calendar file (.ics) or pasted lines. Always shown for a yes/no first.
     Bunk        "can I bunk tomorrow?": tomorrow's classes from the timetable, the 75% maths per subject from your attendance.
     Lecture     "start lecture mode for DBMS": the browser's speech recogniser listens until you stop it; the transcript is appended to
                 ~/jarvis/Notes every 3 minutes; at the end the server turns it into notes (studyserver.js). Needs the tab visible and the internet.
     Exam        "start an exam on dbms_notes.md": questions from a note, a countdown, answers typed or spoken, grading at the end by the viva grader
                 against the answers in your notes; weak answers go to a "Mistakes" flashcard deck, and the score is kept in history.
   Camera and microphone tools refuse a message that came from the phone. Uses the page's globals (callTool, store, classes, attendance, flashcards…). */
const Student = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'STUDY' }, extra || {});
  const plain = s => String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const PHONE_NO = 'I only use the microphone for requests made at the laptop, so I won’t do that from a phone message. Ask me again from JARVIS on the laptop.';
  const ask = (text, yes) => (typeof Extras !== 'undefined' && Extras.confirmCard ? Extras.confirmCard(text, yes) : Promise.resolve(false));
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ================= wording ================= */
  const TT_IMPORT = /^(?:please\s+)?(?:import|add|load|scan|read|upload|set\s*up)\s+(?:my\s+|the\s+|a\s+)?(?:class\s+)?(?:time\s*table|class\s+schedule)(?:\s+(?:from|using|via|with)\s+(?:a\s+|an\s+|the\s+|my\s+)?(photo|picture|image|pic|camera|ics(?:\s+file)?|calendar(?:\s+file)?|file|text|pasted\s+text))?\s*[.!?]*$|^\/timetable\s+import\s*$/i;
  const TT_INLINE = /^(?:please\s+)?import\s+(?:my\s+|the\s+)?(?:time\s*table|class\s+schedule)\s*[:\-]\s*(.+)$/i;
  const BUNK = /^(?:can|may|could)\s+i\s+(?:bunk|skip|miss|take\s+(?:off|a\s+leave)|afford\s+to\s+(?:miss|skip|bunk))\s+(?:(?:all\s+)?(?:my\s+|the\s+)?(?:college|classes|class|lectures?|school)\s+)?(?:on\s+)?(tomorrow|today|(?:the\s+)?day\s+after\s+tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:'s)?(?:\s+(?:college|classes|class|lectures?))?\s*[?.!]*$|^should\s+i\s+(?:go\s+to|attend)\s+(?:college|classes|class)\s+(tomorrow|today)\s*[?.!]*$/i;
  const LEC_START = /^(?:please\s+)?(?:(?:start|begin|enable|turn\s+on)\s+(?:the\s+)?lecture\s+mode|lecture\s+mode\s+on|(?:record|transcribe)\s+(?:this|the|my)\s+lecture)(?:\s+(?:for|on|of|in)\s+(.+?))?\s*[.!]*$/i;
  const LEC_STOP = /^(?:please\s+)?(?:(?:stop|end|finish|exit|turn\s+off)\s+(?:the\s+)?lecture(?:\s+mode)?|lecture\s+mode\s+off|that(?:'s|\s+is)\s+the\s+end\s+of\s+the\s+lecture)\s*[.!]*$/i;
  const EXAM_START = /^(?:please\s+)?(?:(?:start|begin|take|run|give\s+me|set\s+(?:me\s+)?up)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:(?:(?:mock|practice|timed)\s+)(?:exam|test)|exam)\s*(?:mode)?\s+(?:on|from|about|for)\s+(.+?)|exam\s+me\s+(?:on|from|about)\s+(.+?)|(?:start|begin)\s+(?:an?\s+)?(?:mock\s+|practice\s+|timed\s+)?exam\s+mode)\s*[.!?]*$/i;
  const EXAM_STOP = /^(?:please\s+)?(?:stop|end|finish|quit|exit|cancel)\s+(?:the\s+|my\s+)?(?:mock\s+|practice\s+)?(?:exam|test)(?:\s+mode)?\s*[.!]*$/i;
  const EXAM_HISTORY = /^(?:how\s+did\s+(?:my|the)\s+(?:mock\s+|practice\s+)?exams?\s+go|(?:show|list|what\s+(?:are|is))\s+(?:me\s+)?(?:my\s+)?(?:past\s+|previous\s+|recent\s+)?exam\s+(?:history|results|scores?)|exam\s+history|my\s+exam\s+(?:results|scores|history))\s*[?.!]*$/i;
  const FIT = /^(?:please\s+)?(?:fit|schedule|arrange|slot|put|plan|place)\s+(?:my\s+|the\s+)?(?:(.+?)\s+)?(?:study\s+(?:plan|sessions?)|revision(?:\s+plan)?)\s+(?:into|around|in|to|with|on|onto)\s+(?:my\s+)?(?:time\s*table|classes|class\s+schedule|free\s+(?:time|slots|periods|gaps?)|gaps?)(?:\s+(?:with|using|in)\s+(\d{2,3})[\s-]*(?:min(?:ute)?s?)\s+(?:sessions?|blocks?|slots?))?\s*[.!]*$|^(?:please\s+)?when\s+(?:can|should)\s+i\s+study\s*(?:this\s+week)?\s*[?.!]*$|^(?:please\s+)?(?:show|find|list|what\s+are)\s+(?:me\s+)?(?:my\s+)?free\s+(?:slots|periods|gaps)(?:\s+(?:this\s+week|this\s+week'?s|for\s+studying))?\s*[?.!]*$/i;
  const ATT_SW = /^(?:please\s+)?(?:(stop|don'?t|do\s+not)\s+(?:asking|ask)\s+(?:me\s+)?(?:about\s+)?attendance|(?:ask|prompt)\s+me\s+(?:about\s+)?attendance\s+after\s+(?:each\s+|every\s+)?class|(turn\s+off|disable)\s+attendance\s+(?:prompts?|questions?)|(?:turn\s+on|enable)\s+attendance\s+(prompts?|questions?))\s*[.!]*$/i;
  const ASSIGN = /^(?:please\s+)?(?:add|read|import|log|capture|take|get)\s+(?:my\s+|an?\s+|the\s+|this\s+|new\s+)?(?:assignment|homework|home\s+work|tutorial\s+sheet|worksheet|lab\s+record)(?:\s+(?:sheet|details|question\s+paper))?\s+(?:from|using|via|off)\s+(?:a\s+|an\s+|the\s+|my\s+)?(photo|picture|image|pic|camera|(?:pdf|file|document)\s+.+|.+\.(?:pdf|txt|md|docx?))\s*[.!]*$/i;
  const OFFSTT = /^(?:please\s+)?(?:(turn\s+on|enable|switch\s+on|use)|(turn\s+off|disable|switch\s+off|stop\s+using))\s+(?:the\s+)?offline\s+(?:speech|transcription|whisper|speech[\s-]to[\s-]text)(?:\s+for\s+(?:my\s+)?lectures?)?\s*[.!]*$|^(?:is\s+)?(?:offline\s+(?:speech|whisper|transcription)|whisper)\s+(?:installed|ready|working|available|set\s*up)\s*\??$|^offline\s+(?:speech|whisper)\s+status\s*$/i;
  function match(t) {
    t = String(t || '').trim();
    let m;
    if ((m = t.match(OFFSTT))) return { kind: 'offstt', on: m[1] ? true : m[2] ? false : undefined };
    if ((m = t.match(ASSIGN))) { const s = m[1].trim(); return /^(?:photo|picture|image|pic|camera)$/i.test(s) ? { kind: 'assign', how: 'photo' } : { kind: 'assign', how: 'file', file: s.replace(/^(?:pdf|file|document)\s+/i, '').replace(/^["']|["']$/g, '') }; }
    if (typeof Study !== 'undefined' && Study.parseEndSem) { const es = Study.parseEndSem(t); if (es) return { kind: 'endsem', ...es }; }
    if ((m = t.match(ATT_SW))) return { kind: 'attsw', on: !(m[1] || m[2]) };
    if ((m = t.match(FIT))) return { kind: 'fit', name: (m[1] || '').replace(/^(?:my|the)\s+/i, '').trim(), min: m[2] ? +m[2] : 0 };
    if ((m = t.match(BUNK))) return { kind: 'bunk', day: (m[1] || m[2] || '').toLowerCase().replace(/^the\s+/, '') };
    if ((m = t.match(TT_INLINE))) return { kind: 'tt', source: 'text', text: m[1] };
    if ((m = t.match(TT_IMPORT))) { const s = (m[1] || '').toLowerCase(); return { kind: 'tt', source: /photo|picture|image|pic|camera/.test(s) ? 'photo' : /ics|calendar|file/.test(s) ? 'ics' : /text|paste/.test(s) ? 'text' : '' }; }
    if (LEC_STOP.test(t)) return { kind: 'lecture-stop' };
    if ((m = t.match(LEC_START))) return { kind: 'lecture-start', subject: (m[1] || '').trim().replace(/^(?:my|the)\s+/i, '') };
    if (EXAM_STOP.test(t)) return { kind: 'exam-stop' };
    if (EXAM_HISTORY.test(t)) return { kind: 'exam-history' };
    if ((m = t.match(EXAM_START))) {
      let rest = (m[1] || m[2] || '').trim();
      const mins = rest.match(/\b(?:for\s+)?(\d{1,3})\s*(?:min(?:ute)?s?)\b/i), qn = rest.match(/\b(\d{1,2})\s+questions?\b/i);
      rest = rest.replace(/\b(?:for\s+)?\d{1,3}\s*(?:min(?:ute)?s?)\b/i, ' ').replace(/\b(?:with\s+)?\d{1,2}\s+questions?\b/i, ' ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').replace(/^(?:my|the)\s+/i, '');
      return { kind: 'exam-start', source: rest, minutes: mins ? +mins[1] : 0, n: qn ? +qn[1] : 0 };
    }
    return null;
  }
  const looksLikeFile = s => /\.(?:md|markdown|txt|pdf|docx?|pptx?)$/i.test(s) || /^[\w()-]+[_-][\w()_-]+$/.test(s);

  /* ================= timetable import ================= */
  const subjectKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // the same name rule the attendance tracker uses, so "dbms" and "DBMS" become one subject
  function subjectName(raw) {
    const said = subjectKey(raw);
    const known = [...Object.keys(typeof attendance !== 'undefined' ? attendance : {}), ...(typeof classes !== 'undefined' ? classes.map(c => c.name) : [])].find(k => subjectKey(k) === said);
    return known || TtParse.normaliseName(String(raw).trim());
  }
  async function importEntries(entries, label, skippedInfo) {
    if (!entries.length) return say('I could not read any classes from ' + label + (skippedInfo || '') + '.');
    const lines = TtParse.describe(entries);
    const existing = new Set(classes.map(c => c.day + '|' + c.h + ':' + c.m + '|' + subjectKey(c.name)));
    const fresh = entries.filter(e => !existing.has(e.day + '|' + e.h + ':' + e.m + '|' + subjectKey(e.name)));
    const dupes = entries.length - fresh.length;
    const go = await ask('I read **' + pl(entries.length, 'class', 'classes') + '** from ' + label + ':\n' + lines.join('\n') + '\n\n' + (dupes ? pl(dupes, 'of these is', 'of these are') + ' already in your timetable and will be skipped. ' : '') + (skippedInfo || '') + 'Add **' + pl(fresh.length, 'class', 'classes') + '** to your timetable? Nothing you already have is changed, and **“undo”** takes the new ones out again.', 'YES, IMPORT');
    if (!go) return say('Okay, I did not change your timetable.');
    if (!fresh.length) return say('Everything in there is already in your timetable, so nothing was added.');
    const batch = rid(), added = [];
    for (const e of fresh) { const c = { id: rid(), name: subjectName(e.name), day: e.day, h: e.h, m: e.m, batch }; if (e.dur) c.dur = e.dur; if (e.room) c.room = e.room; classes.push(c); added.push(c.id); }
    saveTasks(); if (typeof sfx !== 'undefined') sfx.ok();
    if (typeof Undo !== 'undefined') Undo.push('imported the timetable', () => { const before = classes.length; classes = classes.filter(c => c.batch !== batch); saveTasks(); return 'Removed the ' + pl(before - classes.length, 'class', 'classes') + ' I imported.'; });
    return say('✓ Added **' + pl(fresh.length, 'class', 'classes') + '** to your timetable' + (dupes ? ' (' + dupes + ' already there)' : '') + '. I will ping you 10 minutes before each one. Say **“what’s my timetable”** to see it, or **“undo”** to take them out.', { speak: 'I added ' + fresh.length + ' classes to your timetable.', suggestions: ['What classes do I have tomorrow?'] });
  }
  const skippedNote = r => (r.skipped && r.skipped.length ? 'I left out **' + pl(r.skipped.length, 'item') + '** (' + [...new Set(r.skipped.map(s => s.why))].slice(0, 3).join('; ') + '). ' : '') + (r.notes && r.notes.length ? r.notes.join(' ') + ' ' : '');
  // a panel with a text box, for pasting lines (the chat box holds one line only)
  function pasteText(initial, hint) {
    return new Promise(resolve => {
      const panel = Camera.openPanel({ title: 'TIMETABLE · PASTE THE LINES', hint: hint || 'One class per line, like “Mon 9:00-10:00 DBMS”, or a day on its own line with the times under it. Press READ IT when done.' });
      const ta = document.createElement('textarea'); ta.value = initial || ''; ta.rows = 12; ta.spellcheck = false; ta.setAttribute('aria-label', 'Timetable text');
      ta.style.cssText = 'width:100%;max-width:100%;background:rgba(0,0,0,.4);color:var(--ink);border:1px solid var(--line-hi);border-radius:8px;padding:10px;font-family:var(--code);font-size:13px';
      panel.body(ta); ta.focus();
      let done = false; const fin = v => { if (!done) { done = true; panel.close(); resolve(v); } };
      panel.buttons([{ label: 'READ IT', primary: true, fn: () => fin(ta.value) }, { label: 'CANCEL', danger: true, fn: () => fin(null) }]);
      panel.onCancel(() => { done = true; resolve(null); });
    });
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none'; document.body.appendChild(inp);
      let settled = false; const fin = v => { if (!settled) { settled = true; inp.remove(); resolve(v); } };
      inp.onchange = () => fin(inp.files[0] || null);
      inp.addEventListener('cancel', () => fin(null));
      inp.click();
      setTimeout(() => { if (!settled && !inp.files.length) { /* stays open until the picker closes */ } }, 0);
    });
  }
  async function ttFromText(text) {
    const r = TtParse.parseText(text);
    if (!r.entries.length) return say('I could not read any classes from that text.' + (r.skipped.length ? ' (' + r.skipped.slice(0, 3).map(s => s.why + ': “' + s.text + '”').join('; ') + ')' : '') + '\n\nWrite one class per line, like **“Mon 9:00-10:00 DBMS”**, or a day on its own line with the times under it.');
    return importEntries(r.entries, 'the text', '\n' + skippedNote(r));
  }
  async function ttFromIcs() {
    const f = await pickFile('.ics,text/calendar');
    if (!f) return say('Okay, no file chosen.');
    if (f.size > 2 * 1024 * 1024) return say('That calendar file is over 2 MB, which is too big to be a timetable.');
    const text = await f.text();
    const r = TtParse.parseIcs(text);
    if (!r.entries.length) return say('I found no weekly repeating classes in that calendar file.' + (r.skipped.length ? ' (' + [...new Set(r.skipped.map(s => s.why))].slice(0, 3).join('; ') + ')' : ''));
    return importEntries(r.entries, 'the calendar file', '\n' + skippedNote(r));
  }
  async function ttFromPhoto(source) {
    if (source === 'phone') return say(Camera.PHONE_NO);
    const shot = await Camera.capture({ title: 'TIMETABLE · PHOTO', hint: 'Photograph or choose a picture of your timetable table, straight on, in good light, with all the day names and time slots visible.', maxSide: 2000 });
    if (!shot) return say('Okay, cancelled.');
    let blob = await Camera.canvasToBlob(shot.canvas, 0.9);
    for (let q = 0.8; blob.size > 2.2 * 1024 * 1024 && q > 0.4; q -= 0.15) blob = await Camera.canvasToBlob(shot.canvas, q);
    setState('PROCESSING', 'Reading the timetable…');
    const ocr = await callTool('/ocr/words', { image: await Camera.blobToBase64(blob) });
    if (ocr.error) return say('I could not read the picture: ' + ocr.error);
    const r = TtParse.parseGrid(ocr);
    if (r.error) {
      // fall back to the plain text of the picture, for the person to correct and paste
      const typed = await pasteText(ocr.text || '', 'I could not rebuild the table from the picture (' + plain((r.notes || [])[0] || '') + '). Here is the text I could read; fix it into lines like “Mon 9:00-10:00 DBMS” and press READ IT.');
      if (typed == null) return say('Okay, I did not import anything.');
      return ttFromText(typed);
    }
    return importEntries(r.entries, 'the photo', '\n' + skippedNote(r) + '*Check the list: handwriting and unusual layouts can be misread.*\n\n');
  }
  async function timetable(m, source) {
    if (m.source === 'text' && m.text) return ttFromText(String(m.text).replace(/\s*;\s*/g, '\n'));
    let how = m.source;
    if (!how) {
      how = await new Promise(resolve => jarvisSay(say('Where is your timetable?', { actions: [
        { label: 'A PHOTO', fn: () => resolve('photo') }, { label: 'A CALENDAR FILE (.ICS)', fn: () => resolve('ics') }, { label: 'PASTE TEXT', fn: () => resolve('text') }, { label: 'CANCEL', fn: () => resolve('') }] })));
      if (!how) return say('Okay, cancelled.');
    }
    if (how === 'photo') return ttFromPhoto(source);
    if (how === 'ics') return ttFromIcs();
    const typed = await pasteText('');
    if (typed == null) return say('Okay, cancelled.');
    return ttFromText(typed);
  }

  /* ================= can I bunk tomorrow? ================= */
  function bunk(dayWord) {
    if (!classes.length) return say('I don’t have your timetable yet. Say **“import my timetable”** (from a photo, a calendar file or pasted lines), or **“add class DBMS on Monday at 10am”**.');
    const now = new Date();
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate()), label;
    if (/^today$/.test(dayWord)) label = 'today';
    else if (/^tomorrow$/.test(dayWord)) { target.setDate(target.getDate() + 1); label = 'tomorrow'; }
    else if (/day after tomorrow/.test(dayWord)) { target.setDate(target.getDate() + 2); label = 'the day after tomorrow'; }
    else { const di = DAYS.findIndex(d => d.toLowerCase() === dayWord); const add = (di - now.getDay() + 7) % 7 || 7; target.setDate(target.getDate() + add); label = DAYS[di]; }
    const day = target.getDay();
    const todays = classes.filter(c => c.day === day);
    if (!todays.length) return say('You have **no classes ' + label + '** (' + DAYS[day] + ') in your timetable, so there is nothing to bunk.');
    const bySubject = new Map();
    for (const c of todays) { const k = subjectKey(c.name); if (!bySubject.has(k)) bySubject.set(k, { name: c.name, n: 0 }); bySubject.get(k).n++; }
    const att = typeof attendance !== 'undefined' ? attendance : {};
    const rows = [...bySubject.values()].map(s => {
      const key = Object.keys(att).find(k => subjectKey(k) === subjectKey(s.name));
      if (!key || !att[key].held) return { s, none: true };
      const e = att[key], afterHeld = e.held + s.n, ok = e.attended * 100 >= 75 * afterHeld;
      return { s, e, afterHeld, ok, now: Study.attendancePct(e.held, e.attended), after: Math.round(1000 * e.attended / afterHeld) / 10 };
    });
    const lines = rows.map(r => r.none ? '- **' + r.s.name + '** (' + pl(r.s.n, 'class', 'classes') + ') — no attendance recorded yet, so I can’t tell.'
      : '- **' + r.s.name + '** (' + pl(r.s.n, 'class', 'classes') + ') — now **' + r.now + '%** (' + r.e.attended + '/' + r.e.held + '). Missing ' + (r.s.n === 1 ? 'it' : 'them') + ' → **' + r.after + '%** (' + r.e.attended + '/' + r.afterHeld + ') ' + (r.ok ? '✓ still 75% or more' : '⚠ below 75%'));
    const risky = rows.filter(r => !r.none && !r.ok), unknown = rows.filter(r => r.none);
    const verdict = risky.length ? '**Not all of them.** ' + risky.map(r => r.s.name).join(', ') + ' would fall under 75%, so go to ' + (risky.length === 1 ? 'that class' : 'those') + (rows.length > risky.length ? ' and skip the rest.' : '.')
      : unknown.length ? '**I can’t be sure:** ' + unknown.map(r => r.s.name).join(', ') + ' ' + (unknown.length === 1 ? 'has' : 'have') + ' no attendance recorded. The others stay at 75% or more.'
        : '**Yes, you can skip ' + label + ':** every subject stays at 75% or more.';
    return say('**' + (label === 'today' || label === 'tomorrow' ? label.charAt(0).toUpperCase() + label.slice(1) : label) + ' (' + DAYS[day].slice(0, 3) + ')** you have ' + pl(todays.length, 'class', 'classes') + ':\n' + lines.join('\n') + '\n\n' + verdict + '\n\n*Attendance also depends on your college’s own count, so treat this as a guide.*',
      { speak: plain(verdict) });
  }

  /* ================= attendance prompt after each class ================= */
  // Called every few seconds by the page's task tick. Asks once per class per day, a few minutes after it ends: PRESENT / ABSENT / SKIP. Nothing is
  // marked without an answer, and every mark has an Undo. Only while JARVIS is open (it does not run in the background).
  function markAttendance(c, present, when) {
    const subject = subjectName(c.name);
    const e = attendance[subject] || (attendance[subject] = { held: 0, attended: 0, log: [] });
    const d = Study.ymd(when || new Date());
    e.log.push({ d, s: present ? 'p' : 'a' }); if (e.log.length > 400) e.log.shift();
    e.held++; if (present) e.attended++;
    saveTasks(); if (typeof sfx !== 'undefined') sfx.ok();
    if (typeof Undo !== 'undefined') Undo.push('marked ' + subject + ' ' + (present ? 'present' : 'absent'), () => {
      const cur = attendance[subject]; if (!cur) return 'That attendance entry is already gone.';
      const i = cur.log.map(x => x.d + x.s).lastIndexOf(d + (present ? 'p' : 'a')); if (i < 0) return 'That attendance entry is already gone.';
      cur.log.splice(i, 1); cur.held = Math.max(0, cur.held - 1); if (present) cur.attended = Math.max(0, cur.attended - 1); saveTasks();
      return 'Un-marked ' + subject + ' for today.';
    });
    const pct = Study.attendancePct(e.held, e.attended);
    return say('✓ **' + subject + '** marked **' + (present ? 'present' : 'absent') + '** — now **' + pct + '%** (' + e.attended + '/' + e.held + ')' + (pct < 75 ? ' ⚠ below 75%. Attend ' + pl(Study.neededToReach(e.held, e.attended, 75), 'class', 'classes') + ' in a row to get back.' : ', ' + pl(Study.bunkable(e.held, e.attended, 75), 'bunk') + ' still safe.') + ' Say **“undo”** to take it back.', { speak: subject + (present ? ' present.' : ' absent.'), intent: 'ATTENDANCE_MARK' });
  }
  function attendanceTick(now) {
    now = now || Date.now();
    try {
      if (typeof settings !== 'undefined' && settings.attendancePrompt === false) return null;
      if (E || !classes.length) return null;
      const asked = store.get('jarvis.attAsked', []);
      const due = Study.attendanceDue({ classes, attendance, now, asked });
      if (!due.length) return null;
      const { c, key } = due[0];
      asked.push(key); store.set('jarvis.attAsked', asked.slice(-200));
      const at = new Date(now); at.setHours(c.h, c.m || 0, 0, 0);
      const t = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const reply = say('📚 **' + c.name + '** (' + t + ') is over. Did you attend?', { noTTS: true, actions: [
        { label: 'I ATTENDED', fn: () => jarvisSay(markAttendance(c, true, new Date(now))) },
        { label: 'I MISSED IT', fn: () => jarvisSay(markAttendance(c, false, new Date(now))) },
        { label: 'SKIP', fn: () => jarvisSay(say('Okay, I did not mark ' + c.name + '. Say **“mark ' + c.name + ' present”** later if you want.')) }] });
      if (typeof notify === 'function') notify('Class over', 'Did you attend ' + c.name + '?');
      jarvisSay(reply);
      return reply;
    } catch (e) { return null; }
  }
  function attendanceSwitch(on) {
    if (typeof settings === 'undefined') return say('I could not change that setting here.');
    settings.attendancePrompt = !!on; if (typeof saveSettings === 'function') saveSettings();
    try { if (typeof bindSwitchState === 'function' && document.getElementById('attendancePromptToggle')) bindSwitchState('#attendancePromptToggle', 'attendancePrompt'); } catch (e) {}
    return say(on ? '✓ I will ask **“did you attend?”** a few minutes after each class in your timetable (only while JARVIS is open).' : '✓ I will not ask about attendance after classes. You can still say **“mark DBMS present”**.');
  }

  /* ================= study plan fitted to the timetable ================= */
  function fitStudy(m) {
    const today = Study.ymd(new Date());
    const plans = (typeof studyPlans !== 'undefined' ? studyPlans : []).filter(p => p.examDate >= today && p.days.some(d => !d.done && d.date >= today));
    const freeOnly = !plans.length || /free/.test(m.raw || '');
    if (!classes.length) return say('I need your timetable to find the gaps. Say **“import my timetable”** (from a photo, a calendar file or pasted lines) first.');
    if (!plans.length) {
      const slots = Study.freeSlots({ classes, from: Date.now(), days: 7, minMin: 45 });
      if (!slots.length) return say('Your next 7 days have no gap of 45 minutes or more between 8 am and 9 pm.');
      const byDay = new Map(); for (const s of slots) { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); }
      const f = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const lines = [...byDay.entries()].slice(0, 7).map(([d, ss]) => '- **' + new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + '** — ' + ss.map(s => f(s.start) + '–' + f(s.end) + ' (' + Math.floor(s.min / 60) + 'h' + (s.min % 60 ? ' ' + s.min % 60 + 'm' : '') + ')').join(', '));
      return say('**Your free gaps this week** (between 8 am and 9 pm, 45 minutes or more):\n' + lines.join('\n') + '\n\nYou have no study plan yet. Say **“plan my GATE prep, exam on 12 Dec, topics: OS, DBMS”** and then **“fit my study plan to my timetable”**.');
    }
    const named = m.name ? plans.find(p => p.name.toLowerCase().includes(m.name.toLowerCase())) : null;
    if (m.name && !named) return say('I have no study plan called “' + m.name + '”. Your plans: ' + plans.map(p => '**' + p.name + '**').join(', ') + '.');
    const plan = named || plans.slice().sort((a, b) => (a.examDate < b.examDate ? -1 : 1))[0];
    const studyMin = Math.max(30, Math.min(180, m.min || 60));
    const fit = Study.fitPlan({ plan, classes, now: Date.now(), studyMin });
    if (!fit.length) return say('Nothing is left to schedule in **' + plan.name + '**.');
    const f = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dl = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const placed = fit.filter(x => !x.none), none = fit.filter(x => x.none);
    const lines = fit.slice(0, 12).map(x => '- **' + dl(x.date) + '** ' + (x.none ? '— *no free gap that day*' : f(x.start) + '–' + f(x.end)) + ' — ' + x.topic);
    const future = placed.filter(x => x.start > Date.now() + 6e4);
    return say('**' + plan.name + ' — fitted to your timetable** (exam ' + dl(plan.examDate) + '; ' + pl(studyMin, 'minute') + ' per session, in the longest free gap each day)\n' + lines.join('\n') + (fit.length > 12 ? '\n- …and ' + (fit.length - 12) + ' more' : '') + (none.length ? '\n\n⚠ ' + pl(none.length, 'day') + ' ' + (none.length === 1 ? 'has' : 'have') + ' no gap of ' + Math.min(studyMin, 45) + ' minutes or more. Those topics are not scheduled.' : '') + '\n\nNothing is set until you press the button.',
      { speak: 'I fitted ' + placed.length + ' study sessions into your free time.', actions: future.length ? [{ label: 'ADD ' + Math.min(future.length, 60) + ' REMINDERS', fn: () => {
        const ids = []; for (const x of future.slice(0, 60)) { const id = rid(); reminders.push({ id, text: '📚 Study: ' + x.topic + ' (' + plan.name + ') — ' + f(x.start), at: x.start, fired: false }); ids.push(id); }
        saveTasks(); if (typeof askNotify === 'function') askNotify();
        if (typeof Undo !== 'undefined') Undo.push('added study reminders', () => { const s = new Set(ids); reminders = reminders.filter(r => !s.has(r.id)); saveTasks(); return 'Removed ' + pl(ids.length, 'study reminder') + '.'; });
        jarvisSay(say('✓ Added ' + pl(ids.length, 'reminder') + ', each at the start of its slot. **“undo”** removes them.'));
      } }] : undefined });
  }

  /* ================= an assignment sheet → deadline + to-dos ================= */
  // The text comes from a photo (OCR) or a file (a PDF or note in ~/jarvis); assignparse.js finds the title, subject, due date and questions. The result is
  // shown first; only "yes" adds anything, and one Undo removes the deadline and the to-dos together.
  async function assignment(m, source) {
    let text = '', from = '';
    if (m.how === 'photo') {
      if (source === 'phone') return say(Camera.PHONE_NO);
      const shot = await Camera.capture({ title: 'ASSIGNMENT · PHOTO', hint: 'Photograph or choose a picture of the assignment sheet, flat and well lit, with the title and the due date in view.', maxSide: 2000 });
      if (!shot) return say('Okay, cancelled.');
      let blob = await Camera.canvasToBlob(shot.canvas, 0.9);
      for (let q = 0.8; blob.size > 2.2 * 1024 * 1024 && q > 0.4; q -= 0.15) blob = await Camera.canvasToBlob(shot.canvas, q);
      setState('PROCESSING', 'Reading the assignment…');
      const ocr = await callTool('/ocr/words', { image: await Camera.blobToBase64(blob) });
      if (ocr.error) return say('I could not read the picture: ' + ocr.error);
      text = String(ocr.text || ''); from = 'the photo';
    } else {
      const r = await callTool('/tool/readFile', { name: m.file });
      if (r.error || !r.content) return say('I could not read **' + m.file + '**' + (r.error ? ': ' + r.error : '') + '. Put the file in your JARVIS folder (for example `Documents`) and say its name.');
      text = String(r.content); from = '`' + (r.name || m.file) + '`';
    }
    if (text.trim().length < 15) return say('I could not read enough text from ' + from + ' to find an assignment.');
    const subjects = [...new Set([...Object.keys(typeof attendance !== 'undefined' ? attendance : {}), ...(typeof classes !== 'undefined' ? classes.map(c => c.name) : [])])];
    const a = AssignParse.parseAssignment(text, { now: Date.now(), subjects });
    const title = a.title || 'Assignment';
    const dueTxt = a.due ? new Date(a.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    const tasks = a.questions.map((q, i) => (a.subject || title).slice(0, 30) + ' — Q' + (i + 1) + ': ' + q.slice(0, 80));
    const facts = '**' + title + '**' + (a.subject ? ' (' + a.subject + ')' : '') + '\n- Due: ' + (a.due ? '**' + dueTxt + '**' : '*not found*') + (a.marks ? '\n- Marks: ' + a.marks : '') + '\n- Questions: ' + (a.questions.length ? a.questions.map((q, i) => '\n  ' + (i + 1) + '. ' + q.slice(0, 90)).join('') : '*none found*') + (a.notes.length ? '\n\n⚠ ' + a.notes.join(' ') : '');
    if (!a.due && !tasks.length) return say('I read ' + from + ' but could not find a due date or numbered questions.\n\n' + facts + '\n\nYou can add it by hand: **“add deadline ' + title + ' by 15 Oct”**.');
    const go = await ask('I read this from ' + from + ':\n\n' + facts + '\n\n' + (a.due ? 'Add it as a **deadline**' + (tasks.length ? ' and ' + pl(tasks.length, 'to-do') + ' (one per question)' : '') : 'No due date, so I can only add the **' + pl(tasks.length, 'to-do') + '**') + '? *Check the date: handwriting and unusual layouts can be misread.* **“undo”** removes what I add.', 'YES, ADD');
    if (!go) return say('Okay, I did not add anything.');
    const dl = a.due ? { id: rid(), title, due: a.due, done: false } : null, td = tasks.map(x => ({ id: rid(), text: x, done: false, ts: Date.now() }));
    if (dl) deadlines.push(dl); if (td.length) todos.push(...td);
    saveTasks(); if (typeof sfx !== 'undefined') sfx.ok();
    if (typeof Undo !== 'undefined') Undo.push('added the assignment', () => { if (dl) deadlines = deadlines.filter(x => x.id !== dl.id); const ids = new Set(td.map(x => x.id)); todos = todos.filter(x => !ids.has(x.id)); saveTasks(); return 'Removed the assignment' + (td.length ? ' and its ' + pl(td.length, 'to-do') : '') + '.'; });
    return say('✓ Added ' + [dl ? 'the **deadline** (' + dueTxt + ')' : '', td.length ? pl(td.length, 'to-do') : ''].filter(Boolean).join(' and ') + '. Say **“undo”** to remove ' + (dl && td.length ? 'them' : 'it') + '.', { speak: 'I added the assignment.', suggestions: ['What are my deadlines?'] });
  }

  /* ================= what do I need in the end-sem? ================= */
  function endSem(m) {
    const r = Study.endSemNeeded(m);
    if (r.error) return say(r.error);
    const head = 'With **' + m.internal + '/' + m.internalMax + '** in internals (' + r.internalPct + '%) and an end-sem out of **' + r.endMax + '**, to reach **' + m.target + '** overall (' + r.targetPct + '% of ' + r.total + ' = ' + Math.ceil(r.targetPct * r.total / 100) + ' marks)';
    if (r.already) return say(head + ': **you already have it** from the internals alone. Even 0 in the end-sem is enough on the total. *(Many colleges also need a minimum in the end-sem paper itself, so check yours.)*', { speak: 'You already have enough from internals.' });
    if (!r.possible) return say(head + ': you would need **' + r.needed + '/' + r.endMax + '**, which is more than the paper is worth, so **it is out of reach**. The best you can get is ' + Math.round(1000 * (m.internal + r.endMax) / r.total) / 10 + '%.', { speak: 'That target is out of reach.' });
    const lower = Object.entries(Study.GRADE_CUTS).filter(([, p]) => p < r.targetPct).slice(0, 2).map(([g, p]) => { const q = Study.endSemNeeded({ internal: m.internal, internalMax: m.internalMax, endMax: r.endMax, targetPct: p }); return g + ' (' + p + '%) needs ' + q.needed; });
    return say(head + ', you need **' + r.needed + ' out of ' + r.endMax + '** in the end-sem (' + Math.round(1000 * r.needed / r.endMax) / 10 + '%).' + (lower.length ? '\n\nFor comparison: ' + lower.join(', ') + '.' : '') + '\n\n*Grade cut-offs differ between colleges; I used 90/80/70/60/55/50/40. Check your own rules.*', { speak: 'You need ' + r.needed + ' out of ' + r.endMax + ' in the end sem.' });
  }

  /* ================= offline speech (Whisper) switch / status ================= */
  async function offlineSpeech(m) {
    if (typeof Stt === 'undefined') return say('Offline speech is not part of this page.');
    const s = await Stt.status();
    if (s.error) return say('I could not check: ' + s.error);
    const inst = 'To install it, run **install-whisper.ps1** in the JARVIS folder (right-click → Run with PowerShell). It downloads the whisper.cpp program (a few MB) and one speech model (about 150 MB for “base.en”) into `.whisper` next to JARVIS, from GitHub and Hugging Face. Then say **“turn on offline speech”**.';
    if (m.on === undefined) return say(s.installed ? '✓ **Offline speech is installed** (model **' + s.model + '**, in `' + s.dir + '`). It is **' + (settings.offlineStt ? 'on' : 'off') + '** for lecture mode. Say **“' + (settings.offlineStt ? 'turn off' : 'turn on') + ' offline speech”** to change that.' : 'Offline speech is **not installed**' + (s.hasProgram ? ' (the program is there, but no model)' : s.hasModel ? ' (a model is there, but not the program)' : '') + '. ' + inst);
    if (m.on && !s.installed) return say('I can’t turn it on yet: offline speech is not installed. ' + inst);
    settings.offlineStt = !!m.on; if (typeof saveSettings === 'function') saveSettings();
    try { if (typeof bindSwitchState === 'function' && document.getElementById('offlineSttToggle')) bindSwitchState('#offlineSttToggle', 'offlineStt'); } catch (e) {}
    return say(m.on ? '✓ Lecture mode will now use **offline speech**: the audio is turned into text on this laptop and never sent anywhere.' : '✓ Lecture mode will use the browser’s speech recogniser again (it sends audio to Google or Microsoft).');
  }

  /* ================= lecture mode ================= */
  let L = null;
  const SRClass = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);
  const hm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayStr = d => new Date(d).getFullYear() + '-' + String(new Date(d).getMonth() + 1).padStart(2, '0') + '-' + String(new Date(d).getDate()).padStart(2, '0');
  const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lecture';
  async function lectureFlush(final) {
    if (!L || L.flushing) return;
    const pending = L.pending.splice(0); if (!pending.length) return;
    L.flushing = true;
    const block = (L.wrote ? '' : '# Lecture — ' + L.subject + ' (' + new Date(L.started).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', from ' + hm(L.started) + ')\n\n*Raw automatic transcript: it will have mistakes.*\n\n') + '### ' + hm(pending[0].t) + '\n' + pending.map(p => p.text).join(' ') + '\n\n';
    try {
      const r = await callTool('/tool/writeFile', { name: L.file, content: block, append: true });
      if (r && r.error) throw new Error(r.error);
      L.wrote = true; L.saved += pending.length;
    } catch (e) { L.pending.unshift(...pending); L.saveError = String((e && e.message) || e); }
    finally { L.flushing = false; }
  }
  // stopped by something other than the chat (a problem, the time limit, the indicator's STOP button): the reply has to be shown here
  const stopAndShow = why => lectureStop(why).then(r => { if (r) jarvisSay(r); });
  function lectureListen() {
    if (!L || L.stopped) return;
    const SR_ = SRClass();
    const rec = new SR_(); L.rec = rec;
    rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.lang = (typeof Lang !== 'undefined' && Lang.SPEECH && Lang.SPEECH[settings.speechLang]) || 'en-IN';
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const text = String(ev.results[i][0].transcript || '').trim();
        if (text) { L.pending.push({ t: Date.now(), text }); L.all = ((L.all || '') + text + ' ').slice(0, 130000); L.words += text.split(/\s+/).length; L.lastHeard = Date.now(); }
      }
    };
    rec.onerror = ev => {
      const e = ev && ev.error;
      if (e === 'not-allowed' || e === 'service-not-allowed') { L.fatal = 'The browser did not let me use the microphone.'; stopAndShow('fatal'); }
      else if (e === 'network') { L.netErrors++; if (L.netErrors > 8) { L.fatal = 'The speech service could not be reached (it needs the internet).'; stopAndShow('fatal'); } }
    };
    rec.onend = () => { if (L && !L.stopped) setTimeout(lectureListen, L.netErrors ? 1500 : 250); };       // the recogniser stops by itself every so often: start it again
    try { rec.start(); } catch (e) { if (L && !L.stopped) setTimeout(lectureListen, 1000); }
  }
  async function lectureStart(subject, source) {
    if (source === 'phone') return say(PHONE_NO);
    if (L) return say('Lecture mode is already on' + (L.subject ? ' for **' + L.subject + '**' : '') + ' (' + pl(L.words, 'word') + ' so far). Say **“stop the lecture”** when it is over.');
    if (E) return say('An exam is running. Finish or stop it first (say **“stop the exam”**).');
    // offline (Whisper on this laptop) when the setting is on and it is installed; otherwise the browser's own recogniser
    const offline = typeof settings !== 'undefined' && settings.offlineStt && typeof Stt !== 'undefined' && await Stt.ready();
    const offlineMissed = typeof settings !== 'undefined' && settings.offlineStt && !offline;
    if (!offline && !SRClass()) return say('This browser cannot listen to a lecture (it has no speech recognition). Chrome or Edge can.' + (typeof Stt !== 'undefined' ? ' Offline speech (Whisper) would work in any browser: say **“is offline speech installed”**.' : ''));
    const subj = subject || 'Lecture';
    const how = offline
      ? '- The speech is turned into text **on this laptop** by Whisper: **no audio leaves the computer** and it works without the internet.\n- Text appears in pieces about every 30 seconds, and a CPU-only laptop can lag behind a fast speaker. Whisper is good but not perfect: expect some wrong words.\n- Keep this JARVIS tab open (the microphone is captured only while it is).'
      : '- **Keep this JARVIS tab visible**: the browser stops listening in hidden tabs.\n- The browser’s speech recogniser **sends the audio to Google or Microsoft** to turn it into text, so it needs the internet.' + (offlineMissed ? ' *(Offline speech is switched on but Whisper is not installed, so I am using this.)*' : ' For audio that stays on this laptop, install offline speech: say **“is offline speech installed”**.');
    const go = await ask('Start **lecture mode** for **' + subj + '**? The microphone stays on until you say **“stop the lecture”** (or 3 hours pass).\n\n' + how + '\n- The transcript is saved to `~/jarvis/Notes` every 3 minutes, so a crash loses at most 3 minutes. When you stop, I make study notes from it.\n- The wake word is paused meanwhile.', 'START LISTENING');
    if (!go) return say('Okay, I will not record.');
    const started = Date.now();
    L = { engine: offline ? 'offline' : 'browser', subject: subj, file: 'Notes/lecture-' + slugOf(subj) + '-' + dayStr(started) + '.md', started, pending: [], words: 0, saved: 0, wrote: false, flushing: false, netErrors: 0, stopped: false, wakeWas: typeof wakeOn !== 'undefined' && !!wakeOn };
    try { if (L.wakeWas && typeof stopWake === 'function') stopWake(); } catch (e) {}
    try { if (navigator.wakeLock) L.lock = await navigator.wakeLock.request('screen'); } catch (e) { L.lock = null; }
    L.onVis = async () => { if (!L) return; if (document.visibilityState === 'visible' && navigator.wakeLock && (!L.lock || L.lock.released)) { try { L.lock = await navigator.wakeLock.request('screen'); } catch (e) {} } if (document.hidden) L.hiddenAt = Date.now(); else if (L.hiddenAt && Date.now() - L.hiddenAt > 60000) { L.gaps = (L.gaps || 0) + 1; L.hiddenAt = 0; } };
    document.addEventListener('visibilitychange', L.onVis);
    L.timer = setInterval(() => { lectureFlush(); if (Date.now() - L.started > 3 * 3600e3) stopAndShow('time'); }, 180000);
    L.untrack = Camera.track('lecture', 'MIC ON · LECTURE MODE' + (offline ? ' (OFFLINE)' : '') + ' · ' + subj, () => stopAndShow('button'));
    if (offline) {
      try {
        L.stt = await Stt.start({
          lang: (typeof Lang !== 'undefined' && Lang.SPEECH && Lang.SPEECH[settings.speechLang] || 'en-IN').slice(0, 2),
          onText: text => { if (!L) return; L.pending.push({ t: Date.now(), text }); L.all = ((L.all || '') + text + ' ').slice(0, 130000); L.words += text.split(/\s+/).length; L.lastHeard = Date.now(); },
          onError: (msg, notInstalled) => { if (L && !L.fatal) { L.fatal = notInstalled ? 'Offline speech is not installed any more.' : 'The offline speech reader keeps failing (' + msg + ').'; stopAndShow('fatal'); } },
        });
      } catch (e) {
        const l = L; L = null; clearInterval(l.timer); document.removeEventListener('visibilitychange', l.onVis); try { l.lock && l.lock.release && l.lock.release(); } catch (x) {} if (l.untrack) l.untrack();
        try { if (l.wakeWas && typeof startWake === 'function') startWake(); } catch (x) {}
        return say('I could not open the microphone: ' + String((e && e.message) || e).slice(0, 100) + '. Check that the browser is allowed to use it.');
      }
    } else lectureListen();
    return say('✓ **Lecture mode is on** for **' + subj + '**' + (offline ? ' (offline speech)' : '') + '. I am listening; the transcript is saved to `' + L.file + '` every 3 minutes. Say **“stop the lecture”** when it ends and I will write the notes.', { speak: 'Lecture mode is on.' });
  }
  async function lectureStop(why) {
    if (!L) return say('Lecture mode is not on.');
    const l = L; l.stopped = true;
    clearInterval(l.timer); document.removeEventListener('visibilitychange', l.onVis);
    try { l.rec && l.rec.stop(); } catch (e) {}
    try { l.lock && l.lock.release && l.lock.release(); } catch (e) {}
    if (l.untrack) l.untrack();
    if (l.stt) { try { await l.stt.stop(); } catch (e) {} }               // sends the last piece and waits for its text
    await lectureFlush(true);
    if (l.pending.length) await lectureFlush(true);
    L = null;
    try { if (l.wakeWas && typeof startWake === 'function') startWake(); } catch (e) {}
    const mins = Math.max(1, Math.round((Date.now() - l.started) / 60000));
    const head = (why === 'fatal' ? '⚠ ' + l.fatal + ' ' : why === 'time' ? 'Three hours passed, so I stopped. ' : '') + 'Heard about **' + pl(l.words, 'word') + '** in ' + pl(mins, 'minute') + '.' + (l.gaps ? ' The tab was hidden for a while ' + (l.gaps > 1 ? l.gaps + ' times' : 'once') + ', so some speech may be missing.' : '');
    if (l.saveError && !l.saved) return say(head + ' I could not save the transcript: ' + l.saveError);
    if (l.words < 15) return say(head + ' That is too little to make notes from.' + (l.saved ? ' The transcript is in `' + l.file + '`.' : ''));
    const fileName = l.file.split('/').pop();
    if (typeof llmReady === 'function' && !llmReady()) return say(head + ' The raw transcript is in `' + l.file + '`. The AI is off, so I could not write notes: turn it on and say **“summarize ' + fileName + '”**.', { actions: [{ label: 'OPEN THE TRANSCRIPT', fn: () => callTool('/tool/openFile', { name: l.file }) }] });
    // the notes: read the saved transcript back (it is the one copy), in pieces, on the server
    setState('PROCESSING', 'Writing the lecture notes…');
    jarvisSay(say('⏳ ' + head + ' Writing the notes now. A long lecture takes a few minutes, because the AI works through it in pieces…', { noTTS: true }));
    const cloud = typeof isCloudModel === 'function' && isCloudModel(llm.model);
    if (cloud) { const prov = typeof modelInfo === 'function' ? modelInfo(llm.model).providerLabel : 'an online provider'; const go = await ask('Your AI model runs online (**' + prov + '**). Writing the notes sends the transcript to them. Send it? If you say no, the raw transcript stays in `' + l.file + '`.', 'YES, SEND IT'); if (!go) return say('Okay, nothing was sent. The raw transcript is in `' + l.file + '`.'); }
    const transcript = l.all || '';
    const r = await callTool('/lecture/notes', { subject: l.subject, transcript, model: llm.model });
    if (r.error) return say(head + ' I could not write the notes: ' + r.error + '. The raw transcript is in `' + l.file + '`.', { actions: [{ label: 'OPEN THE TRANSCRIPT', fn: () => callTool('/tool/openFile', { name: l.file }) }] });
    const body = String(r.preview || '').replace(/^# .*\n+/, '').replace(/^\*Written by the AI[^\n]*\n+/, '').slice(0, 1400);
    return say('✓ ' + head + ' Notes saved to `' + r.file + '` (' + pl(r.chunks, 'piece') + ' of transcript, ' + r.seconds + ' s).' + (r.truncated ? ' *The lecture was very long, so the last part was left out.*' : '') + '\n\n' + body + (r.preview && r.preview.length > 1400 ? '\n…' : '') + '\n\n*Made by the AI from an automatic transcript: check it against what was said.*',
      { speak: 'Your lecture notes are ready.', actions: [{ label: 'OPEN THE NOTES', fn: () => callTool('/tool/openFile', { name: r.file }) }], suggestions: ['Make flashcards from ' + r.name, 'Start an exam on ' + r.name] });
  }
  const lectureStatus = () => (L ? say('Lecture mode is **on** for **' + L.subject + '**: ' + pl(L.words, 'word') + ' heard in ' + pl(Math.round((Date.now() - L.started) / 60000), 'minute') + '. Say **“stop the lecture”** to finish.') : say('Lecture mode is **off**. Say **“start lecture mode for DBMS”** to begin.'));

  /* ================= exam mode ================= */
  let E = null;
  const exams = () => { try { return store.get('jarvis.exams', []); } catch (e) { return []; } };
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function examPill() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('examPill');
    if (!E) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'examPill'; el.setAttribute('role', 'timer'); el.setAttribute('aria-live', 'off');
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9100;display:flex;align-items:center;gap:10px;padding:7px 12px;border:1px solid var(--line-hi);border-radius:20px;background:rgba(5,19,32,.92);font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--cyan-hi)';
      const t = document.createElement('span'); t.id = 'examPillText';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cbtn danger'; b.textContent = 'STOP EXAM'; b.onclick = () => { examEnd('stopped').then(r => jarvisSay(r)); };
      el.append(t, b); document.body.appendChild(el);
    }
    const left = E.limitMs - (Date.now() - E.start);
    const tx = document.getElementById('examPillText'); if (tx) tx.textContent = 'EXAM · Q ' + Math.min(E.i + 1, E.qs.length) + '/' + E.qs.length + ' · ' + mmss(left) + ' LEFT';
  }
  const examQ = () => '**Question ' + (E.i + 1) + ' of ' + E.qs.length + '** (' + mmss(E.limitMs - (Date.now() - E.start)) + ' left)\n\n' + E.qs[E.i].q;
  async function examStart(m) {
    if (E) return say('An exam is already running (question ' + (E.i + 1) + ' of ' + E.qs.length + '). Say **“stop the exam”** to end it.');
    if (L) return say('Lecture mode is on. Say **“stop the lecture”** first.');
    if (typeof Skills !== 'undefined' && Skills.state.viva) return say('A viva is running. Say **stop** to end it first.');
    if (typeof llmReady === 'function' && !llmReady()) return say('Exam mode needs the AI brain to write the questions and mark the answers, and it is off or not reachable.');
    const src = m.source;
    if (!src) return say('What should I examine you on? Say it like **“start an exam on dbms_notes.md”** or **“exam me on normalization for 10 minutes”**.');
    const n = Math.max(3, Math.min(15, m.n || 8)), minutes = Math.max(2, Math.min(120, m.minutes || Math.round(n * 2.5)));
    const cloud = typeof isCloudModel === 'function' && isCloudModel(llm.model);
    if (cloud) { const prov = typeof modelInfo === 'function' ? modelInfo(llm.model).providerLabel : 'an online provider'; const go = await ask('Your AI model runs online (**' + prov + '**). Making and marking the exam sends parts of your notes and your answers to them. Go ahead?', 'YES, START'); if (!go) return say('Okay, no exam.'); }
    setState('PROCESSING', 'Writing the exam questions…');
    jarvisSay(say('⏳ Writing ' + n + ' questions' + (looksLikeFile(src) ? ' from **' + src + '**' : ' on **' + src + '**') + '. This takes about a minute with the local AI…', { noTTS: true }));
    let r = await callTool('/exam/questions', looksLikeFile(src) ? { name: src, n, model: llm.model } : { name: src, n, model: llm.model });
    if (r.error && /could not find/i.test(r.error) && !looksLikeFile(src)) r = await callTool('/exam/questions', { topic: src, n, model: llm.model });       // not a file name: it is a topic
    if (r.error) return say('I could not set the exam: ' + r.error);
    E = { qs: r.questions, i: 0, answers: [], start: Date.now(), limitMs: minutes * 60000, topic: r.file ? r.file.split('/').pop() : src, file: r.file || '', fromNotes: !!r.fromNotes, grading: false };
    E.timer = setInterval(() => { examPill(); if (E && !E.grading && Date.now() - E.start >= E.limitMs) { const e = E; examEnd('time').then(res => jarvisSay(res)); } }, 1000);
    examPill();
    return say('📝 **Exam on ' + E.topic + '** — **' + r.questions.length + ' questions, ' + pl(minutes, 'minute') + '**' + (r.fromNotes ? ', from your notes' : ' (general knowledge: no note was found, so these are not from your notes)') + '.\n\nAnswer each in a sentence or two, typed or spoken. **Everything you say or type counts as an answer** until the end; say **skip** to pass, or **“stop the exam”** to end it. Marks come at the end.\n\n' + examQ(), { speak: 'The exam begins. ' + r.questions[0].q, intent: 'EXAM' });
  }
  async function examAnswer(text) {
    const t = String(text).trim();
    if (EXAM_STOP.test(t) || /^(?:stop|end|quit|exit|finish)[.!]?$/i.test(t)) return examEnd('stopped');
    if (E.grading) return say('I am marking your answers now. One moment.', { intent: 'EXAM' });
    if (/^(?:repeat|say (?:it|that) again|again|repeat the question)[.!?]?$/i.test(t)) return say(examQ(), { speak: E.qs[E.i].q, intent: 'EXAM' });
    const skip = /^(?:skip|pass|next|i don'?t know|no idea|dont know)[.!]?$/i.test(t);
    E.answers.push({ q: E.qs[E.i].q, ref: E.qs[E.i].a, user: skip ? '' : t.slice(0, 2500), t: Date.now() });
    E.i++;
    if (E.i >= E.qs.length) return examEnd('done');
    examPill();
    return say((skip ? 'Skipped.' : 'Noted.') + '\n\n' + examQ(), { speak: (skip ? 'Skipped. ' : '') + 'Next question. ' + E.qs[E.i].q, intent: 'EXAM' });
  }
  async function examEnd(why) {
    if (!E) return say('No exam is running.');
    if (E.grading) return say('I am already marking your answers.');
    const e = E; e.grading = true; clearInterval(e.timer); examPill();
    const used = Math.min(Date.now() - e.start, e.limitMs);
    const total = e.qs.length, answered = e.answers.filter(a => a.user).length;
    if (!e.answers.length) { E = null; examPill(); return say(why === 'time' ? 'Time is up, and nothing was answered, so there is nothing to mark.' : 'Okay, the exam is cancelled: no answers to mark.'); }
    jarvisSay(say('⏳ ' + (why === 'time' ? '**Time is up.** ' : '') + 'Marking ' + pl(answered, 'answer') + ' against your notes. About ' + Math.max(1, Math.round(answered * 7 / 60)) + ' minute' + (answered > 6 ? 's' : '') + '…', { noTTS: true, intent: 'EXAM' }));
    setState('PROCESSING', 'Marking the exam…');
    const graded = [];
    for (const a of e.answers) {
      if (!a.user) { graded.push({ ...a, score: 0, feedback: 'Not answered.', missed: [], model: a.ref }); continue; }
      const g = await callTool('/skill/viva/grade', { topic: e.topic, question: a.q, answer: a.user, reference: a.ref, model: llm.model });
      graded.push(g.error ? { ...a, score: null, feedback: 'Could not be marked (' + g.error + ').', missed: [], model: a.ref } : { ...a, score: g.score, feedback: g.feedback, missed: g.missed || [], model: a.ref || g.model });
    }
    for (let k = e.answers.length; k < total; k++) graded.push({ q: e.qs[k].q, ref: e.qs[k].a, user: '', score: 0, feedback: 'Not reached.', missed: [], model: e.qs[k].a, notReached: true });
    E = null; examPill();
    const marked = graded.filter(g => g.score !== null);
    const sum = marked.reduce((s, g) => s + g.score, 0), avg = marked.length ? sum / marked.length : 0, pct = Math.round(avg * 10);
    // weak answers (under 7/10, including skipped and unanswered) → the Mistakes deck, once each
    const have = new Set(flashcards.filter(c => c.deck === 'Mistakes').map(c => String(c.q).toLowerCase()));
    const weak = graded.filter(g => g.score !== null && g.score < 7 && g.q && g.model);
    const newCards = []; for (const g of weak) { const key = String(g.q).toLowerCase(); if (have.has(key)) continue; have.add(key); newCards.push({ id: rid(), deck: 'Mistakes', q: g.q, a: String(g.model).slice(0, 600), box: 1, due: Date.now() }); }
    if (newCards.length) {
      const ids = new Set(newCards.map(c => c.id)); flashcards = flashcards.concat(newCards); saveFlash();
      if (typeof Undo !== 'undefined') Undo.push('added mistakes flashcards', () => { flashcards = flashcards.filter(c => !ids.has(c.id)); saveFlash(); return 'Removed the ' + pl(ids.size, 'Mistakes flashcard') + ' I added.'; });
    }
    const hist = exams(); hist.push({ id: rid(), t: Date.now(), topic: e.topic, file: e.file, n: total, answered, avg: Math.round(avg * 10) / 10, pct, sec: Math.round(used / 1000), mistakes: newCards.length }); store.set('jarvis.exams', hist.slice(-100));
    const rows = graded.map((g, i) => (i + 1) + '. **' + (g.score === null ? '–' : g.score + '/10') + '** — ' + plain(g.q).slice(0, 110) + (g.score !== null && g.score < 7 ? '\n   ' + (g.user ? '*You said:* ' + plain(g.user).slice(0, 110).replace(/[.!?\s]+$/, '') + '. ' : '') + '*Better:* ' + plain(g.model).slice(0, 160) + (g.missed && g.missed.length ? ' (*missed:* ' + g.missed.slice(0, 2).join('; ') + ')' : '') : ''));
    const prev = hist.slice(-4, -1), trend = prev.length ? Math.round(avg * 10 - prev.reduce((s, x) => s + x.pct, 0) / prev.length) : null;
    return say('📝 **Exam result: ' + pct + '%** (' + (Math.round(avg * 10) / 10) + '/10 average) — ' + pl(answered, 'question') + ' answered out of ' + total + ' in ' + mmss(used) + (why === 'time' ? ' (time ran out)' : why === 'stopped' ? ' (stopped early)' : '') + '.' + (trend !== null ? ' ' + (trend > 0 ? '▲ ' + trend + ' points better' : trend < 0 ? '▼ ' + Math.abs(trend) + ' points lower' : 'The same') + ' than your last ' + prev.length + '.' : '') + '\n\n' + rows.join('\n') + '\n\n' +
      (newCards.length ? '➕ I put **' + pl(newCards.length, 'weak question') + '** in your **Mistakes** flashcard deck (**“undo”** removes them). ' : weak.length ? 'Your weak questions were already in the Mistakes deck. ' : '🎉 No weak answers: nothing to add to the Mistakes deck. ') + '*Marked by the AI against your notes, so it can be wrong: judge for yourself.*',
      { speak: 'Your exam score is ' + pct + ' percent.', suggestions: newCards.length || weak.length ? ['Review my Mistakes flashcards', 'How did my exams go?'] : ['How did my exams go?'], intent: 'EXAM' });
  }
  function examHistory() {
    const h = exams();
    if (!h.length) return say('You have not taken an exam yet. Try **“start an exam on dbms_notes.md”** or **“exam me on normalization”**.');
    const last = h.slice(-6).reverse();
    const lines = last.map(x => '- **' + new Date(x.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '** — ' + x.topic + ': **' + x.pct + '%** (' + x.answered + '/' + x.n + ' answered, ' + mmss(x.sec * 1000) + ')');
    const a = h.slice(-3), b = h.slice(-6, -3);
    const trend = b.length ? Math.round(a.reduce((s, x) => s + x.pct, 0) / a.length - b.reduce((s, x) => s + x.pct, 0) / b.length) : null;
    return say('**Your exams** (' + h.length + ' so far)\n' + lines.join('\n') + (trend !== null ? '\n\nLast 3 average **' + Math.round(a.reduce((s, x) => s + x.pct, 0) / a.length) + '%** — ' + (trend > 0 ? '▲ ' + trend + ' points up' : trend < 0 ? '▼ ' + Math.abs(trend) + ' points down' : 'level') + ' from the 3 before.' : ''), { speak: 'Your last exam was ' + last[0].pct + ' percent.' });
  }

  /* ================= router ================= */
  async function intercept(text, source) {
    const t = String(text || '').trim();
    if (E) {                                                                // during an exam EVERYTHING is an answer
      if (source === 'phone') return say('An exam is running at the laptop; answer there.');
      return examAnswer(t);
    }
    const m = match(t); if (!m) return null;
    switch (m.kind) {
      case 'offstt': return offlineSpeech(m);
      case 'assign': return assignment(m, source);
      case 'endsem': return endSem(m);
      case 'attsw': return attendanceSwitch(m.on);
      case 'fit': return fitStudy({ ...m, raw: t });
      case 'bunk': return bunk(m.day);
      case 'tt': return timetable(m, source);
      case 'lecture-start': return lectureStart(m.subject, source);
      case 'lecture-stop': return L ? lectureStop('button') : say('Lecture mode is not on.');
      case 'exam-start': return source === 'phone' ? say('Exams are taken at the laptop. Ask me again there.') : examStart(m);
      case 'exam-stop': return say('No exam is running.');
      case 'exam-history': return examHistory();
    }
    return null;
  }
  return { intercept, match, attendanceTick, markAttendance, fitStudy, endSem, assignment, active: () => !!E, lectureActive: () => !!L, get _E() { return E; }, get _L() { return L; }, importEntries, bunk, examHistory, lectureStatus, subjectName };
})();
if (typeof module !== 'undefined') module.exports = Student;
