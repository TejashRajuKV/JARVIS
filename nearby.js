'use strict';
/* "What's near here?": cafés, pharmacies, ATMs… around a place, from OpenStreetMap (the place is found with Nominatim, the
   things around it with the Overpass API; both free, no key, best effort). Distances are real (straight line), hours and phone
   numbers are shown only when OpenStreetMap has them. The Overpass query is built from the fixed table below, never from the
   user's words, so there is nothing to inject. Pure helpers are exported for tests. */

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const MAX_RESULTS = 10, DEFAULT_RADIUS = 1500, MIN_RADIUS = 100, MAX_RADIUS = 5000;

// key → { label, words (what people say), any: [[osm key, [values]]], and: optional extra tag filter }.
// A clause matches an element that has the key with one of the values ('*' = any value).
const CATEGORIES = {
  restaurant: { label: 'restaurants', words: ['restaurant', 'food', 'biryani', 'pizza', 'dhaba', 'mess', 'canteen', 'fast food'], any: [['amenity', ['restaurant', 'fast_food', 'food_court']]] },
  cafe: { label: 'cafés', words: ['cafe', 'café', 'coffee shop', 'coffee'], any: [['amenity', ['cafe']]] },
  bar: { label: 'bars and pubs', words: ['bar', 'pub', 'nightclub'], any: [['amenity', ['bar', 'pub', 'nightclub']]] },
  bakery: { label: 'bakeries', words: ['bakery', 'bakeries'], any: [['shop', ['bakery']]] },
  icecream: { label: 'ice cream shops', words: ['ice cream', 'juice shop'], any: [['amenity', ['ice_cream']], ['shop', ['ice_cream']]] },
  hotel: { label: 'hotels', words: ['hotel', 'resort'], any: [['tourism', ['hotel', 'resort', 'motel']]] },
  stay: { label: 'hostels and guest houses', words: ['hostel', 'pg', 'paying guest', 'lodge', 'homestay', 'guest house'], any: [['tourism', ['hostel', 'guest_house', 'motel', 'apartment']]] },
  hospital: { label: 'hospitals', words: ['hospital'], any: [['amenity', ['hospital']]] },
  clinic: { label: 'clinics and doctors', words: ['clinic', 'doctor', 'diagnostic centre', 'lab'], any: [['amenity', ['clinic', 'doctors']], ['healthcare', ['laboratory']]] },
  pharmacy: { label: 'pharmacies', words: ['pharmacy', 'medical shop', 'medical store', 'chemist'], any: [['amenity', ['pharmacy']]] },
  dentist: { label: 'dentists', words: ['dentist'], any: [['amenity', ['dentist']]] },
  atm: { label: 'ATMs', words: ['atm'], any: [['amenity', ['atm']]] },
  bank: { label: 'banks', words: ['bank'], any: [['amenity', ['bank']]] },
  fuel: { label: 'petrol stations', words: ['petrol pump', 'petrol bunk', 'petrol station', 'gas station', 'fuel'], any: [['amenity', ['fuel']]] },
  ev: { label: 'EV chargers', words: ['ev charger', 'charging station'], any: [['amenity', ['charging_station']]] },
  supermarket: { label: 'supermarkets and grocery shops', words: ['supermarket', 'grocery', 'grocery store', 'convenience store', 'kirana'], any: [['shop', ['supermarket', 'convenience', 'greengrocer', 'general']]] },
  mall: { label: 'malls', words: ['mall', 'shopping mall'], any: [['shop', ['mall', 'department_store']]] },
  market: { label: 'markets', words: ['market'], any: [['amenity', ['marketplace']]] },
  electronics: { label: 'electronics and mobile shops', words: ['electronics shop', 'mobile shop', 'electronics'], any: [['shop', ['electronics', 'mobile_phone', 'computer']]] },
  stationery: { label: 'stationery and copy shops', words: ['stationery', 'xerox shop', 'printing shop', 'xerox', 'copy shop'], any: [['shop', ['stationery', 'copyshop', 'books']]] },
  laundry: { label: 'laundries', words: ['laundry'], any: [['shop', ['laundry', 'dry_cleaning']]] },
  repair: { label: 'repair shops', words: ['repair shop'], any: [['shop', ['repair', 'electronics_repair', 'mobile_phone_repair']]] },
  salon: { label: 'salons and spas', words: ['salon', 'spa'], any: [['shop', ['hairdresser', 'beauty']], ['leisure', ['spa']]] },
  cinema: { label: 'cinemas and theatres', words: ['cinema', 'theatre', 'theater'], any: [['amenity', ['cinema', 'theatre']]] },
  park: { label: 'parks', words: ['park'], any: [['leisure', ['park', 'garden']]] },
  gym: { label: 'gyms', words: ['gym'], any: [['leisure', ['fitness_centre']]] },
  playground: { label: 'playgrounds', words: ['playground'], any: [['leisure', ['playground']]] },
  tourist: { label: 'places to visit', words: ['tourist place', 'tourist spot', 'tourist attraction', 'places to visit'], any: [['tourism', ['attraction', 'museum', 'viewpoint', 'zoo', 'gallery']]] },
  bus: { label: 'bus stops', words: ['bus stop', 'bus stand'], any: [['highway', ['bus_stop']], ['amenity', ['bus_station']]] },
  metro: { label: 'metro and railway stations', words: ['metro station', 'railway station', 'train station'], any: [['railway', ['station', 'halt']], ['station', ['subway']]] },
  airport: { label: 'airports', words: ['airport'], any: [['aeroway', ['aerodrome']]] },
  taxi: { label: 'taxi and auto stands', words: ['auto stand', 'taxi stand', 'taxi'], any: [['amenity', ['taxi']]] },
  police: { label: 'police stations', words: ['police station', 'police'], any: [['amenity', ['police']]] },
  post: { label: 'post offices', words: ['post office'], any: [['amenity', ['post_office']]] },
  temple: { label: 'temples', words: ['temple'], any: [['amenity', ['place_of_worship']]], and: ['religion', 'hindu'] },
  church: { label: 'churches', words: ['church'], any: [['amenity', ['place_of_worship']]], and: ['religion', 'christian'] },
  mosque: { label: 'mosques', words: ['mosque'], any: [['amenity', ['place_of_worship']]], and: ['religion', 'muslim'] },
  school: { label: 'schools', words: ['school'], any: [['amenity', ['school']]] },
  college: { label: 'colleges', words: ['college', 'university'], any: [['amenity', ['college', 'university']]] },
  library: { label: 'libraries', words: ['library', 'libraries'], any: [['amenity', ['library']]] },
};
// What "what's near X" looks for.
const OVERVIEW = ['restaurant', 'cafe', 'pharmacy', 'hospital', 'atm', 'supermarket', 'fuel', 'bus'];

/* ---------- pure helpers ---------- */
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const plur = w => (/ies$|s$/.test(w) ? esc(w) : /y$/.test(w) && !/[aeiou]y$/.test(w) ? esc(w.slice(0, -1)) + '(?:y|ies)' : esc(w) + '(?:e?s)?');
const WORD_TABLE = Object.entries(CATEGORIES).flatMap(([key, c]) => c.words.map(w => ({ key, w, re: new RegExp('^' + plur(w) + '$', 'i'), find: new RegExp('\\b' + plur(w) + '\\b', 'i') })))
  .sort((a, b) => b.w.length - a.w.length);

// "pharmacies" → 'pharmacy'. The whole phrase must be a category ("cheap cafes" is not one), unless `loose` (then the longest known word inside).
function categoryOf(text, loose) {
  const t = String(text || '').toLowerCase().replace(/\b(?:the|some|any|a|an|good|best|nearest|nearby|closest|open)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const exact = WORD_TABLE.find(x => x.re.test(t));
  if (exact) return exact.key;
  if (loose) { const inside = WORD_TABLE.find(x => x.find.test(t)); if (inside) return inside.key; }
  return null;
}
const categoryList = () => Object.values(CATEGORIES).map(c => c.label);

// Overpass QL for one or several categories around a point. Everything in it comes from CATEGORIES or is a checked number.
function buildQuery(lat, lon, radius, keys) {
  const la = +lat, lo = +lon, r = Math.round(+radius);
  if (!(la >= -90 && la <= 90) || !(lo >= -180 && lo <= 180) || !(r >= MIN_RADIUS && r <= MAX_RADIUS)) throw new Error('bad coordinates or radius');
  const lines = [];
  for (const key of keys) {
    const c = CATEGORIES[key];
    if (!c) throw new Error('unknown category ' + key);
    // One clause per exact value: Overpass answers exact tag matches far faster than regular expressions, and the tag
    // filters go before the area so it narrows by tag first.
    for (const [k, vals] of c.any) {
      for (const v of vals) {
        const test = v === '*' ? `["${k}"]` : `["${k}"="${v}"]`;
        lines.push(`  nwr${test}${c.and ? `["${c.and[0]}"="${c.and[1]}"]` : ''}["name"](around:${r},${la},${lo});`);
      }
    }
  }
  return `[out:json][timeout:20];\n(\n${lines.join('\n')}\n);\nout center tags 150;`;
}

const rad = d => d * Math.PI / 180;
function metersBetween(a, b) {
  const R = 6371000, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  return Math.round(2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2)));
}
const dist = m => (m < 1000 ? m + ' m' : (Math.round(m / 100) / 10) + ' km');

// Which of the categories an element is (the first whose rule it satisfies).
function matchKey(tags, keys) {
  for (const key of keys) {
    const c = CATEGORIES[key];
    if (c.and && tags[c.and[0]] !== c.and[1]) continue;
    if (c.any.some(([k, vals]) => tags[k] !== undefined && (vals.includes('*') || vals.includes(tags[k])))) return key;
  }
  return null;
}
const clean = s => String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const safeUrl = u => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : 'http://' + u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

// Overpass elements → [{name, key, lat, lon, meters, address, hours, phone, website, cuisine, mapsUrl}] nearest first, no duplicates.
function parseElements(elements, origin, keys) {
  const seen = new Set(), out = [];
  for (const e of elements || []) {
    const tags = e && e.tags;
    if (!tags || !tags.name) continue;
    const lat = e.lat !== undefined ? e.lat : e.center && e.center.lat, lon = e.lon !== undefined ? e.lon : e.center && e.center.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const key = matchKey(tags, keys);
    if (!key) continue;
    const name = clean(tags.name);
    const sig = key + '|' + name.toLowerCase() + '|' + lat.toFixed(3) + ',' + lon.toFixed(3);
    if (seen.has(sig)) continue; seen.add(sig);
    const addr = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:city']].filter(Boolean).map(clean).join(', ');
    out.push({
      name, key, lat, lon, meters: metersBetween(origin, { lat, lon }), address: addr,
      hours: clean(tags.opening_hours), phone: clean(tags.phone || tags['contact:phone']), website: safeUrl(clean(tags.website || tags['contact:website'])),
      cuisine: clean(tags.cuisine).replace(/;/g, ', '), mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

// "restaurants near majestic within 2 km" → { place, radius } (the radius words are taken out of the place).
function splitRadius(place) {
  let asked = DEFAULT_RADIUS, p = String(place || '').trim();
  const m = p.match(/\s*\b(?:within|in a radius of|inside)\s+(\d+(?:\.\d+)?)\s*(km|kms|kilometers?|kilometres?|m|meters?|metres?)\b\.?\s*$/i);
  if (m) { asked = Math.round(+m[1] * (/^k/i.test(m[2]) ? 1000 : 1)); p = p.slice(0, m.index).trim(); }
  const radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, asked));
  return { place: p, radius, clamped: radius !== asked };
}

/* ---------- the lookup (network functions injected, so tests need no internet) ---------- */
async function overpass(query, getJSON, mirrors = MIRRORS) {
  let lastErr = null;
  for (const base of mirrors) {
    try {
      const j = await getJSON(base + '?data=' + encodeURIComponent(query), 25000);
      if (j && Array.isArray(j.elements) && (j.elements.length || !j.remark)) return { elements: j.elements, via: new URL(base).host };
      lastErr = new Error((j && j.remark) || 'empty reply');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no reply');
}

// → { place, results, radius } | { error, status }
async function findNearby({ place, city, lat, lon, category, radius, geocodeAll, getJSON, mirrors, cache }) {
  const overview = category === 'any';
  const keys = overview ? OVERVIEW : [category];
  if (!overview && !CATEGORIES[category]) return { status: 400, error: 'I don’t know that kind of place. I can find: ' + categoryList().join(', ') + '.' };
  const r = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(+radius) || DEFAULT_RADIUS));
  let origin;
  if (lat !== undefined && lon !== undefined && lat !== null && lon !== null && lat !== '' && lon !== '') {
    origin = { name: 'your location', lat: +lat, lon: +lon };
    if (!(origin.lat >= -90 && origin.lat <= 90 && origin.lon >= -180 && origin.lon <= 180)) return { status: 400, error: 'Those coordinates are not valid.' };
  } else {
    const p = String(place || '').trim().slice(0, 100);
    if (!p) return { status: 400, error: 'Near where? Give a place, e.g. “near Majestic”.' };
    let found = [];
    const c = String(city || '').trim().slice(0, 80);
    if (c) {                                       // a bare name like "majestic" means the one in YOUR city, not in Kentucky
      const home = (await geocodeAll(c).catch(() => []))[0];
      if (home) found = await geocodeAll(p, home).catch(() => []);
    }
    if (!found.length) found = await geocodeAll(p);
    if (!found.length) return { status: 404, error: 'I couldn’t find “' + p + '” on the map. Try adding the city.' };
    origin = found[0];
  }
  const ck = keys.join(',') + '|' + origin.lat.toFixed(4) + ',' + origin.lon.toFixed(4) + '|' + r;
  if (cache && cache.has(ck) && Date.now() - cache.get(ck).at < 10 * 60000) return { ...cache.get(ck).value, cached: true };
  let data;
  try { data = await overpass(buildQuery(origin.lat, origin.lon, r, keys), getJSON, mirrors); }
  catch (e) { return { status: 502, error: 'The map service didn’t answer (' + String(e.message).slice(0, 80) + '). It is a free public service, so try again in a minute.' }; }
  const all = parseElements(data.elements, origin, keys);
  let results;
  if (overview) { const per = {}; results = []; for (const x of all) { per[x.key] = (per[x.key] || 0) + 1; if (per[x.key] <= 3) results.push(x); } }
  else results = all.slice(0, MAX_RESULTS);
  const value = { success: true, place: { name: origin.name, lat: origin.lat, lon: origin.lon }, category: overview ? { key: 'any', label: 'things nearby' } : { key: category, label: CATEGORIES[category].label }, labels: Object.fromEntries(keys.map(k => [k, CATEGORIES[k].label])), radius: r, total: all.length, results, via: data.via };
  if (cache) { cache.set(ck, { at: Date.now(), value }); if (cache.size > 50) cache.delete(cache.keys().next().value); }
  return value;
}

/* ---------- route ---------- */
module.exports = function setupNearby(app, { geocodeAll, getJSON, mirrors }) {
  const cache = new Map();
  app.post('/api/tool/nearby', async (req, res) => {
    const b = req.body || {};
    if (!b.online) return res.status(403).json({ error: 'offline' });
    const asked = String(b.category || '').toLowerCase().trim().slice(0, 60);
    if (!asked) return res.status(400).json({ error: 'What kind of place? For example cafés, pharmacies or ATMs.' });
    // the page sends the words people use ("pharmacies"); 'any' = an overview of everyday places
    const category = asked === 'any' || CATEGORIES[asked] ? asked : categoryOf(asked) || asked;
    try {
      const r = await findNearby({ place: b.place, city: b.city, lat: b.lat, lon: b.lon, category, radius: b.radius, geocodeAll, getJSON, mirrors, cache });
      if (r.error) return res.status(r.status || 500).json({ error: r.error });
      res.json(r);
    } catch (e) { res.status(502).json({ error: 'The map service is unreachable: ' + String(e.message).slice(0, 80) }); }
  });
};
Object.assign(module.exports, { CATEGORIES, OVERVIEW, categoryOf, categoryList, buildQuery, parseElements, metersBetween, dist, splitRadius, overpass, findNearby, matchKey, MIRRORS, DEFAULT_RADIUS, MAX_RADIUS, MIN_RADIUS, MAX_RESULTS });
