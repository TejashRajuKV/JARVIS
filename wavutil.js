'use strict';
/* Plain audio helpers for offline speech-to-text: turn what the microphone gives the page (floating-point samples at 44.1 or 48 kHz) into the 16 kHz,
   16-bit, mono WAV file that whisper.cpp reads, and read such a file's header back on the server. No library, works in the page and in Node.
     downsample(float32, fromRate, toRate)  → Float32Array   (averages the samples that fall in each output step, so high tones do not fold back as noise)
     encodeWav(float32, sampleRate)         → Uint8Array     (44-byte header + 16-bit little-endian samples)
     parseWav(bytes)                        → { ok, sampleRate, channels, bits, seconds, dataOffset, dataLength, error }
     rms(int16 view or float32)             → loudness 0..1  (to skip silence: Whisper invents words when it is given nothing to hear) */
const WavUtil = (() => {
  function downsample(input, fromRate, toRate) {
    if (!(fromRate > 0) || !(toRate > 0) || toRate > fromRate) throw new Error('cannot upsample');
    if (fromRate === toRate) return Float32Array.from(input);
    const ratio = fromRate / toRate, n = Math.floor(input.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0, c = 0; for (let j = a; j < b; j++) { sum += input[j]; c++; }
      out[i] = c ? sum / c : 0;
    }
    return out;
  }
  function encodeWav(samples, sampleRate) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
    return new Uint8Array(buf);
  }
  function parseWav(b) {
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    if (u.length < 44) return { ok: false, error: 'That is not a WAV file (too short).' };
    const v = new DataView(u.buffer, u.byteOffset, u.byteLength), tag = (o, s) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]) === s;
    if (!tag(0, 'RIFF') || !tag(8, 'WAVE')) return { ok: false, error: 'That is not a WAV file.' };
    let off = 12, fmt = null, data = null;
    while (off + 8 <= u.length) {                                                // walk the chunks: some writers add LIST chunks before "data"
      const id = String.fromCharCode(u[off], u[off + 1], u[off + 2], u[off + 3]), len = v.getUint32(off + 4, true), body = off + 8;
      if (id === 'fmt ' && len >= 16 && body + 16 <= u.length) fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
      else if (id === 'data') { data = { offset: body, length: Math.min(len, u.length - body) }; break; }
      off = body + len + (len & 1);
    }
    if (!fmt) return { ok: false, error: 'The WAV file has no format section.' };
    if (!data) return { ok: false, error: 'The WAV file has no audio.' };
    if (fmt.format !== 1) return { ok: false, error: 'Only plain (PCM) WAV audio is supported.' };
    if (fmt.channels !== 1 || fmt.bits !== 16 || fmt.sampleRate !== 16000) return { ok: false, error: 'The audio has to be 16 kHz, 16-bit, mono (this one is ' + fmt.sampleRate + ' Hz, ' + fmt.bits + '-bit, ' + fmt.channels + ' channel' + (fmt.channels === 1 ? '' : 's') + ').' };
    return { ok: true, sampleRate: fmt.sampleRate, channels: 1, bits: 16, seconds: data.length / 2 / fmt.sampleRate, dataOffset: data.offset, dataLength: data.length };
  }
  // loudness of 16-bit PCM bytes (little-endian) or a float array
  function rms(x, isPcm16Bytes) {
    let sum = 0, n = 0;
    if (isPcm16Bytes) { const v = new DataView(x.buffer, x.byteOffset, x.byteLength); n = Math.floor(x.byteLength / 2); for (let i = 0; i < n; i++) { const s = v.getInt16(i * 2, true) / 32768; sum += s * s; } }
    else { n = x.length; for (let i = 0; i < n; i++) sum += x[i] * x[i]; }
    return n ? Math.sqrt(sum / n) : 0;
  }
  // Where to cut a long recording so a word is not split: the quietest 100 ms stretch inside the last `lookBack` seconds (but not the last 0.3 s).
  // → a sample index (the audio before it is sent now, the rest waits for the next piece). If the whole piece is shorter than lookBack it cuts at the end.
  function cutPoint(samples, rate, lookBack = 5) {
    const n = samples.length;
    if (n < rate * lookBack) return n;
    const frame = Math.max(1, Math.round(rate * 0.1)), from = Math.max(0, n - Math.round(rate * lookBack)), to = n - Math.round(rate * 0.3);
    if (to - from < frame * 2) return n;
    let best = to, bestE = Infinity;
    for (let i = from; i + frame <= to; i += Math.max(1, Math.round(frame / 2))) {
      let e = 0; for (let j = i; j < i + frame; j++) e += samples[j] * samples[j];
      if (e < bestE) { bestE = e; best = i + (frame >> 1); }
    }
    return best;
  }
  return { downsample, encodeWav, parseWav, rms, cutPoint };
})();
if (typeof module !== 'undefined') module.exports = WavUtil;
