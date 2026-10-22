'use strict';

// Phone Hub pairing/session primitives. This module deliberately does not open a network
// listener: the gateway must provide HTTPS and call these methods only after validating
// the transport, origin, request size, and local-network policy.
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CAPABILITIES = Object.freeze([
  'status', 'notifications', 'sms.read', 'sms.send', 'contacts.read',
  'calls', 'photos.read', 'clipboard.read', 'app.launch'
]);
const PAIRING_CAPABILITIES = Object.freeze(['status', 'notifications']);
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_ACTIVE_PAIRINGS = 5;
const DEFAULT_MAX_USED_NONCES = 10_000;
const DEFAULT_MAX_DEVICES = 50;
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
  const maxActivePairings = Number.isSafeInteger(options.maxActivePairings) && options.maxActivePairings > 0 ? options.maxActivePairings : DEFAULT_MAX_ACTIVE_PAIRINGS;
  const maxUsedNonces = Number.isSafeInteger(options.maxUsedNonces) && options.maxUsedNonces > 0 ? options.maxUsedNonces : DEFAULT_MAX_USED_NONCES;
  const maxDevices = Number.isSafeInteger(options.maxDevices) && options.maxDevices > 0 ? options.maxDevices : DEFAULT_MAX_DEVICES;
  const allowed = new Set(DEFAULT_CAPABILITIES);
  const pairings = new Map();
  const devices = new Map();
  const usedNonces = new Map();
  const stateFile = typeof options.stateFile === 'string' && options.stateFile.trim()
    ? path.resolve(options.stateFile) : null;

  function persist() {
    if (!stateFile) return;
    const state = {
      version: 1,
      pairings: [...pairings.entries()],
      devices: [...devices.entries()],
      usedNonces: [...usedNonces.entries()]
    };
    const dir = path.dirname(stateFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const temporary = stateFile + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try { fs.chmodSync(temporary, 0o600); } catch {}
      fs.renameSync(temporary, stateFile);
      try { fs.chmodSync(stateFile, 0o600); } catch {}
    } finally {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    }
  }

  function restore() {
    if (!stateFile || !fs.existsSync(stateFile)) return;
    let state;
    try { fs.chmodSync(stateFile, 0o600); } catch {}
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
    catch { throw new Error('Phone Hub state file is unreadable; refusing to reset device credentials'); }
    if (!state || state.version !== 1 || !Array.isArray(state.pairings) ||
        !Array.isArray(state.devices) || !Array.isArray(state.usedNonces)) {
      throw new Error('Phone Hub state file has an unsupported or invalid format; refusing to reset device credentials');
    }
    for (const [id, p] of state.pairings) {
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || !p ||
          typeof p.codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.codeHash) ||
          !Number.isFinite(p.createdAt) || !Number.isFinite(p.expiresAt) ||
          !Number.isInteger(p.attempts) || p.attempts < 0 || p.attempts > maxAttempts ||
          typeof p.consumed !== 'boolean') {
        throw new Error('Phone Hub state file contains an invalid pairing record');
      }
      if (p.expiresAt > nowFn() && !p.consumed && p.attempts < maxAttempts) pairings.set(id, p);
    }
    for (const [id, d] of state.devices) {
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || !d ||
          typeof d.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(d.tokenHash) ||
          !Array.isArray(d.capabilities) || d.capabilities.some(cap => typeof cap !== 'string' || !allowed.has(cap)) ||
          !Number.isFinite(d.expiresAt) || !Number.isFinite(d.createdAt) ||
          (d.revokedAt !== null && !Number.isFinite(d.revokedAt))) {
        throw new Error('Phone Hub state file contains an invalid device record');
      }
      if (d.expiresAt > nowFn() && !d.revokedAt) devices.set(id, d);
      else if (d.revokedAt) devices.set(id, d);
    }
    for (const [key, expiry] of state.usedNonces) {
      if (typeof key !== 'string' || !/^[a-f0-9]{32}:[a-zA-Z0-9_-]{16,128}$/.test(key) || !Number.isFinite(expiry)) {
        throw new Error('Phone Hub state file contains an invalid nonce record');
      }
      if (expiry > nowFn()) usedNonces.set(key, expiry);
    }
    if (pairings.size > maxActivePairings || usedNonces.size > maxUsedNonces ||
        devices.size > maxDevices * 10 || activeDeviceCount() > maxDevices) {
      throw new Error('Phone Hub state exceeds configured safety limits; refusing to load it');
    }
  }
  restore();

  function beginPairing() {
    // Bound memory even if the laptop UI is repeatedly asked to create pairing sessions.
    sweep();
    while (pairings.size >= maxActivePairings) {
      const oldest = pairings.keys().next().value;
      if (oldest === undefined) break;
      pairings.delete(oldest);
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const id = randomId(12);
    const createdAt = nowFn();
    pairings.set(id, { codeHash: hash(code), createdAt, expiresAt: createdAt + pairingTtlMs, attempts: 0, consumed: false });
    persist();
    return { pairingId: id, code, createdAt, expiresAt: createdAt + pairingTtlMs };
  }

  function activeDeviceCount() {
    const now = nowFn();
    let count = 0;
    for (const device of devices.values()) if (!device.revokedAt && device.expiresAt > now) count++;
    return count;
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
      persist();
      return { ok: false, error: 'PAIRING_LOCKED' };
    }
    if (activeDeviceCount() >= maxDevices) return { ok: false, error: 'DEVICE_CAPACITY' };
    pairing.attempts++;
    const suppliedHash = hash(String(input.code || ''));
    if (!safeEqual(pairing.codeHash, suppliedHash)) {
      if (pairing.attempts >= maxAttempts) pairings.delete(id);
      persist();
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
    persist();
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
      if (usedNonces.size >= maxUsedNonces) return { ok: false, error: 'NONCE_CAPACITY' };
      usedNonces.set(nonceKey, now + NONCE_TTL_MS);
      persist();
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
    persist();
    return { ok: true, device: publicDevice(device) };
  }

  function revoke(deviceId) {
    const device = devices.get(String(deviceId || ''));
    if (!device) return false;
    device.revokedAt = nowFn();
    persist();
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
    persist();
    return { pairings: pairings.size, devices: devices.size, nonces: usedNonces.size };
  }

  return Object.freeze({ beginPairing, completePairing, authenticate, authorize, grant, revoke, listDevices, sweep });
}

module.exports = { createPhoneHubAuth, DEFAULT_CAPABILITIES, PAIRING_CAPABILITIES, DEFAULT_MAX_ACTIVE_PAIRINGS, DEFAULT_MAX_USED_NONCES, DEFAULT_MAX_DEVICES };
