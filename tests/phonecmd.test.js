// Commands from the phone (scheduler.js): the unlock code, the 10-minute window, STRICT mode (a fresh code with every command), the ntfy access token — against a
// fake ntfy server that streams messages to the real JARVIS server. Run: node tests/phonecmd.test.js
'use strict';
const http = require('http'), path = require('path');
const { startServer, suite } = require('./lib/server');
const phoneauth = require(path.join(__dirname, '..', 'phoneauth.js'));
const { check, done } = suite('phonecmd');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const streams = [], posts = [], gets = [];
const fake = http.createServer((req, res) => {
  if (req.method === 'POST') { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch { /* ignore */ } posts.push({ headers: req.headers, body: j }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }); return; }
  if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
  gets.push({ url: req.url, headers: req.headers });
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.write('{"event":"open"}\n'); streams.push(res);
});
let n = 0;
const send = msg => { for (const s of streams) s.write(JSON.stringify({ event: 'message', id: 'm' + (++n), message: msg, tags: [] }) + '\n'); };
const replies = () => posts.filter(p => p.body.title === 'JARVIS').map(p => String(p.body.message));
// waits for a reply (to the message just sent) that matches
async function ask(msg, re, ms = 9000) {
  const before = replies().length; send(msg);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = replies().slice(before).find(x => re.test(x)); if (r) return r; await sleep(100); }
  return null;
}
const silence = async (msg, ms = 2500) => { const before = replies().length; send(msg); await sleep(ms); return replies().slice(before); };

(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const S = await startServer({ env: { NTFY_URL: 'http://127.0.0.1:' + fake.address().port, NTFY_TOKEN: 'tok-secret-123' } });
  try {
    const setup = await S.post('/api/phone/auth/setup', {});
    const secret = setup.json.secret;
    await S.post('/api/state', { set: { 'jarvis.settings': { phonePush: true, phoneTopic: 'jarvis-test-topic-1', wakeWord: 'jarvis' } } });
    for (let i = 0; i < 160 && !streams.length; i++) await sleep(100);       // the listener looks for a topic every few seconds
    check('Setup', 'JARVIS opens the phone stream on the fake ntfy server', streams.length >= 1, gets.length);
    check('Token', 'the stream request carries the access token as a Bearer header (NTFY_TOKEN) — and the topic is in the path', gets.length && gets[0].headers.authorization === 'Bearer tok-secret-123' && /jarvis-test-topic-1\/json/.test(gets[0].url), gets[0]);
    // Four different 30-second steps, fixed now: each code can be used once, and the server accepts about two steps either way, so the run (well under a minute)
    // stays inside the window whichever side of a step boundary it starts.
    const base = Date.now(), STEP = { unlock: 0, strict1: -1, strict2: 1, final: 2 };
    const code = k => phoneauth.totpAt(secret, base + STEP[k] * 30000);

    /* ---------- the unlock window (the default) ---------- */
    let r = await ask('open notepad', /Locked/);
    check('Window', 'a command with no unlock is refused and nothing is run', !!r && /find "JARVIS"|authenticator/i.test(r), r);
    check('Token', 'JARVIS\'s replies are sent with the token too', posts.length >= 1 && posts.every(p => p.headers.authorization === 'Bearer tok-secret-123'), posts.map(p => p.headers.authorization));
    r = await ask('unlock ' + code('unlock'), /Unlocked/);
    check('Window', 'the right code unlocks — and says the real length of the window (10 minutes, not 15)', !!r && /Unlocked for 10 minutes/.test(r), r);
    r = await ask('open spotify', /isn't open on your laptop|spotify/i);
    check('Window', 'a command after the unlock is accepted (no tab is open, so JARVIS says it can\'t act, instead of "Locked")', !!r && /isn't open on your laptop/.test(r) && !/Locked/.test(r), r);
    r = await ask('unlock ' + code('unlock'), /didn.t match/);
    check('Replay', 'the same code a second time is refused (a code seen on the public topic cannot be replayed)', !!r, r);
    const st = (await S.get('/api/phone/auth')).json;
    check('Status', 'the page can read the mode and the window length', st.configured === true && st.strict === false && st.unlockMin === 10 && st.token === true && st.unlockedUntil > Date.now(), st);
    r = await ask('lock', /^🔒 Locked\.$/);
    check('Window', '"lock" locks it again', !!r, r);

    /* ---------- strict mode ---------- */
    await S.post('/api/state', { set: { 'jarvis.settings': { phonePush: true, phoneTopic: 'jarvis-test-topic-1', wakeWord: 'jarvis', phoneStrict: true } } });
    check('Status', 'strict mode shows in the status', (await S.get('/api/phone/auth')).json.strict === true);
    r = await ask('open calculator', /Strict mode is on/);
    check('Strict', 'a command without a code is refused, and the reply explains the format', !!r && /fresh 6-digit code/.test(r) && /482913 open chrome/.test(r), r);
    // (JARVIS sends an identical reply only once per 30 s, so repeats are checked by what did NOT happen)
    let q = await silence(code('final'));
    check('Strict', 'a bare code does not open a window in strict mode — nothing is run and the phone stays locked', !q.some(x => /isn't open on your laptop|Unlocked/.test(x)) && (await S.get('/api/phone/auth')).json.unlockedUntil === 0, q);
    r = await ask(code('strict1').slice(0, 3) + ' ' + code('strict1').slice(3) + ' open firefox', /isn't open on your laptop/);
    check('Strict', 'a fresh code followed by a command runs that one command (also as the app shows it, "482 913 …")', !!r && /open firefox/.test(r), r);
    q = await silence(code('strict1') + ' open edge');
    check('Strict', 'the same code cannot be used for a second command', !q.some(x => /isn't open on your laptop/.test(x)), q);
    r = await ask('code: ' + code('strict2') + ' - open vscode', /isn't open on your laptop/);
    check('Strict', 'the next code works again ("code: 482913 - …" is understood too)', !!r && /open vscode/.test(r), r);
    q = await silence('123456 open zoom');
    check('Strict', 'a wrong code runs nothing', !q.some(x => /isn't open on your laptop/.test(x)), q);
    const quiet = await silence('open teams with no code at all');
    check('Strict', 'and no unlock window was opened by any of that: the next plain command still runs nothing', !quiet.some(x => /isn't open on your laptop/.test(x)), quiet);
    const lim = await S.get('/api/phone/auth'); check('Strict', 'strict mode never shows the phone as "unlocked"', lim.json.unlockedUntil === 0, lim.json);

    /* ---------- back to the window ---------- */
    await S.post('/api/state', { set: { 'jarvis.settings': { phonePush: true, phoneTopic: 'jarvis-test-topic-1', wakeWord: 'jarvis', phoneStrict: false } } });
    await silence('unlock ' + code('final'), 1800);
    check('Window', 'switching strict mode off returns to the lock-and-unlock behaviour: a code alone unlocks again (the status shows it; the identical reply text was already sent a moment ago)', (await S.get('/api/phone/auth')).json.unlockedUntil > Date.now());
  } catch (e) {
    check('Harness', 'suite ran to the end', false, e.stack);
  } finally {
    for (const s of streams) { try { s.end(); } catch { /* closed */ } }
    await S.stop(); fake.close();
  }
  process.exit(done() ? 1 : 0);
})();
