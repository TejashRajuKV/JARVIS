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
