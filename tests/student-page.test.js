// Student tools, chat side (student-page.js): timetable import, "can I bunk tomorrow?", lecture mode, exam mode. Page globals are stubbed; the speech
// recogniser, the clock and the server's answers are fakes. Run: node tests/student-page.test.js
'use strict';
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const root = f => path.join(__dirname, '..', f);

/* ---------- page globals ---------- */
const calls = [], said = [], undo = [];
let replies = {}, yes = true, ids = 0;
const store = (() => { const d = {}; return { get: (k, f) => (k in d ? JSON.parse(JSON.stringify(d[k])) : f), set: (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); }, d }; })();
global.store = store; global.rid = () => 'id' + (++ids); global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
global.classes = []; global.attendance = {}; global.flashcards = [];
global.saveTasks = () => { global.saved = (global.saved || 0) + 1; }; global.saveFlash = () => {}; global.sfx = { ok() {} };
global.Undo = { push: (label, fn) => undo.push([label, fn]) };
global.settings = { speechLang: 'en' }; global.llm = { model: 'qwen3.5:4b' }; global.llmReady = () => true; global.isCloudModel = m => String(m).includes('::'); global.modelInfo = () => ({ providerLabel: 'SomeCloud' });
global.setState = () => {};
global.Lang = { SPEECH: { en: 'en-IN', te: 'te-IN', kn: 'kn-IN' } };
global.wakeOn = false; global.stopWake = () => { global.wakeOn = false; global.__wakeStops = (global.__wakeStops || 0) + 1; }; global.startWake = () => { global.wakeOn = true; global.__wakeStarts = (global.__wakeStarts || 0) + 1; };
global.callTool = async (ep, body, tok) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
global.jarvisSay = o => { said.push(o); if (o && o.confirm) setTimeout(() => (yes ? o.confirm.onConfirm() : o.confirm.onCancel()), 0); if (o && o.actions && o.__pick) setTimeout(() => o.actions[o.__pick].fn(), 0); };
global.Skills = { state: {} };
global.Extras = { confirmCard: (text, y) => new Promise(r => { said.push({ text, confirmCard: true, yes: y }); setTimeout(() => r(yes), 0); }) };
global.Study = require(root('study.js'));
global.ScanMath = require(root('scanmath.js'));
global.TtParse = require(root('ttparse.js'));
const fakeEl = () => ({ style: {}, value: '', focus() {}, remove() {}, appendChild() {}, append() {}, setAttribute() {} });
global.document = { createElement: () => fakeEl(), getElementById: () => null, body: { appendChild() {} }, head: { appendChild() {} }, addEventListener(n, f) { global.__vis = f; }, removeEventListener() {}, visibilityState: 'visible', hidden: false };
// the speech recogniser: records instances, and lets the test speak into them
const recs = [];
class FakeSR { constructor() { this.started = 0; recs.push(this); } start() { this.started++; this.running = true; } stop() { this.running = false; } }
global.window = { SpeechRecognition: FakeSR };
Object.defineProperty(global, 'navigator', { value: { wakeLock: { request: async () => ({ released: false, release() { this.released = true; } }) } }, configurable: true, writable: true });
const intervals = []; const realSetInterval = global.setInterval; let captureIntervals = false;
global.setInterval = (fn, ms, ...a) => { if (captureIntervals) { intervals.push({ fn, ms }); return intervals.length; } return realSetInterval(fn, ms, ...a); };
const realClear = global.clearInterval; global.clearInterval = id => { if (typeof id === 'number' && id <= intervals.length) intervals[id - 1] && (intervals[id - 1].cleared = true); else realClear(id); };
// the Camera: only what student-page.js uses
const cameraLog = []; const indicator = new Map();
global.Camera = { PHONE_NO: 'I only use the camera for requests made at the laptop, so I won’t do that from a phone message.', track: (n, l, s) => { indicator.set(n, { l, s }); return () => indicator.delete(n); },
  capture: async o => { cameraLog.push(o.title); return global.__shot === null ? null : { canvas: {}, source: 'camera' }; }, canvasToBlob: async () => ({ size: 5000 }), blobToBase64: async () => 'AAAA',
  openPanel: o => { const p = { body(el) { p.ta = el; }, buttons(list) { setTimeout(() => (global.__pasteCancel ? list[1].fn() : list[0].fn()), 0); }, close() {}, onCancel() {}, hint() {} }; global.__panel = o; return p; } };
eval(fs.readFileSync(root('student-page.js'), 'utf8') + ';global.Student = Student;');
const S = t => Student.intercept(t, 'text');
const reset = () => { calls.length = 0; said.length = 0; undo.length = 0; replies = {}; yes = true; classes = []; attendance = {}; flashcards = []; };

(async () => {
  /* ---------- wording ---------- */
  const k = (t) => { const m = Student.match(t); return m && m.kind; };
  for (const t of ['import my timetable', 'Import timetable', 'import the timetable from a photo', 'scan my timetable', 'add my class schedule', 'import my timetable from a calendar file', 'load my timetable', '/timetable import', 'upload my timetable from my camera', 'set up my timetable', 'import timetable: Mon 9-10 DBMS; Tue 10-11 OS']) check('wording: timetable: "' + t + '"', k(t) === 'tt', Student.match(t));
  check('wording: the source is read from the words', Student.match('import my timetable from a photo').source === 'photo' && Student.match('import timetable from an ics file').source === 'ics' && Student.match('import my timetable from pasted text').source === 'text' && Student.match('import my timetable').source === '' && Student.match('import timetable: Mon 9 DBMS').text === 'Mon 9 DBMS');
  for (const t of ['can I bunk tomorrow?', 'Can I skip tomorrow', 'can i miss tomorrow', 'can I bunk college tomorrow', "can i bunk tomorrow's classes", 'can I bunk today', 'can i take off on friday', 'should I go to college tomorrow?', 'may i bunk classes on monday', 'can i bunk the day after tomorrow']) check('wording: bunk: "' + t + '"', k(t) === 'bunk', Student.match(t));
  for (const t of ['start lecture mode for DBMS', 'start lecture mode', 'Lecture mode on', 'turn on lecture mode for operating systems', 'record this lecture', 'record this lecture for maths', 'transcribe the lecture']) check('wording: lecture start: "' + t + '"', k(t) === 'lecture-start', Student.match(t));
  check('wording: the subject is read, "my" and "the" are dropped', Student.match('start lecture mode for my DBMS class').subject === 'DBMS class' && Student.match('start lecture mode for the maths').subject === 'maths' && Student.match('start lecture mode').subject === '');
  for (const t of ['stop the lecture', 'stop lecture mode', 'end lecture mode', 'finish the lecture', 'turn off lecture mode', 'lecture mode off']) check('wording: lecture stop: "' + t + '"', k(t) === 'lecture-stop', Student.match(t));
  for (const t of ['start an exam on dbms_notes.md', 'start a mock exam on normalization', 'exam me on normalization for 10 minutes', 'give me a practice exam on os', 'take a timed exam about networks', 'begin an exam on my notes.pdf with 5 questions', 'start exam mode', 'Exam me on recursion']) check('wording: exam start: "' + t + '"', k(t) === 'exam-start', Student.match(t));
  const ex1 = Student.match('exam me on normalization for 10 minutes'), ex2 = Student.match('start an exam on dbms_notes.md with 5 questions'), ex3 = Student.match('start an exam on my os notes.md for 20 minutes with 12 questions');
  check('wording: exam: the topic or file, the minutes and the number of questions are read out of the sentence', ex1.source === 'normalization' && ex1.minutes === 10 && ex1.n === 0 && ex2.source === 'dbms_notes.md' && ex2.n === 5 && ex3.source === 'os notes.md' && ex3.minutes === 20 && ex3.n === 12, [ex1, ex2, ex3]);
  for (const t of ['stop the exam', 'end my exam', 'cancel the test', 'quit exam mode']) check('wording: exam stop: "' + t + '"', k(t) === 'exam-stop', Student.match(t));
  for (const t of ['how did my exams go?', 'show my exam history', 'exam history', 'my exam results', 'what are my past exam scores']) check('wording: exam history: "' + t + '"', k(t) === 'exam-history', Student.match(t));
  for (const t of ['import my contacts', 'import a csv', 'add class DBMS on Monday at 10am', 'what is my timetable', 'show my timetable', 'next class', 'can I bunk', 'can I bunk the exam', 'can I miss the deadline tomorrow', 'should I go to the gym tomorrow', 'start a lecture series on youtube', 'record my screen', 'record this meeting', 'the lecture was boring', 'start a quiz on maths', 'give me a test on python', 'exam tomorrow', 'when is my exam', 'start the exam timer', 'lecture notes', 'stop the music', 'stop the timer', 'stop', 'take a test']) check('wording: not taken: "' + t + '"', Student.match(t) === null, Student.match(t));

  /* ---------- timetable import ---------- */
  reset(); attendance = { DBMS: { held: 10, attended: 9, log: [] } }; classes = [{ id: 'old1', name: 'DBMS', day: 1, h: 9, m: 0 }];
  let r = await S('import my timetable: Mon 9:00-10:00 dbms; Mon 10:00-11:00 Operating Systems (Room 204); Tue 2pm cn; tue 9 maths');
  const card = said.find(x => x.confirmCard);
  check('timetable: the confirmation card lists what was read (by day), what is already there, and promises undo', card && /4 classes/.test(card.text) && /\*\*Mon\*\* — 9:00 am DBMS · 10:00 am Operating Systems \(204\)/.test(card.text) && /\*\*Tue\*\* — 9:00 am Maths · 2:00 pm CN/.test(card.text) && /1 of these is already in your timetable/.test(card.text) && /Add \*\*3 classes\*\*/.test(card.text) && /undo/.test(card.text) && card.yes === 'YES, IMPORT', card && card.text);
  check('timetable: after "yes" only the new ones are added, with a batch tag; the existing class is untouched; the subject uses the name you already track (DBMS)', classes.length === 4 && classes.find(c => c.id === 'old1') && !classes.find(c => c.id === 'old1').batch && classes.filter(c => c.batch).length === 3 && classes.filter(c => c.batch).every(c => c.id && c.name && c.day >= 0 && c.h >= 0) && classes.some(c => c.name === 'Maths' && c.day === 2 && c.h === 9) && classes.some(c => c.name === 'CN' && c.day === 2 && c.h === 14) && classes.find(c => c.name === 'Operating Systems').room === '204' && classes.find(c => c.name === 'Operating Systems').dur === 60, classes);
  check('timetable: saved, answered with how many were added, and ONE undo entry', global.saved >= 1 && /Added \*\*3 classes\*\*/.test(r.text) && /1 already there/.test(r.text) && undo.length === 1 && /timetable/.test(undo[0][0]));
  const msg = undo[0][1](); check('timetable: undo removes exactly the imported ones, and nothing else', classes.length === 1 && classes[0].id === 'old1' && /Removed the 3 classes/.test(msg), classes);
  reset(); yes = false; r = await S('import my timetable: Mon 9-10 DBMS'); check('timetable: saying no changes nothing', classes.length === 0 && /did not change your timetable/.test(r.text) && undo.length === 0); yes = true;
  r = await S('import my timetable: hello there'); check('timetable: text with no classes in it is explained, with the format to use', /could not read any classes/.test(r.text) && /Mon 9:00-10:00 DBMS/.test(r.text) && classes.length === 0);
  reset(); classes = [{ id: 'a', name: 'DBMS', day: 1, h: 9, m: 0 }]; r = await S('import my timetable: Mon 9-10 dbms'); check('timetable: everything already there → nothing added, said so', /already in your timetable/.test(r.text) && classes.length === 1);
  // photo
  reset(); global.__shot = {}; const gridWords = (() => { let l = 0; const W = (t, cx, cy, ll) => ({ t, x: Math.round(cx - t.length * 7), y: cy - 12, w: t.length * 14, h: 24, l: ll }); const w = [W('9:00-10:00', 260, 40, l++), W('10:00-11:00', 460, 40, l++), W('Mon', 80, 120, l++), W('DBMS', 260, 120, l++), W('OS', 460, 120, l++), W('Tue', 80, 210, l++), W('Maths', 260, 210, l++), W('CN', 460, 210, l++)]; return w; })();
  replies['/ocr/words'] = { success: true, width: 600, height: 300, words: gridWords, lines: ['9:00-10:00 10:00-11:00', 'Mon DBMS OS', 'Tue Maths CN'], text: 'Mon DBMS OS' };
  r = await S('import my timetable from a photo');
  check('timetable photo: the picture is read, the table rebuilt, shown for a yes/no, and imported', cameraLog.length === 1 && calls.some(c => c[0] === '/ocr/words' && c[1].image === 'AAAA') && said.find(x => x.confirmCard) && /4 classes/.test(said.find(x => x.confirmCard).text) && classes.length === 4 && classes.some(c => c.name === 'DBMS' && c.day === 1 && c.h === 9 && c.dur === 60) && classes.some(c => c.name === 'CN' && c.day === 2 && c.h === 10), { cam: cameraLog, classes });
  check('timetable photo: the card says to check the list (handwriting can be misread)', /Check the list/.test(said.find(x => x.confirmCard).text));
  reset(); global.__shot = null; r = await S('import my timetable from a photo'); check('timetable photo: cancelling the camera changes nothing', /cancelled/.test(r.text) && classes.length === 0); global.__shot = {};
  reset(); replies['/ocr/words'] = { error: 'Windows has no OCR language installed' }; r = await S('import my timetable from a photo'); check('timetable photo: an OCR failure is passed on', /could not read the picture: Windows has no OCR/.test(r.text) && classes.length === 0);
  reset(); replies['/ocr/words'] = { success: true, words: [{ t: 'blur', x: 1, y: 1, w: 30, h: 10, l: 0 }], lines: ['Mon 9:00 DBMS'], text: 'Mon 9:00 DBMS' }; r = await S('import my timetable from a photo');
  check('timetable photo: when the table cannot be rebuilt, the plain text is offered for correcting (pasted), and then imported', global.__panel && /could not rebuild the table/.test(global.__panel.hint) && classes.length === 1 && classes[0].name === 'DBMS' && classes[0].day === 1 && classes[0].h === 9, { hint: global.__panel && global.__panel.hint, classes });
  reset(); replies['/ocr/words'] = { success: true, words: [{ t: 'blur', x: 1, y: 1, w: 30, h: 10, l: 0 }], lines: ['Mon 9:00 DBMS'], text: 'Mon 9:00 DBMS' }; global.__pasteCancel = true; r = await S('import my timetable from a photo'); global.__pasteCancel = false; check('timetable photo: cancelling the correction box imports nothing', /did not import anything/.test(r.text) && classes.length === 0);
  r = await Student.intercept('import my timetable from a photo', 'phone'); check('timetable photo: from the phone it is refused (it uses the camera)', /only use the camera/.test(r.text) && cameraLog.length === 4 || /only use the camera/.test(r.text));
  reset(); r = await Student.intercept('import my timetable: Mon 9 DBMS', 'phone'); check('timetable from typed text needs no camera, so the phone may do it', classes.length === 1);

  /* ---------- can I bunk tomorrow? ---------- */
  reset(); r = await S('can I bunk tomorrow?'); check('bunk: no timetable → how to add one', /don’t have your timetable yet/.test(r.text) && /import my timetable/.test(r.text));
  const tomorrow = (new Date().getDay() + 1) % 7;
  classes = [{ id: 'c1', name: 'DBMS', day: tomorrow, h: 9, m: 0 }, { id: 'c2', name: 'DBMS', day: tomorrow, h: 10, m: 0 }, { id: 'c3', name: 'OS', day: tomorrow, h: 11, m: 0 }, { id: 'c4', name: 'CN', day: (tomorrow + 2) % 7, h: 9, m: 0 }];
  attendance = { DBMS: { held: 50, attended: 41, log: [] }, OS: { held: 50, attended: 38, log: [] }, CN: { held: 10, attended: 10, log: [] } };
  r = await S('can I bunk tomorrow?');
  check('bunk: tomorrow\'s classes per subject, the percentage now and after missing them, and which one goes under 75%', /DBMS\*\* \(2 classes\) — now \*\*82%\*\* \(41\/50\)\. Missing them → \*\*78.8%\*\* \(41\/52\) ✓ still 75% or more/.test(r.text) && /OS\*\* \(1 class\) — now \*\*76%\*\* \(38\/50\)\. Missing it → \*\*74.5%\*\* \(38\/51\) ⚠ below 75%/.test(r.text) && !/CN/.test(r.text), r.text);
  check('bunk: the verdict names the subject to attend and says the rest can be skipped; short version spoken; a guide, not a promise', /Not all of them\.\*\* OS would fall under 75%, so go to that class and skip the rest/.test(r.text) && /go to that class/.test(r.speak) && /treat this as a guide/.test(r.text));
  attendance.OS = { held: 50, attended: 48, log: [] }; r = await S('can i skip tomorrow'); check('bunk: when every subject stays at 75% or more: yes', /Yes, you can skip tomorrow/.test(r.text));
  attendance = { DBMS: { held: 50, attended: 41, log: [] } }; r = await S('can i bunk tomorrow'); check('bunk: a subject with no attendance recorded: "I can\'t be sure", naming it', /can’t be sure:\*\* OS has no attendance recorded/.test(r.text) && /no attendance recorded yet, so I can’t tell/.test(r.text));
  classes = [{ id: 'c9', name: 'DBMS', day: (tomorrow + 3) % 7, h: 9, m: 0 }]; r = await S('can i bunk tomorrow'); check('bunk: no classes tomorrow → nothing to bunk', /no classes tomorrow/.test(r.text) && /nothing to bunk/.test(r.text));
  classes = [{ id: 'c8', name: 'DBMS', day: (new Date().getDay() + 2) % 7, h: 9, m: 0 }]; attendance = { dbms: { held: 10, attended: 7, log: [] } };
  r = await S('can i bunk the day after tomorrow'); check('bunk: "the day after tomorrow" and a subject written in another case (dbms) are matched; 70% now, missing the class goes lower', /DBMS\*\* \(1 class\) — now \*\*70%\*\* \(7\/10\)\. Missing it → \*\*63.6%\*\* \(7\/11\) ⚠ below 75%/.test(r.text), r.text);
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][(new Date().getDay() + 4) % 7].toLowerCase();
  classes = [{ id: 'c7', name: 'OS', day: (new Date().getDay() + 4) % 7, h: 9, m: 0 }]; attendance = { OS: { held: 40, attended: 40, log: [] } };
  r = await S('can I bunk ' + dayName); check('bunk: a weekday name looks at the next such day', /OS\*\* \(1 class\)/.test(r.text) && /Yes, you can skip/i.test(r.text), r.text);

  /* ---------- lecture mode ---------- */
  reset(); settings.speechLang = 'en';
  r = await Student.intercept('start lecture mode for DBMS', 'phone'); check('lecture: from the phone it is refused, and no microphone starts', /only use the microphone/.test(r.text) && recs.length === 0);
  global.window = {}; r = await S('start lecture mode for DBMS'); check('lecture: a browser with no speech recognition says so', /no speech recognition/.test(r.text)); global.window = { SpeechRecognition: FakeSR };
  yes = false; r = await S('start lecture mode for DBMS'); check('lecture: asks first, saying the real limits (visible tab, audio goes online, saved every 3 minutes, wake word paused); "no" starts nothing', said.some(x => x.confirmCard && /keep this JARVIS tab visible/i.test(x.text) && /sends the audio to Google or Microsoft/.test(x.text) && /every 3 minutes/.test(x.text) && /wake word is paused/.test(x.text)) && /will not record/.test(r.text) && recs.length === 0 && !Student.lectureActive()); yes = true;
  global.wakeOn = true; captureIntervals = true; intervals.length = 0;
  r = await S('start lecture mode for DBMS'); captureIntervals = false;
  check('lecture: starts listening in your speech language, pauses the wake word, shows the MIC indicator, and saves every 3 minutes', recs.length === 1 && recs[0].started === 1 && recs[0].continuous === true && recs[0].interimResults === false && recs[0].lang === 'en-IN' && global.__wakeStops === 1 && indicator.has('lecture') && /MIC ON/.test(indicator.get('lecture').l) && intervals.some(i => i.ms === 180000) && Student.lectureActive() && /Lecture mode is on/.test(r.text) && /Notes\/lecture-dbms-\d{4}-\d{2}-\d{2}\.md/.test(r.text), { recs: recs.length, intervals: intervals.map(i => i.ms), text: r.text });
  r = await S('start lecture mode for OS'); check('lecture: starting again says it is already on', /already on/.test(r.text) && recs.length === 1);
  r = await S('start an exam on dbms_notes.md'); check('lecture: an exam cannot start during a lecture', /Lecture mode is on/.test(r.text));
  const rec = recs[0]; const speak = (text, fin = true) => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: fin })] });
  speak('Normalization is the process of organising tables to reduce redundancy and improve integrity.'); speak('interim noise that is not final', false); speak('A functional dependency means one attribute determines another.');
  rec.onend(); await new Promise(r => setTimeout(r, 300));
  check('lecture: the recogniser stops by itself now and then: it is started again at once (interim results are ignored)', recs.length === 2 && recs[1].started === 1 && recs[1].lang === 'en-IN', recs.length);
  replies['/tool/writeFile'] = { success: true, name: 'Notes/lecture-dbms.md', created: true };
  const flush = intervals.find(i => i.ms === 180000).fn; await flush();
  const wf = calls.find(c => c[0] === '/tool/writeFile');
  check('lecture: every 3 minutes the new text is APPENDED to the lecture file (never overwritten), the first time with a heading and a warning that it is raw', wf && wf[1].append === true && !wf[1].overwrite && /^Notes\/lecture-dbms-/.test(wf[1].name) && /^# Lecture — DBMS/.test(wf[1].content) && /Raw automatic transcript/.test(wf[1].content) && /Normalization is the process/.test(wf[1].content) && /functional dependency/.test(wf[1].content) && !/interim noise/.test(wf[1].content), wf && wf[1].content);
  speak('Third normal form removes transitive dependencies between non key attributes.'); calls.length = 0; await flush();
  check('lecture: the second save is just the new text under a time heading, without the title again', calls[0][1].append === true && /^### \d\d:\d\d\n/.test(calls[0][1].content) && !/^# Lecture/.test(calls[0][1].content) && /Third normal form/.test(calls[0][1].content));
  recs[1].onerror({ error: 'no-speech' }); check('lecture: silence ("no-speech") is not an error', Student.lectureActive());
  speak('Boyce Codd normal form is a stricter version of third normal form used in database design.');
  replies['/lecture/notes'] = { success: true, file: 'Notes/lecture-dbms-2026-10-09-notes.md', name: 'lecture-dbms-2026-10-09-notes.md', preview: '# DBMS — lecture notes (2026-10-09)\n\n*Written by the AI from an automatic transcript, so it can contain mistakes.*\n\n## Notes\n- Normalization reduces redundancy.\n\n## Key terms\n- BCNF — a stricter 3NF.', chunks: 1, truncated: 0, seconds: 42 };
  calls.length = 0; said.length = 0; r = await S('stop the lecture');
  const nc = calls.find(c => c[0] === '/lecture/notes');
  check('lecture: stopping saves what is left, stops the recogniser and the screen lock, clears the indicator, brings the wake word back', calls.some(c => c[0] === '/tool/writeFile') && recs[1].running === false && !indicator.has('lecture') && !Student.lectureActive() && global.__wakeStarts === 1 && intervals.find(i => i.ms === 180000).cleared === true);
  check('lecture: the notes are requested with the subject and the WHOLE transcript heard, in order', nc && nc[1].subject === 'DBMS' && nc[1].transcript.indexOf('Normalization is the process') < nc[1].transcript.indexOf('Third normal form') && nc[1].transcript.indexOf('Third normal form') < nc[1].transcript.indexOf('Boyce Codd') && !/interim noise/.test(nc[1].transcript) && nc[1].model === 'qwen3.5:4b');
  check('lecture: the answer gives the file, how long it took, the notes themselves (without the title), a "check it" warning, and next steps', /Notes saved to `Notes\/lecture-dbms-2026-10-09-notes\.md`/.test(r.text) && /42 s/.test(r.text) && /- Normalization reduces redundancy\./.test(r.text) && !/# DBMS — lecture notes/.test(r.text) && /check it against what was said/.test(r.text) && r.suggestions.includes('Make flashcards from lecture-dbms-2026-10-09-notes.md') && r.actions[0].label === 'OPEN THE NOTES', r);
  r = await S('stop the lecture'); check('lecture: stopping when it is not on is fine', /not on/.test(r.text));
  // too little speech, AI off, notes error, online AI, microphone blocked, repeated network errors
  reset(); recs.length = 0; global.__wakeStops = 0; await S('start lecture mode for Maths'); speak2(0);
  function speak2(i) { recs[recs.length - 1].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'hello there' }], { isFinal: true })] }); }
  replies['/tool/writeFile'] = { success: true }; r = await S('stop the lecture'); check('lecture: a few words are too little for notes (the transcript is still saved)', /too little to make notes/.test(r.text) && calls.some(c => c[0] === '/tool/writeFile') && !calls.some(c => c[0] === '/lecture/notes'), r.text);
  const lecture = async (words, o = {}) => { reset(); replies['/tool/writeFile'] = { success: true }; if (o.notes) replies['/lecture/notes'] = o.notes; await S('start lecture mode for Chem'); const rc = recs[recs.length - 1]; rc.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: words }], { isFinal: true })] }); if (o.after) o.after(); return S('stop the lecture'); };
  const lots = 'The reaction rate depends on temperature and concentration and the presence of a catalyst in the mixture today.';
  global.llmReady = () => false; r = await lecture(lots); check('lecture: with the AI off the raw transcript is kept and how to make notes later is explained', /AI is off/.test(r.text) && /`Notes\/lecture-chem-/.test(r.text) && !calls.some(c => c[0] === '/lecture/notes') && r.actions[0].label === 'OPEN THE TRANSCRIPT'); global.llmReady = () => true;
  r = await lecture(lots, { notes: { error: 'Local LLM unavailable' } }); check('lecture: if the notes fail, the error is shown and the transcript file is named', /could not write the notes: Local LLM unavailable/.test(r.text) && /`Notes\/lecture-chem-/.test(r.text));
  global.llm.model = 'openai::gpt-x'; r = await lecture(lots, { after: () => { yes = false; } }); check('lecture: with an online AI it asks before sending the transcript; "no" sends nothing', said.some(x => x.confirmCard && /SomeCloud/.test(x.text) && /sends the transcript/.test(x.text)) && !calls.some(c => c[0] === '/lecture/notes') && /nothing was sent/.test(r.text)); yes = true; global.llm.model = 'qwen3.5:4b';
  reset(); recs.length = 0; await S('start lecture mode for Phys'); recs[0].onerror({ error: 'not-allowed' }); await new Promise(r => setTimeout(r, 60));
  check('lecture: a blocked microphone stops lecture mode and says why on screen', !Student.lectureActive() && !indicator.has('lecture') && said.some(x => /did not let me use the microphone/.test(x.text)), said.map(x => x.text.slice(0, 80)));
  reset(); recs.length = 0; await S('start lecture mode for Phys'); for (let i = 0; i < 9; i++) recs[0].onerror({ error: 'network' }); await new Promise(r => setTimeout(r, 60));
  check('lecture: repeated network errors stop it (the speech service needs the internet), and say so', !Student.lectureActive() && said.some(x => /needs the internet/.test(x.text)));
  await new Promise(r => setTimeout(r, 50));

  /* ---------- exam mode ---------- */
  const qs = Array.from({ length: 4 }, (_, i) => ({ q: 'What is normalization concept ' + (i + 1) + '?', a: 'Model answer number ' + (i + 1) + ' from the notes.' }));
  const setup = () => { reset(); store.d['jarvis.exams'] = undefined; delete store.d['jarvis.exams']; replies['/exam/questions'] = { success: true, questions: qs, topic: '', file: 'Notes/dbms_notes.md', fromNotes: true }; replies['/skill/viva/grade'] = b => (/concept 1|concept 2/.test(b.question) ? { success: true, score: 9, feedback: 'Good.', missed: [], model: 'x' } : { success: true, score: 4, feedback: 'Thin.', missed: ['the key idea'], model: 'x' }); };
  setup(); r = await S('start an exam on dbms_notes.md with 4 questions');
  check('exam: questions come from the note (the file name is sent), the exam is announced with count, minutes (default 2.5 per question), "from your notes", and the rules', calls.find(c => c[0] === '/exam/questions')[1].name === 'dbms_notes.md' && calls.find(c => c[0] === '/exam/questions')[1].n === 4 && /Exam on dbms_notes\.md/.test(r.text) && /4 questions, 10 minutes/.test(r.text) && /from your notes/.test(r.text) && /Everything you say or type counts as an answer/.test(r.text) && /\*\*Question 1 of 4\*\*/.test(r.text) && /What is normalization concept 1/.test(r.text) && Student.active(), r.text);
  check('exam: the first question is read aloud', /^The exam begins\. What is normalization concept 1\?/.test(r.speak));
  r = await Student.intercept('open the browser please', 'text');
  check('exam: even a sentence that looks like a command is an answer; the next question follows', /Noted/.test(r.text) && /\*\*Question 2 of 4\*\*/.test(r.text) && /Next question\. What is normalization concept 2/.test(r.speak) && Student._E.answers[0].user === 'open the browser please');
  r = await Student.intercept('skip', 'text'); check('exam: "skip" passes and is recorded as no answer', /Skipped/.test(r.text) && /Question 3 of 4/.test(r.text) && Student._E.answers[1].user === '');
  r = await Student.intercept('repeat', 'text'); check('exam: "repeat" says the question again, without using it up', /Question 3 of 4/.test(r.text) && Student._E.i === 2);
  r = await Student.intercept('scan a document', 'phone'); check('exam: a phone message is not taken as an answer', /running at the laptop/.test(r.text) && Student._E.i === 2);
  await Student.intercept('Normalization organises data into tables to remove repetition.', 'text');
  calls.length = 0; r = await Student.intercept('Redundancy means the same data stored twice, which causes update problems.', 'text');
  const gradeCalls = calls.filter(c => c[0] === '/skill/viva/grade');
  check('exam: after the last question every ANSWERED question is marked (the skipped one is not sent), each with the reference answer from the notes', gradeCalls.length === 3 && gradeCalls.every(c => /Model answer number/.test(c[1].reference) && c[1].answer && c[1].topic === 'dbms_notes.md') && !Student.active(), gradeCalls.map(c => c[1].question));
  check('exam: the result has the percentage (every question counts, a skipped or unreached one is 0), counts, the per-question lines, and for weak ones what you said and a better answer', /Exam result: 43%/.test(r.text) && /4\.3\/10 average/.test(r.text) && /3 questions answered out of 4/.test(r.text) && /1\. \*\*9\/10\*\*/.test(r.text) && /2\. \*\*0\/10\*\*/.test(r.text) && /\*You said:\* Redundancy means the same data stored twice/.test(r.text) && /\*Better:\* Model answer number 4/.test(r.text) && /\*missed:\* the key idea/.test(r.text) && /judge for yourself/.test(r.text), r.text);
  check('exam: weak answers (under 7/10 — also the skipped and the poor ones) go to a "Mistakes" flashcard deck, with the answer from the notes; ONE undo entry', flashcards.length === 3 && flashcards.every(c => c.deck === 'Mistakes' && c.q && c.a && c.box === 1) && flashcards.some(c => /concept 3/.test(c.q) && /number 3/.test(c.a)) && /3 weak questions/.test(r.text) && undo.length === 1 && /mistakes/.test(undo[0][0]), flashcards);
  check('exam: the result is kept in history (topic, score, how many, how long)', (() => { const h = store.get('jarvis.exams', []); return h.length === 1 && h[0].topic === 'dbms_notes.md' && h[0].pct === 43 && h[0].n === 4 && h[0].answered === 3 && h[0].mistakes === 3 && h[0].sec >= 0; })());
  check('exam: it suggests reviewing the Mistakes deck', r.suggestions.includes('Review my Mistakes flashcards'));
  const um = undo[0][1](); check('exam: undo removes only the cards that exam added', flashcards.length === 0 && /Removed the 3 Mistakes flashcards/.test(um));
  // second exam with the same weak questions: no duplicates in the deck
  setup(); flashcards = [{ id: 'old', deck: 'Mistakes', q: 'What is normalization concept 3?', a: 'x', box: 1, due: 0 }];
  await S('start an exam on dbms_notes.md with 4 questions'); for (const a of ['one answer text here', 'two answer text here', 'three answer text here', 'four answer text here']) r = await Student.intercept(a, 'text');
  check('exam: a weak question that is already in the Mistakes deck is not added twice; the new ones are', flashcards.filter(c => /concept 3/.test(c.q)).length === 1 && flashcards.length === 2 && /1 weak question/.test(r.text), flashcards.map(c => c.q));
  // stopping early, bare "stop", and time running out
  setup(); await S('exam me on normalization for 10 minutes'); await Student.intercept('some answer to question one here', 'text');
  check('exam: a topic (not a file) first tries it as a file name, then falls back to the topic when none is found', (() => { const q = calls.filter(c => c[0] === '/exam/questions'); return q.length >= 1 && q[0][1].name === 'normalization'; })());
  calls.length = 0; r = await Student.intercept('stop', 'text');
  check('exam: "stop" ends it, marks the one answer given, and says it was stopped early', calls.filter(c => c[0] === '/skill/viva/grade').length === 1 && /stopped early/.test(r.text) && /1 question answered out of 4/.test(r.text) && !Student.active());
  setup(); replies['/exam/questions'] = b => (b.name ? { error: 'I could not find “' + b.name + '”.' } : { success: true, questions: qs, topic: b.topic, file: null, fromNotes: false });
  r = await S('exam me on normalization'); check('exam: when no note is found the exam is on the topic, and says the questions are not from your notes', /not from your notes/.test(r.text) && calls.filter(c => c[0] === '/exam/questions').length === 2 && calls.filter(c => c[0] === '/exam/questions')[1][1].topic === 'normalization' && /Exam on normalization/.test(r.text)); await Student.intercept('stop the exam', 'text');
  setup(); captureIntervals = true; intervals.length = 0; await S('start an exam on dbms_notes.md for 5 minutes with 4 questions'); captureIntervals = false;
  await Student.intercept('only one answer so far here', 'text');
  const realNow = Date.now; Date.now = () => realNow() + 6 * 60000; calls.length = 0; said.length = 0;
  const tick = intervals.find(i => i.ms === 1000).fn; tick(); await new Promise(r => setTimeout(r, 50));
  const timeUp = said.find(x => /Time is up/.test(x.text) && /Exam result/.test(x.text)) || said.find(x => /Exam result/.test(x.text));
  Date.now = realNow;
  check('exam: when the time runs out it ends by itself, marks what was answered and says time ran out', timeUp && /time ran out/.test(timeUp.text) && calls.filter(c => c[0] === '/skill/viva/grade').length === 1 && !Student.active(), said.map(x => x.text.slice(0, 60)));
  check('exam: nothing answered when the time is up → nothing to mark', await (async () => { setup(); captureIntervals = true; intervals.length = 0; await S('start an exam on dbms_notes.md for 2 minutes'); captureIntervals = false; Date.now = () => realNow() + 3 * 60000; said.length = 0; intervals.find(i => i.ms === 1000).fn(); await new Promise(r => setTimeout(r, 30)); Date.now = realNow; return said.some(x => /nothing was answered/.test(x.text)) && !Student.active(); })());
  // refusals
  setup(); global.llmReady = () => false; r = await S('start an exam on dbms_notes.md'); check('exam: with the AI off it says why it cannot start', /needs the AI brain/.test(r.text) && !Student.active()); global.llmReady = () => true;
  r = await S('start exam mode'); check('exam: "start exam mode" with no subject asks what to examine you on', /What should I examine you on/.test(r.text));
  Skills.state.viva = {}; r = await S('start an exam on os'); check('exam: a running viva blocks it', /viva is running/.test(r.text)); Skills.state.viva = null;
  setup(); replies['/exam/questions'] = { error: 'The AI did not give me proper questions.' }; r = await S('start an exam on dbms_notes.md'); check('exam: a question-writing failure is shown and no exam starts', /could not set the exam: The AI did not give me proper questions/.test(r.text) && !Student.active());
  setup(); global.llm.model = 'openai::gpt-x'; yes = false; r = await S('start an exam on dbms_notes.md'); check('exam: with an online AI it asks first (notes and answers go to the provider); "no" starts nothing', said.some(x => x.confirmCard && /SomeCloud/.test(x.text)) && /no exam/i.test(r.text) && !calls.some(c => c[0] === '/exam/questions')); yes = true; global.llm.model = 'qwen3.5:4b';
  r = await Student.intercept('start an exam on os', 'phone'); check('exam: it cannot be started from the phone', /taken at the laptop/.test(r.text));
  r = await S('stop the exam'); check('exam: stopping when none is running', /No exam is running/.test(r.text));

  /* ---------- history ---------- */
  store.d['jarvis.exams'] = undefined; delete store.d['jarvis.exams']; r = await S('how did my exams go?'); check('history: none yet → how to start one', /not taken an exam yet/.test(r.text));
  store.set('jarvis.exams', [60, 70, 80, 55, 65, 75, 90].map((pct, i) => ({ id: 'e' + i, t: Date.UTC(2026, 9, 1 + i), topic: 'DBMS', n: 8, answered: 8, avg: pct / 10, pct, sec: 600, mistakes: 1 })));
  r = await S('show my exam history');
  check('history: the last six with date, topic, score, answered and time, and the trend of the last 3 against the 3 before', /7 so far/.test(r.text) && /\*\*7 Oct\*\* — DBMS: \*\*90%\*\* \(8\/8 answered, 10:00\)/.test(r.text) && !/\*\*1 Oct\*\*/.test(r.text) && /Last 3 average \*\*77%\*\*/.test(r.text) && /▲ 8 points up/.test(r.text) && /90 percent/.test(r.speak), r.text);

  clearInterval(keep);
  console.log(`student-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
