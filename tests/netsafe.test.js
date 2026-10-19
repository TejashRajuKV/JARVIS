// Fetching a page must only reach the public internet: addresses, names that resolve to private addresses, and redirects. Run: node tests/netsafe.test.js
'use strict';
const { isPrivateAddress, assertPublicUrl, safeFetch } = require('../netsafe');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.1.1', '224.0.0.1', '198.18.0.1', '198.51.100.2', '203.0.113.7', '192.88.99.1', '::1', '::', 'fe80::1', 'fd12:3456::1', 'fc00::1', '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a00:1', '::ffff:c0a8:101', '::192.168.1.1', '::7f00:1', '::a00:1', '::808:808', '::ffff:0:192.168.1.1', '2002:c0a8:0101::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:2::1', '2001:20::1', '2001:2f::1', 'ff02::1', '[::1]', 'not-an-ip', ''])
  check('private/odd address refused: ' + ip, isPrivateAddress(ip) === true);
for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.183.14', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '::ffff:808:808', '2a00:1450:4009:81f::200e'])
  check('public address allowed: ' + ip, isPrivateAddress(ip) === false);

const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const rejects = async (href, lookup) => { try { await assertPublicUrl(href, { lookup: lookup || pub }); return null; } catch (e) { return e.message; } };

(async () => {
  for (const u of ['http://localhost:3000/api/state.js', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://printer.local/', 'http://nas.internal/', 'http://router/', 'http://user:pass@example.com/', 'ftp://example.com/', 'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'http://LOCALHOST./', 'http://100.64.1.1/'])
    check('refused: ' + u, /Only public|Invalid/.test(await rejects(u) || ''), await rejects(u));
  check('a normal public name is allowed', (await rejects('https://example.com/page?q=1')) === null);
  check('a name that resolves to a private address is refused (localtest.me style)', /Only public/.test(await rejects('http://sneaky.example.com/', async () => [{ address: '127.0.0.1', family: 4 }]) || ''));
  check('…even if only ONE of several addresses is private', /Only public/.test(await rejects('http://mixed.example.com/', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }]) || ''));
  check('a name that does not resolve gives a plain message', /Could not find/.test(await rejects('http://nope.example.com/', async () => { throw new Error('ENOTFOUND'); }) || ''));

  // safeFetch: redirects are followed by hand and each hop is checked
  const resp = (status, location, body) => ({ status, ok: status < 300, headers: { get: k => (k.toLowerCase() === 'location' ? location : null) }, text: async () => body || '' });
  let seen;
  const chain = map => async (url, init) => { (seen = seen || []).push([url, init.redirect, !!init.signal]); return map[url] || resp(404); };
  seen = []; let r = await safeFetch('https://a.example.com/start', {}, { lookup: pub, fetchImpl: chain({ 'https://a.example.com/start': resp(302, '/next'), 'https://a.example.com/next': resp(200, null, 'hello') }) });
  check('a normal redirect is followed (relative addresses too) and the final address is reported', r.status === 200 && r.finalUrl === 'https://a.example.com/next' && seen.length === 2, seen);
  check('every request is made with redirect:"manual" (the browser/runtime never follows on its own)', seen.every(s => s[1] === 'manual'), seen);
  check('public web requests receive an abort signal so stalled servers time out', seen.every(s => s[2] === true), seen);
  seen = []; let err = null;
  try { await safeFetch('https://a.example.com/start', {}, { lookup: pub, fetchImpl: chain({ 'https://a.example.com/start': resp(302, 'http://127.0.0.1:3000/api/state.js') }) }); } catch (e) { err = e.message; }
  check('a public page redirecting to this laptop is refused, and the laptop address is never requested', /Only public/.test(err || '') && seen.length === 1 && !seen.some(s => /127\.0\.0\.1/.test(s[0])), [err, seen]);
  seen = []; err = null;
  try { await safeFetch('https://a.example.com/start', {}, { lookup: async h => (h === 'evil.example.com' ? [{ address: '192.168.0.9', family: 4 }] : pub()), fetchImpl: chain({ 'https://a.example.com/start': resp(301, 'https://evil.example.com/x') }) }); } catch (e) { err = e.message; }
  check('a redirect to a NAME that resolves privately is refused too', /Only public/.test(err || '') && seen.length === 1, [err, seen]);
  seen = []; err = null;
  try { await safeFetch('https://a.example.com/loop', {}, { lookup: pub, maxHops: 3, fetchImpl: chain({ 'https://a.example.com/loop': resp(302, '/loop') }) }); } catch (e) { err = e.message; }
  check('a redirect loop stops after the hop limit', /too many/.test(err || '') && seen.length === 4, [err, seen.length]);
  seen = []; r = await safeFetch('https://a.example.com/gone', {}, { lookup: pub, fetchImpl: chain({ 'https://a.example.com/gone': resp(302, null) }) });
  check('a redirect with no Location is just returned (the caller sees the status)', r.status === 302);
  // readText: a size cap that stops the download, and text pages only
  const { readText } = require('../netsafe');
  let pulled = 0;
  const big = new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024))); } }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const txt = await readText(big, 200 * 1024);
  check('readText stops at the cap instead of downloading the whole page', txt.length === 200 * 1024 && pulled < 10, { len: txt.length, pulled });
  check('readText reads a normal page whole', (await readText(new Response('<p>héllo</p>', { headers: { 'content-type': 'text/html' } }))) === '<p>héllo</p>');
  check('readText accepts a page with no content type', (await readText(new Response('plain'))) === 'plain');
  const refused = async ct => { try { await readText(new Response('%PDF-1.4', { headers: { 'content-type': ct } })); return null; } catch (e) { return e.message; } };
  check('readText refuses a PDF', /Not a text page \(application\/pdf\)/.test(await refused('application/pdf')));
  check('readText refuses an image', /Not a text page/.test(await refused('image/png')));
  check('readText accepts XHTML and JSON', !(await refused('application/xhtml+xml')) && !(await refused('application/json')));
  console.log(`netsafe: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
