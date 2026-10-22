'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhoneHubAuth, DEFAULT_CAPABILITIES, PAIRING_CAPABILITIES, DEFAULT_MAX_ACTIVE_PAIRINGS, DEFAULT_MAX_USED_NONCES } = require('../phonehub-auth.js');

let now = 1_800_000_000_000;
const auth = createPhoneHubAuth({ now: () => now, pairingTtlMs: 300_000, sessionTtlMs: 86_400_000, maxAttempts: 3 });
let failures = 0, total = 0;
function check(name, condition, detail) {
  total++;
  if (!condition) { failures++; console.error('FAIL [' + name + ']' + (detail ? ' ' + JSON.stringify(detail) : '')); }
}
const nonce = n => 'nonce_test_value_' + n;
const req = (token, n) => ({ token, nonce: nonce(n) });

const p = auth.beginPairing();
check('pair code format', /^\d{6}$/.test(p.code));
check('pair id is unpredictable-looking', /^[a-f0-9]{24}$/.test(p.pairingId));
check('sensitive scopes are known but not granted by pairing', DEFAULT_CAPABILITIES.includes('sms.send') && PAIRING_CAPABILITIES.join(',') === 'status,notifications');
check('active pairing challenges are bounded by default', DEFAULT_MAX_ACTIVE_PAIRINGS === 5);
check('nonce replay cache has a conservative default bound', DEFAULT_MAX_USED_NONCES === 10_000);
const bounded = createPhoneHubAuth({ now: () => now, maxActivePairings: 2 });
const oldChallenge = bounded.beginPairing();
bounded.beginPairing();
bounded.beginPairing();
check('oldest pairing challenge is evicted when capacity is reached', bounded.completePairing({ pairingId: oldChallenge.pairingId, code: oldChallenge.code }).error === 'PAIRING_EXPIRED');
const wrongCode = p.code === '000000' ? '000001' : '000000';
const wrong = auth.completePairing({ pairingId: p.pairingId, code: wrongCode });
check('wrong pairing code rejected', !wrong.ok && wrong.error === 'PAIRING_CODE_INVALID');
const paired = auth.completePairing({
  pairingId: p.pairingId, code: p.code, deviceName: '  Tejash Android\u0000 ',
  capabilities: ['status', 'notifications', 'sms.send', 'contacts.read', 'clipboard.read']
});
check('valid pairing succeeds with baseline scopes only', paired.ok && paired.token && paired.device.capabilities.join(',') === 'status,notifications', paired);
check('device name is normalized', paired.device.name === 'Tejash Android', paired.device.name);
check('device list never exposes the bearer token', !JSON.stringify(auth.listDevices()).includes(paired.token));
check('reusing consumed pairing code fails', !auth.completePairing({ pairingId: p.pairingId, code: p.code }).ok);
check('baseline capability succeeds', auth.authorize(req(paired.token, '1'), 'status').ok);
const replay = auth.authorize(req(paired.token, '1'), 'status');
check('replayed nonce rejected', !replay.ok && replay.error === 'REPLAYED_NONCE', replay);
const denied = auth.authorize(req(paired.token, '2'), 'contacts.read');
check('ungranted sensitive capability denied', !denied.ok && denied.error === 'CAPABILITY_DENIED', denied);
check('nonce is mandatory', !auth.authenticate({ token: paired.token }).ok);
check('wrong token rejected', !auth.authenticate(req('not-a-token', '3')).ok);
check('capability grant updates privileges', auth.grant(paired.device.id, ['status', 'contacts.read']).ok &&
  auth.authorize(req(paired.token, '4'), 'contacts.read').ok);
check('unknown capabilities cannot be granted', auth.grant(paired.device.id, ['status', 'delete-everything']).ok &&
  auth.listDevices()[0].capabilities.join(',') === 'status');
check('grant rejects unknown device', !auth.grant('missing-device', ['status']).ok);
check('revoke invalidates device', auth.revoke(paired.device.id) &&
  auth.authenticate(req(paired.token, '5')).error === 'DEVICE_REVOKED');

const oneDevice = createPhoneHubAuth({ now: () => now, maxDevices: 1 });
const firstPairing = oneDevice.beginPairing();
const firstDevice = oneDevice.completePairing({ pairingId: firstPairing.pairingId, code: firstPairing.code });
const secondPairing = oneDevice.beginPairing();
check('device registry has a configurable hard cap', oneDevice.completePairing({
  pairingId: secondPairing.pairingId, code: secondPairing.code
}).error === 'DEVICE_CAPACITY');
check('device-capacity rejection does not consume the pairing challenge', oneDevice.completePairing({
  pairingId: secondPairing.pairingId, code: secondPairing.code
}).error === 'DEVICE_CAPACITY');
oneDevice.revoke(firstDevice.device.id);
check('revoking a device frees an active pairing slot', oneDevice.completePairing({
  pairingId: secondPairing.pairingId, code: secondPairing.code
}).ok);

const locked = auth.beginPairing();
const lockedWrong = locked.code === '000000' ? '000001' : '000000';
auth.completePairing({ pairingId: locked.pairingId, code: lockedWrong });
auth.completePairing({ pairingId: locked.pairingId, code: lockedWrong });
const third = auth.completePairing({ pairingId: locked.pairingId, code: lockedWrong });
check('pairing attempt limit locks challenge', !third.ok && third.error === 'PAIRING_LOCKED');
const expired = auth.beginPairing();
now += 300_001;
check('expired pairing cannot be completed', auth.completePairing({ pairingId: expired.pairingId, code: expired.code }).error === 'PAIRING_EXPIRED');

const session = auth.beginPairing();
const expPair = auth.completePairing({ pairingId: session.pairingId, code: session.code });
now += 86_400_001;
check('expired session cannot authenticate', auth.authenticate(req(expPair.token, '6')).error === 'SESSION_EXPIRED');
auth.sweep();

// A hostile client cannot grow the in-memory replay cache without limit during the nonce TTL.
const limited = createPhoneHubAuth({ now: () => now, maxUsedNonces: 1 });
const lp = limited.beginPairing();
const ld = limited.completePairing({ pairingId: lp.pairingId, code: lp.code });
check('first nonce accepted when replay cache has room', limited.authenticate(req(ld.token, 'limited_nonce_001')).ok);
check('new nonce rejected at replay-cache capacity', limited.authenticate(req(ld.token, 'limited_nonce_002')).error === 'NONCE_CAPACITY');
// Persistence regression coverage: sessions, permissions, revocation and nonce replay survive restart.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-phonehub-'));
const stateFile = path.join(tempDir, 'state.json');
try {
  const persistent = createPhoneHubAuth({ now: () => now, stateFile });
  const pp = persistent.beginPairing();
  const pd = persistent.completePairing({ pairingId: pp.pairingId, code: pp.code, deviceName: 'Persisted Android' });
  persistent.authenticate(req(pd.token, 'persisted_nonce_001'));
  const restored = createPhoneHubAuth({ now: () => now, stateFile });
  check('paired device survives restart', restored.listDevices().some(d => d.id === pd.device.id));
  check('bearer token remains valid after restart', restored.authenticate(req(pd.token, 'persisted_nonce_002')).ok);
  check('nonce replay is rejected across restart', restored.authenticate(req(pd.token, 'persisted_nonce_001')).error === 'REPLAYED_NONCE');
  restored.grant(pd.device.id, ['status', 'contacts.read']);
  check('granted capabilities survive restart', createPhoneHubAuth({ now: () => now, stateFile }).listDevices()
    .some(d => d.id === pd.device.id && d.capabilities.includes('contacts.read')));
  const revoker = createPhoneHubAuth({ now: () => now, stateFile });
  revoker.revoke(pd.device.id);
  check('device revocation survives restart', createPhoneHubAuth({ now: () => now, stateFile })
    .listDevices().find(d => d.id === pd.device.id).revoked);
  check('state file uses owner-only permissions where supported', (fs.statSync(stateFile).mode & 0o777) === 0o600);
  const corruptFile = path.join(tempDir, 'corrupt.json');
  fs.writeFileSync(corruptFile, '{not-json');
  let rejected = false;
  try { createPhoneHubAuth({ stateFile: corruptFile }); } catch { rejected = true; }
  check('corrupt state fails closed instead of silently forgetting paired devices', rejected);
  const invalidRecordFile = path.join(tempDir, 'invalid-record.json');
  fs.writeFileSync(invalidRecordFile, JSON.stringify({
    version: 1,
    pairings: [],
    devices: [['not-a-device-id', {
      tokenHash: 'a'.repeat(64), capabilities: ['status'], createdAt: now,
      expiresAt: now + 10000, revokedAt: null
    }]],
    usedNonces: []
  }));
  let invalidRecordRejected = false;
  try { createPhoneHubAuth({ stateFile: invalidRecordFile }); } catch { invalidRecordRejected = true; }
  check('malformed persisted device IDs fail closed', invalidRecordRejected);

} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
console.log('phonehub-auth: ' + (total - failures) + '/' + total);
process.exitCode = failures ? 1 : 0;
