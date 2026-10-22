'use strict';
/* Safe hand-off links for messaging, ticket searches and shopping.
   JARVIS prepares a draft/search only. It never presses Send, reserves a seat, adds a payment method,
   places an order, or pays. The user completes and verifies the transaction on the provider site. */
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
  const aliases = { bengaluru: 'bangalore', 'bangalore': 'bangalore', mysuru: 'mysore', 'mysore': 'mysore', mumbai: 'mumbai', delhi: 'delhi', hyderabad: 'hyderabad', chennai: 'chennai', pune: 'pune', kochi: 'kochi', goa: 'goa' };
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
    return { kind, url: 'https://in.bookmyshow.com/explore/movies-' + slugCity(city), summary: 'Opening BookMyShow for movies in ' + city + '. Look for “' + movie + '”, choose the cinema and showtime, and review the total before booking.', query: movie, requiresUserAction: true, purchasesAutomatically: false };
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
module.exports = function setupCommerce(app) {
  app.post('/api/services/prepare', (req, res) => {
    const r = buildAction(req.body);
    if (r.error) return res.status(400).json(r);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...r });
  });
};
Object.assign(module.exports, { buildAction, phoneDigits, slugCity });
