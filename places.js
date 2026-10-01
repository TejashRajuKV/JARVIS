'use strict';
/* Kinds of places the decider recognises ("nearest restaurants to kodigehalli" → Maps). Data only — add a place
   type here, not in decider.js. Each group: the words people say (singular or plural is matched automatically). */
const Places = (() => {
  const GROUPS = {
    food: ['restaurant', 'hotel', 'cafe', 'café', 'coffee shop', 'food', 'biryani', 'pizza', 'bakery', 'bakeries', 'dhaba', 'bar', 'pub', 'mess', 'canteen', 'juice shop', 'ice cream'],
    stay: ['hostel', 'pg', 'paying guest', 'lodge', 'homestay', 'resort'],
    health: ['hospital', 'clinic', 'pharmacy', 'pharmacies', 'medical shop', 'medical store', 'doctor', 'dentist', 'diagnostic centre', 'lab'],
    money: ['atm', 'bank'],
    fuel: ['petrol pump', 'petrol bunk', 'petrol station', 'gas station', 'ev charger', 'charging station'],
    shopping: ['mall', 'supermarket', 'grocery', 'grocery store', 'shop', 'store', 'market', 'electronics shop', 'mobile shop', 'stationery'],
    fun: ['theatre', 'theater', 'cinema', 'park', 'gym', 'salon', 'spa', 'playground', 'tourist place', 'tourist spot', 'tourist attraction', 'places to visit'],
    transport: ['bus stop', 'bus stand', 'metro station', 'railway station', 'airport', 'auto stand', 'taxi stand'],
    services: ['police station', 'post office', 'temple', 'church', 'mosque', 'school', 'college', 'library', 'libraries', 'xerox shop', 'printing shop', 'repair shop', 'laundry'],
  };
  const all = [...new Set(Object.values(GROUPS).flat())].sort((a, b) => b.length - a.length);   // longest first
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const plural = w => /ies$|s$/.test(w) ? esc(w) : /y$/.test(w) && !/[aeiou]y$/.test(w) ? esc(w.slice(0, -1)) + '(?:y|ies)' : esc(w) + '(?:e?s)?';
  const REGEX = new RegExp('\\b(' + all.map(plural).join('|') + ')\\b', 'i');
  const groupOf = word => { const w = String(word || '').toLowerCase(); return Object.keys(GROUPS).find(g => GROUPS[g].some(x => new RegExp('^' + plural(x) + '$', 'i').test(w))) || ''; };
  return { GROUPS, REGEX, groupOf };
})();
if (typeof module !== 'undefined') module.exports = Places;
