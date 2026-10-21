// One-time approval tokens for changes outside ~/jarvis (server.js approvedChange). A token is bound to one action on
// one set of paths, works once, and expires (5 minutes by default): a stale, replayed or swapped approval does nothing.
'use strict';
const crypto = require('crypto');

function createApprovals({ ttl = 5 * 60e3, max = 500, now = () => Date.now() } = {}) {
  const tokens = new Map();   // token → { sig, exp }
  function issue(sig) {
    const t = now();
    for (const [k, v] of tokens) if (v.exp <= t) tokens.delete(k);
    while (tokens.size >= max) tokens.delete(tokens.keys().next().value);
    const token = crypto.randomBytes(16).toString('hex');
    tokens.set(token, { sig: String(sig), exp: t + ttl });
    return token;
  }
  // true only for a live token issued for exactly this sig; a used or expired token is gone afterwards.
  function consume(token, sig) {
    const k = String(token || ''), rec = tokens.get(k);
    if (!rec) return false;
    if (rec.exp <= now()) { tokens.delete(k); return false; }
    if (rec.sig !== String(sig)) return false;
    tokens.delete(k);
    return true;
  }
  return { issue, consume, size: () => tokens.size };
}

module.exports = { createApprovals };
