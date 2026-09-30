'use strict';
/* Authenticator codes (TOTP, RFC 6238 — what Google Authenticator / Microsoft Authenticator generate) for
   unlocking phone commands. The ntfy topic is public, so a message alone proves nothing; a fresh 6-digit code
   from the user's authenticator app does. Each code is accepted once, within ±30 s. No dependencies. */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function newSecret() { return base32Encode(crypto.randomBytes(20)); } // 160-bit, as RFC 4226 recommends

function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
const totpAt = (secret, ms, digits = 6) => hotp(base32Decode(secret), Math.floor(ms / 30000), digits);

// Checks a code against the current 30-second step and its neighbours (±60 s: time to read it, switch to ntfy and
// type it, plus delivery); `used` (a Set of steps) makes it single-use.
function verifyCode(secret, code, now, used) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const key = base32Decode(secret), step = Math.floor(now / 30000);
  for (const d of [0, -1, 1, -2, 2]) {
    const s = step + d;
    if (used && used.has(s)) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(String(code)))) { if (used) used.add(s); return true; }
  }
  return false;
}
const otpauthUri = (secret, label = 'JARVIS') => `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=JARVIS&algorithm=SHA1&digits=6&period=30`;

module.exports = { base32Encode, base32Decode, newSecret, hotp, totpAt, verifyCode, otpauthUri };
