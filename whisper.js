'use strict';
/* Offline speech-to-text for lecture mode, using whisper.cpp on this laptop (the audio never leaves the computer, unlike the browser's recogniser).
     GET  /api/whisper/status       — is it installed (the program and a model), where, which model.
     POST /api/whisper/transcribe   — body: a 16 kHz, 16-bit, mono WAV (content-type audio/wav, up to ~25 MB / 13 minutes) → { text, seconds, ms }.
   Nothing is downloaded by JARVIS itself: install-whisper.ps1 (run by you, see the README) puts whisper-cli and one model in the .whisper folder next to
   the program (or the folder in JARVIS_WHISPER_DIR). Quiet audio is not sent to Whisper at all, because it invents words for silence.
   createWhisper() takes the folders and the process runner as parameters, so it is tested with a fake program. */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const WavUtil = require('./wavutil');

const BIN_NAMES = ['whisper-cli.exe', 'whisper-cli', 'main.exe', 'main'];
const MODEL_ORDER = ['ggml-small.en.bin', 'ggml-base.en.bin', 'ggml-tiny.en.bin', 'ggml-small.bin', 'ggml-base.bin', 'ggml-tiny.bin'];
const MAX_BYTES = 25 * 1048576, SILENCE_RMS = 0.004, TIMEOUT_MS = 240000;
// what Whisper prints when it "hears" nothing useful
const NOISE = /^\s*[\[(]\s*(?:blank[_ ]audio|silence|music|applause|laughter|noise|inaudible|no speech|sound)\s*[\])]\s*$/i;

const realRun = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 8 * 1048576 }, (err, out, serr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(serr || (err && err.message) || ''), timedOut: !!(err && err.killed) })));

function createWhisper({ dirs = [], run = realRun, tmp = os.tmpdir(), threads = Math.max(2, Math.min(6, (os.cpus() || []).length - 1)) } = {}) {
  let queue = Promise.resolve();
  function find(dir, names) {
    for (const base of [dir, path.join(dir, 'Release'), path.join(dir, 'bin'), path.join(dir, 'build', 'bin', 'Release')]) { for (const n of names) { const p = path.join(base, n); try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } } }
    return null;
  }
  function locate() {
    for (const d of dirs.filter(Boolean)) {
      const bin = find(d, BIN_NAMES);
      let model = null, best = 99;                                                    // the best model in this folder or its models folder
      for (const base of [d, path.join(d, 'models')]) for (const m of MODEL_ORDER) { const p = path.join(base, m); try { if (fs.statSync(p).isFile() && MODEL_ORDER.indexOf(m) < best) { best = MODEL_ORDER.indexOf(m); model = p; } } catch { /* next */ } }
      if (bin || model) return { dir: d, bin, model };
    }
    return { dir: dirs.filter(Boolean)[0] || null, bin: null, model: null };
  }
  function status() { const l = locate(); return { installed: !!(l.bin && l.model), hasProgram: !!l.bin, hasModel: !!l.model, dir: l.dir, model: l.model ? path.basename(l.model).replace(/^ggml-|\.bin$/g, '') : null }; }
  async function transcribeOne(buf, { lang = 'en' } = {}) {
    const l = locate();
    if (!l.bin || !l.model) return { error: 'Offline speech is not installed' + (l.bin ? ' (the program is there but no model)' : l.model ? ' (a model is there but not the program)' : '') + '. Run install-whisper.ps1 — see the README.', notInstalled: true };
    const w = WavUtil.parseWav(buf); if (!w.ok) return { error: w.error, badAudio: true };
    if (w.seconds < 0.4) return { text: '', seconds: w.seconds, silent: true, ms: 0 };
    const loud = WavUtil.rms(buf.subarray(w.dataOffset, w.dataOffset + w.dataLength), true);
    if (loud < SILENCE_RMS) return { text: '', seconds: w.seconds, silent: true, ms: 0 };
    const wav = path.join(tmp, 'jarvis_stt_' + process.pid + '_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '.wav'), t0 = Date.now();
    try {
      await fsp.writeFile(wav, buf);
      const language = /^[a-z]{2}$/.test(String(lang)) ? lang : 'en';
      const r = await run(l.bin, ['-m', l.model, '-f', wav, '-l', language, '-nt', '-np', '-t', String(threads)]);
      if (r.timedOut) return { error: 'The speech reader took too long (over ' + Math.round(TIMEOUT_MS / 60000) + ' minutes).' };
      if (r.code !== 0) return { error: 'The speech reader failed: ' + String(r.err || r.out).trim().split('\n').pop().slice(0, 140) };
      const text = r.out.split(/\r?\n/).map(s => s.trim()).filter(s => s && !NOISE.test(s)).join(' ').replace(/\s{2,}/g, ' ').trim();
      return { text, seconds: Math.round(w.seconds * 10) / 10, ms: Date.now() - t0 };
    } catch (e) { return { error: 'Could not read the audio: ' + String((e && e.message) || e).slice(0, 100) }; }
    finally { fsp.unlink(wav).catch(() => {}); }
  }
  // one at a time: the laptop's CPU is shared with the lecture itself
  const transcribe = (buf, o) => { const p = queue.then(() => transcribeOne(buf, o), () => transcribeOne(buf, o)); queue = p.catch(() => {}); return p; };
  return { status, locate, transcribe };
}

module.exports = function setupWhisper(app, { SANDBOX }) {
  const express = require('express');
  const w = createWhisper({ dirs: process.env.JARVIS_WHISPER_DIR ? [process.env.JARVIS_WHISPER_DIR] : [path.join(__dirname, '.whisper'), path.join(SANDBOX, '.whisper')] });      // the env folder is for tests / a custom place
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  app.get('/api/whisper/status', (req, res) => { if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Offline speech can only be used from JARVIS on the laptop.' }); res.json({ success: true, ...w.status() }); });
  app.post('/api/whisper/transcribe', express.raw({ type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'], limit: MAX_BYTES }), async (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Offline speech can only be used from JARVIS on the laptop.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) return res.status(400).json({ error: 'Send the audio as a WAV file (content-type audio/wav).' });
    const r = await w.transcribe(buf, { lang: String(req.query.lang || 'en') });
    if (r.error) return res.status(r.notInstalled ? 501 : r.badAudio ? 400 : 500).json({ error: r.error, notInstalled: !!r.notInstalled });
    res.json({ success: true, ...r });
  });
  return w;
};
Object.assign(module.exports, { createWhisper, NOISE, BIN_NAMES, MODEL_ORDER, SILENCE_RMS });
