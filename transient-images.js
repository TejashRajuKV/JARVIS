'use strict';
const crypto = require('node:crypto');
// At most two pending captures, single-use, with active expiry even when no
// further screenshots are requested. Images never enter durable task history.
function createCache({ now = Date.now, ttl = 120000, max = 2 } = {}) {
  const entries = new Map();
  const purge = () => { for (const [key, value] of entries) if (value.expires <= now()) entries.delete(key); };
  const timer = setInterval(purge, 30000); timer.unref();
  return {
    put(b64) {
      purge();
      if (typeof b64 !== 'string' || b64.length > 9 * 1024 * 1024) throw new Error('Capture too large');
      while (entries.size >= max) entries.delete(entries.keys().next().value);
      const token = crypto.randomBytes(16).toString('hex'); entries.set(token, { b64, expires: now() + ttl }); return token;
    },
    take(token) { purge(); const entry = entries.get(token); entries.delete(token); return entry?.b64 || null; },
    size() { purge(); return entries.size; },
    close() { clearInterval(timer); entries.clear(); }
  };
}
module.exports = { createCache };
