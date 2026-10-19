// Windows Hello approval tests: real WebAuthn-shaped assertions signed with a software key stand in for the
// authenticator, and every tampering case must be rejected. Run: node tests/hello.test.js
const path = require('path');
const crypto = require('crypto');
const H = require(path.join(__dirname, '..', 'hello.js'));

let fail = 0, total = 0;
const check = (name, ok) => { total++; if (!ok) { fail++; console.log('FAIL  ' + name); } };
const b64 = buf => Buffer.from(buf).toString('base64');
const ORIGIN = 'http://localhost:3001';
const origins = [ORIGIN, 'http://localhost:3000'];

function makeKey(kind) {
  const kp = kind === 'rsa' ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey: kp.privateKey, cred: { spki: b64(kp.publicKey.export({ format: 'der', type: 'spki' })), alg: kind === 'rsa' ? -257 : -7 } };
}
function authData({ rpId = 'localhost', flags = 0x05 } = {}) {
  return Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
}
// Builds what navigator.credentials.get() would return, signed by `privateKey`.
function assertion(privateKey, { challenge, origin = ORIGIN, type = 'webauthn.get', ad = authData(), kind = 'ec' }) {
  const cdj = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const data = Buffer.concat([ad, crypto.createHash('sha256').update(cdj).digest()]);
  const sig = kind === 'rsa' ? crypto.sign('sha256', data, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }) : crypto.sign('sha256', data, privateKey);
  return { authenticatorData: b64(ad), clientDataJSON: b64(cdj), signature: b64(sig) };
}
const verify = (cred, a, expectedChallenge) => H.verifyAssertion({ cred, expectedChallenge, origins, ...a });

// ---- signature verification ----
{
  const { privateKey, cred } = makeKey('ec');
  const ch = H.b64url(crypto.randomBytes(32));
  check('valid ES256 assertion accepted', verify(cred, assertion(privateKey, { challenge: ch }), ch) === null);
  check('wrong challenge rejected', /challenge/.test(verify(cred, assertion(privateKey, { challenge: ch }), H.b64url(crypto.randomBytes(32)))));
  check('wrong origin rejected', /origin/.test(verify(cred, assertion(privateKey, { challenge: ch, origin: 'http://evil.example' }), ch)));
  check('127.0.0.1 origin rejected (not the relying party)', /origin/.test(verify(cred, assertion(privateKey, { challenge: ch, origin: 'http://127.0.0.1:3001' }), ch)));
  check('create ceremony can\'t be replayed as approval', /type/.test(verify(cred, assertion(privateKey, { challenge: ch, type: 'webauthn.create' }), ch)));
  check('wrong relying party rejected', /relying party/.test(verify(cred, assertion(privateKey, { challenge: ch, ad: authData({ rpId: 'evil.example' }) }), ch)));
  check('user-verification flag required (a tap alone is not enough)', /not verified/.test(verify(cred, assertion(privateKey, { challenge: ch, ad: authData({ flags: 0x01 }) }), ch)));
  const a = assertion(privateKey, { challenge: ch });
  const bad = Buffer.from(a.signature, 'base64'); bad[bad.length - 1] ^= 0xff;
  check('tampered signature rejected', /signature/.test(verify(cred, { ...a, signature: b64(bad) }, ch)));
  const other = makeKey('ec');
  check('signature from a different key rejected', /signature/.test(verify(cred, assertion(other.privateKey, { challenge: ch }), ch)));
  check('empty challenge never matches', /challenge/.test(verify(cred, assertion(privateKey, { challenge: '' }), '')));
}
{
  const { privateKey, cred } = makeKey('rsa');
  const ch = H.b64url(crypto.randomBytes(32));
  check('valid RS256 assertion accepted', verify(cred, assertion(privateKey, { challenge: ch, kind: 'rsa' }), ch) === null);
}

// ---- guard coverage: every spelling Express would route must be caught ----
for (const [m, p, want] of [
  ['POST', '/api/tool/shutdownSystem', 'power'], ['POST', '/api/tool/SHUTDOWNSYSTEM', 'power'], ['POST', '/api/tool/shutdownSystem/', 'power'],
  ['POST', '/api/tool//shutdownSystem', 'power'], ['POST', '/api/tool/restartSystem', 'power'], ['POST', '/api/tool/sleepSystem', 'power'],
  ['POST', '/api/tool/deleteItem', 'files'], ['POST', '/api/tool/clearSandbox', 'files'], ['post', '/api/tool/DeleteItem', 'files'],
  ['DELETE', '/api/state', 'wipe'], ['DELETE', '/api/state/', 'wipe'],
  ['POST', '/api/backup/import', 'wipe'], ['POST', '/api/BACKUP/Import/', 'wipe'], ['POST', '/api/backup/restore', 'wipe'], ['POST', '/api/backup/export', null], ['POST', '/api/backup/preview', null],
  ['POST', '/api/state', null], ['GET', '/api/tool/shutdownSystem', null], ['POST', '/api/tool/cancelShutdown', null], ['POST', '/api/tool/lockSystem', null],
]) check(`guard ${m} ${p} → ${want}`, H.guardFor(m, p) === want);

console.log(`hello: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
