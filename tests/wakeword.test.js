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
  check('Windows listener', 'it listens only for the wake phrases', f.spawned[0].env.JARVIS_WAKE === 'jarvis,hey jarvis,ok jarvis,okay jarvis', f.spawned[0].env.JARVIS_WAKE);
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
