// The online-voice route (tts.js): input checks, rate clamping, the SSML that is sent, caching, and clean failures — against a fake WebSocket, nothing leaves this machine. Run: node tests/tts.test.js
'use strict';
const path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// a fake WebSocket: records what was sent, answers with one audio frame and "turn.end" (or fails, per `mode`)
let mode = 'ok';
const opened = [];
class FakeWS {
  constructor(url, opts) { this.url = url; this.opts = opts; this.sent = []; opened.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
  send(s) {
    this.sent.push(s);
    if (!String(s).includes('Path:ssml')) return;
    setTimeout(() => {
      if (mode === 'error') return this.onerror && this.onerror(new Error('x'));
      if (mode === 'silent') { this.onmessage({ data: 'Path:turn.end' }); return; }
      const head = Buffer.from('Path:audio\r\n'), frame = Buffer.alloc(2 + head.length + 3); frame.writeUInt16BE(head.length, 0); head.copy(frame, 2); Buffer.from([1, 2, 3]).copy(frame, 2 + head.length);
      this.onmessage({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.length) }); this.onmessage({ data: 'X-Timestamp:1\r\nPath:turn.end\r\n' });
    }, 0);
  }
  close() { this.closed = true; }
}
global.WebSocket = FakeWS;

let handler = null;
require(path.join(__dirname, '..', 'tts.js'))({ post: (p, fn) => { if (p === '/api/tts') handler = fn; } });
const call = async body => {
  const out = { status: 200, json: null, body: null, headers: {} };
  const res = { status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; }, set(h) { Object.assign(out.headers, h); return this; }, send(b) { out.body = b; return this; } };
  await handler({ body }, res); return out;
};
const ssml = ws => ws.sent.find(s => String(s).includes('Path:ssml')) || '';

(async () => {
  check('the route is registered', typeof handler === 'function');
  let r = await call({ lang: 'fr', text: 'hello' }); check('an unknown language is a 400 that names the choices', r.status === 400 && /te, kn or en/.test(r.json.error), r);
  r = await call({ lang: 'te', text: '   ' }); check('empty text is a 400', r.status === 400 && /text required/.test(r.json.error), r);
  check('bad requests never opened a connection', opened.length === 0);

  r = await call({ lang: 'te', gender: 'male', text: 'నమస్తే', rate: 1 });
  check('a good request returns the MP3 bytes, not cached by the browser', r.status === 200 && Buffer.isBuffer(r.body) && r.body.equals(Buffer.from([1, 2, 3])) && r.headers['Content-Type'] === 'audio/mpeg' && r.headers['Cache-Control'] === 'no-store', r);
  const ws = opened[0];
  check('it connects to the Microsoft read-aloud service over wss with the client token and a Sec-MS-GEC code', /^wss:\/\/speech\.platform\.bing\.com\//.test(ws.url) && /TrustedClientToken=/.test(ws.url) && /Sec-MS-GEC=[0-9A-F]{64}(&|$)/.test(ws.url), ws.url);
  check('the Telugu male voice is Mohan, at the normal rate (+0%)', /te-IN, MohanNeural/.test(ssml(ws)) && /rate='\+0%'/.test(ssml(ws)), ssml(ws));
  check('only the reply text goes out (inside the SSML), nothing else of the request', /నమస్తే/.test(ssml(ws)) && !/gender|"male"|"female"/.test(ssml(ws)), ssml(ws));
  check('the socket is closed when done', ws.closed === true);

  const n0 = opened.length;
  r = await call({ lang: 'te', gender: 'male', text: 'నమస్తే', rate: 1 });
  check('the same sentence again is answered from the cache (no new connection)', r.status === 200 && opened.length === n0);

  r = await call({ lang: 'kn', gender: 'female', text: 'a < b & "c"', rate: 3 });
  check('the Kannada female voice is Sapna; the rate is capped at +100%', /kn-IN, SapnaNeural/.test(ssml(opened[opened.length - 1])) && /rate='\+100%'/.test(ssml(opened[opened.length - 1])), ssml(opened[opened.length - 1]));
  check('XML characters in the text are escaped (nothing can break out of the SSML)', /a &lt; b &amp; &quot;c&quot;/.test(ssml(opened[opened.length - 1])) && !/a < b/.test(ssml(opened[opened.length - 1])));
  r = await call({ lang: 'en', gender: 'female', text: 'hello there', rate: 0.1 });
  check('FRIDAY (English female) is Neerja; a slow rate is floored at -50%', /en-IN, NeerjaNeural/.test(ssml(opened[opened.length - 1])) && /rate='-50%'/.test(ssml(opened[opened.length - 1])), ssml(opened[opened.length - 1]));
  r = await call({ lang: 'en', gender: 'anything-else', text: 'hello again' });
  check('an unknown gender falls back to the male voice (Ryan, en-GB)', /en-GB, RyanNeural/.test(ssml(opened[opened.length - 1])));
  r = await call({ lang: 'en', text: 'x '.repeat(2000) });
  check('very long text is cut to 1,500 characters before it is sent', (ssml(opened[opened.length - 1]).match(/x/g) || []).length <= 1500 / 2 + 5, (ssml(opened[opened.length - 1]).match(/x/g) || []).length);

  mode = 'error'; r = await call({ lang: 'en', text: 'this will fail' });
  check('a service that cannot be reached is a 502 with a plain message (and is not cached)', r.status === 502 && /unreachable/i.test(r.json.error), r);
  mode = 'silent'; r = await call({ lang: 'en', text: 'no audio at all' });
  check('a reply with no audio is a 502, not an empty 200', r.status === 502 && /No audio|closed/i.test(r.json.error), r);
  mode = 'ok'; const n1 = opened.length; r = await call({ lang: 'en', text: 'this will fail' });
  check('after a failure the same text is tried again (failures are never cached)', r.status === 200 && opened.length === n1 + 1);

  // the cache is capped (60 entries)
  const n2 = opened.length; for (let i = 0; i < 65; i++) await call({ lang: 'en', text: 'cap test ' + i });
  const n3 = opened.length; r = await call({ lang: 'en', text: 'cap test 0' });
  check('the oldest cached sentences are dropped after 60 (so memory stays small)', opened.length === n3 + 1 && n3 - n2 === 65);
  r = await call({ lang: 'en', text: 'cap test 64' }); check('…while a recent one is still cached', opened.length === n3 + 1);

  delete global.WebSocket; r = await call({ lang: 'en', text: 'no websocket here' });
  check('on an older Node without WebSocket it says so (needs Node 22+) instead of crashing', r.status === 502 && /Node\.js 22/.test(r.json.error), r);

  console.log(`tts: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
