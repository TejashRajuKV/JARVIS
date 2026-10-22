'use strict';

// A deliberately narrow HTTPS API for Phone Hub. This module does not expose JARVIS's
// existing /api/tool routes and does not start unless bound to an explicit private LAN IP.
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');

const DEFAULT_MAX_BODY_BYTES = 4096;
const DEFAULT_PORT = 18443;
const CAPABILITY_ROUTES = new Set(['/v1/status', '/v1/notifications']);

function isPrivateLanAddress(value) {
  let address = String(value || '').split('%')[0];
  if (address.startsWith('::ffff:')) address = address.slice(7);
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  if (family === 6) return /^f[cd][0-9a-f]{2}:/i.test(address);
  return false;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', fail);
  });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function createPhoneHubRequestHandler(options = {}) {
  const auth = options.auth;
  if (!auth || typeof auth.authorize !== 'function' || typeof auth.completePairing !== 'function') {
    throw new TypeError('Phone Hub auth module is required');
  }
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const host = String(options.host || '');
  const allowedHost = net.isIP(host) === 6 ? '[' + host + ']:' + port : host + ':' + port;
  const allowedOrigins = new Set((options.allowedOrigins || []).map(String));
  const maxBodyBytes = Number.isSafeInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
    ? Math.min(options.maxBodyBytes, 16 * 1024) : DEFAULT_MAX_BODY_BYTES;
  const getStatus = typeof options.getStatus === 'function' ? options.getStatus : async () => ({ available: true });
  const getNotifications = typeof options.getNotifications === 'function' ? options.getNotifications : async () => [];

  return async function phoneHubRequestHandler(req, res) {
    try {
      if (!req.socket || req.socket.encrypted !== true) return json(res, 426, { error: 'HTTPS_REQUIRED' });
      if (!isPrivateLanAddress(req.socket && req.socket.remoteAddress)) {
        return json(res, 403, { error: 'PRIVATE_LAN_PEER_REQUIRED' });
      }
      if (req.headers.host !== allowedHost) return json(res, 403, { error: 'FORBIDDEN_HOST' });
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return json(res, 403, { error: 'FORBIDDEN_ORIGIN' });
      if (req.method === 'OPTIONS') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && req.url === '/v1/pair') {
        if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
          return json(res, 415, { error: 'JSON_REQUIRED' });
        }
        const body = await readJsonBody(req, maxBodyBytes);
        const result = auth.completePairing({
          pairingId: body.pairingId,
          code: body.code,
          deviceName: body.deviceName
        });
        return json(res, result.ok ? 200 : result.error === 'DEVICE_CAPACITY' ? 429 : 401, result.ok
          ? { ok: true, device: result.device, token: result.token }
          : { ok: false, error: result.error });
      }
      if (req.method === 'GET' && CAPABILITY_ROUTES.has(req.url)) {
        const capability = req.url === '/v1/status' ? 'status' : 'notifications';
        const tokenHeader = String(req.headers.authorization || '');
        const tokenMatch = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(tokenHeader);
        const nonce = String(req.headers['x-jarvis-nonce'] || '');
        const result = auth.authorize({ token: tokenMatch ? tokenMatch[1] : '', nonce }, capability);
        if (!result.ok) return json(res, result.error === 'CAPABILITY_DENIED' ? 403 : 401, { error: result.error });
        const data = capability === 'status' ? await getStatus() : await getNotifications();
        return json(res, 200, { ok: true, data });
      }
      if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (res.headersSent) return res.destroy && res.destroy();
      return json(res, error.statusCode || 500, {
        error: error.statusCode === 400 ? 'INVALID_JSON' :
          error.statusCode === 413 ? 'BODY_TOO_LARGE' : 'PHONE_HUB_UNAVAILABLE'
      });
    }
  };
}

function createPhoneHubHttpsServer(options = {}) {
  const host = String(options.host || '');
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  if (!isPrivateLanAddress(host)) throw new Error('Phone Hub must bind to an explicit private LAN IP address');
  if (!options.key || !options.cert) throw new Error('Phone Hub requires an HTTPS certificate and private key; plaintext fallback is disabled');
  const key = Buffer.isBuffer(options.key) ? options.key : fs.readFileSync(options.key);
  const cert = Buffer.isBuffer(options.cert) ? options.cert : fs.readFileSync(options.cert);
  const handler = createPhoneHubRequestHandler({ ...options, host, port });
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, handler);
  return { server, host, port, listen: () => new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server.address()); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  }) };
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_PORT,
  isPrivateLanAddress,
  createPhoneHubRequestHandler,
  createPhoneHubHttpsServer
};
