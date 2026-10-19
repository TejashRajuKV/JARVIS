// App lock (applock.js): with it on, JARVIS stays closed until Windows Hello is verified. A real isolated server, with a
// software key standing in for the Windows Hello authenticator (as in hello.test.js). Run: node tests/applock.test.js
'use strict';
const crypto = require('crypto');
const path = require('path');
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('applock');
const AppLock = require('../applock.js');

const b64 = buf => Buffer.from(buf).toString('base64');
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const authData = (flags = 0x05) => Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
function assertion(privateKey, { challenge, origin, type = 'webauthn.get' }) {
  const ad = authData(), cdj = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cdj).digest()]), privateKey);
  return { authenticatorData: b64(ad), clientDataJSON: b64(cdj), signature: b64(sig) };
}

/* ---------- 1. unit: the gate's rules, idle expiry and the no-lock-out guarantee (fake clock, no server) ---------- */
{
  const realNow = Date.now; let clock = realNow();
  Date.now = () => clock;
  const config = { hello: { credId: 'x' }, appLock: { enabled: true, idleMin: 5 } };
  const handlers = {}, fakeApp = { get: (p, h) => { handlers['GET ' + p] = h; }, post: (p, h) => { handlers['POST ' + p] = h; } };
  const lock = AppLock({ getConfig: () => config, saveConfig: () => {}, getHello: () => ({ verifyChallenge: () => null }), PORT: 1234, rootDir: __dirname });
  lock.routes(fakeApp);
  const res = () => { const r = { code: 200, headers: {}, body: null, cookies: [] };
    r.status = c => { r.code = c; return r; }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.json = b => { r.body = b; return r; };
    r.append = (k, v) => { r.cookies.push(v); return r; }; r.sendFile = f => { r.body = { file: f }; return r; }; return r; };
  const pass = (req) => { let called = false; const r = res(); lock.gate(Object.assign({ method: 'GET', headers: {} }, req), r, () => { called = true; }); return { called, r }; };

  check('Gate', 'lock on, no session: an API call is refused with 401 + locked:true', (() => { const x = pass({ path: '/api/tool/systemInfo' }); return !x.called && x.r.code === 401 && x.r.body.locked === true; })());
  for (const p of ['/API/STATE.JS', '/api//state.js', '/api/state.js/', '/Api/Tool/SystemInfo', '/api/%73tate.js', '/api'])
    check('Gate', 'no way round it by spelling the path differently: ' + p, (() => { const x = pass({ path: p }); return !x.called && x.r.code === 401; })());
  check('Gate', 'the app page (/) is replaced by the lock page', (() => { const x = pass({ path: '/' }); return !x.called && x.r.body && /lock\.html$/.test(x.r.body.file); })());
  check('Gate', 'index.html is replaced too', (() => { const x = pass({ path: '/index.html' }); return !x.called && /lock\.html$/.test(x.r.body.file); })());
  check('Gate', 'app code and images are not data (a script request goes through)', pass({ path: '/script.js' }).called);
  for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/lock/status'], ['GET', '/api/hello/status'], ['POST', '/api/hello/challenge'], ['POST', '/api/lock/unlock']])
    check('Gate', 'reachable while locked (needed to unlock): ' + m + ' ' + p, pass({ method: m, path: p }).called);
  check('Gate', 'POST /api/lock/ping is NOT open while locked', !pass({ method: 'POST', path: '/api/lock/ping' }).called);

  // unlock → cookie → works
  const u = res(); handlers['POST /api/lock/unlock']({ body: {}, headers: {} }, u);
  const cookie = (u.cookies[0] || '').split(';')[0];
  check('Session', 'a verified unlock sets an HttpOnly, SameSite=Strict cookie named for this port', u.body && u.body.success && /^jarvis_session_1234=[0-9a-f]{64}$/.test(cookie) && /HttpOnly; SameSite=Strict/.test(u.cookies[0]), u.cookies);
  check('Session', 'with that cookie the API is open', pass({ path: '/api/tool/systemInfo', headers: { cookie } }).called);
  check('Session', 'a made-up cookie is not accepted', !pass({ path: '/api/tool/systemInfo', headers: { cookie: 'jarvis_session_1234=' + 'a'.repeat(64) } }).called);
  check('Session', 'a cookie from another JARVIS port is not accepted', !pass({ path: '/api/tool/systemInfo', headers: { cookie: cookie.replace('1234', '9999') } }).called);

  // idle expiry and ping
  clock += 4 * 60000;
  check('Idle', 'still open after 4 minutes of a 5-minute auto-lock', pass({ path: '/api/x', headers: { cookie } }).called);
  handlers['POST /api/lock/ping']({ headers: { cookie } }, res());
  clock += 4 * 60000;
  check('Idle', 'a ping (real use) restarts the idle clock: open 4 minutes after it', pass({ path: '/api/x', headers: { cookie } }).called);
  clock += 6 * 60000;
  check('Idle', 'after 6 idle minutes the session has expired: locked again', !pass({ path: '/api/x', headers: { cookie } }).called);
  check('Idle', 'the status route reports locked for an expired session', (() => { const r = res(); handlers['GET /api/lock/status']({ headers: { cookie } }, r); return r.body.locked === true; })());

  // lock now clears every session; no Hello key = no lock (never a lock-out)
  const u2 = res(); handlers['POST /api/lock/unlock']({ body: {}, headers: {} }, u2); const c2 = u2.cookies[0].split(';')[0];
  handlers['POST /api/lock/lock']({ headers: { cookie: c2 } }, res());
  check('Lock now', '"lock now" ends every session', !pass({ path: '/api/x', headers: { cookie: c2 } }).called);
  delete config.hello;
  check('No lock-out', 'if the Windows Hello key is gone the lock stands down (the documented recovery)', pass({ path: '/api/tool/systemInfo' }).called);
  config.hello = { credId: 'x' }; config.appLock.enabled = false;
  check('Off', 'lock off: everything is open, no cookie needed', pass({ path: '/api/tool/systemInfo' }).called);
  Date.now = realNow;
}

/* ---------- 2. end to end on a real server ---------- */
(async () => {
  const S = await startServer();
  const raw = async (method, p, body, { cookie, headers = {} } = {}) => {
    const r = await fetch(S.base + p, { method, headers: Object.assign({ 'Content-Type': 'application/json', Origin: S.base, 'Sec-Fetch-Site': 'same-origin' }, cookie ? { Cookie: cookie } : {}, headers),
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch {}
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    return { status: r.status, text, json, cookie: sc.length ? sc[0].split(';')[0] : '', setCookie: sc[0] || '' };
  };
  try {
    check('Default', 'a fresh install has the lock off', (await raw('GET', '/api/lock/status')).json.enabled === false);
    check('Default', 'with it off, the API just works', (await raw('GET', '/api/tool/systemInfo')).status === 200);
    check('Enable', 'cannot turn the lock on before Windows Hello is set up (it would have nothing to unlock with)', (await raw('POST', '/api/lock/enable', { idleMin: 15 })).status === 400);

    // enroll a Windows Hello key (software stands in for the authenticator)
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const credId = b64url(crypto.randomBytes(32));
    const ch = (await raw('POST', '/api/hello/challenge', { purpose: 'enroll' })).json.challenge;
    const create = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: ch, origin: S.base, crossOrigin: false }));
    const en = await raw('POST', '/api/hello/enroll', { credId, spki: b64(kp.publicKey.export({ format: 'der', type: 'spki' })), alg: -7, clientDataJSON: b64(create), authenticatorData: b64(authData()) });
    check('Setup', 'Windows Hello key enrolled', en.status === 200 && en.json.success, en.text);

    const approve = async (purpose, cookie) => {   // → a single-use approval token, as Hello.approve() does in the page (which has its session cookie)
      const c = (await raw('POST', '/api/hello/challenge', { purpose }, { cookie })).json.challenge;
      const v = await raw('POST', '/api/hello/verify', Object.assign({ purpose }, assertion(kp.privateKey, { challenge: c, origin: S.base })), { cookie });
      return v.json.token;
    };
    check('Enable', 'turning the lock on without a fresh Windows Hello approval is refused', (await raw('POST', '/api/lock/enable', { idleMin: 15 })).status === 403);
    const on = await raw('POST', '/api/lock/enable', { idleMin: 15 }, { headers: { 'X-Hello-Token': await approve('lock') } });
    check('Enable', 'with the approval, the lock turns on (and the person who did it stays signed in)', on.status === 200 && on.json.enabled && /^jarvis_session_\d+=/.test(on.cookie), on.text);
    const mine = on.cookie;

    // locked: everything closed
    check('Locked', 'no cookie: an API call is refused (401, locked)', (await raw('GET', '/api/tool/systemInfo')).status === 401);
    check('Locked', 'no cookie: your chat and memory (state.js) are not served', (await raw('GET', '/api/state.js')).status === 401);
    for (const p of ['/API/STATE.JS', '/api//state.js', '/api/state.js/']) check('Locked', 'no way round it: ' + p, (await raw('GET', p)).status === 401);
    const lockPage = await raw('GET', '/');
    check('Locked', 'no cookie: the app page is replaced by the lock page', lockPage.status === 200 && /Unlock with Windows Hello/.test(lockPage.text) && !/id="chatInput"/.test(lockPage.text));
    check('Locked', 'the launcher health probe still answers', (await raw('GET', '/api/health')).status === 200);
    check('Locked', 'a Windows Hello approval cannot be requested without being unlocked first (verify is closed)', (await raw('POST', '/api/hello/verify', { purpose: 'power' })).status === 401);
    check('Locked', 'status says locked', (await raw('GET', '/api/lock/status')).json.locked === true);
    check('Locked', 'with the session cookie the app page is the real one', /id="chatInput"/.test((await raw('GET', '/', undefined, { cookie: mine })).text));
    check('Locked', 'with the session cookie the API works', (await raw('GET', '/api/tool/systemInfo', undefined, { cookie: mine })).status === 200);

    // unlock with Windows Hello
    const uc = (await raw('POST', '/api/hello/challenge', { purpose: 'unlock' })).json.challenge;
    const badSig = assertion(kp.privateKey, { challenge: uc, origin: S.base }); const sb = Buffer.from(badSig.signature, 'base64'); sb[sb.length - 1] ^= 0xff;
    const bad = await raw('POST', '/api/lock/unlock', Object.assign({}, badSig, { signature: b64(sb) }));
    check('Unlock', 'a forged signature does not unlock (and sets no cookie)', bad.status === 403 && !bad.cookie, bad.text);
    check('Unlock', 'the challenge is single use: replaying it fails', (await raw('POST', '/api/lock/unlock', assertion(kp.privateKey, { challenge: uc, origin: S.base }))).status === 400);
    const wrong = (await raw('POST', '/api/hello/challenge', { purpose: 'power' })).json.challenge;
    check('Unlock', 'a Windows Hello approval for something else (e.g. shutdown) cannot be used to unlock', (await raw('POST', '/api/lock/unlock', assertion(kp.privateKey, { challenge: wrong, origin: S.base }))).status === 400);
    const stranger = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sc = (await raw('POST', '/api/hello/challenge', { purpose: 'unlock' })).json.challenge;
    check('Unlock', 'a signature from a different key does not unlock', (await raw('POST', '/api/lock/unlock', assertion(stranger.privateKey, { challenge: sc, origin: S.base }))).status === 403);
    const gc = (await raw('POST', '/api/hello/challenge', { purpose: 'unlock' })).json.challenge;
    const good = await raw('POST', '/api/lock/unlock', assertion(kp.privateKey, { challenge: gc, origin: S.base }));
    check('Unlock', 'the real Windows Hello signature unlocks and sets a session cookie', good.status === 200 && good.json.unlocked && /HttpOnly/.test(good.setCookie) && /SameSite=Strict/.test(good.setCookie), good.text);
    check('Unlock', 'the new session works', (await raw('GET', '/api/tool/systemInfo', undefined, { cookie: good.cookie })).status === 200);

    // lock now / turn off
    check('Lock now', 'POST /api/lock/lock closes JARVIS for everyone', (await raw('POST', '/api/lock/lock', {}, { cookie: good.cookie })).json.success === true
      && (await raw('GET', '/api/tool/systemInfo', undefined, { cookie: good.cookie })).status === 401 && (await raw('GET', '/api/tool/systemInfo', undefined, { cookie: mine })).status === 401);
    const again = (await raw('POST', '/api/lock/unlock', assertion(kp.privateKey, { challenge: (await raw('POST', '/api/hello/challenge', { purpose: 'unlock' })).json.challenge, origin: S.base })));
    check('Disable', 'turning the lock off without a Windows Hello approval is refused', (await raw('POST', '/api/lock/disable', {}, { cookie: again.cookie })).status === 403);
    const off = await raw('POST', '/api/lock/disable', {}, { cookie: again.cookie, headers: { 'X-Hello-Token': await approve('lock', again.cookie) } });
    check('Disable', 'with the approval it turns off, and JARVIS opens with no cookie again', off.status === 200 && (await raw('GET', '/api/tool/systemInfo')).status === 200 && /id="chatInput"/.test((await raw('GET', '/')).text));
    check('Disable', 'status shows the lock off', (await raw('GET', '/api/lock/status')).json.enabled === false);
  } catch (e) { check('Harness', 'the end-to-end run finished without an error', false, e && e.stack || e); }
  finally { await S.stop(); done(); }
})();
