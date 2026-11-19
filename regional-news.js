'use strict';

// Publisher-listed city feeds. Only these addresses are ever fetched.
const feeds = [
  { city: 'Bengaluru', aliases: ['bangalore', 'ಬೆಂಗಳೂರು'], language: 'Kannada', source: 'Public TV', url: 'https://publictv.in/category/news/karnataka/district-news/bengaluru-city/feed/' },
  { city: 'Delhi', aliases: ['new delhi', 'दिल्ली'], language: 'English', source: 'The Indian Express', url: 'https://indianexpress.com/section/cities/delhi/feed/' },
  { city: 'Chennai', aliases: ['madras', 'சென்னை'], language: 'English', source: 'The Indian Express', url: 'https://indianexpress.com/section/cities/chennai/feed/' },
  { city: 'Hyderabad', aliases: ['హైదరాబాద్'], language: 'English', source: 'Telangana Today', url: 'https://telanganatoday.com/hyderabad/feed' },
];
const cleanKey = text => typeof text === 'string' ? text.trim().toLowerCase().replace(/\s+/g, ' ') : '';
function findFeed(city, language) {
  const key = cleanKey(city).split(',')[0].trim();
  const lang = cleanKey(language);
  return feeds.find(f => (f.city.toLowerCase() === key || f.aliases.includes(key)) && (!lang || f.language.toLowerCase() === lang));
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(value) {
  return value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, token) => {
    if (token[0] !== '#') return Object.hasOwn(entities, token) ? entities[token] : all;
    const point = /^#x/i.test(token) ? parseInt(token.slice(2), 16) : Number(token.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function parseRss(xml, feed, now = Date.now()) {
  if (!/<rss\b/i.test(xml) || /<!DOCTYPE/i.test(xml)) throw new Error('Unexpected news feed format');
  const feedHost = new URL(feed.url).hostname;
  const rows = new Map();
  for (const [, item] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const tag = name => decode(item.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'i'))?.[1] || '');
    const title = tag('title').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const date = Date.parse(tag('pubDate'));
    if (!title || !Number.isFinite(date) || date > now + 5 * 60000 || date < now - 7 * 86400000) continue;
    let link;
    try { link = new URL(tag('link')); } catch { continue; }
    if (link.origin !== 'https://' + feedHost || link.username || link.password || rows.has(link.href)) continue;
    rows.set(link.href, { title, url: link.href, publishedAt: new Date(date).toISOString(), source: feed.source });
  }
  return [...rows.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 3);
}

async function fetchRss(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6500), redirect: 'error',
    headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'JARVIS/1.0 (Personal RSS Reader)' },
  });
  if (!response.ok) throw new Error('News provider did not respond');
  const decoder = new TextDecoder();
  let xml = '', bytes = 0, from = 0, items = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 512 * 1024) throw new Error('News feed is too large');
    xml += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = xml.indexOf('</item>', from)) >= 0) { from = end + 7; items++; }
    if (items >= 12) return xml.slice(0, from);
    from = Math.max(from, xml.length - 6);
  }
  return xml + decoder.decode();
}

function register(app, { load = fetchRss } = {}) {
  const cache = new Map();
  app.post('/api/news/regional', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.body?.online !== true) return res.status(400).json({ error: 'Enable Online tools to fetch regional headlines.' });
    const feed = findFeed(req.body?.city, req.body?.language);
    if (!feed) return res.status(404).json({ error: 'No matching regional feed. Available: Bengaluru in Kannada, and Chennai, Delhi and Hyderabad in English.' });
    try {
      let entry = cache.get(feed.url);
      if (!entry || entry.expires <= Date.now()) {
        entry = { expires: Date.now() + 5 * 60000, result: Promise.resolve().then(() => load(feed.url)).then(xml => parseRss(xml, feed)) };
        cache.set(feed.url, entry);
      }
      const headlines = await entry.result;
      res.json({ city: feed.city, language: feed.language, headlines });
    } catch {
      cache.delete(feed.url);
      res.status(502).json({ error: 'Regional headlines are temporarily unavailable.' });
    }
  });
}

module.exports = { register, findFeed, parseRss };
