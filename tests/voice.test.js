// Voice collector (voice.js): whole sentences from pause-happy speech recognition. Fake clock, scripted results —
// no microphone. Run: node tests/voice.test.js
'use strict';
const Voice = require('../voice.js');
const { suite } = require('./lib/server');
const { check, done } = suite('voice');

// A scripted recogniser session: say(text, final) appends/updates results like Chrome's continuous mode.
function rig(opts = {}) {
  let t = 0; const log = [];
  const u = Voice.createUtterance(Object.assign({ now: () => t, silenceMs: 1600, maxMs: 30000, idleMs: 8000, promptMs: 700,
    onWake: hasCmd => log.push('wake:' + hasCmd), onPrompt: () => log.push('prompt'), onCommit: x => log.push('commit:' + x),
    onIdle: () => log.push('idle'), onDrop: x => log.push('drop:' + x) }, opts));
  let results = [];
  const api = {
    u, log,
    interim(text) { if (results.length && !results[results.length - 1].isFinal) results[results.length - 1] = { text, isFinal: false }; else results.push({ text, isFinal: false }); u.update(results.slice()); },
    final(text) { if (results.length && !results[results.length - 1].isFinal) results[results.length - 1] = { text, isFinal: true }; else results.push({ text, isFinal: true }); u.update(results.slice()); },
    wait(ms) { for (let s = 0; s < ms; s += 100) { t += 100; u.tick(); } },
    restart() { u.sessionEnded(); results = []; },
    commits: () => log.filter(x => x.startsWith('commit:')).map(x => x.slice(7)),
  };
  return api;
}
const WAKE = ['jarvis', 'జార్విస్', 'జార్వీస్', 'ಜಾರ್ವಿಸ್', 'ಜಾರ್ವೀಸ್'];

{ // the reported bug: a pause mid-sentence cut the command off
  const r = rig({ wakeWords: WAKE });
  r.interim('jarvis open'); r.final('jarvis open vs code'); r.wait(900);      // a short pause — must NOT send yet
  check('Wake word', 'a pause shorter than the threshold does not send', r.commits().length === 0, r.log);
  r.interim('and start'); r.final('and start a focus session'); r.wait(1700);
  check('Wake word', 'wake word + a sentence with a pause → one whole command', r.commits().join('|') === 'open vs code and start a focus session', r.log);
}
{ // "Jarvis" … then the command, itself with pauses
  const r = rig({ wakeWords: WAKE });
  r.final('jarvis');
  check('Wake word', 'wake word alone is detected (no command yet)', r.log[0] === 'wake:false');
  r.wait(800);
  check('Wake word', 'after a moment of silence JARVIS prompts ("Yes, sir?")', r.log.includes('prompt'));
  r.wait(2000);
  check('Wake word', 'waiting for the command does not time out at the first pause', r.commits().length === 0 && !r.log.includes('idle'));
  r.final('remind me to call mom'); r.wait(1200); r.final('at six pm'); r.wait(1700);
  check('Wake word', '"Jarvis" → pause → a command with a pause → one command', r.commits().join('|') === 'remind me to call mom at six pm', r.log);
}
{ // nothing said after the wake word
  const r = rig({ wakeWords: WAKE });
  r.final('jarvis'); r.wait(8100);
  check('Wake word', 'nothing said after the wake word → back to idle after 8 s', r.log.includes('idle') && !r.commits().length && r.u.mode === 'wait');
}
{ // chatter without the wake word is ignored; the next command in the same session isn't polluted by the last one
  const r = rig({ wakeWords: WAKE });
  r.final('so what did you eat today'); r.wait(3000);
  check('Wake word', 'speech without the wake word is ignored', !r.commits().length && !r.log.some(x => x.startsWith('wake')));
  r.final('jarvis open notepad'); r.wait(1700);
  r.final('jarvis mute'); r.wait(1700);
  check('Wake word', 'two commands in one session come out separately', r.commits().join('|') === 'open notepad|mute', r.commits());
}
{ // the recogniser restarts mid-sentence
  const r = rig({ wakeWords: WAKE });
  r.final('jarvis set a timer'); r.restart(); r.final('for ten minutes'); r.wait(1700);
  check('Wake word', 'a recogniser restart mid-sentence keeps the words', r.commits().join('|') === 'set a timer for ten minutes', r.commits());
}
{ // silence threshold is a setting
  const r = rig({ wakeWords: WAKE, silenceMs: 2500 });
  r.final('jarvis open chrome'); r.wait(1700);
  check('Settings', 'the "Long" pause setting waits longer before answering', r.commits().length === 0);
  r.wait(900);
  check('Settings', '…and then answers', r.commits().join('|') === 'open chrome');
}
{ // 30-second cap
  const r = rig({ wakeWords: WAKE });
  r.final('jarvis write a note'); for (let i = 0; i < 40; i++) { r.interim('word ' + i); r.wait(900); }
  check('Wake word', 'someone talking non-stop is cut off at 30 s', r.commits().length === 1, r.commits().length);
}
{ // JARVIS hearing itself
  const r = rig({ wakeWords: WAKE, isEcho: x => /yes sir/.test(x) });
  r.final('jarvis'); r.u.setMuted(true); r.final('yes sir'); r.u.setMuted(false);
  r.final('open notepad'); r.wait(1700);
  check('Echo', 'what the mic hears while JARVIS speaks is skipped', r.commits().join('|') === 'open notepad', r.log);
  const e = rig({ isEcho: x => /as you wish/.test(x) });
  e.final('as you wish sir'); e.wait(1700);
  check('Echo', 'an echo that slips through is dropped, not run', !e.commits().length && e.log.some(x => x.startsWith('drop:')));
}
{ // Telugu / Kannada wake words, including the recogniser's spelling variants
  const te = rig({ wakeWords: WAKE });
  te.final('జార్విస్ క్రోమ్ ఓపెన్ చెయ్యి'); te.wait(1700);
  check('Telugu/Kannada', 'Telugu wake word + command', te.commits().join('|') === 'క్రోమ్ ఓపెన్ చెయ్యి', te.commits());
  const tv = rig({ wakeWords: WAKE });
  tv.final('జర్విస్ వాల్యూమ్ పెంచు'); tv.wait(1700);
  check('Telugu/Kannada', 'a one-letter-off Telugu spelling still wakes it', tv.commits().join('|') === 'వాల్యూమ్ పెంచు', tv.commits());
  const kn = rig({ wakeWords: WAKE });
  kn.final('ಜಾರ್ವಿಸ್'); kn.wait(1000); kn.final('ಕ್ರೋಮ್ ತೆರೆ'); kn.wait(1700);
  check('Telugu/Kannada', 'Kannada wake word, pause, then the command', kn.commits().join('|') === 'ಕ್ರೋಮ್ ತೆರೆ', kn.commits());
  const nope = rig({ wakeWords: WAKE });
  nope.final('జావా నేర్చుకోవాలి'); nope.wait(1700);
  check('Telugu/Kannada', 'an unrelated word is not mistaken for the wake word', !nope.log.some(x => x.startsWith('wake')));
}
{ // tap-to-talk (no wake word)
  const r = rig();
  r.final('open vs code'); r.wait(900); r.final('in the dsa folder'); r.wait(1700);
  check('Tap to talk', 'a pause mid-sentence does not cut tap-to-talk off', r.commits().join('|') === 'open vs code in the dsa folder', r.commits());
  const f = rig();
  f.interim('what time is'); f.u.flush();
  check('Tap to talk', 'tapping while the words are still a guess waits briefly for the final', f.commits().length === 0, f.log);
  f.wait(800);
  check('Tap to talk', 'tapping the mic again sends what was said (after at most a short grace)', f.commits().join('|') === 'what time is', f.log);
  const g = rig();
  g.final('open chrome'); g.u.flush();
  check('Tap to talk', 'tapping with only final words sends right away', g.commits().join('|') === 'open chrome', g.log);
  const h = rig();
  h.interim('create a front'); h.u.flush(); h.wait(200); h.final('create a frontend for calculator'); h.wait(200);
  check('Tap to talk', 'tap, then the final arrives: the final words are sent ("frontend", not "front")', h.commits().join('|') === 'create a frontend for calculator', h.log);
}
{ // the presentation bug: an interim "front" was sent before the recogniser finished the word
  const r = rig();
  r.interim('create a front'); r.wait(1700);
  check('Interim vs final', 'silence with a pending interim does not send the guess yet', r.commits().length === 0, r.log);
  r.final('create a frontend'); r.wait(1700);
  check('Interim vs final', 'the final version is what gets sent', r.commits().join('|') === 'create a frontend', r.log);
  const s = rig();
  s.interim('open notepad'); s.wait(3000);
  check('Interim vs final', 'an interim that never becomes final is still sent after the extra grace', s.commits().join('|') === 'open notepad', s.log);
  const q = rig();
  q.wait(8100);
  check('Tap to talk', 'tapping and saying nothing ends quietly after 8 s', q.log.includes('idle') && !q.commits().length);
}
process.exit(done() ? 1 : 0);
