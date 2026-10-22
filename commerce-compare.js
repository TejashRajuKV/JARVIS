'use strict';
// Conservative helpers for interpreting live search snippets and public product/travel pages.
// Price candidates are evidence to inspect, never proof of a final checkout price.
const MONEY_RE = /(?:₹|INR\s*|Rs\.?\s*)(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{2,3})+|\d{2,7})(?:\.\d{1,2})?\s*(?:₹|INR)\b/gi;
function extractPriceCandidates(text) {
  const s = String(text || '').slice(0, 12000), out = [], seen = new Set();
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(s)) && out.length < 8) {
    const raw = (m[1] || m[2] || '').replace(/,/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 50 || value > 10000000) continue;
    const before = s.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(?:model|version|year|pin|pincode|phone|mobile|sku|part number)\s*[:#-]?\s*$/i.test(before)) continue;
    if (/\b(?:off|discount)\s*$/i.test(before) && value < 100) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const around = s.slice(Math.max(0, m.index - 50), Math.min(s.length, m.index + m[0].length + 50));
    out.push({ value, display: '₹' + value.toLocaleString('en-IN'), context: around.replace(/\s+/g,' ').trim().slice(0,160) });
  }
  return out;
}
function queryMatch(query, text) {
  const words = String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const body = String(text || '').toLowerCase();
  const meaningful = words.filter(w => w.length > 2 && !/^(the|and|for|with|under|from|into|price|cheap|cheapest|compare|buy|find|search|india|product|item|best|new)$/.test(w));
  if (!meaningful.length) return 0;
  return meaningful.filter(w => body.includes(w)).length / meaningful.length;
}
module.exports = { extractPriceCandidates, queryMatch };
