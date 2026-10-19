'use strict';
/* Windows Hello approvals for explicit-tier actions (shutdown, restart, sleep, deleting files, erasing all data).
   The page proves a human approved with a WebAuthn platform authenticator (fingerprint / face / PIN); the SERVER
   verifies the signature against the key enrolled once, and only then accepts the guarded request — so a page bug
   or a stray request can't trigger these on its own. Off until the user turns it on in Settings.
   Uses only Node's crypto: the browser hands over the public key as SPKI (getPublicKey()), so no CBOR parsing. */
const crypto = require('crypto');

const RP_ID = 'localhost'; // WebAuthn can't use an IP address, so JARVIS must be opened as http://localhost:PORT
const CHALLENGE_MS = 120000;
const TOKEN_MS = 60000;
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Guarded endpoints → purpose. Express matches routes case-insensitively and ignores a trailing slash, so the
// lookup normalizes the same way — "/api/tool/SHUTDOWNSYSTEM/" must not slip past the guard.
const GUARDED = {
  'POST /api/tool/shutdownsystem': 'power', 'POST /api/tool/restartsystem': 'power', 'POST /api/tool/sleepsystem': 'power',
  'POST /api/tool/deleteitem': 'files', 'POST /api/tool/clearsandbox': 'files', 'POST /api/disk/applypermanent': 'files', 'POST /api/chatarchive/forget': 'files',   // permanent clean-ups (diskcare.js)
  'DELETE /api/state': 'wipe', 'POST /api/backup/import': 'wipe', 'POST /api/backup/restore': 'wipe',
  'POST /api/lock/enable': 'lock', 'POST /api/lock/disable': 'lock',   // the app lock (applock.js)
};
function guardFor(method, urlPath) {
  let raw = String(urlPath || '').split('?')[0];
  try { raw = decodeURIComponent(raw); } catch {}
  const p = raw.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return GUARDED[String(method || '').toUpperCase() + ' ' + p] || null;
}

// Checks the parts every ceremony shares. Returns an error string, or null when fine.
function checkClient(clientData, { type, origins }) {
  if (!clientData || clientData.type !== type) return 'wrong ceremony type';
  if (!origins.includes(clientData.origin)) return 'wrong origin';
  if (clientData.crossOrigin) return 'cross-origin request';
  return null;
}
function checkAuthData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) return 'bad authenticator data';
  if (!authData.subarray(0, 32).equals(crypto.createHash('sha256').update(RP_ID).digest())) return 'wrong relying party';
  const flags = authData[32];
  if (!(flags & 0x01)) return 'user not present';
  if (!(flags & 0x04)) return 'user not verified (Windows Hello must check fingerprint, face or PIN)';
  return null;
}
function verifySignature({ spki, alg, authData, clientDataJSON, signature }) {
  const key = crypto.createPublicKey({ key: fromB64(spki), format: 'der', type: 'spki' });
  const data = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  if (alg === -7) return crypto.verify('sha256', data, key, signature);
  if (alg === -257) return crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  return false;
}
// Full assertion check (pure — used by the route and by tests/hello.test.js).
function verifyAssertion({ cred, expectedChallenge, origins, authenticatorData, clientDataJSON, signature }) {
  let clientData;
  const cdj = fromB64(clientDataJSON);
  try { clientData = JSON.parse(cdj.toString('utf8')); } catch { return 'bad client data'; }
  const e1 = checkClient(clientData, { type: 'webauthn.get', origins }); if (e1) return e1;
  if (!expectedChallenge || clientData.challenge !== expectedChallenge) return 'wrong or expired challenge';
  const authData = fromB64(authenticatorData);
  const e2 = checkAuthData(authData); if (e2) return e2;
  let ok = false;
  try { ok = verifySignature({ spki: cred.spki, alg: cred.alg, authData, clientDataJSON: cdj, signature: fromB64(signature) }); } catch { ok = false; }
  return ok ? null : 'signature did not verify';
}

module.exports = function setupHello(app, { getConfig, saveConfig, ALLOWED_ORIGINS }) {
  // Deliberately localhost only: the page opened from the phone (Tailscale) can use every other command, but
  // shutdown/restart/sleep/delete approvals must happen at the laptop itself.
  const origins = [...ALLOWED_ORIGINS].filter(o => o.startsWith('http://localhost:'));
  const challenges = new Map(); // challenge → { purpose, exp }
  const tokens = new Map();     // approval token → { purpose, exp }
  const hello = () => getConfig().hello || null;
  const sweep = () => { const now = Date.now(); for (const m of [challenges, tokens]) for (const [k, v] of m) if (v.exp < now) m.delete(k); };
  const takeToken = (t, purpose) => { const rec = t && tokens.get(t); if (t) tokens.delete(t); return !!(rec && rec.purpose === purpose && rec.exp > Date.now()); };

  // The guard runs before every route; a no-op unless Windows Hello is enrolled and required.
  app.use((req, res, next) => {
    const purpose = guardFor(req.method, req.path);
    const h = hello();
    if (!purpose || !h || !h.required) return next();
    if (takeToken(req.headers['x-hello-token'], purpose)) return next();
    res.status(403).json({ error: 'Windows Hello approval required', needHello: true, purpose });
  });

  app.get('/api/hello/status', (req, res) => {
    const h = hello();
    res.json({ enrolled: !!h, required: !!(h && h.required), credId: h ? h.credId : null, rpId: RP_ID });
  });

  app.post('/api/hello/challenge', (req, res) => {
    sweep();
    const purpose = String((req.body && req.body.purpose) || '');
    if (!/^[a-z]{2,20}$/.test(purpose)) return res.status(400).json({ error: 'bad purpose' });
    const challenge = b64url(crypto.randomBytes(32));
    challenges.set(challenge, { purpose, exp: Date.now() + CHALLENGE_MS });
    const h = hello();
    res.json({ challenge, credId: h ? h.credId : null, rpId: RP_ID });
  });

  // Enrolling: trust on first use. Replacing an existing key needs a Windows Hello approval with the old one.
  app.post('/api/hello/enroll', (req, res) => {
    const b = req.body || {};
    const existing = hello();
    if (existing && !takeToken(req.headers['x-hello-token'], 'hello')) return res.status(403).json({ error: 'Approve with Windows Hello to replace the enrolled key', needHello: true, purpose: 'hello' });
    let clientData;
    try { clientData = JSON.parse(fromB64(b.clientDataJSON).toString('utf8')); } catch { return res.status(400).json({ error: 'bad client data' }); }
    const c = challenges.get(clientData && clientData.challenge); challenges.delete(clientData && clientData.challenge);
    if (!c || c.purpose !== 'enroll' || c.exp < Date.now()) return res.status(400).json({ error: 'wrong or expired challenge' });
    const err = checkClient(clientData, { type: 'webauthn.create', origins }) || checkAuthData(fromB64(b.authenticatorData));
    if (err) return res.status(400).json({ error: err });
    if (![-7, -257].includes(b.alg) || !/^[\w-]{16,1400}$/.test(String(b.credId || ''))) return res.status(400).json({ error: 'unsupported key' });
    try { crypto.createPublicKey({ key: fromB64(b.spki), format: 'der', type: 'spki' }); } catch { return res.status(400).json({ error: 'bad public key' }); }
    getConfig().hello = { credId: b.credId, spki: String(b.spki), alg: b.alg, required: true, enrolledAt: Date.now() };
    saveConfig();
    res.json({ success: true });
  });

  // Checks a signed Windows Hello assertion against the challenge it answers (single use, pass or fail).
  // → null when it is genuine, else { status, error }. Shared by /api/hello/verify and the app lock's unlock.
  function verifyChallenge(b, purpose) {
    const h = hello();
    if (!h) return { status: 400, error: 'Windows Hello is not set up' };
    let challenge;
    try { challenge = JSON.parse(fromB64(b.clientDataJSON).toString('utf8')).challenge; } catch { return { status: 400, error: 'bad client data' }; }
    const c = challenges.get(challenge); challenges.delete(challenge);
    if (!c || c.purpose !== purpose || c.exp < Date.now()) return { status: 400, error: 'wrong or expired challenge' };
    const err = verifyAssertion({ cred: h, expectedChallenge: challenge, origins, authenticatorData: b.authenticatorData, clientDataJSON: b.clientDataJSON, signature: b.signature });
    return err ? { status: 403, error: err } : null;
  }

  app.post('/api/hello/verify', (req, res) => {
    const b = req.body || {};
    const purpose = String(b.purpose || '');
    const bad = verifyChallenge(b, purpose);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, { purpose, exp: Date.now() + TOKEN_MS });
    res.json({ success: true, token });
  });

  app.post('/api/hello/disable', (req, res) => {
    if (!hello()) return res.json({ success: true });
    if (!takeToken(req.headers['x-hello-token'], 'hello')) return res.status(403).json({ error: 'Approve with Windows Hello to turn this off', needHello: true, purpose: 'hello' });
    delete getConfig().hello; saveConfig();
    res.json({ success: true });
  });
  return { verifyChallenge, isEnrolled: () => !!hello() };
};
module.exports.guardFor = guardFor;
module.exports.verifyAssertion = verifyAssertion;
module.exports.checkAuthData = checkAuthData;
module.exports.RP_ID = RP_ID;
module.exports.b64url = b64url;
