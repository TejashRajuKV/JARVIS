'use strict';
const https = require('node:https');
const { lookup } = require('node:dns').promises;
const { createHash } = require('node:crypto');
const { Transform, pipeline } = require('node:stream');
const { privateIp, pinLookup } = require('./calendar');

// Official Akashvani streams, including the exact CDN directories used by the Waves player.
const waves = (host, id) => 'https://' + host + '.cloudfront.net/' + id + '/' + id + '.m3u8';
const stationUrls = new Map([
  [117, 'https://d3r9rhourdc02u.cloudfront.net/assets/radio/airbang02/air034_Auto.m3u8'],
  [297, waves('d3hrxqn1tritdh', 'b20ff2fc0bb34b3d')],
  [241, waves('d1cvqgmbcpg5yn', '84ad819b3f45dc08')],
  [3, 'https://d3r9rhourdc02u.cloudfront.net/assets/radio/airdelhi02/air002_Auto.m3u8'],
  [2, 'https://d3r9rhourdc02u.cloudfront.net/assets/radio/airdelhi03/air003_Auto.m3u8'],
  [256, waves('d1cvqgmbcpg5yn', '3a02c5c035815bb9')],
  [257, waves('d1tmej9eu7kw5c', '89969ad91f106dde')],
  [50, waves('d1cvqgmbcpg5yn', 'bad174fd7eac38d0')],
  [51, waves('d3hrxqn1tritdh', '0beac8e921bbfdbb')],
]);
const opaqueId = text => createHash('sha256').update(text).digest('hex').slice(0, 32);
const httpsUrl = raw => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.local'))
    throw new Error('Use a public HTTPS media address.');
  return url;
};

async function requestPublic(raw, { accept, range, signal, allow = () => true, maxRedirects = 3 }, redirects = 0) {
  const url = httpsUrl(raw);
  if (!allow(url)) throw new Error('The stream left its permitted source.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => privateIp(entry.address))) throw new Error('Private media addresses are not supported.');
  const options = {
    lookup: pinLookup(addresses[0]), signal, timeout: 12000,
    headers: { Accept: accept, 'User-Agent': 'JARVIS/1.0 (Personal media player)', ...(range ? { Range: range } : {}) },
  };
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, options, resolve);
    req.once('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Media source timed out.')));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.destroy();
    if (redirects >= maxRedirects || !response.headers.location) throw new Error('Too many media redirects.');
    return requestPublic(new URL(response.headers.location, url).href, { accept, range, signal, allow, maxRedirects }, redirects + 1);
  }
  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.destroy(); throw new Error('Media source returned HTTP ' + response.statusCode + '.');
  }
  return { response, url };
}
async function readLimited(response, maxBytes, itemLimit = 0) {
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0, items = 0, tail = '';
  for await (const part of response) {
    bytes += part.length;
    if (bytes > maxBytes) throw new Error('The media document is too large.');
    const text = decoder.decode(part, { stream: true });
    parts.push(text);
    if (itemLimit) {
      const window = tail + text;
      const lower = window.toLowerCase();
      let end = 0, next;
      while ((next = lower.indexOf('</item>', end)) >= 0) {
        end = next + 7;
        if (++items >= itemLimit) return parts.slice(0, -1).join('') + text.slice(0, end - tail.length);
      }
      tail = window.slice(Math.max(end, window.length - 6));
    }
  }
  return parts.join('') + decoder.decode();
}
const safeText = text => String(text || '').trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  .replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, key) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }[key])).replace(/\s+/g, ' ').trim();
function readPodcast(xml, feedUrl) {
  if (!/<rss\b/i.test(xml) || /<!DOCTYPE/i.test(xml)) throw new Error('This URL did not return a supported podcast RSS feed.');
  const tag = (source, name) => safeText(source.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'))?.[1]);
  const title = tag(xml, 'title').slice(0, 180) || new URL(feedUrl).hostname;
  const byId = new Map();
  for (const [, entry] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const enclosure = /<enclosure\b([^>]*)>/i.exec(entry)?.[1] || '';
    const attr = name => safeText(enclosure.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'))?.[2]);
    const location = attr('url');
    const name = tag(entry, 'title').slice(0, 200);
    try {
      if (!location || !name) continue;
      const candidate = new URL(location, feedUrl);
      if (candidate.protocol === 'http:' && !candidate.port) candidate.protocol = 'https:';
      if (candidate.hostname === 'open.live.bbc.co.uk' && candidate.pathname.startsWith('/mediaselector/6/redir/'))
        candidate.pathname = candidate.pathname.replace('/proto/http/', '/proto/https/');
      const url = httpsUrl(candidate.href);
      const type = attr('type').toLowerCase();
      if (!type.startsWith('audio/') && !/\.(mp3|aac|m4a|ogg|opus|wav)$/i.test(url.pathname)) continue;
      const id = opaqueId(feedUrl + '\n' + (tag(entry, 'guid') || url.href));
      const date = Date.parse(tag(entry, 'pubDate'));
      byId.set(id, { id, name, url: url.href, type: type.startsWith('audio/') ? type : 'audio/mpeg', released: Number.isFinite(date) ? date : 0 });
      if (byId.size >= 60) break;
    } catch {}
  }
  return { title, episodes: [...byId.values()] };
}
function rewriteManifest(content, base, allow, remember) {
  if (!/^#EXTM3U(?:\r?\n|$)/.test(content) || /#EXT-X-(?:KEY|SESSION-KEY|CONTENT-STEERING|DEFINE):/i.test(content))
    throw new Error('This broadcast requires an unsupported playlist feature.');
  const reference = value => {
    const url = httpsUrl(new URL(value, base).href);
    if (!allow(url)) throw new Error('The playlist left the broadcaster’s source.');
    return remember(url.href);
  };
  return content.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return reference(trimmed);
    return line.replace(/\bURI="([^"]+)"/gi, (_, url) => 'URI="' + reference(url) + '"');
  }).join('\n');
}
function register(app, { fetchMedia = requestPublic } = {}) {
  const episodes = new Map(), radioParts = new Map();
  function keep(map, id, data, max) {
    map.delete(id); map.set(id, data);
    if (map.size > max) map.delete(map.keys().next().value);
  }
  function watch(res, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    res.once('close', () => { clearTimeout(timer); controller.abort(); });
    return controller.signal;
  }
  const noCache = res => res.setHeader('Cache-Control', 'no-store');
  function stream(res, response, type, limit) {
    if (Number(response.headers['content-length']) > limit) {
      response.destroy(); return res.status(413).json({ error: 'This media item is too large.' });
    }
    res.status(response.statusCode);
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      if (response.headers[name]) res.setHeader(name, response.headers[name]);
    }
    let bytes = 0;
    const bounded = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) callback(new Error('Media limit exceeded.'));
      else callback(null, chunk);
    } });
    pipeline(response, bounded, res, () => {});
  }
  app.get('/api/media/hls.js', (_req, res) => res.sendFile(require.resolve('hls.js/dist/hls.light.min.js')));
  app.post('/api/media/podcast', async (req, res) => {
    noCache(res);
    if (req.body?.online !== true) return res.status(400).json({ error: 'Enable Online tools to load podcast feeds.' });
    try {
      const feed = httpsUrl(String(req.body.url || '').slice(0, 2000)).href;
      const { response } = await fetchMedia(feed, { accept: 'application/rss+xml, application/xml, text/xml', signal: watch(res, 15000) });
      const data = readPodcast(await readLimited(response, 4 * 1024 * 1024, 60), feed);
      for (const entry of data.episodes) keep(episodes, entry.id, entry, 1200);
      res.json({ title: data.title, episodes: data.episodes.map(({ id, name, released }) => ({ id, name, released })) });
    } catch (error) { if (!res.destroyed) res.status(502).json({ error: error.message }); }
  });
  app.get('/api/media/episode/:id', async (req, res) => {
    noCache(res);
    const entry = episodes.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Refresh the podcast feed and retry.' });
    const range = req.headers.range;
    if (range && !/^bytes=(?:\d{1,12}-\d{0,12}|-\d{1,12})$/.test(range)) return res.status(416).end();
    try {
      const { response } = await fetchMedia(entry.url, { accept: 'audio/*, application/octet-stream', range, signal: watch(res, 20 * 60000) });
      const type = String(response.headers['content-type'] || '').split(';')[0].trim();
      if (!/^audio\/[a-z0-9.+-]+$/i.test(type) && type !== 'application/octet-stream') {
        response.destroy(); return res.status(415).json({ error: 'The provider did not return podcast audio.' });
      }
      stream(res, response, type === 'application/octet-stream' ? entry.type : type, 128 * 1024 * 1024);
    } catch { if (!res.destroyed) res.status(502).json({ error: 'The podcast audio is unavailable.' }); }
  });
  async function radio(res, source, base) {
    noCache(res);
    const prefix = new URL('.', base);
    const allow = url => url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname);
    try {
      const { response, url } = await fetchMedia(source, { accept: '*/*', signal: watch(res, 15000), allow, maxRedirects: 2 });
      const type = String(response.headers['content-type'] || '').split(';')[0].trim();
      if (/\.m3u8$/i.test(url.pathname)) {
        const playlist = rewriteManifest(await readLimited(response, 128 * 1024), url, allow, part => {
          const id = opaqueId(base + '\n' + part);
          keep(radioParts, id, { part, base }, 1200);
          return '/api/media/radio-part/' + id;
        });
        return res.type('application/vnd.apple.mpegurl').send(playlist);
      }
      if (!/\.(?:ts|m4s|mp4|aac|mp3)$/i.test(url.pathname) ||
          !/^(?:audio\/[a-z0-9.+-]+|video\/(?:mp2t|mp4)|application\/octet-stream)$/i.test(type)) {
        response.destroy(); return res.status(415).end();
      }
      stream(res, response, type, 12 * 1024 * 1024);
    } catch { if (!res.destroyed) res.status(502).json({ error: 'The broadcast is unavailable in the built-in player.' }); }
  }
  app.get('/api/media/radio/:id', (req, res) => {
    const source = stationUrls.get(Number(req.params.id));
    if (!source) return res.status(404).json({ error: 'Use the official player for this station.' });
    return radio(res, source, source);
  });
  app.get('/api/media/radio-part/:id', (req, res) => {
    const hit = radioParts.get(req.params.id);
    if (!hit) return res.status(404).end();
    return radio(res, hit.part, hit.base);
  });
}
module.exports = { register, readPodcast, rewriteManifest, httpsUrl, stationUrls };
