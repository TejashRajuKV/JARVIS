// Wake word in other tabs/apps (wakeword.js): the Windows-listener manager, with a fake PowerShell process — no
// microphone. Plus the page's wake-word list (lang.js) catching common mishearings. Run: node tests/wakeword.test.js
'use strict';
const fs = require('fs'), path = require('path'), { EventEmitter } = require('events');
const { suite, ROOT } = require('./lib/server');
const W = require(path.join(ROOT, 'wakeword.js'));
const Voice = require(path.join(ROOT, 'voice.js'));
const { check, done } = suite('wakeword');

function fakeRun() {
  const spawned = [];
  const run = (cmd, args, opts) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.killed = false;
    p.kill = () => { p.killed = true; p.emit('exit', 0); };
    p.say = obj => p.stdout.emit('data', JSON.stringify(obj) + '\n');
    spawned.push({ cmd, args, env: opts.env, p });
    return p;
  };
  return { run, spawned };
}

{ // start / events / stop
  let t = 1e6; const events = [];
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  check('Windows listener', 'switching on starts one listener', f.spawned.length === 1 && /powershell/i.test(f.spawned[0].cmd));
  check('Windows listener', 'it listens only for the wake phrases (jarvis + romanised transliterations)', f.spawned[0].env.JARVIS_WAKE === 'jarvis,hey jarvis,ok jarvis,okay jarvis,jaarvis,hey jaarvis,ok jaarvis,okay jaarvis,jarwis,hey jarwis,ok jarwis,okay jarwis,jarvas,hey jarvas,ok jarvas,okay jarvas,jarviz,hey jarviz,ok jarviz,okay jarviz', f.spawned[0].env.JARVIS_WAKE);
  n.set(true);
  check('Windows listener', 'switching on twice doesn’t start a second one', f.spawned.length === 1);
  f.spawned[0].p.say({ ready: 'en-US' });
  check('Windows listener', 'status reports it is listening (and with which recogniser)', n.status().listening && n.status().recogniser === 'en-US');
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.97 });
  check('Windows listener', 'a detected wake word is sent to the page', events.length === 1 && events[0].type === 'wake' && events[0].text === 'jarvis');
  t += 800; f.spawned[0].p.say({ wake: 'hey jarvis', conf: 0.9 });
  check('Windows listener', 'one "hey Jarvis" doesn’t fire twice', events.length === 1);
  t += 3000; f.spawned[0].p.say({ wake: 'jarvis', conf: 0.9 });
  check('Windows listener', 'a later wake word fires again', events.length === 2);
  f.spawned[0].p.stdout.emit('data', '{"wake":"jar'); f.spawned[0].p.stdout.emit('data', 'vis","conf":0.9}\n');
  check('Windows listener', 'output split across chunks is still read (and deduplicated)', events.length === 2);
  n.set(false);
  check('Windows listener', 'switching off stops it', f.spawned[0].p.killed && !n.status().on && !n.status().listening);
}
{ // errors and restarts
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: () => {}, run: f.run });
  n.set(true);
  f.spawned[0].p.say({ error: 'no English speech recogniser is installed' });
  check('Windows listener', 'a missing recogniser is reported, not hidden', /no English speech recogniser/.test(n.status().error));
  n.stop();
  const off = W.createNativeWake({ isWin: false, broadcast: () => {}, run: f.run });
  off.set(true);
  check('Windows listener', 'on Linux/macOS it does nothing (and says unsupported)', f.spawned.length === 1 && off.status().supported === false);
}
{ // mic sensitivity → how sure Windows must be that it heard "Jarvis"
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: () => {}, run: f.run });
  n.set(true, { sensitivity: 'normal' });
  check('Mic sensitivity', 'Normal needs 60% confidence', f.spawned[0].env.JARVIS_MINCONF === '0.6', f.spawned[0].env.JARVIS_MINCONF);
  n.set(true, { sensitivity: 'max' });
  check('Mic sensitivity', 'changing it to Max restarts the listener with 45%', f.spawned.length === 2 && f.spawned[0].p.killed && f.spawned[1].env.JARVIS_MINCONF === '0.45', f.spawned.map(s => s.env.JARVIS_MINCONF));
  n.set(true, { sensitivity: 'max' });
  check('Mic sensitivity', 'the same setting again doesn’t restart it', f.spawned.length === 2);
  n.stop();
}
{ // persona
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: () => {}, run: f.run });
  n.set(true, { persona: 'friday' });
  check('Windows listener', 'FRIDAY persona listens for "Friday" too', /friday/.test(f.spawned[0].env.JARVIS_WAKE) && /jarvis/.test(f.spawned[0].env.JARVIS_WAKE));
  // Strengthening: FRIDAY persona should also include the romanised transliterations
  // (a Telugu/Kannada speaker using FRIDAY should still match "jaarvis" etc).
  check('Windows listener', 'FRIDAY persona also includes romanised transliterations (jaarvis)', /jaarvis/.test(f.spawned[0].env.JARVIS_WAKE), f.spawned[0].env.JARVIS_WAKE);
  n.stop();
}

// ---- Strengthening: extended tests for wake-word edge cases ----

{ // unknown sensitivity value is ignored, listener keeps default 0.6
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: () => {}, run: f.run });
  n.set(true, { sensitivity: 'gibberish' });
  check('Mic sensitivity', 'unknown sensitivity value is ignored (listener keeps default 0.6)', f.spawned[0].env.JARVIS_MINCONF === '0.6', f.spawned[0].env.JARVIS_MINCONF);
  n.stop();
}

{ // chunked JSON across many tiny pieces is reassembled
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  const pieces = '{"wake":"jaarvis","conf":0.9}'.split('');
  for (const c of pieces) f.spawned[0].p.stdout.emit('data', c);
  // No newline yet — should NOT fire until newline arrives
  check('Windows listener', 'no fire until newline arrives (chunked JSON)', events.length === 0);
  f.spawned[0].p.stdout.emit('data', '\n');
  check('Windows listener', 'fire after newline on chunked JSON', events.length === 1 && events[0].text === 'jaarvis');
  n.stop();
}

{ // romanised transliteration 'jaarvis' fires wake event (Telugu/Kannada speaker)
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  f.spawned[0].p.say({ wake: 'jaarvis', conf: 0.85 });
  check('Romanised wake', '"jaarvis" fires wake event (Telugu/Kannada speaker)', events.length === 1 && events[0].text === 'jaarvis');
  t += 3000;
  f.spawned[0].p.say({ wake: 'jarwis', conf: 0.85 });
  check('Romanised wake', '"jarwis" fires wake event', events.length === 2 && events[1].text === 'jarwis');
  n.stop();
}

{ // duplicate wake within 2 seconds is suppressed; later one fires
  const events = []; let t = 1000000;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.9 });
  check('Deduplication', 'first wake fires', events.length === 1);
  t += 500;
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.9 });
  check('Deduplication', 'second wake within 2s is suppressed', events.length === 1);
  t += 2500; // 3 seconds total since the first wake
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.9 });
  check('Deduplication', 'third wake after 2s fires', events.length === 2);
  n.stop();
}

// ---- Calibration feature: confidence samples → suggested preset ----
{ // With fewer than 3 samples, calibration returns "need more data"
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.7 });
  const cal = n.calibration();
  check('Calibration', 'with 1 sample: no suggestion yet', cal.suggestion === null && /need at least 3/.test(cal.reason));
  check('Calibration', 'sample count is 1', cal.samples === 1);
  n.stop();
}

{ // With 3 high-confidence samples (all > 0.6), suggest Normal
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  for (const c of [0.75, 0.80, 0.85]) { f.spawned[0].p.say({ wake: 'jarvis', conf: c }); t += 3000; }
  const cal = n.calibration();
  check('Calibration', '3 samples, p25 = 0.75 → suggest Normal', cal.suggestion === 'normal', cal);
  check('Calibration', 'median is reported', cal.median === 0.8);
  n.stop();
}

{ // With 3 mid-range samples (0.52–0.6), suggest High
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  for (const c of [0.55, 0.58, 0.62]) { f.spawned[0].p.say({ wake: 'jarvis', conf: c }); t += 3000; }
  const cal = n.calibration();
  check('Calibration', '3 samples, p25 = 0.55 → suggest High', cal.suggestion === 'high', cal);
  n.stop();
}

{ // With 3 low samples (0.45–0.52), suggest Max
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  for (const c of [0.46, 0.50, 0.55]) { f.spawned[0].p.say({ wake: 'jarvis', conf: c }); t += 3000; }
  const cal = n.calibration();
  check('Calibration', '3 samples, p25 = 0.46 → suggest Max', cal.suggestion === 'max', cal);
  n.stop();
}

{ // Calibration samples are capped at 20 (oldest dropped)
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  for (let i = 0; i < 25; i++) { f.spawned[0].p.say({ wake: 'jarvis', conf: 0.5 + (i % 10) / 100 }); t += 3000; }
  check('Calibration', 'after 25 wakes, sample count is capped at 20', n.calibration().samples === 20, n.calibration().samples);
  // oldest (0.50, 0.51, 0.52, 0.53, 0.54) should be dropped — so the lowest remaining is 0.55
  check('Calibration', 'oldest samples were dropped (FIFO)', n._confSamples()[0] === 0.55, n._confSamples().slice(0, 3));
  n.stop();
}

{ // Status response includes calibration data
  const events = []; let t = 1e6;
  const f = fakeRun();
  const n = W.createNativeWake({ isWin: true, broadcast: e => events.push(e), run: f.run, now: () => t });
  n.set(true);
  f.spawned[0].p.say({ ready: 'en-US' });
  f.spawned[0].p.say({ wake: 'jarvis', conf: 0.75 });
  const st = n.status();
  check('Status', 'status() includes calibration object', typeof st.calibration === 'object');
  check('Status', 'status.calibration.samples is 1', st.calibration.samples === 1);
  n.stop();
}

// The page's wake-word list (lang.js) and the collector: common mishearings still wake it, ordinary words don't.
global.settings = { persona: 'jarvis' };
eval(fs.readFileSync(path.join(ROOT, 'lang.js'), 'utf8') + ';global.Lang=Lang;');
const words = Lang.wakeWords('jarvis');
const heard = text => { const got = []; let t = 0; const u = Voice.createUtterance({ now: () => t, wakeWords: words, onCommit: x => got.push(x) }); u.update([{ text, isFinal: true }]); t += 2000; u.tick(); return got[0] || null; };
check('Mishearings', '"jar vis open notepad" (split by the recogniser) still wakes it', heard('jar vis open notepad') === 'open notepad', heard('jar vis open notepad'));
check('Mishearings', '"jervis set a timer" wakes it', heard('jervis set a timer') === 'set a timer');
check('Mishearings', '"service is down" does not wake it', heard('service is down') === null);
check('Mishearings', '"java programming" does not wake it', heard('java programming is fun') === null);
process.exit(done() ? 1 : 0);
