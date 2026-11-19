'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createPhoneHubAuth } = require('../phonehub-auth');
const {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_PORT,
  isPrivateLanAddress,
  createPhoneHubRequestHandler,
  createPhoneHubHttpsServer
} = require('../phonehub-gateway');

function request({ method = 'GET', url = '/', body, headers = {}, remoteAddress = '192.168.1.20', encrypted = true } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { host: '192.168.1.10:' + DEFAULT_PORT, ...headers };
  req.socket = { remoteAddress, encrypted };
  return req;
}
function response() {
  return {
    headers: {}, statusCode: 200, body: '', headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = String(value || ''); this.headersSent = true; },
    destroy() { this.destroyed = true; },
    json() { return JSON.parse(this.body); }
  };
}
async function call(handler, options) {
  const res = response();
  await handler(request(options), res);
  return res;
}

(async () => {
  let total = 0;
  const check = (name, fn) => {
    total++;
    try { fn(); } catch (e) { console.error('FAIL [' + name + '] ' + e.message); throw e; }
  };
  check('private IPv4 ranges accepted', () =>
    assert.deepEqual(['10.0.0.2', '172.16.0.2', '172.31.255.1', '192.168.1.2'].map(isPrivateLanAddress), [true, true, true, true]));
  check('private IPv6 ULA accepted', () => assert.equal(isPrivateLanAddress('fd12:3456::1'), true));
  check('loopback, link-local, public and invalid addresses rejected', () =>
    assert.deepEqual(['127.0.0.1', '169.254.1.2', '8.8.8.8', '::1', 'not-an-ip'].map(isPrivateLanAddress), [false, false, false, false, false]));
  check('default request body size is bounded', () => assert.equal(DEFAULT_MAX_BODY_BYTES, 4096));
  check('gateway refuses missing TLS material', () =>
    assert.throws(() => createPhoneHubHttpsServer({ host: '192.168.1.10', port: DEFAULT_PORT }), /HTTPS certificate and private key/));
  check('gateway refuses wildcard and loopback binds', () => {
    assert.throws(() => createPhoneHubHttpsServer({ host: '0.0.0.0', key: 'k', cert: 'c' }), /explicit private LAN IP/);
    assert.throws(() => createPhoneHubHttpsServer({ host: '127.0.0.1', key: 'k', cert: 'c' }), /explicit private LAN IP/);
  });

  const auth = createPhoneHubAuth();
  const handler = createPhoneHubRequestHandler({
    auth, host: '192.168.1.10', port: DEFAULT_PORT,
    getStatus: async () => ({ battery: 87 }),
    getNotifications: async () => [{ id: 'n1', title: 'Build complete' }],
    getMarksStatus: async () => ({ available: true, tasks: [{ id: '00000000-0000-0000-0000-000000000001', status: 'completed' }] }),
    getMarksReport: async id => id.endsWith('1') ? { report: 'Owner-reviewed report' } : null,
  });
  let res = await call(handler, { encrypted: false, url: '/health' });
  check('plaintext requests are rejected even if handler is mis-mounted', () => assert.equal(res.statusCode, 426));
  res = await call(handler, { remoteAddress: '8.8.8.8', url: '/health' });
  check('public network peers rejected', () => assert.equal(res.statusCode, 403));
  res = await call(handler, { headers: { host: 'attacker.example:' + DEFAULT_PORT }, url: '/health' });
  check('unrecognized Host rejected', () => assert.equal(res.statusCode, 403));
  res = await call(handler, { headers: { origin: 'https://attacker.example' }, url: '/health' });
  check('unapproved Origin rejected', () => assert.equal(res.statusCode, 403));
  res = await call(handler, { method: 'OPTIONS', url: '/v1/status' });
  check('preflight is not enabled', () => assert.equal(res.statusCode, 405));
  res = await call(handler, { url: '/api/tool/run' });
  check('existing laptop-control paths are not exposed', () => assert.equal(res.statusCode, 404));
  res = await call(handler, { url: '/health' });
  check('health endpoint returns no-store response', () => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  const pairing = auth.beginPairing();
  res = await call(handler, { method: 'POST', url: '/v1/pair', headers: { 'content-type': 'text/plain' }, body: { pairingId: pairing.pairingId, code: pairing.code } });
  check('pair endpoint requires JSON content type', () => assert.equal(res.statusCode, 415));
  res = await call(handler, { method: 'POST', url: '/v1/pair', headers: { 'content-type': 'application/json' }, body: { pairingId: pairing.pairingId, code: pairing.code, deviceName: 'Android' } });
  const paired = res.json();
  check('valid pairing returns a device and one-time token', () => {
    assert.equal(res.statusCode, 200);
    assert.ok(paired.token);
    assert.deepEqual(paired.device.capabilities, ['status', 'notifications']);
  });
  res = await call(handler, { url: '/v1/status', headers: { authorization: 'Bearer ' + paired.token, 'x-jarvis-nonce': 'gateway_nonce_0001' } });
  check('authorized status request returns injected status only', () => {
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data, { battery: 87 });
  });
  res = await call(handler, { url: '/v1/status', headers: { authorization: 'Bearer ' + paired.token, 'x-jarvis-nonce': 'gateway_nonce_0001' } });
  check('replayed request nonce is rejected', () => assert.equal(res.statusCode, 401));
  res = await call(handler, { url: '/v1/notifications', headers: { authorization: 'Bearer ' + paired.token, 'x-jarvis-nonce': 'gateway_nonce_0002' } });
  check('notifications route enforces its capability and returns provider data', () => {
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data, [{ id: 'n1', title: 'Build complete' }]);
  });
  const marksGet = (url, nonce) => call(handler, { url, headers: { authorization: 'Bearer ' + paired.token, 'x-jarvis-nonce': 'gateway_marks_' + nonce } });
  res = await marksGet('/v1/marks', 'ungranted');
  check('Marks access is excluded from pairing defaults', () => assert.equal(res.statusCode, 403));
  auth.grant(paired.device.id, ['status', 'notifications', 'marks.read']);
  res = await marksGet('/v1/status', 'status');
  check('status advertises Marks to a granted device only', () => assert.equal(res.json().data.marksAvailable, true));
  res = await marksGet('/v1/marks', 'granted');
  check('a granted device can read Marks task status', () => assert.equal(res.json().data.tasks[0].status, 'completed'));
  res = await marksGet('/v1/marks/reports/00000000-0000-0000-0000-000000000001', 'reviewed');
  check('a granted device can read an explicitly shared report', () => assert.equal(res.json().data.report, 'Owner-reviewed report'));
  res = await marksGet('/v1/marks/reports/00000000-0000-0000-0000-000000000002', 'unshared');
  check('unshared Marks reports return 404', () => assert.equal(res.statusCode, 404));
  auth.grant(paired.device.id, ['status', 'notifications']);
  res = await marksGet('/v1/marks', 'revoked');
  check('removing the Marks grant applies to the next request', () => assert.equal(res.statusCode, 403));
  res = await call(handler, { method: 'POST', url: '/v1/pair', headers: { 'content-type': 'application/json' }, body: '{invalid json' });
  check('malformed JSON receives a 400 error', () => assert.equal(res.statusCode, 400));
  res = await call(createPhoneHubRequestHandler({ auth, host: '192.168.1.10', maxBodyBytes: 32 }), {
    method: 'POST', url: '/v1/pair', headers: { 'content-type': 'application/json' }, body: { pairingId: 'a'.repeat(100), code: '000000' }
  });
  check('oversized JSON receives a 413 error', () => assert.equal(res.statusCode, 413));

  const gatewaySource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'phonehub-gateway.js'), 'utf8');
  check('live event stream is protected by notification capability authorization', () => {
    assert.match(gatewaySource, /req\.url === STREAM_ROUTE/);
    assert.match(gatewaySource, /auth\.authorize/);
    assert.match(gatewaySource, /text.event-stream/);
    assert.match(gatewaySource, /req\.on\('close', close\)/);
  });
  let nonce = 0, providerError = null;
  const providerMessages = [];
  const scoped = createPhoneHubRequestHandler({ auth, host: '192.168.1.10',
    respondToVoice: async text => 'Heard: ' + text,
    makeCall: async ({ message }) => {
      if (providerError) throw Object.assign(new Error(providerError), { code:providerError });
      providerMessages.push(message); return { status:'queued' };
    }
  });
  const scopedPost = (url, body) => call(scoped, { method:'POST', url, body, headers:{
    'content-type':'application/json', authorization:'Bearer ' + paired.token, 'x-jarvis-nonce':'scoped_test_nonce_' + ++nonce
  } });
  const voice = '/v1/voice/respond', announcement = '/v1/call';
  res = await scopedPost(voice, {text:'Test phrase'});
  const noCall = await scopedPost(announcement, {message:'Test announcement'});
  check('a newly paired device receives neither voice nor call permission', () => {
    assert.equal(res.statusCode, 403);
    assert.equal(noCall.statusCode, 403);
    assert.deepEqual(providerMessages, []);
  });
  auth.grant(paired.device.id, ['voice']);
  res = await scopedPost(voice, {text:'Test phrase'});
  const stillNoCall = await scopedPost(announcement, {message:'Test announcement'});
  check('voice permission returns a reply but cannot place a call', () => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().reply, 'Heard: Test phrase');
    assert.equal(stillNoCall.statusCode, 403);
  });
  auth.grant(paired.device.id, ['calls']);
  res = await scopedPost(announcement, {message:'Meet at 5 PM, room\u0000 12.'});
  const noVoice = await scopedPost(voice, {text:'Test phrase'});
  check('calls permission forwards the full announcement after stripping controls, without enabling voice', () => {
    assert.equal(res.statusCode, 202);
    assert.equal(noVoice.statusCode, 403);
    assert.deepEqual(providerMessages, ['Meet at 5 PM, room 12.']);
  });
  providerError = 'CALL_RATE_LIMITED';
  res = await scopedPost(announcement, {message:'Test announcement'});
  check('call rate limitation is reported as 429', () => {
    assert.equal(res.statusCode, 429); assert.equal(res.json().error, 'CALL_RATE_LIMITED');
  });
  providerError = 'CALLING_NOT_CONFIGURED';
  res = await scopedPost(announcement, {message:'Test announcement'});
  check('unconfigured calling provider is reported as 503', () => {
    assert.equal(res.statusCode, 503); assert.equal(res.json().error, 'CALLING_NOT_CONFIGURED');
  });
  console.log('phonehub-gateway: ' + total + ' checks passed');
})().catch(() => { process.exitCode = 1; });
