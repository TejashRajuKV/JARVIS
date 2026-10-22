'use strict';
const { createPhoneHubAuth, DEFAULT_CAPABILITIES } = require('../phonehub-auth.js');

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
check('default capabilities are least privilege', DEFAULT_CAPABILITIES.includes('sms.send'));
const wrong = auth.completePairing({ pairingId: p.pairingId, code: 'not-it' });
check('wrong pairing code rejected', !wrong.ok && wrong.error === 'PAIRING_CODE_INVALID');
const paired = auth.completePairing({
  pairingId: p.pairingId, code: p.code, deviceName: '  Tejash Android\u0000 ',
  capabilities: ['status', 'notifications', 'sms.send', 'unknown', 'sms.send']
});
check('valid pairing succeeds once', paired.ok && paired.token && paired.device.capabilities.length === 3, paired);
check('device name is normalized', paired.device.name === 'Tejash Android', paired.device.name);
check('device list never exposes the bearer token', !JSON.stringify(auth.listDevices()).includes(paired.token));
check('reusing consumed pairing code fails', !auth.completePairing({ pairingId: p.pairingId, code: p.code }).ok);
check('authorized capability succeeds', auth.authorize(req(paired.token, '1'), 'sms.send').ok);
const replay = auth.authorize(req(paired.token, '1'), 'sms.send');
check('replayed nonce rejected', !replay.ok && replay.error === 'REPLAYED_NONCE', replay);
const denied = auth.authorize(req(paired.token, '2'), 'contacts.read');
check('ungranted capability denied', !denied.ok && denied.error === 'CAPABILITY_DENIED', denied);
check('nonce is mandatory', !auth.authenticate({ token: paired.token }).ok);
check('wrong token rejected', !auth.authenticate(req('not-a-token', '3')).ok);
check('capability grant updates privileges', auth.grant(paired.device.id, ['status', 'contacts.read']).ok &&
  auth.authorize(req(paired.token, '4'), 'contacts.read').ok);
check('grant rejects unknown device', !auth.grant('missing-device', ['status']).ok);
check('revoke invalidates device', auth.revoke(paired.device.id) &&
  auth.authenticate(req(paired.token, '5')).error === 'DEVICE_REVOKED');

const locked = auth.beginPairing();
auth.completePairing({ pairingId: locked.pairingId, code: '000000' });
auth.completePairing({ pairingId: locked.pairingId, code: '111111' });
const third = auth.completePairing({ pairingId: locked.pairingId, code: '222222' });
check('pairing attempt limit locks challenge', !third.ok && third.error === 'PAIRING_LOCKED');
const expired = auth.beginPairing();
now += 300_001;
check('expired pairing cannot be completed', auth.completePairing({ pairingId: expired.pairingId, code: expired.code }).error === 'PAIRING_EXPIRED');

const session = auth.beginPairing();
const expPair = auth.completePairing({ pairingId: session.pairingId, code: session.code, capabilities: ['status'] });
now += 86_400_001;
check('expired session cannot authenticate', auth.authenticate(req(expPair.token, '6')).error === 'SESSION_EXPIRED');
auth.sweep();
console.log('phonehub-auth: ' + (total - failures) + '/' + total);
process.exitCode = failures ? 1 : 0;
