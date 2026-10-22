'use strict';
const { createPhoneHubAuth, DEFAULT_CAPABILITIES, PAIRING_CAPABILITIES } = require('../phonehub-auth.js');

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
console.log('phonehub-auth: ' + (total - failures) + '/' + total);
process.exitCode = failures ? 1 : 0;
