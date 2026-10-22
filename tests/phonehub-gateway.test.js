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
    getNotifications: async () => [{ id: 'n1', title: 'Build complete' }]
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
  res = await call(handler, { method: 'POST', url: '/v1/pair', headers: { 'content-type': 'application/json' }, body: '{invalid json' });
  check('malformed JSON receives a 400 error', () => assert.equal(res.statusCode, 400));
  res = await call(createPhoneHubRequestHandler({ auth, host: '192.168.1.10', maxBodyBytes: 32 }), {
    method: 'POST', url: '/v1/pair', headers: { 'content-type': 'application/json' }, body: { pairingId: 'a'.repeat(100), code: '000000' }
  });
  check('oversized JSON receives a 413 error', () => assert.equal(res.statusCode, 413));

  const gatewaySource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'phonehub-gateway.js'), 'utf8');\n  check('live event stream is protected by notification capability authorization', () => {\n    assert.match(gatewaySource, /req\.url === STREAM_ROUTE/);\n    assert.match(gatewaySource, /auth\.authorize\(\{ token: tokenMatch \? tokenMatch\[1\] : '', nonce \}, 'notifications'\)/);\n    assert.match(gatewaySource, /text\\/event-stream/);\n    assert.match(gatewaySource, /req\.on\('close', close\)/);\n  });\n  console.log('phonehub-gateway: ' + total + ' checks passed');
})().catch(() => { process.exitCode = 1; });
