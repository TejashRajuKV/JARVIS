// Nearby places (nearby.js): which words mean which kind of place, the Overpass query, reading the answer, the lookup, the route.
// Run: node tests/nearby.test.js
const path = require('path');
const N = require(path.join(__dirname, '..', 'nearby.js'));
const Places = require(path.join(__dirname, '..', 'places.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- words → kind of place ---------- */
{
  const k = N.categoryOf;
  check('words: plain, plural and accented', k('cafe') === 'cafe' && k('cafes') === 'cafe' && k('café') === 'cafe' && k('cafés') === 'cafe' && k('pharmacies') === 'pharmacy' && k('ATMs') === 'atm' && k('restaurants') === 'restaurant' && k('libraries') === 'library' && k('bakeries') === 'bakery');
  check('words: several words', k('bus stop') === 'bus' && k('bus stops') === 'bus' && k('petrol pump') === 'fuel' && k('petrol pumps') === 'fuel' && k('railway station') === 'metro' && k('police station') === 'police' && k('medical shop') === 'pharmacy' && k('xerox shop') === 'stationery' && k('ev charger') === 'ev' && k('places to visit') === 'tourist');
  check('words: filler words are ignored', k('the nearest cafes') === 'cafe' && k('some good restaurants') === 'restaurant' && k('open pharmacies') === 'pharmacy' && k('nearby hospitals') === 'hospital');
  check('words: what people say for food, stay and worship', k('biryani') === 'restaurant' && k('food') === 'restaurant' && k('pg') === 'stay' && k('hostels') === 'stay' && k('temples') === 'temple' && k('mosque') === 'mosque' && k('church') === 'church');
  for (const no of ['netflix', 'my notes', 'weather', 'cheap cafes', 'wifi networks', 'python files', 'me', '', null, 'zzzz']) check('words: not a place kind: ' + JSON.stringify(no), k(no) === null, k(no));
  check('words: loose mode finds a word inside a phrase', k('cheap cafes', true) === 'cafe' && k('best biryani in town', true) === 'restaurant' && k('weather', true) === null);
  // every word JARVIS's decider already knows (places.js) must lead somewhere here, apart from the two vague ones
  const missing = Object.values(Places.GROUPS).flat().filter(w => !k(w) && !['shop', 'store'].includes(w));
  check('words: everything in places.js is covered (keep the two files in step)', missing.length === 0, missing);
  check('words: the list of supported kinds is readable', N.categoryList().length === Object.keys(N.CATEGORIES).length && N.categoryList().includes('pharmacies'));
}

/* ---------- the Overpass query ---------- */
{
  const q = N.buildQuery(12.9716, 77.5946, 1500, ['cafe']);
  check('query: around the point, only named places, one clause per rule', /^\[out:json\]\[timeout:20\];/.test(q) && q.includes('nwr["amenity"="cafe"]["name"](around:1500,12.9716,77.5946);') && /out center tags 150;$/.test(q), q);
  check('query: a kind with several values gets one exact-match clause per value (faster than regular expressions)', (N.buildQuery(1, 2, 500, ['bus']).match(/nwr\[/g) || []).length === 2 && (N.buildQuery(1, 2, 500, ['restaurant']).match(/nwr\[/g) || []).length === 3 && !/~/.test(N.buildQuery(1, 2, 500, Object.keys(N.CATEGORIES))));
  check('query: temples must also be Hindu places of worship', N.buildQuery(1, 2, 500, ['temple']).includes('nwr["amenity"="place_of_worship"]["religion"="hindu"]["name"](around:500,1,2);'));
  check('query: several kinds are one union', (N.buildQuery(1, 2, 500, N.OVERVIEW).match(/nwr\[/g) || []).length >= N.OVERVIEW.length);
  for (const [la, lo, r, ks, why] of [[91, 0, 500, ['cafe'], 'latitude'], [0, 181, 500, ['cafe'], 'longitude'], [NaN, 0, 500, ['cafe'], 'NaN'], [1, 2, 50, ['cafe'], 'radius too small'], [1, 2, 99999, ['cafe'], 'radius too big'], [1, 2, 500, ['nope'], 'unknown kind'], [1, 2, 500, ['cafe"];out;//'], 'injection attempt']]) {
    let threw = false; try { N.buildQuery(la, lo, r, ks); } catch { threw = true; }
    check('query: refused (' + why + ')', threw);
  }
  check('query: nothing but table text and numbers can get in', !/[^\w\s\[\]{}()|^$"~=.,:;*\-]/.test(N.buildQuery(12.5, 77.5, 800, Object.keys(N.CATEGORIES))));
}

/* ---------- distance ---------- */
{
  const d = N.metersBetween({ lat: 12.9716, lon: 77.5946 }, { lat: 12.9352, lon: 77.6245 });
  check('distance: Majestic to Koramangala is about 5 km', d > 5000 && d < 5800, d);
  check('distance: the same point is 0, and wording', N.metersBetween({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }) === 0 && N.dist(240) === '240 m' && N.dist(1500) === '1.5 km' && N.dist(999) === '999 m' && N.dist(12345) === '12.3 km');
}

/* ---------- reading the answer ---------- */
const origin = { lat: 12.9716, lon: 77.5946 };
const node = (name, dLat, tags = {}, extra = {}) => ({ type: 'node', lat: origin.lat + dLat, lon: origin.lon, tags: { name, amenity: 'cafe', ...tags }, ...extra });
{
  const els = [
    node('Far Cafe', 0.008), node('Near Cafe', 0.001, { opening_hours: 'Mo-Su 08:00-23:00', phone: '+91 80 1234 5678', 'addr:housenumber': '12', 'addr:street': 'MG Road', 'addr:suburb': 'Shivajinagar', website: 'javascript:alert(1)' }),
    { type: 'way', center: { lat: origin.lat + 0.003, lon: origin.lon }, tags: { name: 'Way Cafe', amenity: 'cafe', website: 'wayfarer.example/menu' } },
    node('Near Cafe', 0.001, { opening_hours: 'dup' }), { type: 'node', lat: 1, lon: 1, tags: { amenity: 'cafe' } }, { type: 'node', tags: { name: 'No coords', amenity: 'cafe' } },
    node('Pharmacy Not Cafe', 0.002, { amenity: 'pharmacy' }), null, { tags: null }, node('Evil\u0000Name\n\nHere', 0.004, { 'contact:phone': '555' }),
  ];
  const out = N.parseElements(els, origin, ['cafe']);
  check('parse: nearest first, unnamed / coordinate-less / other-kind / duplicate entries dropped', out.map(x => x.name).join('|') === 'Near Cafe|Way Cafe|Evil Name Here|Far Cafe', out.map(x => x.name));
  const n = out[0];
  check('parse: distance, address, hours, phone', n.meters > 100 && n.meters < 120 && n.address === '12, MG Road, Shivajinagar' && n.hours === 'Mo-Su 08:00-23:00' && n.phone === '+91 80 1234 5678' && n.key === 'cafe', n);
  check('parse: a way uses its centre; a website without http gets one; javascript: is dropped', out[1].lat === origin.lat + 0.003 && out[1].website === 'http://wayfarer.example/menu' && n.website === '');
  check('parse: control characters are cleaned; contact:phone is used', out[2].name === 'Evil Name Here' && out[2].phone === '555');
  check('parse: a Google Maps link to the exact spot', n.mapsUrl === `https://www.google.com/maps/search/?api=1&query=${n.lat},${n.lon}`);
  check('parse: nothing / junk in is an empty list', N.parseElements(undefined, origin, ['cafe']).length === 0 && N.parseElements([], origin, ['cafe']).length === 0);
  const worship = [{ type: 'node', lat: 1, lon: 1, tags: { name: 'A', amenity: 'place_of_worship', religion: 'hindu' } }, { type: 'node', lat: 1, lon: 1.001, tags: { name: 'B', amenity: 'place_of_worship', religion: 'muslim' } }];
  check('parse: a temple must be Hindu, a mosque Muslim', N.parseElements(worship, { lat: 1, lon: 1 }, ['temple']).map(x => x.name).join() === 'A' && N.parseElements(worship, { lat: 1, lon: 1 }, ['mosque']).map(x => x.name).join() === 'B');
  check('parse: with several kinds each element is labelled with its own', N.parseElements([node('C', 0.001), node('P', 0.002, { amenity: 'pharmacy' })], origin, ['cafe', 'pharmacy']).map(x => x.key).join() === 'cafe,pharmacy');
}

/* ---------- "within 2 km" ---------- */
{
  const s = N.splitRadius;
  let r = s('majestic within 2 km'); check('radius: km', r.place === 'majestic' && r.radius === 2000 && !r.clamped, r);
  r = s('majestic, bengaluru within 500 m.'); check('radius: metres', r.place === 'majestic, bengaluru' && r.radius === 500);
  r = s('majestic within 1.5 kilometres'); check('radius: decimals', r.radius === 1500);
  r = s('majestic'); check('radius: default', r.radius === N.DEFAULT_RADIUS && r.place === 'majestic' && !r.clamped);
  check('radius: too big or too small is limited, and flagged', s('x within 50 km').radius === 5000 && s('x within 50 km').clamped && s('x within 20 m').radius === 100 && s('x within 20 m').clamped);
  check('radius: a place that merely contains "in" is untouched', s('st marks road in indiranagar').place === 'st marks road in indiranagar');
}

/* ---------- the lookup, with fake network ---------- */
(async () => {
  const geoCalls = [], getCalls = [];
  const homeBengaluru = { name: 'Bengaluru', lat: 12.97, lon: 77.59 };
  const geocodeAll = async (p, near) => { geoCalls.push([p, near && near.name]); if (/zzz/.test(p)) return []; if (/^bengaluru$/i.test(p)) return [homeBengaluru]; if (near) return [{ name: 'Majestic (Bengaluru)', lat: 12.9767, lon: 77.5713 }]; return [{ name: 'Majestic (Kentucky)', lat: 37.0, lon: -82.0 }]; };
  const reply = { elements: [node('Cafe A', 0.001), node('Cafe B', 0.002), node('Cafe C', 0.003)] };
  let overpassReply = reply;
  const getJSON = async (url, ms) => { getCalls.push(url); if (typeof overpassReply === 'function') return overpassReply(url); if (overpassReply instanceof Error) throw overpassReply; return overpassReply; };
  const base = { geocodeAll, getJSON };

  // mirrors
  let r = await N.overpass('q', async url => { if (/overpass-api/.test(url)) throw new Error('HTTP 504'); return { elements: [1] }; });
  check('overpass: the second mirror answers when the first fails', r.elements.length === 1 && r.via === 'overpass.kumi.systems', r);
  r = await N.overpass('q', async url => (/overpass-api/.test(url) ? { elements: [], remark: 'runtime error: Query timed out' } : { elements: [2] }));
  check('overpass: a "timed out" remark with no results tries the next mirror', r.via === 'overpass.kumi.systems');
  r = await N.overpass('q', async () => ({ elements: [] }));
  check('overpass: an honest empty answer is an empty list, not an error', r.elements.length === 0);
  check('overpass: all mirrors down → error', await N.overpass('q', async () => { throw new Error('boom'); }).then(() => false, e => /boom/.test(e.message)));
  check('overpass: the query is URL-encoded into ?data=', (await (async () => { let u; await N.overpass('a b&c', async url => { u = url; return { elements: [] }; }); return u; })()).endsWith('?data=a%20b%26c'));

  // place → your city first
  r = await N.findNearby({ ...base, place: 'majestic', city: 'Bengaluru', category: 'cafe' });
  check('lookup: a bare place name is looked up near YOUR city first', r.success && r.place.name === 'Majestic (Bengaluru)' && geoCalls[0][0] === 'Bengaluru' && geoCalls[1][0] === 'majestic' && geoCalls[1][1] === 'Bengaluru', geoCalls);
  check('lookup: nearest first (measured from the place found), with the kind and radius', r.results.length === 3 && r.results.every((x, i, a) => !i || a[i - 1].meters <= x.meters) && r.category.key === 'cafe' && r.category.label === 'cafés' && r.radius === 1500 && r.via, r);
  geoCalls.length = 0; r = await N.findNearby({ ...base, place: 'majestic', category: 'cafe' });
  check('lookup: no city → unbounded search (and says which Majestic it found)', r.place.name === 'Majestic (Kentucky)' && geoCalls.length === 1);
  geoCalls.length = 0; r = await N.findNearby({ ...base, place: 'majestic', city: 'zzz-city', category: 'cafe' });
  check('lookup: a city that cannot be found falls back to the plain search', r.success && geoCalls.length === 2 && geoCalls[0][0] === 'zzz-city' && r.place.name === 'Majestic (Kentucky)', geoCalls);
  r = await N.findNearby({ ...base, place: 'zzz nowhere', category: 'cafe' });
  check('lookup: unknown place → 404 with advice', r.status === 404 && /couldn’t find “zzz nowhere”/.test(r.error) && /city/.test(r.error), r);
  r = await N.findNearby({ ...base, place: '', category: 'cafe' });
  check('lookup: no place at all → 400 asking where', r.status === 400 && /Near where/.test(r.error));
  r = await N.findNearby({ ...base, place: 'x', category: 'spaceport' });
  check('lookup: unknown kind → 400 listing what is supported', r.status === 400 && /pharmacies/.test(r.error));
  getCalls.length = 0; r = await N.findNearby({ ...base, lat: 12.97, lon: 77.59, category: 'atm', radius: 99999 });
  check('lookup: coordinates skip the place search; the radius is limited', r.success && r.radius === 5000 && r.place.name === 'your location' && /around:5000,12.97,77.59/.test(decodeURIComponent(getCalls[0])), getCalls);
  r = await N.findNearby({ ...base, lat: 200, lon: 77, category: 'atm' });
  check('lookup: impossible coordinates → 400', r.status === 400);

  // many kinds
  overpassReply = { elements: [...[1, 2, 3, 4, 5].map(i => node('Cafe ' + i, i / 1000)), node('Rx 1', 0.0015, { amenity: 'pharmacy' }), node('ATM 1', 0.0025, { amenity: 'atm' })] };
  r = await N.findNearby({ ...base, lat: origin.lat, lon: origin.lon, category: 'any' });
  const per = {}; r.results.forEach(x => { per[x.key] = (per[x.key] || 0) + 1; });
  check('overview: "what is near" shows at most 3 of each kind', r.category.key === 'any' && per.cafe === 3 && per.pharmacy === 1 && per.atm === 1 && r.total === 7, per);
  overpassReply = { elements: Array.from({ length: 30 }, (_, i) => node('C' + i, (i + 1) / 10000)) };
  r = await N.findNearby({ ...base, lat: origin.lat, lon: origin.lon, category: 'cafe' });
  check('lookup: at most 10 results, with the real total', r.results.length === 10 && r.total === 30);
  overpassReply = { elements: [] };
  r = await N.findNearby({ ...base, lat: origin.lat, lon: origin.lon, category: 'cafe' });
  check('lookup: nothing found is a success with an empty list', r.success && r.results.length === 0 && r.total === 0);
  overpassReply = new Error('HTTP 429');
  r = await N.findNearby({ ...base, lat: origin.lat, lon: origin.lon, category: 'bank' });
  check('lookup: map service down → 502 with a friendly message', r.status === 502 && /free public service/.test(r.error) && /429/.test(r.error), r);

  // cache
  overpassReply = reply; const cache = new Map(); getCalls.length = 0;
  await N.findNearby({ ...base, lat: 1.5, lon: 2.5, category: 'cafe', cache }); const again = await N.findNearby({ ...base, lat: 1.5, lon: 2.5, category: 'cafe', cache });
  check('cache: the same question twice asks the map service once', getCalls.length === 1 && again.cached === true);
  await N.findNearby({ ...base, lat: 1.5, lon: 2.5, category: 'cafe', radius: 800, cache });
  check('cache: a different radius is a different question', getCalls.length === 2);

  /* ---------- the route ---------- */
  const routes = {}; const app = { post: (p, h) => { routes[p] = h; } };
  N(app, { geocodeAll, getJSON });
  const call = async body => { let out, code = 200; await routes['/api/tool/nearby']({ body }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
  check('route: refuses when Online tools is off', (await call({ place: 'x', category: 'cafe' })).code === 403);
  check('route: needs a kind', (await call({ online: true, place: 'x' })).code === 400);
  check('route: needs a place', (await call({ online: true, category: 'cafe' })).code === 400);
  r = await call({ online: true, place: 'majestic', city: 'Bengaluru', category: 'Cafe' });
  check('route: a full answer (the kind is case-insensitive)', r.code === 200 && r.success && r.results.length === 3 && r.place.name === 'Majestic (Bengaluru)', r);
  check('route: an unknown kind is a 400', (await call({ online: true, place: 'x', category: 'spaceport' })).code === 400);
  r = await call({ online: true, place: 'majestic', city: 'Bengaluru', category: 'pharmacies' });
  check('route: the words people use work too ("pharmacies" → pharmacy)', r.code === 200 && r.category.key === 'pharmacy', r);
  r = await call({ online: true, place: 'majestic', city: 'Bengaluru', category: 'any' });
  check('route: "any" is the overview', r.code === 200 && r.category.key === 'any', r);
  geocodeAll.bad = true;
  const app2 = { post: (p, h) => { routes['2' + p] = h; } };
  N(app2, { geocodeAll: async () => { throw new Error('Nominatim down'); }, getJSON });
  let out2, code2 = 200; await routes['2/api/tool/nearby']({ body: { online: true, place: 'x', category: 'cafe' } }, { json: o => { out2 = o; }, status: c => ({ json: o => { code2 = c; out2 = o; } }) });
  check('route: a crash in the map lookup is a 502, not a hang', code2 === 502 && /unreachable/.test(out2.error), out2);

  console.log(`nearby: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
