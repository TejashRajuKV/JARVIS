// Chat side of the camera tools (camera-page.js) and the two watchers (watch-page.js): explicit wording only, phone messages refused, QR text worded
// safely, presence lock and room watch driven with a fake camera, a fake face detector and a fake clock. No camera, no browser.
// Run: node tests/camera-page.test.js
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const root = f => path.join(__dirname, '..', f);

/* ---------- page globals, stubbed ---------- */
const calls = [], said = [], fetches = [];
let replies = {}, confirmAnswer = true;
global.ScanMath = require(root('scanmath.js'));
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
global.settings = { presenceLock: false, presenceSecs: 60, phonePush: false, presenceLockWindows: false };
global.saveSettings = () => {}; global.setState = () => {}; global.toast = () => {}; global.API = '/api';
global.llmReady = () => true; global.llm = { model: 'qwen3.5:4b' }; global.isCloudModel = m => String(m).includes('::'); global.modelInfo = () => ({ providerLabel: 'SomeCloud' });
global.callTool = async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
global.getJSON = async ep => { const r = replies['GET ' + ep]; return typeof r === 'function' ? r() : (r || { error: 'no stub for ' + ep }); };
global.jarvisSay = o => { said.push(o); if (o && o.confirm) setTimeout(() => (confirmAnswer ? o.confirm.onConfirm() : o.confirm.onCancel()), 0); };
global.fetch = async (url, opts) => { fetches.push([url, opts]); return { ok: true, status: 200, json: async () => ({ success: true, file: 'Watch/watch-test.jpg' }) }; };
const el = () => ({ style: {}, remove() {}, appendChild() {}, play: async () => {}, getContext: () => ({}), videoWidth: 640, videoHeight: 480, width: 80, height: 60, classList: { add() {}, remove() {} } });
global.document = { createElement: () => el(), getElementById: () => null, querySelector: () => null, body: { appendChild() {} }, head: { appendChild() {} } };
global.location = { reload: () => { global.__reloaded = (global.__reloaded || 0) + 1; } };
eval(fs.readFileSync(root('vendor/qrcode.js'), 'utf8') + ';global.qrcode = qrcode;');
eval(fs.readFileSync(root('camera-page.js'), 'utf8') + ';global.Camera = Camera;');
eval(fs.readFileSync(root('watch-page.js'), 'utf8') + ';global.Watch = Watch;');
// the camera itself is faked: no browser here
let streams = 0, stopped = 0, indicator = new Map();
Camera.getStream = async () => { streams++; return { getTracks: () => [{ stop: () => { stopped++; } }] }; };
Camera.stopStream = s => { if (s) stopped++; };
Camera.track = (name, label, stop) => { indicator.set(name, { label, stop }); return () => indicator.delete(name); };
Camera.untrack = name => indicator.delete(name);
const fresh = () => { calls.length = 0; said.length = 0; fetches.length = 0; replies = {}; confirmAnswer = true; };

(async () => {
  /* ---------- wording ---------- */
  const yes = (t, kind) => { const m = Camera.match(t); check('camera match: "' + t + '" → ' + kind, m && m.kind === kind, m); };
  for (const t of ['scan a document', 'scan document', 'Scan the document.', 'scan this page', 'scan my notes', 'scan the whiteboard', 'scan a paper', 'scan this worksheet', 'scan my assignment to pdf', 'scan it to pdf', 'digitize my notes', 'scan a document using the camera', '/scan', 'please scan a receipt', 'scan the blackboard', 'scan handwritten notes', 'open the scanner', 'use the document scanner']) yes(t, 'scan');
  for (const t of ['scan a qr code', 'scan qr', 'scan the qr code', 'read this qr code', 'read a qr', 'decode the qr code', '/qr', 'what does this qr say', 'scan a qr code with the camera', 'qr scanner']) yes(t, 'qr');
  for (const [t, text] of [['make a qr for https://example.com', 'https://example.com'], ['create a qr code for my wifi', 'my wifi'], ['generate a QR code of hello world', 'hello world'], ['qr code for https://x.test/a?b=1', 'https://x.test/a?b=1'], ['/qr https://college.edu', 'https://college.edu'], ['make me a qr for "my name is Asha"', 'my name is Asha']]) {
    const m = Camera.match(t); check('camera match: "' + t + '" → qrmake', m && m.kind === 'qrmake' && m.text === text, m);
  }
  for (const t of ['solve this from a photo', 'solve this problem from a photo', 'solve the equation from a picture', 'answer this question from the camera', 'explain this diagram from a photo', 'what is in this picture', "what's in this photo", 'look at this photo', 'describe this image', 'read this picture', 'take a photo and solve it', 'snap a picture to read', '/photo', 'check my homework from a photo']) yes(t, 'photo');
  check('camera match: /photo with a question keeps the question', (Camera.match('/photo what is the voltage here') || {}).question === 'what is the voltage here');
  for (const t of ['scan my pc for viruses', 'scan the barcode on the box', 'scan the network', 'scan for wifi', 'scan this website', 'scan all files', 'scan my downloads folder', 'scan the room', 'scan', 'document', 'qr', 'make a qr', 'make a qr for', 'make a pdf', 'what is a qr code', 'how do qr codes work', 'explain qr codes', 'what is in the fridge', 'take a photo', 'take a screenshot', 'read this file', 'read my notes', 'describe my day', 'solve 2x + 3 = 7', 'solve this', 'look at the sky', 'open the camera app', 'scan to pdf the cat', 'scan documents folder', 'scan a documentary']) {
    check('camera match: not taken: "' + t + '"', Camera.match(t) === null, Camera.match(t));
  }
  check('camera match: empty input', Camera.match('') === null && Camera.match(null) === null);

  /* ---------- phone messages never use the camera ---------- */
  fresh();
  for (const t of ['scan a document', 'scan a qr code', 'solve this from a photo']) {
    const r = await Camera.intercept(t, 'phone');
    check('phone: "' + t + '" is refused with a reason, and no camera starts', r && /only use the camera for requests made at the laptop/.test(r.text) && streams === 0 && !calls.length, r);
  }
  replies['/tool/writeFile'] = b => ({ success: true, name: b.name });
  check('phone: making a QR code needs no camera, so it is allowed', /Made a QR code/.test((await Camera.intercept('make a qr for https://example.com', 'phone')).text));

  /* ---------- QR maker ---------- */
  fresh(); replies['/tool/writeFile'] = b => ({ success: true, name: b.name, created: true });
  let r = await Camera.makeQr('https://example.com/a?b=c');
  const w = calls.find(c => c[0] === '/tool/writeFile');
  check('qr make: saved as an SVG under QR/ with a readable name', w && /^QR\/qr-example-com-a-b-c\.svg$/.test(w[1].name) && /^<svg/.test(w[1].content) && w[1].content.length > 1000, w && w[1].name);
  check('qr make: says what it made, and gives a picture and an OPEN button', /Made a QR code for \*\*https:\/\/example\.com\/a\?b=c\*\*/.test(r.text) && r.extraNode && r.actions[0].label === 'OPEN THE PICTURE', r.text);
  check('qr make: the saved file is a real QR (rows of dark squares)', (w[1].content.match(/M\d+,\d+l8,0/g) || []).length > 100 && /fill="white"/.test(w[1].content) && /fill="black"/.test(w[1].content));
  fresh(); let n = 0; replies['/tool/writeFile'] = b => (++n < 3 ? { success: false, exists: true, name: b.name } : { success: true, name: b.name });
  r = await Camera.makeQr('hello');
  check('qr make: a name already taken gets a number (-2, -3), never an overwrite', calls.map(c => c[1].name).join() === 'QR/qr-hello.svg,QR/qr-hello-2.svg,QR/qr-hello-3.svg' && !calls.some(c => c[1].overwrite), calls.map(c => c[1].name));
  fresh(); replies['/tool/writeFile'] = { success: false, exists: true };
  r = await Camera.makeQr('hello'); check('qr make: too many copies is explained', /already several QR files/.test(r.text));
  replies['/tool/writeFile'] = { error: 'disk full' }; r = await Camera.makeQr('hello'); check('qr make: a save failure is reported', /could not save it: disk full/.test(r.text));
  r = await Camera.makeQr('x'.repeat(901)); check('qr make: too long is refused before anything is written', /too long/.test(r.text) && !calls.some(c => c[0] === '/tool/writeFile' && c[1].content.length > 100 && c[1].name.length > 100));
  r = await Camera.makeQr('   '); check('qr make: empty is explained', /what the QR code should say/.test(r.text));
  fresh(); replies['/tool/writeFile'] = b => ({ success: true, name: b.name }); r = await Camera.makeQr('<script>alert(1)</script> & "x"');
  check('qr make: odd characters are fine and the file name is plain', /^QR\/qr-script-alert-1-script-x\.svg$/.test(calls[0][1].name) || /^QR\/qr-[a-z0-9-]+\.svg$/.test(calls[0][1].name), calls[0][1].name);

  /* ---------- what a QR says ---------- */
  fresh();
  let d = Camera.describeQr(ScanMath.parseQr('https://college.edu/tt'));
  check('qr describe: a link is described and NOT opened; there is an explicit OPEN button', /A link/.test(d.text) && /did not open it/.test(d.text) && d.actions.length === 1 && d.actions[0].label === 'OPEN THE LINK' && !calls.length, d);
  d.actions[0].fn(); await new Promise(r => setTimeout(r, 5));
  check('qr describe: only the button opens it, with the exact address', calls.length === 1 && calls[0][0] === '/tool/openUrl' && calls[0][1].url === 'https://college.edu/tt', calls);
  d = Camera.describeQr(ScanMath.parseQr('javascript:alert(1)'));
  check('qr describe: a javascript: address has no open button', !(d.actions || []).length && !/OPEN/.test(JSON.stringify(d.actions || [])), d);
  d = Camera.describeQr(ScanMath.parseQr('http://google.com@evil.example/login'));
  check('qr describe: a trick address is flagged and shows the real host', /Be careful/.test(d.text) && /evil\.example/.test(d.text), d.text);
  d = Camera.describeQr(ScanMath.parseQr('WIFI:T:WPA;S:Hostel;P:topsecret99;;'));
  check('qr describe: a Wi-Fi password is never written in the chat text or the spoken text', !/topsecret99/.test(JSON.stringify([d.text, d.speak])) && /Hostel/.test(d.text) && d.actions[0].label === 'COPY PASSWORD', d);
  d = Camera.describeQr(ScanMath.parseQr('WIFI:T:nopass;S:Cafe;;')); check('qr describe: an open network has no copy button', /open, no password/.test(d.text) && !d.actions.length);
  d = Camera.describeQr(ScanMath.parseQr('upi://pay?pa=a@b&am=500')); check('qr describe: a payment request is shown with a warning and no action', /never pay for you/.test(d.text) && !(d.actions || []).length);
  d = Camera.describeQr(ScanMath.parseQr('just text here')); check('qr describe: plain text', /It says/.test(d.text) && /just text here/.test(d.text));
  d = Camera.describeQr(ScanMath.parseQr('BEGIN:VCARD\nFN:Asha Rao\nTEL:123\nEND:VCARD')); check('qr describe: contact card', /Asha Rao/.test(d.text) && /123/.test(d.text));
  d = Camera.describeQr(ScanMath.parseQr('')); check('qr describe: empty', /empty/.test(d.text));
  d = Camera.describeQr(ScanMath.parseQr('see `this` text')); check('qr describe: backticks in the code cannot break out of the quote', !/`this`/.test(d.text));

  /* ---------- watcher wording ---------- */
  const wm = (t, kind) => { const m = Watch.match(t); check('watch match: "' + t + '" → ' + kind, m && m.kind === kind, m); };
  for (const t of ['lock when I leave', 'Lock when i walk away', 'turn on presence lock', 'start presence lock', 'enable the presence lock', 'lock jarvis when i step away', 'please turn on the presence lock']) wm(t, 'presence-on');
  for (const t of ['turn off presence lock', 'stop presence lock', 'disable the presence lock', "don't lock when i leave", 'stop lock when i leave']) wm(t, 'presence-off');
  for (const t of ['presence lock', 'presence lock status', 'is the presence lock on']) wm(t, 'presence-status');
  for (const t of ['watch my room', 'watch the room', 'guard my room', 'monitor the room', 'start room watch', 'please watch my room']) wm(t, 'room-on');
  for (const t of ['stop watching my room', 'stop watching the room', 'end room watch', 'stop the room guard', 'cancel watching the room', 'room watch off']) wm(t, 'room-off');
  for (const t of ['room watch', 'room watch status', 'are you watching my room']) wm(t, 'room-status');
  for (const t of ['watch youtube', 'watch a movie in my room', 'watch the room temperature', 'lock my laptop', 'lock the screen', 'lock when the timer ends', 'presence', 'room', 'watch', 'stop watching cricket', 'guard the door', 'monitor my cpu', 'lock jarvis', 'what is presence lock', 'how do i watch my room']) {
    check('watch match: not taken: "' + t + '"', Watch.match(t) === null, Watch.match(t));
  }

  /* ---------- presence lock ---------- */
  fresh(); streams = 0; stopped = 0; indicator.clear(); global.__reloaded = 0;
  let clock = 1000000, truth = true, locks = 0;
  Watch.deps.now = () => clock; Watch.deps.detect = async () => truth; Watch.deps.lock = async () => { locks++; };
  replies['GET /lock/status'] = { enabled: false, active: false };
  r = await Watch.intercept('lock when I leave', 'text');
  check('presence: needs the app lock first, says how, starts nothing, switch stays off', /needs the \*\*app lock\*\*/.test(r.text) && !Watch.presenceOn() && settings.presenceLock === false && indicator.size === 0, r.text);
  replies['GET /lock/status'] = { enabled: true, active: true };
  r = await Watch.intercept('lock when I leave', 'phone');
  check('presence: from the phone it is refused', /only use the camera/.test(r.text) && !Watch.presenceOn());
  r = await Watch.intercept('lock when I leave', 'text');
  check('presence: starts (indicator shown with the seconds, switch on, says plainly what it does)', Watch.presenceOn() && indicator.has('presence') && /60 s/.test(indicator.get('presence').label) && settings.presenceLock === true && /60 seconds/.test(r.text) && /never saved or sent/.test(r.text), r.text);
  check('presence: Windows is not locked unless you chose that', /Windows itself is not locked/.test(r.text));
  r = await Watch.intercept('lock when I leave', 'text'); check('presence: asking again says it is already on', /already on/.test(r.text));
  const step = async (ms, present) => { clock += ms; truth = present; await Watch.presenceStep(); };
  await step(2000, true);
  check('presence: someone there → no lock; status says it can see you', locks === 0 && /can see you/.test(Watch.intercept && (await Watch.intercept('presence lock status', 'text')).text));
  for (let i = 0; i < 29; i++) await step(2000, false);                                   // 58 s away
  check('presence: 58 s away → not yet', locks === 0 && /cannot see you/.test((await Watch.intercept('presence lock status', 'phone')).text));
  await step(2000, false); await step(2000, false);
  check('presence: 60 s away → locks exactly once, and the camera is turned off', locks === 1 && !Watch.presenceOn() && indicator.size === 0, { locks, on: Watch.presenceOn() });
  await Watch.presenceStep(); check('presence: after locking nothing more happens', locks === 1);
  // "could not tell" never locks
  fresh(); settings.presenceLock = false; replies['GET /lock/status'] = { enabled: true }; locks = 0;
  await Watch.intercept('turn on presence lock', 'text');
  Watch.deps.detect = async () => { throw new Error('detector broke'); };
  for (let i = 0; i < 100; i++) { clock += 2000; await Watch.presenceStep(); }
  check('presence: a detector that keeps failing never locks (error ≠ absent)', locks === 0 && Watch.presenceOn());
  Watch.deps.detect = async () => null; for (let i = 0; i < 100; i++) { clock += 2000; await Watch.presenceStep(); }
  check('presence: "could not tell" (null) never locks either', locks === 0);
  Watch.deps.detect = async () => false;
  for (let i = 0; i < 20; i++) { clock += 2000; await Watch.presenceStep(); }               // 40 s away
  clock += 600000; await Watch.presenceStep();                                            // the tab slept for 10 minutes: that gap is not evidence
  check('presence: a tab that slept for minutes does not lock on its first awake step', locks === 0);
  for (let i = 0; i < 29; i++) { clock += 2000; await Watch.presenceStep(); }
  check('presence: …but real absence after waking still counts from the start (58 s → no lock yet)', locks === 0);
  clock += 4000; await Watch.presenceStep(); check('presence: …and locks at 60 s', locks === 1);
  // switching off, also from the phone
  settings.presenceLock = false; await Watch.intercept('turn on presence lock', 'text'); Watch.deps.detect = async () => true;
  r = await Watch.intercept('turn off presence lock', 'phone'); check('presence: turning it off is allowed from the phone (it only makes things safer)', /off/.test(r.text) && !Watch.presenceOn() && settings.presenceLock === false && indicator.size === 0);
  r = await Watch.intercept('turn off presence lock', 'text'); check('presence: off when already off is fine', /already off/.test(r.text));
  // the indicator's STOP button
  await Watch.intercept('turn on presence lock', 'text'); indicator.get('presence').stop();
  check('presence: the STOP button on the indicator turns it off and the switch with it', !Watch.presenceOn() && settings.presenceLock === false);
  // real lock path (no injected lock): app lock first, Windows only if chosen
  fresh(); Watch.deps.lock = null; replies['/lock/lock'] = { success: true }; replies['/tool/lockSystem'] = { success: true }; replies['GET /lock/status'] = { enabled: true };
  Watch.deps.detect = async () => false; settings.presenceLockWindows = false; settings.presenceSecs = 30;
  await Watch.intercept('turn on presence lock', 'text'); for (let i = 0; i < 16; i++) { clock += 2000; await Watch.presenceStep(); }
  check('presence: the real lock calls /lock/lock (not the idle ping) and reloads; Windows is left alone', calls.some(c => c[0] === '/lock/lock') && !calls.some(c => c[0] === '/tool/lockSystem') && !calls.some(c => /ping/i.test(c[0])) && global.__reloaded === 1, calls.map(c => c[0]));
  fresh(); replies['GET /lock/status'] = { enabled: true }; settings.presenceLockWindows = true; await Watch.intercept('turn on presence lock', 'text'); for (let i = 0; i < 16; i++) { clock += 2000; await Watch.presenceStep(); }
  check('presence: with "also lock Windows" on, Windows is locked too', calls.some(c => c[0] === '/tool/lockSystem') && calls.some(c => c[0] === '/lock/lock'));
  settings.presenceLockWindows = false; settings.presenceSecs = 60; Watch.deps.lock = async () => { locks++; };
  check('presence: no camera is left running after all of that', !Watch.presenceOn() && indicator.size === 0);

  /* ---------- room watch ---------- */
  fresh(); streams = 0; indicator.clear(); settings.phonePush = true;
  let frame = 0, movingNow = false;
  const still = new Uint8Array(4800).fill(100);
  Camera.smallGray = () => { if (!movingNow) return still; const f = new Uint8Array(4800).fill(100); const k = frame++; for (let i = 0; i < 400; i++) f[(k * 450 + i) % 4800] = 230; return f; };
  Camera.videoToCanvas = () => ({}); Camera.canvasToBlob = async () => ({ size: 1234, type: 'image/jpeg' });
  r = await Watch.startRoom('phone'); check('room: from the phone it is refused, and no camera starts', /only use the camera/.test(r.text) && streams === 0 && !Watch.roomOn());
  confirmAnswer = false; r = await Watch.intercept('watch my room', 'text');
  check('room: asks first and says what it does (camera, local pictures, text-only phone alert, keep window visible); "no" starts nothing', said.some(s => s.confirm && /camera/.test(s.text) && /text-only/.test(s.text) && /No picture leaves this laptop/.test(s.text) && /visible/.test(s.text)) && /will not watch/.test(r.text) && streams === 0 && !Watch.roomOn(), said.map(s => s.text));
  confirmAnswer = true; r = await Watch.intercept('watch my room', 'text');
  check('room: after "yes" it starts with the indicator on', Watch.roomOn() && indicator.has('room') && streams === 1 && /Watching the room/.test(r.text) && /text only/.test(r.text), r.text);
  r = await Watch.intercept('watch my room', 'text'); check('room: asking again says it is already watching', /already watching/.test(r.text) && streams === 1);
  said.length = 0; fetches.length = 0; calls.length = 0; replies['/phone/alert'] = { success: true, sent: true };
  const tick = async () => { clock += 1000; await Watch.roomStep(); };
  for (let i = 0; i < 15; i++) await tick();
  check('room: a still room (and the 10 s warm-up) gives no alert', !said.some(s => s.alert) && !fetches.length);
  movingNow = true; await tick(); await tick(); check('room: two moving frames are not enough', !said.some(s => s.alert));
  await tick();
  const al = said.find(s => s.alert);
  check('room: the third moving frame raises ONE alert on screen with the saved picture name', al && /Movement seen in the room/.test(al.text) && /Watch\/watch-test\.jpg/.test(al.text) && said.filter(s => s.alert).length === 1, said.map(s => s.text));
  const snap = fetches.find(f => /room\/snapshot/.test(f[0]));
  check('room: the picture goes to the laptop\'s own server only (one request, to /api/room/snapshot)', snap && snap[0] === '/api/room/snapshot' && snap[1].method === 'POST' && fetches.length === 1, fetches.map(f => f[0]));
  const pa = calls.find(c => c[0] === '/phone/alert');
  check('room: the phone gets a TEXT-ONLY alert (no image, no data URL, no file)', pa && pa[1].kind === 'room' && /^Movement seen in your room at /.test(pa[1].text) && !('image' in pa[1]) && !/data:|jpe?g|Watch\//.test(JSON.stringify(pa[1])) && calls.filter(c => c[0] === '/phone/alert').length === 1, pa);
  for (let i = 0; i < 20; i++) await tick();
  check('room: more movement in the next minutes does not alert again (cooldown)', said.filter(s => s.alert).length === 1);
  movingNow = false; for (let i = 0; i < 302; i++) await tick();                          // five quiet minutes pass, one second at a time
  movingNow = true; await tick(); await tick(); await tick();
  check('room: after the cooldown it can alert again', said.filter(s => s.alert).length === 2);
  r = await Watch.intercept('room watch status', 'phone'); check('room: status (allowed from the phone) counts alerts', /2 alerts/.test(r.text));
  r = await Watch.intercept('stop watching the room', 'phone'); check('room: stopping is allowed from the phone, and the camera and indicator go', /stopped watching/.test(r.text) && !Watch.roomOn() && indicator.size === 0);
  r = await Watch.intercept('stop watching the room', 'text'); check('room: stopping when not watching is fine', /was not watching/.test(r.text));
  // phone alerts off: nothing is sent to the phone
  settings.phonePush = false; calls.length = 0; movingNow = false; const before = said.filter(s => s.alert).length; await Watch.intercept('watch my room', 'text'); movingNow = false;
  for (let i = 0; i < 12; i++) await tick(); movingNow = true; for (let i = 0; i < 4; i++) await tick();
  check('room: with phone alerts off, no phone message is sent (the alert still shows on screen)', said.filter(s => s.alert).length === before + 1 && !calls.some(c => c[0] === '/phone/alert'));
  // a tab that slept: frames after the gap are not compared to stale ones
  movingNow = false; for (let i = 0; i < 3; i++) await tick(); clock += 120000; movingNow = true; const c0 = said.filter(s => s.alert).length; await Watch.roomStep();
  check('room: the first frame after a long sleep only sets a new baseline', said.filter(s => s.alert).length === c0);
  // auto stop after 8 hours
  clock += 8 * 3600 * 1000; movingNow = false; await Watch.roomStep();
  check('room: stops by itself after 8 hours and says so', !Watch.roomOn() && said.some(s => /after 8 hours/.test(s.text)) && indicator.size === 0);
  Watch.stopRoom(); Watch.stopPresence();

  clearInterval(keep);
  console.log(`camera-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
