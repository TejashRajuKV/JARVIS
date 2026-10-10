// Offline speech (wavutil.js + whisper.js): the audio conversion, the WAV checks, locating the program and model, silence handling, output cleaning, and
// one-at-a-time use — with a fake whisper program. Run: node tests/whisper.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const W = require(path.join(__dirname, '..', 'wavutil.js'));
const { createWhisper, NOISE } = require(path.join(__dirname, '..', 'whisper.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- wavutil ---------- */
const sine = (rate, secs, hz, amp = 0.5) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate));
const d48 = W.downsample(sine(48000, 1, 440), 48000, 16000);
check('downsample: 48 kHz → 16 kHz keeps the length ratio and the tone\'s loudness', d48.length === 16000 && Math.abs(W.rms(d48) - 0.5 / Math.SQRT2) < 0.02, [d48.length, W.rms(d48)]);
const d441 = W.downsample(sine(44100, 1, 440), 44100, 16000); check('downsample: 44.1 kHz works (non-integer ratio)', d441.length === 16000 && Math.abs(W.rms(d441) - 0.5 / Math.SQRT2) < 0.03);
check('downsample: equal rates copy; upsampling and bad rates are refused', W.downsample(Float32Array.of(1, 2), 16000, 16000).length === 2 && (() => { try { W.downsample(Float32Array.of(1), 8000, 16000); } catch (e) { return true; } return false; })() && (() => { try { W.downsample(Float32Array.of(1), 0, 16000); } catch (e) { return true; } return false; })());
check('downsample: a tone above the new Nyquist (9 kHz) is attenuated rather than folded back loudly', W.rms(W.downsample(sine(48000, 1, 9000, 0.8), 48000, 16000)) < 0.4);
const wav = W.encodeWav(d48, 16000);
check('encode: 44-byte header + 2 bytes per sample, RIFF/WAVE/fmt/data tags', wav.length === 44 + 32000 && String.fromCharCode(...wav.slice(0, 4)) === 'RIFF' && String.fromCharCode(...wav.slice(8, 12)) === 'WAVE' && String.fromCharCode(...wav.slice(36, 40)) === 'data');
const p = W.parseWav(wav); check('parse: reads back 16 kHz mono 16-bit, 1 second, data offset 44', p.ok && p.sampleRate === 16000 && p.channels === 1 && p.bits === 16 && Math.abs(p.seconds - 1) < 1e-6 && p.dataOffset === 44 && p.dataLength === 32000, p);
check('encode: samples outside -1..1 are clipped, not wrapped', (() => { const w = W.encodeWav(Float32Array.of(2, -2, 0), 16000), v = new DataView(w.buffer); return v.getInt16(44, true) === 32767 && v.getInt16(46, true) === -32768 && v.getInt16(48, true) === 0; })());
check('parse: wrong rate / stereo / 8-bit are refused with the real values in the message', /44100 Hz/.test(W.parseWav(W.encodeWav(new Float32Array(100), 44100)).error) && (() => { const b = Uint8Array.from(wav); new DataView(b.buffer).setUint16(22, 2, true); return /2 channels/.test(W.parseWav(b).error); })() && (() => { const b = Uint8Array.from(wav); new DataView(b.buffer).setUint16(34, 8, true); return /8-bit/.test(W.parseWav(b).error); })());
check('parse: not a WAV, too short, no data chunk, non-PCM', !W.parseWav(Buffer.from('hello world, this is not audio at all, not at all, really not')).ok && !W.parseWav(new Uint8Array(10)).ok && (() => { const b = Uint8Array.from(wav.slice(0, 44)); b.set(Buffer.from('junk'), 36); return /no audio/.test(W.parseWav(b).error); })() && (() => { const b = Uint8Array.from(wav); new DataView(b.buffer).setUint16(20, 3, true); return /PCM/.test(W.parseWav(b).error); })());
check('parse: a LIST chunk before "data" is skipped', (() => { const list = Buffer.concat([Buffer.from('LIST'), Buffer.from(Uint32Array.of(5).buffer), Buffer.from('abcde'), Buffer.from([0])]); const b = Buffer.concat([Buffer.from(wav.slice(0, 36)), list, Buffer.from(wav.slice(36))]); const r = W.parseWav(b); return r.ok && r.dataOffset === 36 + list.length + 8 && r.dataLength === 32000; })());
check('parse: a data chunk that claims more than the file holds is cut to what is there', (() => { const b = Uint8Array.from(wav.slice(0, 44 + 100)); const r = W.parseWav(b); return r.ok && r.dataLength === 100; })());
check('rms: silence 0, a full-scale square 1, works on PCM bytes too', W.rms(new Float32Array(100)) === 0 && Math.abs(W.rms(Float32Array.from({ length: 100 }, () => 1)) - 1) < 1e-9 && W.rms(W.encodeWav(Float32Array.from({ length: 100 }, () => 0.5), 16000).subarray(44), true) > 0.49 && W.rms(new Float32Array(0)) === 0);

// cutPoint: a pause inside the last seconds is chosen, not the middle of a word
{ const rate = 16000, x = sine(rate, 30, 200, 0.5); for (let i = Math.round(rate * 27.0); i < Math.round(rate * 27.3); i++) x[i] = 0;                 // a 0.3 s pause at 27.0–27.3 s
  const c = W.cutPoint(x, rate, 5); check('cutPoint: the cut lands inside the pause (27.0–27.3 s), not at the end', c >= rate * 27.0 && c <= rate * 27.3, c / rate);
  check('cutPoint: with no quiet part it still returns a valid index in the last window', (() => { const k = W.cutPoint(sine(rate, 10, 200, 0.5), rate, 5); return k >= rate * 5 && k <= rate * 9.7; })());
  check('cutPoint: a piece shorter than the look-back is cut at its end; empty is 0', W.cutPoint(sine(rate, 1, 200), rate, 5) === rate && W.cutPoint(new Float32Array(0), rate) === 0); }

/* ---------- whisper.js ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-whisper-'));
const dirA = path.join(tmp, 'a'), dirB = path.join(tmp, 'b'), dirEmpty = path.join(tmp, 'none');
for (const d of [dirA, dirB, dirEmpty, path.join(dirA, 'Release')]) fs.mkdirSync(d, { recursive: true });
const loudWav = W.encodeWav(sine(16000, 2, 300, 0.4), 16000), quietWav = W.encodeWav(sine(16000, 2, 300, 0.001), 16000), tinyWav = W.encodeWav(sine(16000, 0.2, 300, 0.4), 16000);
let runs = [], runOut = { code: 0, out: '', err: '' }, active = 0, maxActive = 0;
const run = async (file, args) => { runs.push([file, args]); active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 15)); active--; return typeof runOut === 'function' ? runOut(args) : runOut; };

(async () => {
  let w = createWhisper({ dirs: [dirEmpty], run, tmp });
  check('status: nothing installed', !w.status().installed && !w.status().hasProgram && !w.status().hasModel);
  let r = await w.transcribe(loudWav); check('transcribe: not installed → a clear error and the flag', r.notInstalled && /install-whisper\.ps1/.test(r.error) && runs.length === 0, r);
  fs.writeFileSync(path.join(dirA, 'Release', 'whisper-cli.exe'), 'x');
  w = createWhisper({ dirs: [dirEmpty, dirA], run, tmp }); check('status: the program is found in Release\\, but no model yet', w.status().hasProgram && !w.status().hasModel && !w.status().installed);
  r = await w.transcribe(loudWav); check('transcribe: program without a model says so', /no model/.test(r.error), r);
  fs.writeFileSync(path.join(dirA, 'ggml-tiny.en.bin'), 'x'); fs.mkdirSync(path.join(dirA, 'models')); fs.writeFileSync(path.join(dirA, 'models', 'ggml-base.en.bin'), 'x');
  w = createWhisper({ dirs: [dirA], run, tmp }); const st = w.status();
  check('status: installed; the better model wins (base over tiny), found in models\\ too', st.installed && st.model === 'base.en' && st.dir === dirA, st);
  check('locate: the first folder that has anything is used', createWhisper({ dirs: [dirEmpty, dirA, dirB], run, tmp }).locate().dir === dirA && createWhisper({ dirs: [undefined, '', dirA], run, tmp }).locate().dir === dirA);

  runOut = { code: 0, out: ' Hello class, today we study normalization.\n\n [BLANK_AUDIO]\n (silence) \n The second sentence.\n', err: '' };
  r = await w.transcribe(loudWav, { lang: 'en' });
  check('transcribe: text from the program, noise markers dropped, lines joined, seconds and time reported', r.text === 'Hello class, today we study normalization. The second sentence.' && r.seconds === 2 && r.ms >= 0 && !r.error, r);
  const [bin, args] = runs[runs.length - 1];
  check('transcribe: fixed arguments — the model, the file, language, no timestamps, no progress; the temp file is removed afterwards', bin.endsWith('whisper-cli.exe') && args.includes('-m') && args[args.indexOf('-m') + 1].endsWith('ggml-base.en.bin') && args.includes('-nt') && args.includes('-np') && args[args.indexOf('-l') + 1] === 'en' && /jarvis_stt_.*\.wav$/.test(args[args.indexOf('-f') + 1]) && !fs.existsSync(args[args.indexOf('-f') + 1]), args);
  runs = []; r = await w.transcribe(loudWav, { lang: '--evil' }); check('transcribe: an odd language value is replaced by "en" (never passed through)', runs[0][1][runs[0][1].indexOf('-l') + 1] === 'en');
  runs = []; r = await w.transcribe(loudWav, { lang: 'te' }); check('transcribe: a two-letter language is passed', runs[0][1][runs[0][1].indexOf('-l') + 1] === 'te');
  runs = []; r = await w.transcribe(quietWav); check('silence: quiet audio is not sent to Whisper at all', r.silent === true && r.text === '' && runs.length === 0, r);
  r = await w.transcribe(tinyWav); check('silence: under 0.4 seconds is skipped too', r.silent === true && runs.length === 0);
  r = await w.transcribe(Buffer.from('not audio, just a long enough string of text to pass the length check ok')); check('bad audio: not a WAV → a 400-style error, nothing run', r.badAudio && runs.length === 0, r);
  r = await w.transcribe(W.encodeWav(sine(44100, 1, 300), 44100)); check('bad audio: the wrong sample rate is said plainly', r.badAudio && /44100 Hz/.test(r.error));
  runOut = { code: 1, out: '', err: 'error: failed to load model\nfatal' }; r = await w.transcribe(loudWav); check('failure: a non-zero exit gives the last line of the error', /failed:.*fatal/.test(r.error), r);
  runOut = { code: 0, out: '', err: '', timedOut: true }; r = await w.transcribe(loudWav); check('failure: a timeout is reported', /too long/.test(r.error));
  runOut = { code: 0, out: '[Music]\n', err: '' }; r = await w.transcribe(loudWav); check('output: only a noise marker → empty text, no error', r.text === '' && !r.error);
  check('NOISE: matches the usual markers and not real speech', ['[BLANK_AUDIO]', '(silence)', '[Music]', ' [ Applause ] ', '(inaudible)'].every(s => NOISE.test(s)) && !['music is great', 'the silence of the lambs', '[a] real'].some(s => NOISE.test(s)));
  // one at a time
  runOut = { code: 0, out: 'ok', err: '' }; active = 0; maxActive = 0; await Promise.all([w.transcribe(loudWav), w.transcribe(loudWav), w.transcribe(loudWav)]); check('queue: three requests at once run one after another', maxActive === 1, maxActive);
  runOut = () => { throw new Error('boom'); }; r = await w.transcribe(loudWav).catch(e => ({ thrown: e.message })); runOut = { code: 0, out: 'fine', err: '' };
  r = await w.transcribe(loudWav); check('queue: after a request that blew up the next one still works', r.text === 'fine', r);
  const leftovers = fs.readdirSync(os.tmpdir()).filter(f => /^jarvis_stt_.*\.wav$/.test(f) && f.includes('_' + process.pid + '_')); check('cleanup: no temp audio files are left behind', leftovers.length === 0, leftovers);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`whisper: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
