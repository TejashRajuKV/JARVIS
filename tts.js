'use strict';
/* Telugu / Kannada speech, and FRIDAY's English voice: Microsoft's online neural voices (the ones Edge's
   "Read aloud" uses), so replies are spoken in any browser. Only the reply text is sent; audio comes back as MP3.
   FRIDAY uses Neerja (en-IN): in testing, Emily (en-IE) took 5–15 s per reply and often failed. */
const crypto = require('crypto');

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_VER = '143.0.3650.75';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const VOICES = {
  te: { male: 'te-IN, MohanNeural', female: 'te-IN, ShrutiNeural' },
  kn: { male: 'kn-IN, GaganNeural', female: 'kn-IN, SapnaNeural' },
  en: { male: 'en-GB, RyanNeural', female: 'en-IN, NeerjaNeural' },
};
let skewSec = 0;

// Sec-MS-GEC: SHA-256 of (Windows file time rounded to 5 minutes) + token.
function gec() {
  let ticks = Math.floor(Date.now() / 1000 + skewSec) + 11644473600;
  ticks -= ticks % 300;
  return crypto.createHash('sha256').update(`${BigInt(ticks) * 10000000n}${TOKEN}`, 'ascii').digest('hex').toUpperCase();
}
const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function synthesize(text, voice, rate) {
  return new Promise((resolve, reject) => {
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-${EDGE_VER}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`;
    const ws = new WebSocket(url, { headers: {
      Pragma: 'no-cache', 'Cache-Control': 'no-cache', Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      Cookie: 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';', 'User-Agent': UA,
    } });
    ws.binaryType = 'arraybuffer';
    const chunks = [];
    const ts = new Date().toString();
    let done = false;
    const finish = (err, buf) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} err ? reject(err) : resolve(buf); };
    const timer = setTimeout(() => finish(new Error('Voice service timed out')), 20000);
    ws.onopen = () => {
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='Microsoft Server Speech Text to Speech Voice (${voice})'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`);
    };
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') { if (ev.data.includes('Path:turn.end')) finish(null, Buffer.concat(chunks)); return; }
      const buf = Buffer.from(ev.data);
      const hl = buf.readUInt16BE(0);
      if (buf.subarray(2, 2 + hl).toString().includes('Path:audio')) chunks.push(buf.subarray(2 + hl));
    };
    ws.onerror = () => finish(new Error('Voice service unreachable (are you online?)'));
    ws.onclose = () => finish(chunks.length ? null : new Error('Voice service closed the connection'), Buffer.concat(chunks));
  });
}

module.exports = function setupTTS(app) {
  const cache = new Map();
  app.post('/api/tts', async (req, res) => {
    const lang = String(req.body.lang || '');
    const gender = req.body.gender === 'female' ? 'female' : 'male';
    if (!VOICES[lang]) return res.status(400).json({ error: 'lang must be te, kn or en' });
    const text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = Math.max(-50, Math.min(100, Math.round(((parseFloat(req.body.rate) || 1) - 1) * 100)));
    const rate = (r >= 0 ? '+' : '') + r + '%';
    const key = lang + gender + rate + text;
    try {
      let audio = cache.get(key);
      if (!audio) {
        audio = await synthesize(text, VOICES[lang][gender], rate);
        if (!audio.length) throw new Error('No audio returned');
        cache.set(key, audio);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
      }
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }).send(audio);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
};
