// Decider (decider.js): which way each request goes — direct tool, your local things, the local AI, or the web.
// The rule engine (nlu.js) supplies the command intent, exactly as in the page. Run: node tests/decider.test.js
'use strict';
const fs = require('fs'), path = require('path');
const { suite } = require('./lib/server');
const { check, done } = suite('decider');
eval(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
const Decider = require('../decider.js');

function route(text, env) {
  const p = NLU.classify(NLU.normalize(text, 'jarvis'), {});
  const implicitSearch = p.intent === 'SEARCH_FILES' && !/\b(files?|folders?|documents?|notes?|directory)\b/i.test(text);
  const sig = Decider.signals(text, { intent: p.intent, confidence: p.confidence, implicitSearch });
  return Object.assign(Decider.decide(sig, Object.assign({ online: true }, env)), { intent: p.intent });
}

const CASES = [
  // direct tools — no AI, no web
  ['open chrome', 'TOOL'], ['set volume to 50', 'TOOL'], ['create a folder called test', 'TOOL'], ['turn wifi off', 'TOOL'],
  ['run main.py', 'TOOL'], ['open the calculator project folder', 'TOOL'], ['find my calculator.py file', 'TOOL'], ['where is pythonProject', 'LOCAL'], ['create a study plan for DSA', 'TOOL'],
  // the local AI: understanding, not fresh facts
  ['explain binary search simply', 'LOCAL_AI'], ['how does binary search work', 'LOCAL_AI'], ['explain python decorators', 'LOCAL_AI'],
  ['what is recursion', 'LOCAL_AI'], ['why is quicksort faster than bubble sort', 'LOCAL_AI'], ['tell me a fun fact about space', 'LOCAL_AI'],
  // your own things: tools + local AI, never the web
  ['help me debug this python code', 'LOCAL'], ['fix the previous python file', 'LOCAL'], ['what does my notes.md say about paging', 'LOCAL'],
  ['continue the calculator project', 'LOCAL'], ['what is in my latest file', 'TOOL'], ['explain the code in this file', 'LOCAL'],
  // the web, then the local AI answers from the pages
  ['what is the latest node.js version', 'WEB_AI'], ["what happened in today's AI news", 'WEB_AI'], ['what is the price of RTX 5060 in India', 'WEB_AI'],
  ['find the latest nvidia driver for rtx 3050', 'WEB_AI'], ['find the official documentation for React', 'WEB_OPEN'],
  ['find the latest React documentation and explain how hooks work', 'WEB_AI'], ['find latest information about react', 'WEB_AI'],
  ['what is the latest python version', 'WEB_AI'], ['who won the last ipl', 'WEB_AI'], ['what does the internet say about bun vs node', 'WEB_AI'],
  ['upcoming release date of gta 6', 'WEB_AI'],
  // places → Google Maps
  ['what are the nearest restaurants to bengaluru(kodigehalli)', 'MAPS'], ['hotels near me', 'MAPS'], ['best cafes in indiranagar', 'MAPS'],
  ['nearest hospital', 'MAPS'], ['where can i find an atm near kodigehalli', 'MAPS'], ['any good pg near kodigehalli', 'MAPS'], ['restaurants in my area', 'MAPS'],
  // …but not statements, food questions, or your own files
  ['i am at the park', 'LOCAL_AI'], ['i went to the hospital yesterday', 'LOCAL_AI'], ['what food is good for health', 'LOCAL_AI'],
  // explicit "search google" → the browser
  ['search google for binary search visualizer', 'WEB_LINKS'], ['google rust vs go', 'WEB_LINKS'],
];
for (const [t, want] of CASES) {
  const r = route(t);
  // a rule may legitimately own a web request (RESEARCH / WEATHER / WEB_SEARCH are tools that go online themselves)
  const ok = r.route === want || (want === 'LOCAL' && r.route === 'TOOL' && /^(ASK_FILES|READ_FILE|SEARCH_FILES|LIST_FILES|OPEN_FOLDER|LOCATE_PROJECT|SUMMARISE_FILE|EXPLAIN_FILE)$/.test(r.intent)) || (want === 'WEB_AI' && r.route === 'TOOL' && /^(RESEARCH|WEATHER|CONTESTS|HACKATHONS|OPEN_WEB)$/.test(r.intent)) || (want === 'WEB_LINKS' && r.route === 'TOOL' && /^(WEB_SEARCH|SITE_SEARCH)$/.test(r.intent));
  check('Route', '"' + t + '" → ' + want, ok, r.route + ' (' + r.intent + ') — ' + r.reason);
}
// Online tools off: fresh questions are offered the web, never answered silently from stale memory
for (const t of ['what is the latest node.js version', 'what are the latest react features', "what happened in today's AI news"]) {
  const r = route(t, { online: false });
  check('Offline', '"' + t + '" with Online tools off → ask to turn it on', r.route === 'OFFER_ONLINE' || (r.route === 'TOOL' && /^RESEARCH$/.test(r.intent)), r.route + ' ' + r.reason);
}
for (const t of ['explain binary search simply', 'open chrome', 'fix the previous python file', 'find the official documentation for React', 'search google for rust vs go', 'nearest hospital']) {
  const r = route(t, { online: false });
  check('Offline', '"' + t + '" needs no web → unaffected when offline', r.route !== 'OFFER_ONLINE', r.route);
}
// the Maps search is what you meant, with "near me" when no place is named
for (const [t, want] of [['what are the nearest restaurants to bengaluru(kodigehalli)', 'restaurants near bengaluru kodigehalli'], ['nearest hospital', 'hospital near me'], ['restaurants in my area', 'restaurants near me'], ['hotels near me', 'hotels near me']])
  check('Maps', '"' + t + '" → maps search "' + want + '"', Decider.mapsQuery(t) === want, Decider.mapsQuery(t));
// places understood as category + location (most specific first) + sort
for (const [t, cat, loc, sort, q] of [
  ['what are the nearest restaurants to bengaluru(kodigehalli)', 'restaurants', 'Kodigehalli, Bengaluru', 'nearest', 'nearest restaurants near Kodigehalli, Bengaluru'],
  ['nearest restaurants to kodigehalli in bengaluru', 'restaurants', 'Kodigehalli, Bengaluru', 'nearest', 'nearest restaurants near Kodigehalli, Bengaluru'],
  ['petrol bunks near yelahanka in bengaluru', 'petrol bunks', 'Yelahanka, Bengaluru', 'relevance', 'petrol bunks near Yelahanka, Bengaluru'],
  ['cheap hostels in koramangala, bengaluru', 'hostels', 'Koramangala, Bengaluru', 'cheapest', 'cheap hostels near Koramangala, Bengaluru'],
  ['best cafes in indiranagar', 'cafes', 'Indiranagar', 'best rated', 'best cafes near Indiranagar'],
  ['nearest hospital', 'hospital', 'your current location', 'nearest', 'hospital near me'],
  ['pharmacy open now near hebbal', 'pharmacy', 'Hebbal', 'open now', 'pharmacy open now near Hebbal']]) {
  const r = Decider.placeQuery(t);
  check('Places', '"' + t + '" → ' + cat + ' · ' + loc + ' · ' + sort, r.category === cat && r.location === loc && r.sort === sort && r.query === q, JSON.stringify(r));
}
/* ---------- conflicts: several signals at once — the route that matches what you MEANT ---------- */
for (const [t, want, why] of [
  // ACTION + PLACE: places beat the generic "open the best web page"
  ['open the nearest restaurant to kodigehalli', 'MAPS', 'action+place'], ['find the nearest atm and open it', 'MAPS', 'action+place'],
  ['search for hotels near majestic', 'MAPS', 'source+place'],
  // …but a real command still wins
  ['open chrome', 'TOOL', 'action only'], ['open the restaurant.py file', 'TOOL', 'action+local file'],
  // PLACE + LOCAL: your own files win
  ['open my restaurant folder', 'TOOL', 'place word + my folder'], ['find the hospital notes in my project', 'TOOL', 'place word + my project'],
  // PLACE + FRESH
  ['restaurants open now near hebbal', 'MAPS', 'place+fresh(now)'],
  // LOCAL + FRESH: "latest" about your things is local
  ['what is the latest file in my project', 'TOOL', 'local+fresh → newest file'], ['open my latest notes', 'TOOL', 'local+fresh → reads your notes'],
  // MACHINE + FRESH: "version" of what's installed here is local
  ['what version of node am i running', 'TOOL', 'machine+fresh(version)'], ['which python version do i have installed', 'TOOL', 'machine+fresh'],
  ['is my gpu driver up to date', 'LOCAL', 'machine+fresh(driver)'],
  // ACTION-ish + FRESH: updating software is a how-to, not news
  ['update my node.js', 'GUIDE', 'install+fresh(update)'], ['install python on my laptop', 'GUIDE', 'install+machine'],
  // FRESH alone / FRESH + SOURCE
  ['what is the latest python version', 'WEB_AI', 'fresh'], ['what does the official documentation say about react hooks', 'WEB_AI', 'source+question'],
  // SHOW vs EXPLAIN: the page itself vs an answer from it
  ['find react documentation', 'WEB_OPEN', 'show page'], ['open the latest node.js documentation', 'WEB_OPEN', 'action(open best page)+fresh → the page'],
  ['explain the latest react documentation', 'WEB_AI', 'reasoning+fresh+source'], ['search google for react 20', 'WEB_LINKS', 'explicit search'],
  // LOCAL + SOURCE: you explicitly asked for the web
  ['search the web for my laptop model specs', 'WEB_LINKS', 'source+machine'],
  // QUESTION + ACTION / QUESTION + LOCAL / QUESTION + PLACE
  ['can you open chrome', 'TOOL', 'question+action'], ['what does my notes.md say about paging', 'TOOL', 'question+local'],
  ['where are the nearest hospitals', 'MAPS', 'question+place'],
  // statements are not requests
  ['i am at the park', 'LOCAL_AI', 'statement with a place word'], ['binary search is fast', 'LOCAL_AI', 'noun "search"'],
]) {
  const r = route(t);
  const ok = r.route === want || (want === 'WEB_OPEN' && r.route === 'TOOL' && r.intent === 'OPEN_WEB') || (want === 'WEB_LINKS' && r.route === 'TOOL' && /^(WEB_SEARCH|SITE_SEARCH)$/.test(r.intent));
  check('Conflict', why + ': "' + t + '" → ' + want, ok, r.route + ' (' + r.intent + ') — ' + r.reason);
}
/* ---------- adversarial: the review's conflict cases — route AND the command that will actually run ---------- */
for (const [t, wantRoute, wantIntent] of [
  // place vs local
  ['find restaurants near kodigehalli', 'MAPS', /./], ['find my restaurant project', 'TOOL', /^LOCATE_PROJECT$/],
  ['open the nearest restaurant', 'MAPS', /^OPEN_WEB$/], ['open my restaurant folder', 'TOOL', /^OPEN_FOLDER$/],
  // local vs web
  ['what is the latest node.js version', 'WEB_AI', /./], ['what version of node am i running', 'TOOL', /^TOOL_VERSION$/],
  ['what is the latest file in my project', 'TOOL', /^RECENT_FILES$/], ['find the latest information about my project', 'LOCAL', /^CONVERSATION$/],
  ['find the login code in my project', 'TOOL', /^ASK_FILES$/], ['find where we handle payments in the codebase', 'TOOL', /^ASK_FILES$/],
  // web vs page
  ['find react documentation', 'WEB_OPEN', /./], ['explain the latest react documentation', 'WEB_AI', /./], ['search google for react documentation', 'WEB_LINKS', /./],
  // action vs web: an app name next to "documentation" is the PAGE, not the app
  ['open chrome', 'TOOL', /^OPEN_APPLICATION$/], ['open the latest chrome documentation', 'TOOL', /^OPEN_WEB$/], ['open the vs code documentation', 'TOOL', /^OPEN_WEB$/],
  ['open vs code in dsa_sprint', 'TOOL', /^OPEN_IN_EDITOR$/], ['open the docs folder in vs code', 'TOOL', /^OPEN_IN_EDITOR$/],
  // place vs generic page
  ['open the nearest atm', 'MAPS', /^OPEN_WEB$/], ['open google maps', 'TOOL', /^OPEN_APPLICATION$/],
  // "find" is four different things
  ['find pythonproject', 'LOCAL', /./], ['find react documentation', 'WEB_OPEN', /./], ['find restaurants near me', 'MAPS', /./], ['find the latest python version', 'WEB_AI', /./],
]) {
  const r = route(t);
  check('Adversarial', '"' + t + '" → ' + wantRoute + ' (' + String(wantIntent).replace(/[\/^$]/g, '') + ')', r.route === wantRoute && wantIntent.test(r.intent), r.route + ' [' + r.intent + '] — ' + r.reason);
}
// every decision carries a payload and a confidence; conflicts are flagged as less certain
{
  const a = route('what are the nearest restaurants to bengaluru(kodigehalli)');
  check('Payload', 'MAPS carries the place already worked out (category, location, sort)', a.payload && a.payload.category === 'restaurants' && a.payload.location === 'Kodigehalli, Bengaluru' && a.payload.sort === 'nearest', JSON.stringify(a.payload));
  check('Payload', 'every route has a confidence between 0 and 1', CASES.every(([t]) => { const c = route(t).confidence; return c > 0 && c <= 1; }));
  check('Payload', 'a conflict (action + place) is marked less certain than a clean one', route('open the nearest restaurant to kodigehalli').confidence < route('hotels near me').confidence);
}
// every decision explains itself
check('Reason', 'every decision has a one-line reason', CASES.every(([t]) => route(t).reason.length > 10));
check('Reason', 'the reason names the trigger word', /“latest”/.test(route('what is the latest node.js version').reason));
done();
