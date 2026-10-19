'use strict';
// Fetching a page the user (or the AI) named must only ever reach the PUBLIC internet. Three holes the old check had:
//  - a public page could redirect to http://127.0.0.1:3000/... (JARVIS itself) or another service on the laptop, and the answer was read and handed to the AI;
//  - a name that points at a private address (localtest.me, an internal DNS name) passed because only the spelling of the address was checked;
//  - spellings the pattern missed (IPv4-mapped IPv6 like [::ffff:7f00:1], 100.64.x.x, *.local, *.internal).
// So: check the spelling, resolve the name and check every address it gives, and follow redirects ourselves, one hop at a time, re-checking each.
// (A name that changes its answer between the check and the connection — DNS rebinding — is not covered; the request is read-only text and capped.)
const dns = require('dns').promises, net = require('net');

const v4 = ip => ip.split('.').map(Number);
function privateV4(ip) {
  const [a, b] = v4(ip);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && v4(ip)[2] === 99))) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && v4(ip)[2] === 100)) ||
    (a === 203 && b === 0 && v4(ip)[2] === 113) || a >= 224;
}
// true when the address is not a normal public one (loopback, private, link-local, multicast, "this network", carrier-grade NAT, mapped forms of those)
function isPrivateAddress(raw) {
  let ip = String(raw || '').trim().replace(/^\[|\]$/g, '').toLowerCase().split('%')[0];
  const kind = net.isIP(ip);
  if (!kind) return true;                                   // not an address at all: refuse rather than guess
  if (kind === 4) return privateV4(ip);
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return privateV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
  if (/^(::|::1|0:0:0:0:0:0:0:[01])$/.test(ip)) return true;
  // IPv4-compatible/translatable IPv6 forms and transition tunnels can disguise
  // a private IPv4 destination from the ordinary IPv4-mapped-address check.
  if (/^::(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4}$/.test(ip) ||
      /^::(?:[0-9a-f]{1,4}:){0,1}(?:\d+\.\d+\.\d+\.\d+)$/.test(ip)) return true;
  if (/^::ffff:0:/.test(ip) || /^2002:/.test(ip)) return true;                         // translated IPv4 / 6to4
  if (/^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip)) return true;       // unique-local, link-local, multicast
  if (/^64:ff9b:/.test(ip)) return true;                                                // NAT64 maps to IPv4: not worth resolving
  if (/^2001:db8/.test(ip) || /^2001:0:/.test(ip)) return true;                       // documentation / Teredo
  return false;
}
const BAD_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa)$/i;

// Throws Error('Only public http(s) pages') unless the URL is http(s) and every address its host resolves to is public.
async function assertPublicUrl(href, { lookup = (h => dns.lookup(h, { all: true, verbatim: true })) } = {}) {
  let u; try { u = new URL(String(href || '')); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Only public http(s) pages');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BAD_NAME.test(host) || !/[.:]/.test(host)) throw new Error('Only public http(s) pages');   // "intranet", "router": a bare name is a local one
  if (net.isIP(host)) { if (isPrivateAddress(host)) throw new Error('Only public http(s) pages'); return u; }
  let addrs;
  try { addrs = await lookup(host); } catch { throw new Error('Could not find that address'); }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (a && a.address) || a);
  if (!list.length || list.some(isPrivateAddress)) throw new Error('Only public http(s) pages');
  return u;
}

// fetch() that follows at most `maxHops` redirects by hand and checks each hop. `fetchImpl` and `lookup` are injectable for tests.
async function safeFetch(href, init = {}, { fetchImpl = fetch, lookup, maxHops = 5 } = {}) {
  let url = String(href);
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = await assertPublicUrl(url, lookup ? { lookup } : {});
    const r = await fetchImpl(u.href, { ...init, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers && r.headers.get && r.headers.get('location')) {
      try { url = new URL(r.headers.get('location'), u.href).href; } catch { throw new Error('Page redirected to a bad address'); }
      continue;
    }
    r.finalUrl = u.href;
    return r;
  }
  throw new Error('Page redirected too many times');
}

// A page's text, read at most `maxBytes` (the download stops there, instead of reading everything and cutting it
// afterwards). Only text pages: a PDF, image or download is refused, so it never reaches the AI as garbage.
const TEXT_TYPE = /^(?:text\/|application\/(?:xhtml\+xml|xml|json|[\w.+-]+\+(?:xml|json))\b)/i;
async function readText(r, maxBytes = 1024 * 1024) {
  const type = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
  if (type && !TEXT_TYPE.test(type.trim())) throw new Error('Not a text page (' + type.split(';')[0].trim() + ')');
  if (!r.body || !r.body.getReader) return String(await r.text()).slice(0, maxBytes);
  const reader = r.body.getReader(), parts = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); size += value.byteLength;
    }
  } finally { if (size >= maxBytes) reader.cancel().catch(() => {}); }
  return Buffer.concat(parts.map(p => Buffer.from(p))).subarray(0, maxBytes).toString('utf8');
}

module.exports = { isPrivateAddress, assertPublicUrl, safeFetch, readText };
