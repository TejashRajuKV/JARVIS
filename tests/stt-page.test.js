// Offline speech recorder (stt-page.js) with a fake microphone and audio context: pieces are cut at pauses, sent in order as 16 kHz WAV, the last piece goes
// out on stop, errors are reported once, and everything is released. Run: node tests/stt-page.test.js
'use strict';
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);
global.WavUtil = require(root('wavutil.js'));
global.API = 'http://x/api'; global.getJSON = async ep => (ep === '/whisper/status' ? { installed: true } : { error: 'no' });
eval(fs.readFileSync(root('stt-page.js'), 'utf8') + ';global.Stt = Stt;');

const RATE = 48000;
const mkCtx = () => { const c = { sampleRate: RATE, closed: false, nodes: [], destination: {} };
  c.createMediaStreamSource = () => { const n = { connect(x) { n.to = x; }, disconnect() { n.to = null; } }; c.nodes.push(n); return n; };
  c.createScriptProcessor = () => { const n = { connect(x) { n.to = x; }, disconnect() { n.to = null; }, onaudioprocess: null }; c.proc = n; return n; };
  c.createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  c.close = () => { c.closed = true; }; return c; };
const mkStream = () => { const s = { stopped: 0, getTracks: () => [{ stop() { s.stopped++; } }] }; return s; };
const feed = (ctx, seconds, fn) => { if (!ctx.proc.onaudioprocess) return; const frames = Math.round(RATE * seconds / 4096); for (let i = 0; i < frames; i++) { const buf = new Float32Array(4096); for (let j = 0; j < 4096; j++) buf[j] = fn((i * 4096 + j) / RATE); ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => buf } }); } };
const tone = t => 0.4 * Math.sin(2 * Math.PI * 220 * t);

(async () => {
  check('ready: asks the server whether Whisper is installed', await Stt.ready() === true);
  const sent = [], texts = [], errors = []; let delay = 0, failWith = null;
  const ctx = mkCtx(), stream = mkStream();
  const h = await Stt.start({ chunkSec: 6, lang: 'en', getStream: async () => stream, ctxFactory: () => ctx, send: async (wav, lang) => { sent.push({ wav, lang }); if (delay) await new Promise(r => setTimeout(r, delay)); return failWith || { text: 'piece ' + sent.length }; }, onText: t => texts.push(t), onError: (m, ni) => errors.push([m, ni]) });
  check('start: the microphone is wired to a muted processor (so the lecture is not played back)', ctx.nodes[0].to === ctx.proc && ctx.proc.to !== ctx.destination);
  feed(ctx, 4, tone); check('no piece is sent before chunkSec of audio has gathered', sent.length === 0);
  feed(ctx, 3.0, t => (t > 0.5 && t < 0.9 ? 0 : tone(t)));                         // total 7 s ≥ 6 s: the cut happens, with a pause inside the look-back window
  await new Promise(r => setTimeout(r, 20));
  check('a piece is sent once chunkSec has passed: 16 kHz mono WAV, language passed', sent.length === 1 && WavUtil.parseWav(sent[0].wav).ok && WavUtil.parseWav(sent[0].wav).sampleRate === 16000 && sent[0].lang === 'en', sent.length);
  const secs1 = WavUtil.parseWav(sent[0].wav).seconds;
  check('the piece is cut before the end (inside the look-back window), the rest waits', secs1 > 1.8 && secs1 < 7, secs1);
  check('text that comes back is delivered', texts[0] === 'piece 1', texts);
  delay = 30; feed(ctx, 7, tone); feed(ctx, 7, tone);                                // two more pieces while the first reply is slow: they queue, in order
  await new Promise(r => setTimeout(r, 200));
  check('several pieces were sent, and they were answered in the order they were sent (one at a time)', sent.length >= 3 && texts.length === sent.length && texts.every((x, i) => x === 'piece ' + (i + 1)), [sent.length, texts]);
  const before = sent.length;
  feed(ctx, 2, tone);
  const stopP = h.stop(); await stopP;
  check('stop: sends what is left, waits for its text, then releases the microphone and the audio context', sent.length > before && texts.length === sent.length && texts[texts.length - 1] === 'piece ' + sent.length && stream.stopped === 1 && ctx.closed === true && ctx.proc.onaudioprocess === null, [before, sent.length, texts.length, stream.stopped, ctx.closed]);
  const afterStop = sent.length; feed(ctx, 20, tone); await new Promise(r => setTimeout(r, 20)); check('after stop nothing more is recorded or sent', sent.length === afterStop);
  await h.stop(); check('stop twice is harmless', sent.length === afterStop && stream.stopped === 1);

  // errors: reported once after 3 failures in a row; a success resets the count (outcomes are fixed per piece: fail, fail, ok, fail, fail, fail, fail, ok)
  const e = [], c2 = mkCtx(), s2 = mkStream(); let n2 = 0; const outcomes = ['fail', 'fail', 'ok', 'fail', 'fail', 'fail', 'fail', 'ok'];
  const h2 = await Stt.start({ chunkSec: 3, getStream: async () => s2, ctxFactory: () => c2, send: async () => { const o = outcomes[n2++] || 'ok'; return o === 'fail' ? { error: 'boom' } : { text: 'ok' }; }, onText: () => {}, onError: (m, ni) => e.push([m, ni, n2]) });
  for (let i = 0; i < 40; i++) feed(c2, 4, tone);
  await new Promise(r => setTimeout(r, 60));
  check('errors: reported once, on the third failure IN A ROW (the 6th piece — the two before a success do not count), with the message', n2 >= 8 && e.length === 1 && e[0][0] === 'boom' && e[0][1] === false && e[0][2] === 6, [n2, e]);
  h2.abort(); check('abort: releases everything without waiting', s2.stopped === 1 && c2.closed);
  const e3 = [], c3 = mkCtx(), h3 = await Stt.start({ chunkSec: 3, getStream: async () => mkStream(), ctxFactory: () => c3, send: async () => ({ error: 'Offline speech is not installed', notInstalled: true }), onText: () => {}, onError: (m, ni) => e3.push([m, ni]) });
  feed(c3, 4, tone); await new Promise(r => setTimeout(r, 30)); check('errors: "not installed" is reported at once', e3.length === 1 && e3[0][1] === true); h3.abort();
  const c4 = mkCtx(), h4 = await Stt.start({ chunkSec: 3, getStream: async () => mkStream(), ctxFactory: () => c4, send: async () => { throw new Error('network down'); }, onText: () => {}, onError: () => {} });
  feed(c4, 4, tone); await new Promise(r => setTimeout(r, 30)); check('a sender that throws does not break the recorder', (await h4.stop(2000)) === undefined);
  const hs = await Stt.start({ chunkSec: 3, getStream: async () => mkStream(), ctxFactory: mkCtx, send: async () => new Promise(() => {}), onText: () => {} }); const t0 = Date.now(); await hs.stop(60); check('stop: never waits longer than waitMs for a server that does not answer', Date.now() - t0 < 1000);
  let threw = false; try { await Stt.start({ getStream: async () => { throw new Error('Permission denied'); }, ctxFactory: mkCtx }); } catch (er) { threw = /Permission denied/.test(er.message); } check('start: a microphone that cannot be opened throws so the caller can say so', threw);

  console.log(`stt-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0; process.exit();
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
