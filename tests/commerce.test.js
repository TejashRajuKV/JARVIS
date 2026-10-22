'use strict';
const { buildAction, phoneDigits, slugCity } = require('../commerce');
let failed = 0, total = 0;
function check(name, ok, actual) { total++; if (!ok) { failed++; console.log('FAIL ' + name + (actual === undefined ? '' : ' — ' + JSON.stringify(actual))); } }
const wa = buildAction({ kind: 'whatsapp', phone: '+91 98765-43210', message: 'Hi, I will be there at 5.' });
check('WhatsApp produces a wa.me draft URL', !wa.error && wa.url.startsWith('https://wa.me/919876543210?text='), wa);
check('WhatsApp draft is not sent automatically', wa.sendsAutomatically === false && wa.requiresUserAction === true);
check('WhatsApp draft includes encoded text', decodeURIComponent(wa.url.split('text=')[1]) === 'Hi, I will be there at 5.');
check('invalid phone punctuation is rejected', !!buildAction({ kind: 'whatsapp', phone: 'friend; javascript:alert(1)', message: 'hello' }).error);
check('short phone numbers are rejected', !!buildAction({ kind: 'whatsapp', phone: '1234', message: 'hello' }).error);
check('empty message is rejected', !!buildAction({ kind: 'whatsapp', phone: '+919876543210', message: '   ' }).error);
const movie = buildAction({ kind: 'movie', movie: 'Dune', city: 'Bengaluru' });
check('movie handoff stays on BookMyShow and keeps a user-action boundary', movie.url === 'https://in.bookmyshow.com/explore/movies-bengaluru' && movie.purchasesAutomatically === false, movie);
const bus = buildAction({ kind: 'bus', from: 'Bengaluru', to: 'Mysuru', date: 'tomorrow' });
check('bus handoff uses the redBus route and requires manual booking', bus.url === 'https://www.redbus.in/bus-tickets/bangalore-to-mysore' && bus.purchasesAutomatically === false, bus);
check('same origin/destination is refused', !!buildAction({ kind: 'bus', from: 'Delhi', to: 'Delhi' }).error);
const shop = buildAction({ kind: 'shopping', item: 'wireless mouse', shop: 'amazon' });
check('shopping opens an encoded Amazon India search only', shop.url.startsWith('https://www.amazon.in/s?k=') && shop.purchasesAutomatically === false, shop);
check('unsupported service is refused', !!buildAction({ kind: 'payment', amount: 500 }).error);
check('phone normalization only accepts phone-like input', phoneDigits('+91 (98765) 43210') === '919876543210' && phoneDigits('hello-world') === '');
check('city aliases normalize known routes', slugCity('Bengaluru') === 'bangalore' && slugCity('Mysuru') === 'mysore');

const { parsePriceCandidates, comparisonPlan, comparePublicListings, providerMatch } = require('../commerce');
check('price parser extracts rupee amounts without treating ordinary numbers as prices', parsePriceCandidates('Price ₹ 1,299 only').some(p => p.amount === 1299) && parsePriceCandidates('2026 model with 8GB RAM').length === 0);
check('product comparison fans out to Amazon, Flipkart and Shopping discovery', comparisonPlan({type:'product',query:'wireless mouse'}).entries.map(p=>p.key).join(',') === 'amazon,flipkart,googleShopping');
check('bus comparison fans out to AbhiBus, redBus and government services', comparisonPlan({type:'bus',from:'Bengaluru',to:'Mysuru',provider:'all'}).entries.map(p=>p.key).join(',') === 'abhibus,redbus,government');
check('provider filtering rejects unrelated seller domains', !providerMatch('amazon','https://example.com/product'));

console.log((failed ? 'FAIL ' : 'PASS ') + 'commerce.test.js — ' + (total - failed) + '/' + total);
if (failed) process.exitCode = 1;

let asyncCompareFailed = 0;
comparePublicListings({ type: 'product', query: 'wireless mouse' }, {
  webSearch: async q => q.includes('site:amazon.in')
    ? [{ title: 'Wireless mouse - Amazon', url: 'https://www.amazon.in/dp/example', snippet: 'Price ₹ 1,299 wireless mouse' }]
    : q.includes('site:flipkart.com')
      ? [{ title: 'Wireless mouse - Flipkart', url: 'https://www.flipkart.com/item/example', snippet: 'Price ₹ 999 wireless mouse' }]
      : [{ title: 'Wireless mouse shopping result', url: 'https://www.google.com/search?tbm=shop&q=wireless+mouse', snippet: 'Price ₹ 899 wireless mouse' }],
  pageText: async () => ({ text: '' })
}).then(data => {
  const pass = data.success && data.providers.length === 3 && data.lowestObserved && data.lowestObserved.amount === 899
    && data.verifiedCheapest === null && data.providers.every(p => p.results.every(r => r.priceVerified === false));
  if (!pass) { asyncCompareFailed++; console.log('FAIL comparison engine returns lowest observed public candidate but never marks it verified'); }
  else console.log('PASS commerce comparison mock — provider fan-out, candidate ranking and unverified-price safety');
  if (asyncCompareFailed) process.exitCode = 1;
}).catch(e => { console.log('FAIL commerce comparison mock — ' + e.message); process.exitCode = 1; });
