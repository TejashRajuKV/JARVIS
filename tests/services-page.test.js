'use strict';
const Services = require('../services-page');
let failed = 0, total = 0;
function check(name, ok, actual) { total++; if (!ok) { failed++; console.log('FAIL ' + name + (actual === undefined ? '' : ' — ' + JSON.stringify(actual))); } }
let m = Services.match('send WhatsApp message to +91 98765 43210 saying I will arrive at 5');
check('WhatsApp message extracts recipient and body', m && m.kind === 'whatsapp' && m.phone === '+91 98765 43210' && /arrive at 5/.test(m.message), m);
m = Services.match('send WhatsApp message to mom saying I will be late');
check('named WhatsApp recipient is recognized but requires phone verification', m && m.kind === 'whatsapp' && m.phone === 'mom' && /late/.test(m.message), m);
m = Services.match('book movie tickets for Dune in Bengaluru');
check('movie booking extracts title and city', m && m.kind === 'movie' && /Dune/.test(m.movie) && /Bengaluru/i.test(m.city), m);
m = Services.match('book bus tickets from Bengaluru to Mysuru on 25 October');
check('bus booking extracts route and date', m && m.kind === 'bus' && /Bengaluru/i.test(m.from) && /Mysuru/i.test(m.to) && /25 October/i.test(m.date), m);
m = Services.match('buy wireless mouse');
check('buy request only creates shopping search intent', m && m.kind === 'shopping' && m.item === 'wireless mouse', m);
check('ordinary conversation is not intercepted', Services.match('I bought a mouse yesterday') === null);
check('ambiguous generic message is not intercepted', Services.match('message me later') === null);
console.log((failed ? 'FAIL ' : 'PASS ') + 'services-page.test.js — ' + (total - failed) + '/' + total);
if (failed) process.exitCode = 1;
