'use strict';
/* Safe hand-off and public-search comparison for messaging, tickets and shopping.
   Comparison reads public search snippets/readable pages. Prices are candidates, never checkout-verified.
   JARVIS never sends, reserves, orders, adds payment details or pays. */
const MAX_TEXT = 2000;
const clean = (v, max = 120) => String(v || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function phoneDigits(value) {
  const raw = String(value || '').trim();
  if (!/^[+\d() .-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}
function slugCity(value) {
  const s = clean(value, 80).toLowerCase();
  const aliases = { bengaluru: 'bangalore', bangalore: 'bangalore', mysuru: 'mysore', mysore: 'mysore', mumbai: 'mumbai', delhi: 'delhi', hyderabad: 'hyderabad', chennai: 'chennai', pune: 'pune', kochi: 'kochi', goa: 'goa' };
  return aliases[s] || s.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function buildAction(body) {
  const b = body || {}, kind = String(b.kind || '');
  if (kind === 'whatsapp') {
    const phone = phoneDigits(b.phone), message = clean(b.message, MAX_TEXT);
    if (!phone) return { error: 'A valid recipient phone number with country code is required (for example, +91 followed by the number).' };
    if (!message) return { error: 'Write the message you want to prepare.' };
    return { kind, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message), summary: 'WhatsApp draft for +' + phone + '. Review the recipient and message in WhatsApp, then press Send yourself.', requiresUserAction: true, sendsAutomatically: false };
  }
  if (kind === 'movie') {
    const movie = clean(b.movie, 120), city = clean(b.city || 'Bengaluru', 80);
    if (!movie) return { error: 'Which movie should I look for?' };
    const movieUrl = /^(?:bengaluru|bangalore)$/i.test(city) ? 'https://in.bookmyshow.com/explore/movies-bengaluru' : 'https://in.bookmyshow.com/';
    return { kind, url: movieUrl, summary: 'Opening BookMyShow for movies. Select ' + city + ' if needed, then look for “' + movie + '”, choose the cinema and showtime, and review the total before booking.', query: movie, requiresUserAction: true, purchasesAutomatically: false };
  }
  if (kind === 'bus') {
    const from = clean(b.from, 80), to = clean(b.to, 80), date = clean(b.date, 40);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return { error: 'Provide different departure and destination cities.' };
    return { kind, url: 'https://www.redbus.in/bus-tickets/' + slugCity(from) + '-to-' + slugCity(to), summary: 'Opening redBus for ' + from + ' to ' + to + (date ? ' on ' + date : '') + '. Verify the travel date, boarding point, operator, cancellation terms and total before booking.', requiresUserAction: true, purchasesAutomatically: false };
  }
  if (kind === 'shopping') {
    const item = clean(b.item, 180), shop = String(b.shop || 'amazon').toLowerCase();
    if (!item) return { error: 'What item should I search for?' };
    const base = shop === 'flipkart' ? 'https://www.flipkart.com/search?q=' : shop === 'myntra' ? 'https://www.myntra.com/' : 'https://www.amazon.in/s?k=';
    const url = shop === 'myntra' ? 'https://www.google.com/search?q=' + encodeURIComponent('site:myntra.com ' + item) : base + encodeURIComponent(item);
    return { kind, url, summary: 'Searching for “' + item + '”. Compare seller, reviews, delivery, return policy and the final price. JARVIS will not place an order or pay.', requiresUserAction: true, purchasesAutomatically: false };
  }
  return { error: 'Unsupported action. Available actions: whatsapp, movie, bus, shopping.' };
}
const PROVIDERS = {
  amazon: { name: 'Amazon India', domains: ['amazon.in'], query: q => 'site:amazon.in ' + q },
  flipkart: { name: 'Flipkart', domains: ['flipkart.com'], query: q => 'site:flipkart.com ' + q },
  googleShopping: { name: 'Google Shopping / other sellers', domains: ['google.com/shopping', 'google.com/search'], query: q => q + ' Google Shopping price India' },
  abhibus: { name: 'AbhiBus', domains: ['abhibus.com'], query: q => 'site:abhibus.com ' + q + ' bus fare' },
  redbus: { name: 'redBus', domains: ['redbus.in'], query: q => 'site:redbus.in ' + q + ' bus fare' },
  government: { name: 'Government bus services', domains: ['gov.in', 'ksrtc.in', 'apsrtconline.in', 'tsrtconline.in', 'msrtc.maharashtra.gov.in', 'tnstc.in', 'keralartc.com'], query: q => 'official government state transport bus booking ' + q + ' fare' }
};
function hostOf(href) { try { return new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function providerMatch(provider, href) {
  const host = hostOf(href);
  if (!host) return false;
  if (provider === 'googleShopping') { const u = new URL(href); return (host === 'google.com' && (u.pathname.startsWith('/shopping') || u.searchParams.get('tbm') === 'shop')) || /shopping\.google\./i.test(host); }
  return PROVIDERS[provider].domains.some(d => host === d || host.endsWith('.' + d));
}
function parsePriceCandidates(text) {
  const s = String(text || '').replace(/\u00a0/g, ' ');
  const out = [], seen = new Set();
  const re = /(?:₹\s*|INR\s*|Rs\.?\s*)(\d{1,3}(?:,\d{2,3})+|\d{3,7})(?:\.(\d{1,2}))?/gi;
  let m;
  while ((m = re.exec(s)) && out.length < 4) {
    const amount = Number((m[1] || '').replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    if (!Number.isFinite(amount) || amount < 20 || amount > 100000000 || seen.has(amount)) continue;
    seen.add(amount); out.push({ amount, display: '₹' + amount.toLocaleString('en-IN') });
  }
  return out;
}
function relevanceScore(text, query) {
  const stop = new Set('the a an for with and or in on of to by from new latest price cheapest under below compare'.split(' '));
  const words = clean(query, 200).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stop.has(w));
  if (!words.length) return 0;
  const hay = String(text || '').toLowerCase();
  return words.filter(w => hay.includes(w)).length / words.length;
}
function comparisonPlan(body) {
  const b = body || {}, type = String(b.type || '');
  if (type === 'product') {
    const query = clean(b.query, 160);
    if (!query) return { error: 'Enter the product name and, if possible, the exact model or variant.' };
    return { type, query, entries: ['amazon', 'flipkart', 'googleShopping'].map(key => ({ key, ...PROVIDERS[key], search: PROVIDERS[key].query(query) })) };
  }
  if (type === 'bus') {
    const from = clean(b.from, 80), to = clean(b.to, 80), date = clean(b.date, 40);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return { error: 'Enter different departure and destination cities.' };
    const route = from + ' to ' + to + (date ? ' on ' + date : '');
    const requested = String(b.provider || 'all');
    const keys = requested === 'all' ? ['abhibus', 'redbus', 'government'] : [requested];
    if (keys.some(k => !['abhibus', 'redbus', 'government'].includes(k))) return { error: 'Unsupported bus provider.' };
    return { type, query: route, entries: keys.map(key => ({ key, ...PROVIDERS[key], search: PROVIDERS[key].query(route) })) };
  }
  return { error: 'Comparison type must be product or bus.' };
}
async function comparePublicListings(body, deps) {
  const plan = comparisonPlan(body);
  if (plan.error) return plan;
  if (!deps || typeof deps.webSearch !== 'function') return { error: 'Public search is not available in this JARVIS runtime.' };
  const providers = await Promise.all(plan.entries.map(async p => {
    let raw = [];
    try { raw = await deps.webSearch(p.search); } catch {}
    let results = (Array.isArray(raw) ? raw : []).filter(r => r && providerMatch(p.key, r.url))
      .map(r => {
        const text = [r.title, r.snippet].filter(Boolean).join(' ');
        return { title: clean(r.title, 220), url: r.url, snippet: clean(r.snippet, 500), relevance: relevanceScore(text, plan.query), priceCandidates: parsePriceCandidates(text), priceSource: 'public search snippet', priceVerified: false };
      }).filter(r => r.relevance >= (plan.type === 'bus' ? 0.2 : 0.25))
      .sort((a, b) => b.relevance - a.relevance).slice(0, 4);
    // Try reading up to two public result pages per provider; if a site blocks reading, keep the search snippet.
    if (typeof deps.pageText === 'function') {
      await Promise.all(results.slice(0, 2).map(async item => {
        try {
          const page = await deps.pageText(item.url, { timeout: 5000, max: 5000 });
          const text = clean((page && (page.text || page.content)) || '', 5000);
          const candidates = parsePriceCandidates(text);
          if (candidates.length && !item.priceCandidates.length) {
            item.priceCandidates = candidates; item.priceSource = 'readable public page'; item.priceVerified = false;
          }
          if (!item.snippet && text) item.snippet = text.slice(0, 350);
        } catch { /* public site may block bots or require JavaScript; do not treat that as a zero price */ }
      }));
    }
    if (!results.length) {
      // Always provide a useful provider-specific fallback, but never attach an invented price to it.
      const fallbackUrl = plan.type === 'product'
        ? (p.key === 'amazon' ? 'https://www.amazon.in/s?k=' + encodeURIComponent(plan.query)
          : p.key === 'flipkart' ? 'https://www.flipkart.com/search?q=' + encodeURIComponent(plan.query)
          : 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(plan.query))
        : 'https://www.google.com/search?q=' + encodeURIComponent(p.search);
      results.push({ title: 'Search ' + p.name + ' for “' + plan.query + '”', url: fallbackUrl,
        snippet: 'No matching public result with a reliable price was found. Open this provider search to check current availability and final price.',
        relevance: 1, priceCandidates: [], priceSource: null, priceVerified: false, fallback: true });
    }
    return { key: p.key, name: p.name, results, status: results.some(r => !r.fallback) ? 'results' : 'provider_search_fallback' };
  }));
  const candidates = providers.flatMap(p => p.results.map(r => ({ provider: p.name, title: r.title, url: r.url, ...(r.priceCandidates[0] || {}), priceSource: r.priceSource, priceVerified: false, relevance: r.relevance })))
    .filter(x => Number.isFinite(x.amount) && x.amount > 0);
  candidates.sort((a, b) => a.amount - b.amount);
  return {
    success: true, type: plan.type, query: plan.query, providers,
    lowestObserved: candidates.length ? { ...candidates[0], display: candidates[0].display + ' (observed; unverified)' } : null,
    checkedAt: new Date().toISOString(),
    limitations: ['Public search snippets and readable pages can be stale or variant-mismatched.', 'Final delivery, booking fees, coupons, bank offers and availability may change at checkout.', 'No provider is labelled cheapest unless comparable, verified final prices are available.'],
    verifiedCheapest: null
  };
}
module.exports = function setupCommerce(app, deps = {}) {
  app.post('/api/services/prepare', (req, res) => {
    const r = buildAction(req.body);
    if (r.error) return res.status(400).json(r);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...r });
  });
  app.post('/api/commerce/compare', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await comparePublicListings(req.body, deps);
      if (r.error) return res.status(400).json(r);
      res.json(r);
    } catch (e) {
      res.status(502).json({ error: 'Comparison search failed. Try again in a moment.' });
    }
  });
};
Object.assign(module.exports, { buildAction, phoneDigits, slugCity, parsePriceCandidates, comparisonPlan, comparePublicListings, providerMatch, relevanceScore });
