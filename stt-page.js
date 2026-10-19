'use strict';
/* Offline speech-to-text, page side: records the microphone, cuts it into pieces at pauses (about every 25 seconds), turns each piece into a 16 kHz mono WAV and
   sends it to this laptop's own server (/api/whisper/transcribe), which runs whisper.cpp. Nothing goes to the internet. Used by lecture mode when
   "Offline lecture transcription" is on and Whisper is installed. Pieces are sent one at a time, in order. Uses WavUtil (wavutil.js) and the page's API/getJSON.
     Stt.ready()                         → true when Whisper is installed
     Stt.start({ onText, onError, lang, chunkSec, getStream }) → a handle { stop() }; stop() sends what is left and resolves when the text has come back.
   The stream, the audio context and the processor are all closed on stop, whatever happens. `getStream` and `ctxFactory` are there for tests. */
const Stt = (() => {
  const status = async () => { try { return await getJSON('/whisper/status'); } catch (e) { return { error: String(e) }; } };
  async function ready() { const s = await status(); return !!(s && s.installed); }
  async function post(wav, lang) {
    const r = await fetch(API + '/whisper/transcribe?lang=' + encodeURIComponent(lang || 'en'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
    const j = await r.json().catch(() => ({ error: 'Bad answer (' + r.status + ')' }));
    if (!r.ok && !j.error) j.error = 'HTTP ' + r.status;
    return j;
  }
  async function start({ onText, onError, lang = 'en', chunkSec = 25, getStream, ctxFactory, send } = {}) {
    const sendWav = send || post;
    const stream = await (getStream ? getStream() : navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, channelCount: 1 } }));
    const ctx = ctxFactory ? ctxFactory() : new (window.AudioContext || window.webkitAudioContext)();
    const rate = ctx.sampleRate, src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain();
    mute.gain.value = 0;                                                      // the processor only runs while connected; muted so the lecture is not played back
    let parts = [], total = 0, stopped = false, chain = Promise.resolve(), errors = 0, failedOnce = false, pieces = 0;
    const merge = () => { const all = new Float32Array(total); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } parts = []; total = 0; return all; };
    function enqueue(samples) {
      if (!samples.length) return;
      const small = WavUtil.downsample(samples, rate, 16000), wav = WavUtil.encodeWav(small, 16000);
      chain = chain.then(async () => {
        const r = await sendWav(wav, lang).catch(e => ({ error: String((e && e.message) || e) }));
        pieces++;
        if (r.error) { errors++; if (r.notInstalled || errors === 3) { if (!failedOnce) { failedOnce = true; onError && onError(r.error, !!r.notInstalled); } } return; }
        errors = 0;
        if (r.text && r.text.trim()) onText && onText(r.text.trim(), r);
      });
    }
    proc.onaudioprocess = ev => {
      if (stopped) return;
      parts.push(Float32Array.from(ev.inputBuffer.getChannelData(0))); total += 4096;
      if (total >= rate * chunkSec) {
        const all = merge(), cut = WavUtil.cutPoint(all, rate, 5);
        enqueue(all.subarray(0, cut));
        if (cut < all.length) { parts.push(all.slice(cut)); total = all.length - cut; }
      }
    };
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    const cleanup = () => { try { proc.onaudioprocess = null; src.disconnect(); proc.disconnect(); mute.disconnect(); } catch (e) {} try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} try { ctx.close(); } catch (e) {} };
    return {
      get pieces() { return pieces; },
      // sends the rest and waits for every piece to be answered (up to `waitMs`), then releases the microphone
      async stop(waitMs = 120000) {
        if (stopped) return; stopped = true;
        try { enqueue(merge()); } catch (e) { /* nothing left */ }
        cleanup();
        await Promise.race([chain, new Promise(r => setTimeout(r, waitMs))]);
      },
      abort() { stopped = true; cleanup(); },
    };
  }
  return { ready, status, start };
})();
if (typeof module !== 'undefined') module.exports = Stt;
