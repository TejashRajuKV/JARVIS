'use strict';
/* "Draw me …": text to image through an image service, saved as a file with a small .json note beside it (the prompt, the seed,
   the size, the service), then opened. Two services: a hosted one (Pollinations, https://gen.pollinations.ai/image/<prompt>; it may need
   a free key, kept on this laptop in ~/jarvis/.config.json) and, if you already run one, a local Automatic1111 / Forge on this PC.
   JARVIS installs nothing. Whatever a service sends back is checked by its file signature (PNG, JPEG or WebP, 10 MB at most) before
   it is written, so an error page can never end up saved as a picture. Pure helpers are exported for tests. */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 10 * 1024 * 1024, MAX_PROMPT = 400, MAX_N = 4;
const SHAPES = { square: [1024, 1024], portrait: [768, 1024], landscape: [1024, 768] };
const STYLES = {
  photo: 'photorealistic, natural light, sharp focus', anime: 'anime style, clean line art, vibrant colours', watercolor: 'watercolour painting, soft washes, paper texture', pixel: 'pixel art, limited palette, crisp pixels',
  sketch: 'pencil sketch, hand drawn, cross-hatching', '3d': '3D render, soft studio lighting', logo: 'flat vector logo, simple shapes, plain background', cartoon: 'cartoon illustration, bold outlines', oil: 'oil painting, visible brush strokes',
};
const SERVICES = {
  pollinations: {
    label: 'Pollinations', host: 'gen.pollinations.ai', keyUrl: 'https://enter.pollinations.ai', hosted: true,
    // GET https://gen.pollinations.ai/image/<prompt>?width=&height=&seed=  (+ Authorization: Bearer <key> when you have one)
    request({ prompt, width, height, seed, key }) {
      const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed) });
      return { url: 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt) + '?' + q, init: { method: 'GET', headers: Object.assign({ 'User-Agent': 'JARVIS-local-assistant' }, key ? { Authorization: 'Bearer ' + key } : {}) } };
    },
    async read(res) { return Buffer.from(await res.arrayBuffer()); },
    gapMs: 2000,
  },
  local: {
    label: 'Your local Stable Diffusion (Automatic1111 / Forge)', host: '127.0.0.1:7860', hosted: false,
    request({ prompt, width, height, seed }) {
      return { url: 'http://127.0.0.1:7860/sdapi/v1/txt2img', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, width: Math.min(width, 768), height: Math.min(height, 768), seed, steps: 20 }) } };
    },
    async read(res) { const j = await res.json(); return j && Array.isArray(j.images) && j.images[0] ? Buffer.from(String(j.images[0]).replace(/^data:[^,]*,/, ''), 'base64') : Buffer.alloc(0); },
    gapMs: 0,
  },
};

/* ---------- pure helpers ---------- */
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
// What the bytes really are, from their first bytes (never from a header or a file name the service chose).
function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
function cleanPrompt(s) {
  const t = String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 3) return { error: 'Describe the picture in a few words, e.g. “a cat astronaut on the moon”.' };
  if (t.length > MAX_PROMPT) return { error: 'That description is ' + t.length + ' characters; keep it under ' + MAX_PROMPT + '.' };
  return { prompt: t };
}
const withStyle = (prompt, style) => (STYLES[style] ? prompt + ', ' + STYLES[style] : prompt);
// A service's reply that is not an image → one plain sentence about what went wrong and what to do.
function explainFailure(service, status, bodyText, hasKey, retryAfter) {
  const label = SERVICES[service].label;
  let detail = String(bodyText || '');
  try { const j = JSON.parse(detail); detail = (j.error && (j.error.message || j.error)) || j.message || detail; } catch {}
  detail = String(detail).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (status === 401 || status === 403) return { code: 'key', error: hasKey ? label + ' rejected the key I have (' + status + '). Save a new one in Settings → IMAGE SERVICE.' : label + ' needs a free key to make images (' + status + '). Create one at ' + SERVICES[service].keyUrl + ' and save it in Settings → IMAGE SERVICE.' };
  if (status === 402) return { code: 'credit', error: label + ' says the account is out of credit' + (detail ? ': ' + detail : '') + '.' };
  if (status === 429) return { code: 'rate', error: label + ' is limiting how fast I can ask' + (retryAfter ? ' — try again in about ' + retryAfter + ' seconds' : ' — try again in a minute') + '.' };
  if (status === 400 || status === 422) return { code: 'bad', error: label + ' didn’t accept that description' + (detail ? ': ' + detail : '') + '. Try rewording it.' };
  if (status >= 500) return { code: 'server', error: label + ' is having trouble right now (' + status + '). Try again later.' };
  return { code: 'other', error: label + ' answered with ' + status + (detail ? ': ' + detail : '') + '.' };
}

/* ---------- one image from one service (fetch is injectable) ---------- */
async function requestImage(service, params, fetchImpl = fetch, timeoutMs = 90000) {
  const svc = SERVICES[service];
  const { url, init } = svc.request(params);
  let res;
  try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
  catch (e) { return { code: 'network', error: (/timeout|abort/i.test(e.message) ? svc.label + ' took too long to answer.' : service === 'local' ? 'I can’t reach your local Stable Diffusion on 127.0.0.1:7860. Is it running with the API turned on?' : 'I can’t reach ' + svc.label + ' (' + String(e.message).slice(0, 60) + '). Check your internet connection.') }; }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return explainFailure(service, res.status, body, !!params.key, res.headers && res.headers.get && res.headers.get('retry-after'));
  }
  const declared = +(res.headers && res.headers.get && res.headers.get('content-length')) || 0;
  if (declared > MAX_BYTES) return { code: 'big', error: 'The picture is larger than ' + MAX_BYTES / 1048576 + ' MB, so I didn’t take it.' };
  let buf;
  try { buf = await svc.read(res); } catch { return { code: 'other', error: svc.label + ' sent something I could not read.' }; }
  if (buf.length > MAX_BYTES) return { code: 'big', error: 'The picture is larger than ' + MAX_BYTES / 1048576 + ' MB, so I didn’t take it.' };
  const type = imageType(buf);
  if (!type) return { code: 'notimage', error: svc.label + ' answered, but not with a picture. It may need a key or be busy. I saved nothing.' };
  return { buf, type };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// → { images: [{ file, path, seed, bytes, type }], errors: [..] }
async function generate({ prompt, expanded, shape = 'square', style, n = 1, service, key, dir, fetchImpl, rand = () => Math.floor(Math.random() * 2 ** 31), gap = true, now = () => new Date() }) {
  const p = cleanPrompt(expanded || prompt);
  if (p.error) return { error: p.error, status: 400 };
  const orig = cleanPrompt(prompt || expanded);
  if (!SERVICES[service]) return { error: 'Unknown image service.', status: 400 };
  const [width, height] = SHAPES[shape] || SHAPES.square;
  const count = Math.max(1, Math.min(MAX_N, Math.round(+n) || 1));
  const finalPrompt = withStyle(p.prompt, style);
  fs.mkdirSync(dir, { recursive: true });
  const images = [], errors = [];
  for (let i = 0; i < count; i++) {
    if (i > 0 && gap && SERVICES[service].gapMs) await sleep(SERVICES[service].gapMs);
    const seed = rand();
    const r = await requestImage(service, { prompt: finalPrompt, width, height, seed, key }, fetchImpl);
    if (r.error) { errors.push({ code: r.code, error: r.error }); if (['key', 'credit', 'rate', 'network', 'server', 'bad'].includes(r.code)) break; continue; }
    const base = slug(orig.prompt || p.prompt) + '-' + seed;
    let file = path.join(dir, base + '.' + r.type.ext), k = 2;
    while (fs.existsSync(file)) file = path.join(dir, base + '-' + (k++) + '.' + r.type.ext);
    fs.writeFileSync(file, r.buf);
    fs.writeFileSync(file.replace(/\.\w+$/, '.json'), JSON.stringify({ prompt: orig.prompt || p.prompt, sentPrompt: finalPrompt, expanded: !!expanded && expanded !== prompt, style: style || null, shape, width, height, seed, seedNote: 'The seed is sent with the request; not every model honours it.', service, serviceLabel: SERVICES[service].label, createdAt: now().toISOString(), bytes: r.buf.length, type: r.type.mime }, null, 1));
    images.push({ file, seed, bytes: r.buf.length, type: r.type.mime });
  }
  return { images, errors, sentPrompt: finalPrompt, width, height };
}

/* ---------- local service probe ---------- */
async function probeLocal(fetchImpl = fetch) {
  try { const r = await fetchImpl('http://127.0.0.1:7860/sdapi/v1/options', { signal: AbortSignal.timeout(800) }); return !!r.ok; } catch { return false; }
}

/* ---------- routes ---------- */
module.exports = function setupImages(app, { getConfig, saveConfig, SANDBOX, rel, openPath, fetchImpl }) {
  const dir = path.join(SANDBOX, 'Images');
  const cfg = () => { const c = getConfig(); return (c.imageService && typeof c.imageService === 'object') ? c.imageService : {}; };
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  let localCache = { at: 0, ok: false };
  const localUp = async () => { if (Date.now() - localCache.at > 30000) localCache = { at: Date.now(), ok: await probeLocal(fetchImpl) }; return localCache.ok; };

  app.get('/api/image/status', async (req, res) => {
    const c = cfg(), local = await localUp();
    res.json({ success: true, service: { id: 'pollinations', label: SERVICES.pollinations.label, host: SERVICES.pollinations.host, keyUrl: SERVICES.pollinations.keyUrl }, hasKey: !!c.apiKey, local, folder: dir });
  });
  // The key is typed into Settings on the laptop and never sent back to a page (only "a key is saved").
  app.post('/api/image/key', (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Change this from JARVIS on the laptop.' });
    const key = String((req.body || {}).apiKey || '').trim().replace(/^["']|["']$/g, '');
    if (key.length > 300 || /[\s\u0000-\u001f]/.test(key)) return res.status(400).json({ error: 'That doesn’t look like a key. Copy it again without spaces.' });
    const c = getConfig();
    if (!key) { delete c.imageService; saveConfig(); return res.json({ success: true, hasKey: false }); }
    c.imageService = { id: 'pollinations', apiKey: key, savedAt: Date.now() };
    saveConfig();
    res.json({ success: true, hasKey: true });
  });
  app.post('/api/image/generate', async (req, res) => {
    const b = req.body || {};
    const want = String(b.service || '');
    let service = SERVICES[want] ? want : (await localUp()) ? 'local' : 'pollinations';
    if (SERVICES[service].hosted && !b.online) return res.status(403).json({ error: 'offline' });
    if (b.shape !== undefined && !SHAPES[b.shape]) return res.status(400).json({ error: 'Shape can be square, portrait or landscape.' });
    if (b.style && !STYLES[b.style]) return res.status(400).json({ error: 'I know these styles: ' + Object.keys(STYLES).join(', ') + '.' });
    const r = await generate({ prompt: b.prompt, expanded: b.expanded, shape: b.shape, style: b.style, n: b.n, service, key: cfg().apiKey, dir, fetchImpl });
    if (r.error) return res.status(r.status || 500).json({ error: r.error });
    if (!r.images.length) {
      const e = r.errors[0] || { error: 'No picture came back.', code: 'other' };
      return res.status(e.code === 'key' ? 401 : e.code === 'rate' ? 429 : 502).json({ error: e.error, reason: e.code, needsKey: e.code === 'key', keyUrl: SERVICES[service].keyUrl, service });
    }
    if (b.open !== false && openPath) openPath(r.images[0].file);
    res.json({ success: true, service, serviceLabel: SERVICES[service].label, sentPrompt: r.sentPrompt, width: r.width, height: r.height, folder: dir, images: r.images.map(i => ({ file: rel ? rel(i.file) : i.file, path: i.file, seed: i.seed, bytes: i.bytes, type: i.type })), errors: r.errors, partial: r.errors.length > 0 });
  });
};
Object.assign(module.exports, { imageType, cleanPrompt, withStyle, explainFailure, requestImage, generate, probeLocal, SERVICES, SHAPES, STYLES, MAX_BYTES, MAX_PROMPT, MAX_N, slug });
