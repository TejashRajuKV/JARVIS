'use strict';

// Phone Hub pairing/session primitives. This module deliberately does not open a network
// listener: the gateway must provide HTTPS and call these methods only after validating
// the transport, origin, request size, and local-network policy.
const crypto = require('crypto');

const DEFAULT_CAPABILITIES = Object.freeze([
  'status', 'notifications', 'sms.read', 'sms.send', 'contacts.read',
  'calls', 'photos.read', 'clipboard.read', 'app.launch'
]);
const PAIRING_CAPABILITIES = Object.freeze(['status', 'notifications']);
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const NONCE_TTL_MS = 2 * 60 * 1000;

const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Android device';

function createPhoneHubAuth(options = {}) {
  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const pairingTtlMs = Number.isSafeInteger(options.pairingTtlMs) && options.pairingTtlMs > 0 ? options.pairingTtlMs : DEFAULT_PAIRING_TTL_MS;
  const sessionTtlMs = Number.isSafeInteger(options.sessionTtlMs) && options.sessionTtlMs > 0 ? options.sessionTtlMs : DEFAULT_SESSION_TTL_MS;
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const allowed = new Set(DEFAULT_CAPABILITIES);
  const pairings = new Map();
  const devices = new Map();
  const usedNonces = new Map();

  function beginPairing() {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const id = randomId(12);
    const createdAt = nowFn();
    pairings.set(id, { codeHash: hash(code), createdAt, expiresAt: createdAt + pairingTtlMs, attempts: 0, consumed: false });
    return { pairingId: id, code, createdAt, expiresAt: createdAt + pairingTtlMs };
  }

  function completePairing(input = {}) {
    const id = String(input.pairingId || '');
    const pairing = pairings.get(id);
    const now = nowFn();
    if (!pairing || pairing.consumed || now >= pairing.expiresAt) {
      if (pairing && now >= pairing.expiresAt) pairings.delete(id);
      return { ok: false, error: 'PAIRING_EXPIRED' };
    }
    if (pairing.attempts >= maxAttempts) {
      pairings.delete(id);
      return { ok: false, error: 'PAIRING_LOCKED' };
    }
    pairing.attempts++;
    const suppliedHash = hash(String(input.code || ''));
    if (!safeEqual(pairing.codeHash, suppliedHash)) {
      if (pairing.attempts >= maxAttempts) pairings.delete(id);
      return { ok: false, error: pairing.attempts >= maxAttempts ? 'PAIRING_LOCKED' : 'PAIRING_CODE_INVALID' };
    }

    // Pairing grants only low-risk baseline capabilities. Sensitive scopes must be
    // granted later through the trusted laptop-side management UI.
    const capabilities = [...PAIRING_CAPABILITIES];
    const deviceId = randomId(16);
    const token = crypto.randomBytes(32).toString('base64url');
    const device = {
      id: deviceId,
      name: cleanName(input.deviceName),
      tokenHash: hash(token),
      capabilities,
      createdAt: now,
      expiresAt: now + sessionTtlMs,
      revokedAt: null
    };
    pairing.consumed = true;
    pairings.delete(id);
    devices.set(deviceId, device);
    return { ok: true, device: publicDevice(device), token };
  }

  function publicDevice(device) {
    return {
      id: device.id, name: device.name, capabilities: [...device.capabilities],
      createdAt: device.createdAt, expiresAt: device.expiresAt,
      revoked: !!device.revokedAt
    };
  }

  function authenticate(input = {}) {
    const token = String(input.token || '');
    if (!token || token.length > 256) return { ok: false, error: 'UNAUTHENTICATED' };
    const tokenHash = hash(token);
    const now = nowFn();
    for (const device of devices.values()) {
      if (!safeEqual(device.tokenHash, tokenHash)) continue;
      if (device.revokedAt) return { ok: false, error: 'DEVICE_REVOKED' };
      if (now >= device.expiresAt) return { ok: false, error: 'SESSION_EXPIRED' };
      const nonce = String(input.nonce || '');
      if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) return { ok: false, error: 'NONCE_REQUIRED' };
      for (const [key, expiry] of usedNonces) if (expiry <= now) usedNonces.delete(key);
      const nonceKey = device.id + ':' + nonce;
      if (usedNonces.has(nonceKey)) return { ok: false, error: 'REPLAYED_NONCE' };
      usedNonces.set(nonceKey, now + NONCE_TTL_MS);
      return { ok: true, device: publicDevice(device) };
    }
    return { ok: false, error: 'UNAUTHENTICATED' };
  }

  function authorize(input = {}, capability = 'status') {
    const auth = authenticate(input);
    if (!auth.ok) return auth;
    if (!allowed.has(capability) || !auth.device.capabilities.includes(capability)) {
      return { ok: false, error: 'CAPABILITY_DENIED', device: auth.device };
    }
    return auth;
  }

  function grant(deviceId, capabilities) {
    const device = devices.get(String(deviceId || ''));
    if (!device || device.revokedAt) return { ok: false, error: 'DEVICE_NOT_FOUND' };
    if (!Array.isArray(capabilities)) return { ok: false, error: 'INVALID_CAPABILITIES' };
    device.capabilities = [...new Set(capabilities.map(String).filter(v => allowed.has(v)))];
    return { ok: true, device: publicDevice(device) };
  }

  function revoke(deviceId) {
    const device = devices.get(String(deviceId || ''));
    if (!device) return false;
    device.revokedAt = nowFn();
    return true;
  }

  function listDevices() {
    return [...devices.values()].map(publicDevice);
  }

  function sweep() {
    const now = nowFn();
    for (const [id, p] of pairings) if (p.expiresAt <= now || p.consumed || p.attempts >= maxAttempts) pairings.delete(id);
    for (const [key, expiry] of usedNonces) if (expiry <= now) usedNonces.delete(key);
    for (const [id, d] of devices) if (d.expiresAt <= now && !d.revokedAt) d.revokedAt = now;
    return { pairings: pairings.size, devices: devices.size, nonces: usedNonces.size };
  }

  return Object.freeze({ beginPairing, completePairing, authenticate, authorize, grant, revoke, listDevices, sweep });
}

module.exports = { createPhoneHubAuth, DEFAULT_CAPABILITIES, PAIRING_CAPABILITIES };
