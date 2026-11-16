'use strict';

// Preloaded only by the isolated positive-route suite. Preserve application routing
// and validation while replacing network requests to external providers.
if (process.env.JARVIS_TEST !== '1') throw new Error('Provider fixtures require an isolated JARVIS test');

const https = require('node:https');
const { Readable, Writable } = require('node:stream');
const netSafe = require('../../netsafe');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';
const announcement = 'Fixture announcement';
const to = '+14155550101';
const from = '+14155550100';
const sid = 'AC' + '1'.repeat(32);
const token = 'fixture-twilio-token';
const callSid = 'CA' + '2'.repeat(32);
const listings = {
  amazon: 'https://www.amazon.in/dp/audit-fixture',
  flipkart: 'https://www.flipkart.com/item/audit-fixture'
};
const request = https.request;
https.request = function (options, callback) {
  if (options.hostname !== 'api.twilio.com') return request.apply(this, arguments);
  const chunks = [];
  return new Writable({
    write(chunk, encoding, done) { chunks.push(chunk); done(); },
    final(done) {
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const valid = options.method === 'POST' && options.auth === sid + ':' + token &&
        options.path === '/2010-04-01/Accounts/' + sid + '/Calls.json' &&
        form.get('To') === to && form.get('From') === from &&
        form.get('Twiml') === '<Response><Say>' + announcement + '</Say><Pause length="1"/></Response>';
      const reply = Readable.from([Buffer.from(JSON.stringify(valid ? {sid: callSid, status: 'queued'} : {}))]);
      reply.statusCode = valid ? 201 : 400;
      callback(reply);
      done();
    }
  });
};

const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.hostname === 'www.bing.com') {
    const query = url.searchParams.get('q') || '';
    const listing = query.includes('site:amazon.in') ? listings.amazon :
      query.includes('site:flipkart.com') ? listings.flipkart : null;
    return Promise.resolve(new Response(listing ? '<li class="b_algo"><h2><a href="' + listing +
      '">Desk lamp</a></h2><p class="b_lineclamp">Desk lamp available</p></li>' : ''));
  }
  if (url.hostname === 'html.duckduckgo.com') return Promise.resolve(new Response(''));
  if (url.origin === 'http://127.0.0.1:9') {
    const payload = JSON.parse(options?.body || '{}');
    if (url.pathname === '/api/show' && payload.model === 'fixture-vision') {
      return Promise.resolve(Response.json({capabilities: ['vision']}));
    }
    if (url.pathname === '/api/chat' &&
        payload.messages?.some(m => m.role === 'user' && m.images?.includes(png) && m.content.includes('What is in this fixture?'))) {
      const message = {message: {content: 'A fixture pixel.'}, done: true};
      return Promise.resolve(new Response(JSON.stringify(message) + '\n', {headers: {'Content-Type': 'application/x-ndjson'}}));
    }
    return Promise.resolve(Response.json({}, {status: 404}));
  }
  return fetch(input, options);
};

const safeFetch = netSafe.safeFetch;
netSafe.safeFetch = (href, options) => {
  if (href === listings.amazon) return Promise.resolve(new Response('<p>Desk lamp price INR 1,299</p>'));
  if (href === listings.flipkart) return Promise.resolve(new Response('<p>Desk lamp price INR 999</p>'));
  return safeFetch(href, options);
};
