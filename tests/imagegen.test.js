// Image generation (imagegen.js): what counts as a picture, the requests to each service, saving with a note beside it, the routes.
// All with fake services; nothing leaves this machine. Run: node tests/imagegen.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const G = require(path.join(__dirname, '..', 'imagegen.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body-bytes')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body-bytes')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 fake')]);

/* ---------- is it really a picture? ---------- */
{
  const t = G.imageType;
  check('type: PNG, JPEG and WebP are recognised by their first bytes', t(PNG).ext === 'png' && t(PNG).mime === 'image/png' && t(JPG).ext === 'jpg' && t(WEBP).ext === 'webp' && t(WEBP).mime === 'image/webp');
  for (const [name, buf] of [['an HTML error page', Buffer.from('<!DOCTYPE html><html><body>Rate limit</body></html>')], ['a JSON error', Buffer.from('{"error":"nope","status":401}')], ['plain text', Buffer.from('hello world, not a picture')], ['an empty body', Buffer.alloc(0)], ['too short', Buffer.from([0x89, 0x50])], ['a GIF', Buffer.from('GIF89a......fake')], ['an SVG with a script', Buffer.from('<svg xmlns="x"><script>alert(1)</script></svg>')], ['an executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00')], ['RIFF but not WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt ')])]]) {
    check('type: ' + name + ' is not a picture', t(buf) === null);
  }
  check('type: null / undefined are handled', t(null) === null && t(undefined) === null);
}

/* ---------- the description ---------- */
{
  check('prompt: tidied (spaces, control characters)', G.cleanPrompt('  a  cat\u0000 on\nthe moon \t').prompt === 'a cat on the moon');
  check('prompt: too short and too long are refused with advice', /few words/.test(G.cleanPrompt('hi').error) && /few words/.test(G.cleanPrompt('').error) && /few words/.test(G.cleanPrompt(null).error) && /under 400/.test(G.cleanPrompt('x'.repeat(401)).error) && G.cleanPrompt('x'.repeat(400)).prompt.length === 400);
  check('style: added as plain words, unknown or none changes nothing', G.withStyle('a cat', 'anime') === 'a cat, anime style, clean line art, vibrant colours' && G.withStyle('a cat', 'nope') === 'a cat' && G.withStyle('a cat') === 'a cat');
  check('slug: safe file name from any text', G.slug('A cat on the Moon!') === 'a-cat-on-the-moon' && G.slug('../../etc/passwd') === 'etc-passwd' && G.slug('C:\\Windows\\x') === 'c-windows-x' && G.slug('') === 'image' && G.slug('x'.repeat(100)).length === 40);
}

/* ---------- what went wrong, in plain words ---------- */
{
  const e = (s, body, key, ra) => G.explainFailure('pollinations', s, body, key, ra);
  check('failure: no key → says a free key is needed, where to get it and where to put it', e(401, '', false).code === 'key' && /needs a free key/.test(e(401, '', false).error) && /enter\.pollinations\.ai/.test(e(401, '', false).error) && /Settings → IMAGE SERVICE/.test(e(403, '', false).error));
  check('failure: a key that is rejected', /rejected the key I have/.test(e(401, '', true).error));
  check('failure: out of credit, rate limited (with the wait), bad prompt, server trouble, anything else', e(402, '{"error":"no pollen"}', true).code === 'credit' && /no pollen/.test(e(402, '{"error":"no pollen"}', true).error) && /about 12 seconds/.test(e(429, '', true, '12').error) && /in a minute/.test(e(429, '', true).error) && e(400, '{"error":{"message":"prompt blocked"}}', true).code === 'bad' && /prompt blocked/.test(e(400, '{"error":{"message":"prompt blocked"}}', true).error) && e(503, '', true).code === 'server' && e(418, 'teapot', true).code === 'other');
  check('failure: markup in an error body is stripped, and it is shortened', !/<|>/.test(e(500, '<html><b>Oops</b>' + 'x'.repeat(500) + '</html>', true).error) && e(402, 'y'.repeat(900), true).error.length < 300);
}

/* ---------- the requests ---------- */
{
  const P = G.SERVICES.pollinations, L = G.SERVICES.local;
  let r = P.request({ prompt: 'a cat/dog? #1 ../../x ü', width: 1024, height: 768, seed: 42, key: 'sk_secret' });
  const u = new URL(r.url);
  check('pollinations: the description is one URL-encoded path piece (no / ? # or ..)', u.origin === 'https://gen.pollinations.ai' && u.pathname.startsWith('/image/') && u.pathname.split('/').length === 3 && !u.hash && decodeURIComponent(u.pathname.slice(7)) === 'a cat/dog? #1 ../../x ü', r.url);
  check('pollinations: size and seed as query parameters; the key only in a header, never in the address', u.searchParams.get('width') === '1024' && u.searchParams.get('height') === '768' && u.searchParams.get('seed') === '42' && !r.url.includes('sk_secret') && r.init.headers.Authorization === 'Bearer sk_secret' && r.init.method === 'GET');
  check('pollinations: no key → no Authorization header', !('Authorization' in P.request({ prompt: 'x y z', width: 1, height: 1, seed: 1 }).init.headers));
  r = L.request({ prompt: 'a cat', width: 1024, height: 1024, seed: 7 });
  const body = JSON.parse(r.init.body);
  check('local: posts to this PC only; the size is limited to what a small GPU can do', r.url === 'http://127.0.0.1:7860/sdapi/v1/txt2img' && r.init.method === 'POST' && body.prompt === 'a cat' && body.width === 768 && body.height === 768 && body.seed === 7 && body.steps === 20);
}

/* ---------- one picture from one service ---------- */
const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => Uint8Array.from(Buffer.from(body || '')).buffer, text: async () => (Buffer.isBuffer(body) ? body.toString('latin1') : String(body || '')), json: async () => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)) });
const asBuf = b => (Buffer.isBuffer(b) ? b : Buffer.from(b));
(async () => {
  const fx = (status, body, headers) => async () => { const r = res(status, body, headers); if (Buffer.isBuffer(body)) r.arrayBuffer = async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); return r; };
  const base = { prompt: 'a cat', width: 1024, height: 1024, seed: 1 };
  let r = await G.requestImage('pollinations', base, fx(200, PNG));
  check('request: a real PNG comes back with its type', r.buf.equals(PNG) && r.type.ext === 'png');
  r = await G.requestImage('pollinations', base, fx(200, Buffer.from('<html>Please sign in</html>')));
  check('request: a 200 that is not a picture is refused, and says so', r.code === 'notimage' && /not with a picture/.test(r.error) && /saved nothing/.test(r.error));
  check('request: 401 without a key → "needs a key"; with one → "rejected"', (await G.requestImage('pollinations', base, fx(401, ''))).code === 'key' && /rejected/.test((await G.requestImage('pollinations', { ...base, key: 'k' }, fx(401, ''))).error));
  r = await G.requestImage('pollinations', base, fx(429, '', { 'retry-after': '30' }));
  check('request: 429 passes on the wait time', r.code === 'rate' && /about 30 seconds/.test(r.error));
  r = await G.requestImage('pollinations', base, async () => { throw new Error('getaddrinfo ENOTFOUND gen.pollinations.ai'); });
  check('request: no internet is explained', r.code === 'network' && /internet connection/.test(r.error));
  r = await G.requestImage('pollinations', base, async () => { throw new Error('The operation was aborted due to timeout'); });
  check('request: a timeout is explained', r.code === 'network' && /took too long/.test(r.error));
  r = await G.requestImage('local', base, async () => { throw new Error('fetch failed'); });
  check('request: local service not running is explained', /127\.0\.0\.1:7860/.test(r.error) && /API turned on/.test(r.error));
  r = await G.requestImage('pollinations', base, fx(200, PNG, { 'content-length': String(G.MAX_BYTES + 1) }));
  check('request: a declared size over 10 MB is refused before reading', r.code === 'big');
  const bigBody = Buffer.concat([PNG, Buffer.alloc(G.MAX_BYTES, 1)]);
  check('request: a body over 10 MB is refused even if the header lied', (await G.requestImage('pollinations', base, fx(200, bigBody))).code === 'big');
  let seenInit; await G.requestImage('pollinations', base, async (url, init) => { seenInit = init; return fx(200, PNG)(); });
  check('request: redirects are not followed and there is a time limit', seenInit.redirect === 'error' && seenInit.signal instanceof AbortSignal);
  r = await G.requestImage('local', base, async () => res(200, JSON.stringify({ images: [PNG.toString('base64')] })));
  check('request: local service replies with base64 images', r.type && r.type.ext === 'png' && r.buf.equals(PNG), r);
  check('request: local service with no image in the reply is refused', (await G.requestImage('local', base, async () => res(200, JSON.stringify({ images: [] })))).code === 'notimage' && (await G.requestImage('local', base, async () => res(200, JSON.stringify({ images: [Buffer.from('not an image at all, sorry').toString('base64')] })))).code === 'notimage');

  /* ---------- saving ---------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
  const out = path.join(tmp, 'Images');
  let seeds = [101, 102, 103, 104], calls = [];
  const rand = () => seeds.shift();
  const okFetch = async (url, init) => { calls.push(url); return fx(200, PNG)(); };
  let g = await G.generate({ prompt: 'a cat on the moon', service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false, now: () => new Date('2026-10-08T12:00:00Z') });
  check('generate: one picture saved as <description>-<seed>.png in the Images folder', g.images.length === 1 && path.basename(g.images[0].file) === 'a-cat-on-the-moon-101.png' && fs.readFileSync(g.images[0].file).equals(PNG) && g.images[0].seed === 101 && g.images[0].bytes === PNG.length, g);
  const note = JSON.parse(fs.readFileSync(path.join(out, 'a-cat-on-the-moon-101.json'), 'utf8'));
  check('generate: a note beside it — prompt, what was sent, seed, size, service, time', note.prompt === 'a cat on the moon' && note.sentPrompt === 'a cat on the moon' && note.expanded === false && note.seed === 101 && note.width === 1024 && note.height === 1024 && note.service === 'pollinations' && note.serviceLabel === 'Pollinations' && note.createdAt === '2026-10-08T12:00:00.000Z' && note.bytes === PNG.length && note.type === 'image/png' && /not every model honours/.test(note.seedNote), note);
  seeds = [201, 202, 203, 204]; calls = [];
  g = await G.generate({ prompt: 'a red fox', expanded: 'a red fox in a snowy forest, golden hour, detailed fur', style: 'watercolor', shape: 'landscape', n: 3, service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false });
  check('generate: three pictures, each with its own seed; the expanded prompt and the style are what is sent', g.images.length === 3 && g.images.map(i => i.seed).join() === '201,202,203' && calls.every(u => decodeURIComponent(u).includes('a red fox in a snowy forest, golden hour, detailed fur, watercolour painting')) && g.width === 1024 && g.height === 768 && calls.every(u => /width=1024&height=768/.test(u)), calls);
  const note2 = JSON.parse(fs.readFileSync(path.join(out, 'a-red-fox-201.json'), 'utf8'));
  check('generate: the note keeps YOUR words as the prompt, and records that it was expanded', note2.prompt === 'a red fox' && note2.expanded === true && /snowy forest/.test(note2.sentPrompt) && note2.style === 'watercolor' && note2.shape === 'landscape');
  seeds = [101]; g = await G.generate({ prompt: 'a cat on the moon', service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false });
  check('generate: the same name never overwrites an earlier picture', path.basename(g.images[0].file) === 'a-cat-on-the-moon-101-2.png' && fs.existsSync(path.join(out, 'a-cat-on-the-moon-101.png')));
  seeds = [1, 2, 3, 4, 5, 6]; calls = [];
  g = await G.generate({ prompt: 'many cats', n: 99, service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false });
  check('generate: at most 4 at a time; 0 or junk means 1', g.images.length === 4 && (seeds = [7], (await G.generate({ prompt: 'one cat', n: 0, service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false })).images.length === 1) && (seeds = [8], (await G.generate({ prompt: 'one dog', n: 'abc', service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false })).images.length === 1));
  seeds = [11, 12, 13]; let k = 0;
  g = await G.generate({ prompt: 'rate limited cats', n: 3, service: 'pollinations', dir: out, fetchImpl: async () => (++k === 2 ? fx(429, '', { 'retry-after': '20' })() : fx(200, PNG)()), rand, gap: false });
  check('generate: when the service starts limiting after the first picture, you still get that one, and the reason', g.images.length === 1 && g.errors.length === 1 && g.errors[0].code === 'rate' && k === 2, g);
  seeds = [21, 22]; k = 0;
  g = await G.generate({ prompt: 'one bad reply', n: 2, service: 'pollinations', dir: out, fetchImpl: async () => (++k === 1 ? fx(200, Buffer.from('<html>oops</html>'))() : fx(200, PNG)()), rand, gap: false });
  check('generate: a reply that is not a picture is skipped (nothing written) and the next one is tried', g.images.length === 1 && g.errors[0].code === 'notimage' && fs.readdirSync(out).filter(f => /^one-bad-reply-21/.test(f)).length === 0);
  g = await G.generate({ prompt: 'needs a key', service: 'pollinations', dir: out, fetchImpl: fx(401, ''), rand: () => 31, gap: false });
  check('generate: no key → no pictures, the first error says what to do; nothing written', g.images.length === 0 && g.errors[0].code === 'key' && !fs.readdirSync(out).some(f => /needs-a-key/.test(f)));
  check('generate: bad input is refused before any request', (await G.generate({ prompt: 'hi', service: 'pollinations', dir: out, fetchImpl: okFetch })).status === 400 && (await G.generate({ prompt: 'a fine prompt', service: 'nope', dir: out, fetchImpl: okFetch })).status === 400);
  seeds = [41]; calls = [];
  g = await G.generate({ prompt: '../../Windows/evil\\name', service: 'pollinations', dir: out, fetchImpl: okFetch, rand, gap: false });
  check('generate: a hostile description cannot place a file outside the Images folder', g.images.length === 1 && path.dirname(g.images[0].file) === out && path.basename(g.images[0].file) === 'windows-evil-name-41.png');
  seeds = [51]; const wp = await G.generate({ prompt: 'webp cat', service: 'pollinations', dir: out, fetchImpl: fx(200, WEBP), rand, gap: false });
  check('generate: the file extension follows the real picture type', path.extname(wp.images[0].file) === '.webp');
  let t0 = Date.now(); seeds = [61, 62];
  await G.generate({ prompt: 'two quick ones', n: 2, service: 'local', dir: out, fetchImpl: async () => res(200, JSON.stringify({ images: [PNG.toString('base64')] })), rand });
  check('generate: the local service needs no waiting between pictures', Date.now() - t0 < 1500);

  /* ---------- routes ---------- */
  const routes = {}, app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const config = {}; let saved = 0; const opened = [];
  let localUp = false, hostedMode = 'ok';
  const fetchImpl = async (url, init) => {
    if (/7860\/sdapi\/v1\/options/.test(url)) { if (!localUp) throw new Error('refused'); return res(200, '{}'); }
    if (/7860\/sdapi\/v1\/txt2img/.test(url)) return res(200, JSON.stringify({ images: [PNG.toString('base64')] }));
    if (hostedMode === 'key') return res(401, '');
    return fx(200, PNG)();
  };
  const sandbox = path.join(tmp, 'sandbox'); fs.mkdirSync(sandbox);
  G(app, { getConfig: () => config, saveConfig: () => { saved++; }, SANDBOX: sandbox, rel: p => path.relative(sandbox, p).split(path.sep).join('/'), openPath: p => opened.push(p), fetchImpl });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (key, req) => { let o, code = 200; await routes[key]({ headers: {}, body: {}, query: {}, ...req }, { json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  let s = await call('GET /api/image/status');
  check('status: the service, whether a key is saved, whether a local one is running', s.success && s.service.id === 'pollinations' && s.service.keyUrl === 'https://enter.pollinations.ai' && s.hasKey === false && s.local === false && /Images$/.test(s.folder), s);
  check('key: only from JARVIS on the laptop', (await call('POST /api/image/key', { body: { apiKey: 'abc' } })).code === 403 && (await call('POST /api/image/key', { headers: { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' }, body: { apiKey: 'abc' } })).code === 403 && !config.imageService);
  check('key: odd keys are refused', (await call('POST /api/image/key', { headers: LAPTOP, body: { apiKey: 'has space' } })).code === 400 && (await call('POST /api/image/key', { headers: LAPTOP, body: { apiKey: 'x'.repeat(301) } })).code === 400);
  let kr = await call('POST /api/image/key', { headers: LAPTOP, body: { apiKey: ' "sk_live_abc123" ' } });
  check('key: saved (quotes and spaces trimmed), and the answer never contains it', kr.success && kr.hasKey && config.imageService.apiKey === 'sk_live_abc123' && saved === 1 && !JSON.stringify(kr).includes('abc123'));
  s = await call('GET /api/image/status');
  check('status: says a key is saved without showing it', s.hasKey === true && !JSON.stringify(s).includes('abc123'));
  let usedAuth = null; const innerFetch = fetchImpl;
  G(app, { getConfig: () => config, saveConfig: () => {}, SANDBOX: sandbox, rel: p => p, openPath: () => {}, fetchImpl: async (u, i) => { if (/gen\.pollinations/.test(u)) usedAuth = i.headers.Authorization; return innerFetch(u, i); } });
  await call('POST /api/image/generate', { body: { online: true, prompt: 'auth check cat', service: 'pollinations', open: false } });
  check('generate: the saved key is sent as a bearer token', usedAuth === 'Bearer sk_live_abc123', usedAuth);
  G(app, { getConfig: () => config, saveConfig: () => { saved++; }, SANDBOX: sandbox, rel: p => path.relative(sandbox, p).split(path.sep).join('/'), openPath: p => opened.push(p), fetchImpl });
  kr = await call('POST /api/image/key', { headers: LAPTOP, body: { apiKey: '' } });
  check('key: an empty key removes it', kr.success && kr.hasKey === false && !config.imageService);

  check('generate: the hosted service needs Online tools', (await call('POST /api/image/generate', { body: { prompt: 'a cat on the moon', service: 'pollinations' } })).code === 403);
  let r2 = await call('POST /api/image/generate', { body: { online: true, prompt: 'a cat on the moon', n: 2 } });
  check('generate: success — files relative to ~/jarvis, seeds, sizes, the service, and the first one is opened', r2.code === 200 && r2.success && r2.service === 'pollinations' && r2.images.length === 2 && /^Images\/a-cat-on-the-moon-\d+\.png$/.test(r2.images[0].file) && r2.images[0].path && r2.partial === false && opened.length === 1 && opened[0].endsWith('.png'), r2);
  r2 = await call('POST /api/image/generate', { body: { online: true, prompt: 'a cat on the moon', open: false } });
  check('generate: open:false does not open', opened.length === 1);
  check('generate: bad shape and unknown style are 400s that list the choices', (await call('POST /api/image/generate', { body: { online: true, prompt: 'a cat on the moon', shape: 'huge' } })).code === 400 && /anime/.test((await call('POST /api/image/generate', { body: { online: true, prompt: 'a cat on the moon', style: 'nope' } })).error));
  check('generate: bad descriptions are 400s', (await call('POST /api/image/generate', { body: { online: true, prompt: 'x' } })).code === 400 && (await call('POST /api/image/generate', { body: { online: true } })).code === 400);
  hostedMode = 'key';
  r2 = await call('POST /api/image/generate', { body: { online: true, prompt: 'a cat on the moon', service: 'pollinations' } });
  check('generate: when the service wants a key, the answer is a 401 with needsKey and where to get one', r2.code === 401 && r2.needsKey === true && r2.keyUrl === 'https://enter.pollinations.ai' && /Settings → IMAGE SERVICE/.test(r2.error), r2);
  hostedMode = 'ok'; localUp = true;
  s = await call('GET /api/image/status'); check('status: a running local Stable Diffusion is noticed (briefly remembered)', s.local === false);
  localUp = true;
  const app3 = { get: (p, h) => { routes['3GET ' + p] = h; }, post: (p, h) => { routes['3POST ' + p] = h; } };
  G(app3, { getConfig: () => ({}), saveConfig() {}, SANDBOX: sandbox, rel: p => p, openPath() {}, fetchImpl });
  const call3 = async (key, req) => { let o, code = 200; await routes[key]({ headers: {}, body: {}, ...req }, { json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  const st3 = await call3('3GET /api/image/status');
  check('status: with a local service running, it says so', st3.local === true);
  const g3 = await call3('3POST /api/image/generate', { body: { prompt: 'local only cat' } });
  check('generate: with a local service running and no Online tools, it is used and nothing leaves the PC', g3.code === 200 && g3.service === 'local' && g3.images.length === 1);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`imagegen: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
