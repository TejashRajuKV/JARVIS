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
  ['continue the calculator project', 'LOCAL'], ['what is in my latest file', 'LOCAL'], ['explain the code in this file', 'LOCAL'],
  // the web, then the local AI answers from the pages
  ['what is the latest node.js version', 'WEB_AI'], ["what happened in today's AI news", 'WEB_AI'], ['what is the price of RTX 5060 in India', 'WEB_AI'],
  ['find the latest nvidia driver for rtx 3050', 'WEB_AI'], ['find the official documentation for React', 'WEB_AI'],
  ['find the latest React documentation and explain how hooks work', 'WEB_AI'], ['find latest information about react', 'WEB_AI'],
  ['what is the latest python version', 'WEB_AI'], ['who won the last ipl', 'WEB_AI'], ['what does the internet say about bun vs node', 'WEB_AI'],
  ['upcoming release date of gta 6', 'WEB_AI'],
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
for (const t of ['what is the latest node.js version', 'find the official documentation for React', "what happened in today's AI news"]) {
  const r = route(t, { online: false });
  check('Offline', '"' + t + '" with Online tools off → ask to turn it on', r.route === 'OFFER_ONLINE' || (r.route === 'TOOL' && /^RESEARCH$/.test(r.intent)), r.route + ' ' + r.reason);
}
for (const t of ['explain binary search simply', 'open chrome', 'fix the previous python file']) {
  const r = route(t, { online: false });
  check('Offline', '"' + t + '" needs no web → unaffected when offline', r.route !== 'OFFER_ONLINE', r.route);
}
// every decision explains itself
check('Reason', 'every decision has a one-line reason', CASES.every(([t]) => route(t).reason.length > 10));
check('Reason', 'the reason names the trigger word', /“latest”/.test(route('what is the latest node.js version').reason));
done();
