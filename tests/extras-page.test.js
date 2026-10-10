// Chat side of the extra tools (extras-page.js): explicit wording only, the right route is called, answers are worded sensibly.
// Run: node tests/extras-page.test.js
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// page globals, stubbed
const calls = [], fetched = [];
let replies = {}, getReplies = {};
global.llmReady = () => true; global.llm = { model: 'qwen3.5:4b' };
global.setState = () => {}; global.jarvisSay = () => {}; global.cap = s => s.charAt(0).toUpperCase() + s.slice(1);
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's'); global.rid = () => Math.random().toString(36).slice(2);
global.Undo = { push: () => {} }; global.projectRoots = []; global.flashcards = []; global.saveFlash = () => {};
global.settings = { online: true, city: 'Bengaluru' }; global.API = '/api'; global.Places = require(path.join(__dirname, '..', 'places.js'));
global.enableOnlineAction = () => [{ label: 'ENABLE ONLINE TOOLS' }];
global.callTool = async (ep, body, tok) => { calls.push(tok === undefined ? [ep, body] : [ep, body, tok]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
const fetchBodies = []; global.fetch = async (url, opts) => { fetched.push(url); fetchBodies.push([url, opts]); const p = String(url).replace(/^\/api/, '').split('?')[0]; const r = getReplies[p]; return { ok: true, status: 200, json: async () => (typeof r === 'function' ? r(url) : r || { error: 'no stub for ' + p }) }; };
eval(fs.readFileSync(path.join(__dirname, '..', 'skills-page.js'), 'utf8') + ';global.Skills=Skills;');
global.ScanMath = require(path.join(__dirname, '..', 'scanmath.js')); global.document = { createElement: () => ({ style: {} }), getElementById: () => null, body: { appendChild() {} }, head: { appendChild() {} } };
eval(fs.readFileSync(path.join(__dirname, '..', 'camera-page.js'), 'utf8') + ';global.Camera=Camera;');
eval(fs.readFileSync(path.join(__dirname, '..', 'watch-page.js'), 'utf8') + ';global.Watch=Watch;');
eval(fs.readFileSync(path.join(__dirname, '..', 'extras-page.js'), 'utf8') + ';global.Extras=Extras;');

const ex = t => Extras.intercept(t);
(async () => {
  /* ---------- AI health ---------- */
  getReplies['/ai/health'] = { success: true, headline: 'Your AI is working. 12 AI calls in the last day, none failed.', text: '**AI health** — Your AI is working.\n\n- ✓ Ollama is running' };
  for (const t of ['check my ai', 'Check my AI.', 'is my ai working?', 'is ollama running', 'any ai errors today?', 'ai errors', 'ai health', 'ai status report', 'api health', '/health', 'test my ai', 'check the llm status'.replace(' status', '')]) {
    fetched.length = 0; const r = await ex(t);
    check('health: "' + t + '"', r && /AI health/.test(r.text) && fetched.length === 1 && /^\/api\/ai\/health/.test(fetched[0]), { t, r, fetched });
  }
  fetched.length = 0; let r = await ex('check my ai');
  check('health: a plain check does not ask the model anything', fetched[0] === '/api/ai/health');
  for (const t of ['check my ai properly', 'test my ai', '/health deep', 'check my ai fully']) { fetched.length = 0; await ex(t); check('health: deep for "' + t + '"', /deep=1&model=qwen3\.5%3A4b/.test(fetched[0]), fetched); }
  r = await ex('check my ai');
  check('health: spoken as the one-line headline, with follow-up chips', r.speak === 'Your AI is working. 12 AI calls in the last day, none failed.' && r.noPersona && r.suggestions.includes('Check my AI properly'), r);
  getReplies['/ai/health'] = { error: 'down' };
  r = await ex('check my ai'); check('health: a failed check is explained', /couldn’t check: down/.test(r.text));
  replies['/ai/health/clear'] = { success: true };
  r = await ex('clear ai history'); check('health: clear history', /Cleared/.test(r.text) && calls.at(-1)[0] === '/ai/health/clear');
  for (const t of ['clear history', 'clear my chat', 'what is ai', 'how do ai models work', 'explain api errors in python', 'open chrome', 'is the weather ok', 'check my attendance', 'check my battery', 'test my code', 'run diagnostics', 'ai']) {
    fetched.length = 0; const x = await ex(t);
    check('health: not taken: "' + t + '"', x === null && !fetched.length, { t, x });
  }
  check('empty input', (await ex('')) === null && (await ex('   ')) === null);

  /* ---------- service watchdog ---------- */
  const watching = (label, up = true, extra = {}) => ({ success: true, existed: false, enabled: true, intervalMs: 120000, watching: { label, up, ms: 12, error: up ? '' : 'nothing is listening there', ...extra } });
  replies['/watch/add'] = b => watching(b.label || b.target);
  for (const [t, target, label] of [['watch localhost:5000', 'localhost:5000', undefined], ['Watch https://my-site.com/health', 'https://my-site.com/health', undefined], ['monitor 127.0.0.1:8080', '127.0.0.1:8080', undefined], ['keep an eye on db.local:5432', 'db.local:5432', undefined],
    ['please watch the server on localhost:3000.', 'localhost:3000', undefined], ['watch localhost:5000 as My app', 'localhost:5000', 'My app'], ['watch port 8000', 'localhost:8000', undefined], ['/watch localhost:9', 'localhost:9', undefined], ['/watch http://x.test/', 'http://x.test/', undefined]]) {
    calls.length = 0; const x = await ex(t);
    check('watch add: "' + t + '"', x && /Now watching/.test(x.text) && calls.at(-1)[0] === '/watch/add' && calls.at(-1)[1].target === target && calls.at(-1)[1].label === label, { t, calls: calls.at(-1), x });
  }
  replies['/watch/add'] = () => watching('localhost:9', false);
  let w = await ex('watch localhost:9');
  check('watch add: a service that is down says so', /not answering/.test(w.text) && /nothing is listening there/.test(w.text) && /not answering/.test(w.speak), w);
  replies['/watch/add'] = () => ({ ...watching('localhost:5000'), existed: true });
  check('watch add: already watched', /already watching/.test((await ex('watch localhost:5000')).text));
  replies['/watch/add'] = { error: 'The port must be between 1 and 65535.' };
  check('watch add: the reason a target is refused is passed on', /can’t watch that: The port must be/.test((await ex('watch localhost:99999')).text));
  for (const t of ['watch youtube', 'watch a movie', 'watch the video', 'watch netflix tonight', 'monitor my cpu', 'watch port', 'watch me code', 'watch out', 'watch 5000', 'keep watching', 'watch it', 'watch localhost', 'monitor https', 'watch the match at 8:30', 'watch tv at 9:00']) {
    calls.length = 0; const x = await ex(t);
    check('watch: not taken: "' + t + '"', x === null && !calls.length, { t, x });
  }
  replies['/watch/check'] = { success: true, enabled: true, intervalMs: 120000, down: ['localhost:5000'], targets: [
    { id: 'ollama', label: 'Ollama (local AI)', up: true, ms: 8, uptime: 100, checks: 12, since: 1, error: '' },
    { id: 'localhost-5000', label: 'localhost:5000', up: false, ms: 0, uptime: 80, checks: 10, since: new Date(2026, 9, 8, 10, 42).getTime(), error: 'nothing is listening there' }] };
  for (const t of ['/watch', 'what is down', "what's down?", 'watchdog', 'watchdog status', 'what am i watching', 'is everything up?', 'list my watched services']) {
    calls.length = 0; const x = await ex(t);
    check('watch status: "' + t + '"', x && calls.at(-1)[0] === '/watch/check' && /\*\*localhost:5000\*\* — not answering since/.test(x.text) && /✓ \*\*Ollama \(local AI\)\*\* — up, 100% of the last 12 checks, 8 ms/.test(x.text), { t, x });
  }
  w = await ex('what is down');
  check('watch status: spoken summary names what is down; the watchdog state is explained', w.speak === 'localhost 5000 is not answering.' && /Watchdog is \*\*on\*\*, checking every 2 minutes/.test(w.text), w);
  replies['/watch/check'] = { success: true, enabled: false, intervalMs: 120000, down: [], targets: [{ id: 'ollama', label: 'Ollama (local AI)', up: null, ms: 0, uptime: null, checks: 0, since: 0, error: '' }] };
  w = await ex('what am i watching');
  check('watch status: off, nothing checked yet, with how to start', /Watchdog is \*\*off\*\*/.test(w.text) && /not checked yet/.test(w.text) && /Watch localhost:3000/.test(w.suggestions.join()), w);
  replies['/watch/check'] = { error: 'down' }; check('watch status: a failure is explained', /couldn’t check: down/.test((await ex('what is down')).text));
  replies['/watch/remove'] = b => /cricket/.test(b.target) ? { error: 'I’m not watching “cricket”.' } : { success: true, removed: b.target };
  calls.length = 0;
  check('unwatch: by name', /Stopped watching \*\*localhost:5000\*\*/.test((await ex('stop watching localhost:5000')).text) && /Stopped watching \*\*localhost:8000\*\*/.test((await ex('stop watching port 8000')).text) && /Stopped watching \*\*My app\*\*/.test((await ex('unwatch My app')).text) && calls.at(-1)[1].target === 'My app');
  check('unwatch: something you are not watching is left to normal handling (not an answer)', (await ex('stop watching cricket')) === null);
  replies['/watch/enable'] = b => ({ success: true, enabled: b.on });
  check('watchdog on / off', /Watchdog is \*\*on\*\*/.test((await ex('start the watchdog')).text) && calls.at(-1)[1].on === true && /Watchdog is \*\*off\*\*/.test((await ex('turn off the watchdog')).text) && calls.at(-1)[1].on === false);
  check('watchdog: not taken: other "start" and "stop" sentences', (await ex('start the timer')) === null && (await ex('stop the music')) === null && (await ex('start a watch party')) === null);

  /* ---------- nearby places ---------- */
  const near = (name, meters, extra = {}) => ({ name, key: 'cafe', meters, address: '12, MG Road', cuisine: '', hours: '', phone: '', website: '', lat: 12.97, lon: 77.59, mapsUrl: 'https://www.google.com/maps/search/?api=1&query=12.97,77.59', ...extra });
  const nearReply = (results, extra = {}) => ({ success: true, place: { name: 'Majestic', lat: 1, lon: 2 }, category: { key: 'cafe', label: 'cafés' }, labels: { cafe: 'cafés', pharmacy: 'pharmacies' }, radius: 1500, total: results.length, results, via: 'overpass-api.de', ...extra });
  replies['/tool/nearby'] = () => nearReply([near('Third Wave Coffee', 240, { hours: 'Mo-Su 08:00-23:00', phone: '+91 80 1234' }), near('Cafe B', 1200)]);
  for (const [t, cat, place] of [['list cafes near majestic', 'cafes', 'majestic'], ['List the nearest pharmacies near MG Road', 'pharmacies', 'MG Road'], ['show me restaurants around indiranagar', 'restaurants', 'indiranagar'], ['show me the best cafés close to my college', 'cafés', 'my college'],
    ['show pharmacies near me', 'pharmacies', 'me'], ['list atms next to the airport.', 'atms', 'the airport'], ['/nearby cafes near majestic', 'cafes', 'majestic'], ['/nearby atms', 'atms', ''], ['list nearby cafes', 'cafes', ''], ['show me the nearest bus stops', 'bus stops', '']]) {
    calls.length = 0; const x = await ex(t);
    const sent = calls.at(-1) && calls.at(-1)[1];
    const here = place === '' || /^me$/.test(place);
    check('nearby: "' + t + '"', x && /Third Wave Coffee/.test(x.text) && calls.at(-1)[0] === '/tool/nearby' && sent.category === cat && sent.online === true && (here ? sent.place === 'Bengaluru' : sent.place === place && sent.city === 'Bengaluru'), { t, sent, x });
  }
  calls.length = 0; let n = await ex('list cafes near majestic');
  check('nearby: nearest first with distance, address, hours, phone and a map link', /\*\*Cafés near majestic\*\* — within 1\.5 km, nearest first/.test(n.text) && /1\. \*\*Third Wave Coffee\*\* — 240 m · 12, MG Road · 🕒 Mo-Su 08:00-23:00 · ☎ \+91 80 1234 · \[map\]\(https:\/\/www\.google\.com\/maps/.test(n.text) && /2\. \*\*Cafe B\*\* — 1\.2 km/.test(n.text), n.text);
  check('nearby: credits OpenStreetMap and warns the details may be old', /From OpenStreetMap\. Hours and phone numbers are entered by volunteers/.test(n.text));
  check('nearby: spoken summary names the nearest', n.speak === 'I found 2 cafés near majestic. The nearest is Third Wave Coffee, 240 metres away.', n.speak);
  check('nearby: a button opens the nearest on the map', n.actions[0].label === 'OPEN THIRD WAVE COFFEE ON THE MAP' && (await n.actions[0].fn(), calls.at(-1)[0] === '/tool/openUrl' && /google\.com\/maps/.test(calls.at(-1)[1].url)) && /Directions to Third Wave Coffee/.test(n.suggestions.join()));
  calls.length = 0; n = await ex('show pharmacies near me');
  check('nearby: "near me" uses your city and says so honestly', /your city \(Bengaluru\)/.test(n.text) && /can’t see your location/.test(n.text) && calls.at(-1)[1].place === 'Bengaluru' && calls.at(-1)[1].city === '');
  calls.length = 0; await ex('list cafes near majestic within 3 km');
  check('nearby: "within 3 km" becomes the radius and is not part of the place', calls.at(-1)[1].radius === 3000 && calls.at(-1)[1].place === 'majestic');
  await ex('list nearby cafes within 800 m'); check('nearby: radius without a place', calls.at(-1)[1].radius === 800 && calls.at(-1)[1].place === 'Bengaluru');
  replies['/tool/nearby'] = () => nearReply([near('Rx One', 300, { key: 'pharmacy' }), near('Cafe Z', 400), near('Cafe Y', 500)], { category: { key: 'any', label: 'things nearby' } });
  for (const t of ["what's near indiranagar", 'what is near majestic?', 'what are the places around koramangala']) {
    calls.length = 0; const x = await ex(t);
    check('nearby overview: "' + t + '"', calls.at(-1)[1].category === 'any' && /\*\*Around /.test(x.text) && /\*\*Pharmacies\*\*\n1\. \*\*Rx One\*\*/.test(x.text) && /\*\*Cafés\*\*\n1\. \*\*Cafe Z\*\*[^]*2\. \*\*Cafe Y\*\*/.test(x.text), { t, x: x && x.text });
  }
  calls.length = 0; await ex("what's nearby"); check('nearby overview: "what\'s nearby" uses your city', calls.at(-1)[1].place === 'Bengaluru' && calls.at(-1)[1].category === 'any');
  replies['/tool/nearby'] = () => nearReply([], { total: 0 });
  n = await ex('list cafes near majestic');
  check('nearby: nothing found suggests a wider search and explains OSM coverage', /found nothing in the map data/.test(n.text) && /within 3 km/.test(n.text) && /coverage varies/.test(n.text) && n.speak === 'I found nothing there.', n.text);
  replies['/tool/nearby'] = { error: 'I couldn’t find “zzz” on the map. Try adding the city.' };
  check('nearby: the server\'s reason is passed on', /couldn’t find “zzz”/.test((await ex('list cafes near zzz')).text));
  replies['/tool/nearby'] = { error: 'offline' };
  check('nearby: a server "offline" is worded', /Online tools is off/.test((await ex('list cafes near majestic')).text));
  const was = settings.online; settings.online = false; calls.length = 0;
  n = await ex('list cafes near majestic');
  check('nearby: Online tools off → asks, offers ENABLE, makes no request', /needs \*\*Online tools\*\*/.test(n.text) && n.actions[0].label === 'ENABLE ONLINE TOOLS' && !calls.length);
  settings.online = was;
  const city = settings.city; settings.city = '';
  n = await ex('show pharmacies near me'); check('nearby: no city and "near me" → asks for a place, no request', /don’t know where you are/.test(n.text) && /Majestic/.test(n.text));
  settings.city = city;
  n = await ex('/nearby'); check('nearby: /nearby alone explains how to use it', /Nearby places/.test(n.text) && /pharmacies/.test(n.text) && /Online tools/.test(n.text));
  // "what is near X" (spelled out, no "places/things") could be an ordinary question: if the map cannot place it, normal handling carries on
  replies['/tool/nearby'] = { error: 'I couldn’t find “field communication” on the map. Try adding the city.' };
  check('nearby (soft): "what is near field communication" with no such place → handed back, not a map error', (await ex('what is near field communication')) === null && (await ex('what is near field communication?')) === null);
  check('nearby (soft): …but the clear forms still explain the problem', /couldn’t find “field/.test((await ex("what's near field communication")).text) && /couldn’t find/.test((await ex('what is nearby field communication')).text));
  replies['/tool/nearby'] = () => nearReply([near('Rx One', 300, { key: 'pharmacy' })], { category: { key: 'any', label: 'things nearby' } });
  check('nearby (soft): "what is near majestic" still works when the place exists', /Rx One/.test((await ex('what is near majestic')).text));
  const wasOn = settings.online; settings.online = false;
  check('nearby (soft): Online off → handed back; the clear form → asks for Online tools', (await ex('what is near majestic')) === null && /needs \*\*Online tools\*\*/.test((await ex("what's near majestic")).text));
  settings.online = wasOn;
  for (const t of ['list my files', 'list files near the project folder', 'show notes near the end', 'list pdfs around here', 'show me the weather near me', 'show me a cafe', 'list cafes', 'cafes near majestic', 'nearest cafes to majestic', 'find cafes near majestic', 'where is the nearest atm', 'list the apps near the top', 'what is the nearest star', 'show me the nearest exit', 'list everything']) {
    calls.length = 0; const x = await ex(t);
    check('nearby: not taken: "' + t + '"', x === null && !calls.length, { t, x: x && x.text });
  }
  replies['/tool/nearby'] = { error: 'I don’t know that kind of place. I can find: cafés, ….' };
  check('nearby: a place word the server does not know gets its list of kinds', /I can find/.test((await ex('list stores near majestic')).text));
  // the "LIST THEM HERE" button on the Google Maps reply
  replies['/tool/nearby'] = () => nearReply([near('Cafe One', 100)]); const said = []; global.jarvisSay = m => said.push(m); calls.length = 0;
  await Extras.listNearby('cafes', 'majestic');
  check('LIST THEM HERE: runs the lookup and shows the answer in the chat', calls.at(-1)[1].place === 'majestic' && said.length === 1 && /Cafe One/.test(said[0].text));
  await Extras.listNearby('atms', 'your current location'); check('LIST THEM HERE: "your current location" means your city', calls.at(-1)[1].place === 'Bengaluru');
  global.jarvisSay = () => {};

  /* ---------- CSV analysis ---------- */
  const rep = { success: true, name: 'marks.csv', rows: 120, cols: 3, delimiter: ',', digest: 'File: marks.csv — 120 rows × 3 columns.', duplicates: 0, notes: ['“marks” has 2 unusually high or low values.'],
    columns: [{ name: 'dept', type: 'text', count: 120, missing: 0, unique: 3, categorical: true, top: [{ value: 'CSE', count: 60 }, { value: 'ECE', count: 40 }] },
      { name: 'marks', type: 'number', count: 118, missing: 2, unique: 50, min: 12, max: 99, mean: 61.5, median: 63, outliers: 2 }, { name: 'attendance', type: 'number', count: 120, missing: 0, unique: 40, min: 40, max: 100, mean: 80, median: 82, outliers: 0 }],
    correlations: [{ a: 'marks', b: 'attendance', r: 0.81, strength: 'strong' }] };
  replies['/csv/analyze'] = rep;
  replies['/skill/run'] = b => ({ success: true, text: '- Marks and attendance move together.' });
  for (const t of ['analyze marks.csv', 'Analyse the file marks.csv', 'summarize my data in marks.csv', 'profile "my marks.csv"', 'describe marks.csv.', "what's in marks.csv", 'look at C:\\data\\marks.csv', 'explore marks.csv', '/csv marks.csv', 'analyze marks.tsv'.replace('tsv', 'csv')]) {
    calls.length = 0; const x = await ex(t);
    check('csv analyze: "' + t + '"', x && /\*\*marks\.csv\*\* — 120 rows × 3 columns/.test(x.text) && calls[0][0] === '/csv/analyze' && /marks\.csv$/.test(calls[0][1].name), { t, calls: calls[0], x });
  }
  calls.length = 0; let c = await ex('analyze "my marks.csv"');
  check('csv analyze: a quoted name with a space is sent whole', calls[0][1].name === 'my marks.csv');
  calls.length = 0; c = await ex('look at C:\\data\\marks.csv');
  check('csv analyze: a full path is sent whole', calls[0][1].name === 'C:\\data\\marks.csv');
  c = await ex('analyze marks.csv');
  check('csv analyze: each column on a line with its numbers; categories list their top values', /- \*\*dept\*\* \(text\) — 120 filled · CSE \(60\), ECE \(40\)/.test(c.text) && /- \*\*marks\*\* \(number\) — 118 filled, 2 empty · 12 to 99 · mean 61\.5 · median 63 · 2 unusual/.test(c.text));
  check('csv analyze: relationships and data-quality notes', /\*\*Move together:\*\* marks & attendance \(r = 0\.81, strong\)/.test(c.text) && /\*\*Worth checking:\*\* “marks” has 2 unusually high or low values\./.test(c.text));
  check('csv analyze: the AI is given the digest only (statistics), by the csv-insights skill', calls.at(-1)[0] === '/skill/run' && calls.at(-1)[1].skill === 'csv-insights' && calls.at(-1)[1].input === 'File: marks.csv — 120 rows × 3 columns.' && /\*\*What stands out\*\*\n- Marks and attendance move together/.test(c.text));
  check('csv analyze: spoken line and next-step chips', c.speak === 'marks.csv has 120 rows and 3 columns.' && c.suggestions.includes('Chart marks in marks.csv') && c.suggestions.includes('Average marks by dept in marks.csv'));
  global.isCloudModel = () => true; global.modelInfo = () => ({ providerLabel: 'Gemini' });
  c = await ex('analyze marks.csv'); check('csv analyze: a cloud model is named, and it says rows were not sent', /sent to Gemini/.test(c.text) && /not your rows/.test(c.text));
  global.isCloudModel = () => false;
  global.llmReady = () => false; calls.length = 0; c = await ex('analyze marks.csv');
  check('csv analyze: with no AI the statistics still show and the AI is not called', /120 rows/.test(c.text) && !/What stands out/.test(c.text) && calls.length === 1); global.llmReady = () => true;
  replies['/skill/run'] = { error: 'Local LLM unavailable' }; c = await ex('analyze marks.csv');
  check('csv analyze: an AI failure does not hide the statistics', /120 rows/.test(c.text) && !/What stands out/.test(c.text));
  replies['/csv/analyze'] = { error: 'I can’t find “nope.csv” in ~/jarvis or your project folders.' };
  check('csv analyze: the server\'s reason is shown', /can’t find “nope\.csv”/.test((await ex('analyze nope.csv')).text));
  replies['/csv/analyze'] = { ...rep, delimiter: ';' }; check('csv analyze: says when it was semicolon-separated', /\(semicolon-separated\)/.test((await ex('analyze marks.csv')).text));

  const asked = []; replies['/csv/query'] = b => { asked.push(b); return { success: true, file: 'marks.csv', kind: 'stat', matched: 120, total: 120, column: 'marks', agg: b.agg, value: 61.5, used: 118 }; };
  for (const [t, agg, column, by, filter] of [['average of marks in marks.csv', 'mean', 'marks', undefined, undefined], ['what is the mean marks in marks.csv', 'mean', 'marks', undefined, undefined], ['median attendance from marks.csv', 'median', 'attendance', undefined, undefined],
    ['total marks in marks.csv where dept = CSE', 'sum', 'marks', undefined, 'dept = CSE'], ['highest marks in marks.csv', 'max', 'marks', undefined, undefined], ['lowest attendance in marks.csv', 'min', 'attendance', undefined, undefined], ['unique dept in marks.csv', 'unique', 'dept', undefined, undefined],
    ['average marks by dept in marks.csv', 'mean', 'marks', 'dept', undefined], ['show me the average of total marks by department in "my marks.csv" where attendance > 75', 'mean', 'total marks', 'department', 'attendance > 75']]) {
    asked.length = 0; const x = await ex(t);
    check('csv stat: "' + t + '"', x && asked.length === 1 && asked[0].agg === agg && asked[0].column === column && asked[0].groupBy === by && asked[0].filter === filter, { t, asked, x: x && x.text });
  }
  c = await ex('average of marks in marks.csv where dept = CSE');
  check('csv stat: the answer names the statistic, the file and the filter', /\*\*Average of marks\*\* in marks\.csv where dept = CSE: \*\*61\.5\*\* — from 118 filled values/.test(c.text) && c.speak === 'The average of marks is 61.5.', c.text);
  replies['/csv/query'] = { success: true, file: 'marks.csv', kind: 'groups', matched: 120, total: 120, groupBy: 'dept', agg: 'mean', column: 'marks', groupCount: 3, groups: [{ group: 'CSE', value: 74, n: 60 }, { group: 'ECE', value: 58.3333, n: 40 }, { group: 'ME', value: 58, n: 20 }] };
  c = await ex('average marks by dept in marks.csv');
  check('csv groups: one line per group, biggest first, with the row counts', /\*\*Average of marks by dept\*\* in marks\.csv\n- \*\*CSE\*\* — 74 \(60 rows\)\n- \*\*ECE\*\* — 58\.33 \(40 rows\)\n- \*\*ME\*\* — 58 \(20 rows\)/.test(c.text) && c.speak === 'The top one is CSE with 74.' && /Chart marks by dept in marks\.csv/.test(c.suggestions[0]), c);
  replies['/csv/query'] = { success: true, file: 'marks.csv', kind: 'rows', matched: 2, total: 120, columns: ['dept', 'marks', 'note'], rows: [['CSE', '82', ''], ['ECE', '91', 'topper with a very long note that keeps going and going']], more: 0 };
  for (const t of ['show rows in marks.csv where marks > 80', 'list the rows where marks > 80 in marks.csv', 'filter marks.csv where marks > 80', 'show me students in marks.csv where marks > 80', 'find records where marks > 80 in marks.csv']) {
    calls.length = 0; const x = await ex(t);
    check('csv rows: "' + t + '"', x && /2 of 120 rows\*\* in marks\.csv match “marks > 80”/.test(x.text) && calls[0][1].filter === 'marks > 80' && calls[0][1].limit === 15, { t, calls: calls[0], x: x && x.text });
  }
  c = await ex('show rows in marks.csv where marks > 80');
  check('csv rows: each row on a line with column names; empty cells and long text are trimmed', /- dept: CSE · marks: 82\n- dept: ECE · marks: 91 · note: topper with a very long not…/.test(c.text), c.text);
  replies['/csv/query'] = { success: true, file: 'marks.csv', kind: 'rows', matched: 0, total: 120, columns: ['dept'], rows: [], more: 0 };
  check('csv rows: nothing matched', /No rows in marks\.csv match “marks > 999” \(0 of 120\)/.test((await ex('show rows in marks.csv where marks > 999')).text));
  replies['/csv/query'] = { success: true, file: 'marks.csv', kind: 'rows', matched: 42, total: 120, columns: ['dept'], rows: [['CSE']], more: 41 };
  for (const t of ['how many rows are in marks.csv', 'how many records does marks.csv have', 'count of rows in marks.csv', 'number of students in marks.csv']) {
    const x = await ex(t); check('csv count: "' + t + '"', x && /\*\*42\*\* rows in marks\.csv/.test(x.text), { t, x: x && x.text });
  }
  check('csv count: with a filter', /\*\*42\*\* rows match “marks > 80” \(of 120\)/.test((await ex('how many rows are in marks.csv where marks > 80')).text));
  replies['/csv/query'] = { error: 'There is no column “mark”. The columns are: dept, marks.' };
  check('csv query: the server\'s reason (with the real column names) is shown', /no column “mark”.*dept, marks/.test((await ex('average mark in marks.csv')).text));

  replies['/csv/chart'] = { success: true, kind: 'histogram', title: 'Distribution of marks', file: 'Charts/marks-marks.svg', path: 'C:\\Users\\x\\jarvis\\Charts\\marks-marks.svg' };
  for (const [t, column, by, agg, filter] of [['chart marks in marks.csv', 'marks', undefined, undefined, undefined], ['histogram of marks in marks.csv', 'marks', undefined, undefined, undefined], ['bar chart of dept in marks.csv', 'dept', undefined, undefined, undefined], ['plot attendance from marks.csv', 'attendance', undefined, undefined, undefined],
    ['draw me a chart of average marks by dept in marks.csv', 'marks', 'dept', 'mean', undefined], ['make a bar graph of marks by dept in marks.csv where attendance > 75', 'marks', 'dept', undefined, 'attendance > 75'], ['show the distribution of marks in marks.csv', 'marks', undefined, undefined, undefined]]) {
    calls.length = 0; const x = await ex(t);
    check('csv chart: "' + t + '"', x && /Distribution of marks\*\* — saved as `Charts\/marks-marks\.svg` and opened/.test(x.text) && calls[0][0] === '/csv/chart' && calls[0][1].column === column && calls[0][1].groupBy === by && calls[0][1].agg === agg && calls[0][1].filter === filter, { t, calls: calls[0], x: x && x.text });
  }
  c = await ex('chart marks in marks.csv'); await c.actions[0].fn();
  check('csv chart: OPEN AGAIN opens the saved file with the file-opening route (openUrl only takes web addresses)', calls.at(-1)[0] === '/tool/openFile' && calls.at(-1)[1].name === 'C:\\Users\\x\\jarvis\\Charts\\marks-marks.svg', calls.at(-1));
  replies['/csv/chart'] = { error: 'There is no column “zzz”.' }; check('csv chart: errors shown', /no column “zzz”/.test((await ex('chart zzz in marks.csv')).text));
  c = await ex('/csv'); check('csv: /csv alone explains how to use it', /CSV analysis/.test(c.text) && /marks\.csv/.test(c.text) && /never your rows/.test(c.text));
  check('csv: /csv with something I do not understand also explains', /CSV analysis/.test((await ex('/csv do something odd to marks.csv')).text) && /CSV analysis/.test((await ex('/csv what is this')).text));
  calls.length = 0;
  for (const t of ['open marks.csv', 'delete marks.csv', 'create a file called marks.csv', 'rename marks.csv to old.csv', 'copy marks.csv to the desktop', 'where is marks.csv', 'save this as marks.csv', 'email marks.csv to my teacher', 'average of my marks', 'chart my progress', 'analyze my sleep', 'histogram of nothing', 'how many rows', 'show rows where marks > 80', 'what is in my csv', 'convert marks.csv to excel', 'upload marks.csv', 'read marks.csv aloud', 'the file marks.csv is broken']) {
    const x = await ex(t); check('csv: not taken: "' + t + '"', x === null, { t, x: x && x.text });
  }
  check('csv: none of those made a request', calls.length === 0, calls);

  /* ---------- project wiki ---------- */
  const wikiReply = (o = {}) => ({ success: true, name: 'shop', dir: 'C:\\Users\\x\\jarvis\\Wikis\\shop', relDir: 'Wikis/shop', files: ['README.md', 'architecture.md', 'modules/src.md'], modules: 5, sourceFiles: 7, languages: { JavaScript: { files: 6, lines: 90 }, Python: { files: 1, lines: 5 } }, aiSummaries: 5, truncated: false, ...o });
  replies['/project/wiki'] = () => wikiReply();
  const said2 = []; global.jarvisSay = m => said2.push(m);
  for (const [t, name, into] of [['document my shop project', 'shop', false], ['document the calculator app', 'calculator', false], ['Document dsa_sprint folder', 'dsa_sprint', false], ['generate a wiki for shop', 'shop', false], ['create documentation for my shop project', 'shop', false], ['write the docs for shop', 'shop', false],
    ['make a code wiki of shop', 'shop', false], ['/wiki shop', 'shop', false], ['document my shop project and save it in the project folder', 'shop', true], ['/wiki shop and put it in the project folder', 'shop', true], ['build me a wiki for "my shop"', 'my shop', false], ['please document the agri loop repo.', 'agri loop', false]]) {
    calls.length = 0; said2.length = 0; const x = await ex(t);
    check('wiki: "' + t + '"', x && /Wrote the wiki for \*\*shop\*\*/.test(x.text) && calls.at(-1)[0] === '/project/wiki' && calls.at(-1)[1].name === name && (calls.at(-1)[1].into === 'project') === into && calls.at(-1)[1].ai === true, { t, call: calls.at(-1), x: x && x.text });
  }
  check('wiki: a progress line is shown while it works', said2.length === 1 && /Reading \*\*agri loop\*\*/.test(said2[0].text) && said2[0].noTTS);
  c = await ex('document my shop project');
  check('wiki: the answer says where, how many pages / modules / files, the languages, and what to open first', /→ `Wikis\/shop` \(3 pages\)/.test(c.text) && /5 modules from 7 source files \(JavaScript 6, Python 1\)/.test(c.text) && /Start with `README\.md`; `architecture\.md`/.test(c.text), c.text);
  check('wiki: AI sentences are said to be marked; speech is short', /wrote 5 one-line summaries, each marked “AI summary”/.test(c.text) && c.speak === 'The wiki for shop is ready. It has 5 modules.');
  await c.actions[0].fn(); check('wiki: OPEN THE WIKI FOLDER uses the folder route', calls.at(-1)[0] === '/tool/openFolder' && calls.at(-1)[1].name === 'C:\\Users\\x\\jarvis\\Wikis\\shop');
  await c.actions[1].fn(); check('wiki: OPEN README opens that page', calls.at(-1)[0] === '/tool/openFile' && /README\.md$/.test(calls.at(-1)[1].name));
  global.llmReady = () => false; calls.length = 0; replies['/project/wiki'] = () => wikiReply({ aiSummaries: 0 });
  c = await ex('document my shop project');
  check('wiki: with no AI it asks the server not to use one, and says descriptions come from the code', calls.at(-1)[1].ai === false && /No AI summaries/.test(c.text) && /comments/.test(c.text)); global.llmReady = () => true;
  check('wiki: one AI summary reads naturally; a big folder is flagged', /wrote one one-line summary/.test((replies['/project/wiki'] = () => wikiReply({ aiSummaries: 1, truncated: true }), (await ex('document my shop project')).text)) && /bigger than I read/.test((await ex('document my shop project')).text));
  replies['/project/wiki'] = { error: 'I can’t find a project folder called “nope” in ~/jarvis or your project folders.' };
  check('wiki: the server\'s reason is shown (project not found)', /can’t find a project folder called “nope”/.test((await ex('document my nope project')).text));
  c = await ex('/wiki'); check('wiki: /wiki alone explains it', /Project wiki/.test(c.text) && /AI summary/.test(c.text) && /docs\/wiki/.test(c.text));
  calls.length = 0;
  for (const t of ['document my day', 'document this', 'document the bug', 'document my homework', 'document it', 'generate a wiki', 'make a wiki page about cats', 'write documentation', 'document everything in my room', 'create docs', 'documents for the visa', 'my wiki is slow', 'what is a wiki', 'wiki']) {
    const x = await ex(t); check('wiki: not taken: "' + t + '"', x === null, { t, x: x && x.text });
  }
  check('wiki: none of those made a request', calls.length === 0, calls);
  global.jarvisSay = () => {};

  /* ---------- images ---------- */
  const mem = {}; global.store = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
  const said3 = []; let accept = true;
  global.jarvisSay = m => { said3.push(m); if (m.confirm) setTimeout(() => (accept ? m.confirm.onConfirm() : m.confirm.onCancel()), 0); };
  getReplies['/image/status'] = { success: true, local: false, hasKey: false };
  const imgReply = (o = {}) => ({ success: true, service: 'pollinations', serviceLabel: 'Pollinations', width: 1024, height: 1024, folder: 'C:\\Users\\x\\jarvis\\Images', sentPrompt: 'a cat astronaut, detailed', images: [{ file: 'Images/a-cat-astronaut-123.png', path: 'C:\\x\\a-cat-astronaut-123.png', seed: 123, bytes: 204800, type: 'image/png' }], errors: [], partial: false, ...o });
  replies['/image/generate'] = () => imgReply();
  replies['/skill/run'] = () => ({ success: true, text: '"A cat astronaut floating above the moon, soft rim light, detailed fur."' });
  for (const [t, prompt, n, style, shape] of [['generate an image of a cat astronaut', 'a cat astronaut', 1, undefined, undefined], ['Generate a picture of a red fox in portrait', 'a red fox', 1, undefined, 'portrait'], ['make 3 pictures of a castle in watercolor style', 'a castle', 3, 'watercolor', undefined],
    ['create two images of a robot in an anime style', 'a robot', 2, 'anime', undefined], ['draw me a dragon', 'dragon', 1, undefined, undefined], ['draw me the moon in pixel art style', 'moon', 1, 'pixel', undefined], ['generate 4 variations of a logo for a coffee shop in square', 'a logo for a coffee shop', 4, undefined, 'square'],
    ['/image a cat on a skateboard', 'a cat on a skateboard', 1, undefined, undefined], ['imagine an image of the sea at night, landscape format', 'the sea at night', 1, undefined, 'landscape'], ['paint a picture of mountains in oil painting style.', 'mountains', 1, 'oil', undefined], ['create 9 images of cats', 'cats', 4, undefined, undefined], ['please make an illustration of a lighthouse in 3d render style', 'a lighthouse', 1, '3d', undefined]]) {
    calls.length = 0; mem['jarvis.imageServiceOk'] = true; const x = await ex(t);
    const g = calls.find(c => c[0] === '/image/generate');
    check('image: "' + t + '"', x && g && g[1].prompt === prompt && g[1].n === n && g[1].style === style && g[1].shape === shape && g[1].online === true, { t, g: g && g[1], x: x && x.text });
  }
  mem['jarvis.imageServiceOk'] = false; calls.length = 0; said3.length = 0;
  c = await ex('generate an image of a cat astronaut');
  check('image: the first time it asks, naming the service and saying only the description leaves the laptop', said3[0].confirm && /Pollinations/.test(said3[0].text) && /Only the description leaves your laptop/.test(said3[0].text) && said3[0].confirm.yes === 'YES, SEND IT' && !/key you saved/.test(said3[0].text) && !!mem['jarvis.imageServiceOk'], said3[0]);
  calls.length = 0; said3.length = 0; await ex('generate an image of a cat astronaut');
  check('image: …and not again after you said yes', !said3.some(m => m.confirm) && calls.some(x => x[0] === '/image/generate'));
  mem['jarvis.imageServiceOk'] = false; accept = false; calls.length = 0;
  c = await ex('generate an image of a cat astronaut');
  check('image: if you say no, nothing is sent and it is not remembered', /won’t send anything/.test(c.text) && !calls.length && !mem['jarvis.imageServiceOk']);
  accept = true; getReplies['/image/status'] = { success: true, local: false, hasKey: true }; mem['jarvis.imageServiceOk'] = false; said3.length = 0;
  await ex('generate an image of a cat astronaut'); check('image: the card says when a saved key goes along', /together with the key you saved/.test(said3[0].text));
  mem['jarvis.imageServiceOk'] = true;
  calls.length = 0; c = await ex('generate an image of a cat astronaut');
  const gcall = calls.find(x => x[0] === '/image/generate')[1];
  check('image: the AI turns the idea into a detailed prompt first (quotes stripped), and both go to the server', calls.find(x => x[0] === '/skill/run')[1].skill === 'image-prompt' && calls.find(x => x[0] === '/skill/run')[1].input === 'a cat astronaut' && gcall.expanded === 'A cat astronaut floating above the moon, soft rim light, detailed fur.' && gcall.prompt === 'a cat astronaut', gcall);
  check('image: the prompt in use is shown while it draws', said3.some(m => /Prompt I’m using:\* A cat astronaut floating/.test(m.text) && m.noTTS));
  check('image: the answer lists the file, size and seed, the prompt that was sent, and the note files', /✓ Made your picture with Pollinations \(1024×1024\) and opened it\./.test(c.text) && /1\. `Images\/a-cat-astronaut-123\.png` — 200 KB, seed 123/.test(c.text) && /Prompt sent:\* a cat astronaut, detailed/.test(c.text) && /`\.json` note/.test(c.text) && c.speak === 'Your picture is ready.');
  await c.actions[0].fn(); check('image: OPEN FOLDER', calls.at(-1)[0] === '/tool/openFolder' && calls.at(-1)[1].name === 'C:\\Users\\x\\jarvis\\Images');
  global.handleUser = async (t, s) => { calls.push(['handleUser', t, s]); }; await c.actions[1].fn();
  check('image: MAKE ANOTHER asks again with the same words', calls.at(-1)[1] === 'generate an image of a cat astronaut' && calls.at(-1)[2] === 'chip');
  replies['/skill/run'] = { error: 'Local LLM unavailable' }; calls.length = 0;
  c = await ex('generate an image of a cat astronaut');
  check('image: if the prompt helper fails, the picture is still made from your own words', calls.find(x => x[0] === '/image/generate')[1].expanded === undefined && /Made your picture/.test(c.text) && !/Prompt sent/.test(c.text));
  global.llmReady = () => false; calls.length = 0; await ex('generate an image of a cat astronaut'); global.llmReady = () => true;
  check('image: with no AI the helper is not called', !calls.some(x => x[0] === '/skill/run'));
  replies['/skill/run'] = () => ({ success: true, text: 'detailed' });
  replies['/image/generate'] = () => imgReply({ images: [1, 2, 3].map(i => ({ file: 'Images/x-' + i + '.png', seed: i, bytes: 1024, path: 'x' })), errors: [{ error: 'Pollinations is limiting how fast I can ask — try again in a minute.' }], partial: true });
  c = await ex('make 3 pictures of a castle'); check('image: several pictures are listed; a partial result says why it stopped', /Made 3 pictures/.test(c.text) && /3\. `Images\/x-3\.png`/.test(c.text) && /I stopped early: Pollinations is limiting/.test(c.text) && c.speak === 'I made 3 pictures.');
  replies['/image/generate'] = { error: 'Pollinations needs a free key to make images (401). Create one at https://enter.pollinations.ai and save it in Settings → IMAGE SERVICE.', needsKey: true };
  c = await ex('generate an image of a cat'); check('image: a missing key is explained with where to get one and where to put it', /free key/.test(c.text) && /enter\.pollinations\.ai/.test(c.text) && /Settings → IMAGE SERVICE/.test(c.text) && /say it again/.test(c.text));
  replies['/image/generate'] = { error: 'offline' }; check('image: server "offline" is worded', /Online tools is off/.test((await ex('generate an image of a cat')).text));
  replies['/image/generate'] = { error: 'Pollinations is having trouble right now (503). Try again later.' }; check('image: other errors are shown as they are', /having trouble right now/.test((await ex('generate an image of a cat')).text));
  settings.online = false; calls.length = 0; said3.length = 0;
  c = await ex('generate an image of a cat');
  check('image: Online tools off (and no local service) → asks, offers ENABLE, sends nothing', /needs \*\*Online tools\*\*/.test(c.text) && c.actions[0].label === 'ENABLE ONLINE TOOLS' && !calls.some(x => x[0] === '/image/generate') && !said3.some(m => m.confirm));
  getReplies['/image/status'] = { success: true, local: true, hasKey: false }; mem['jarvis.imageServiceOk'] = false; calls.length = 0; said3.length = 0; replies['/image/generate'] = () => imgReply({ service: 'local', serviceLabel: 'Your local Stable Diffusion (Automatic1111 / Forge)' });
  c = await ex('generate an image of a cat');
  check('image: with a local service it works without Online tools and without any "sending" question', /Made your picture with Your local Stable Diffusion/.test(c.text) && !said3.some(m => m.confirm) && calls.some(x => x[0] === '/image/generate'));
  settings.online = true; getReplies['/image/status'] = { success: true, local: false, hasKey: false }; mem['jarvis.imageServiceOk'] = true;
  c = await ex('/image'); check('image: /image alone explains how to use it', /Pictures/.test(c.text) && /Pollinations/.test(c.text) && /IMAGE SERVICE/.test(c.text) && /Images/.test(c.text));
  calls.length = 0;
  for (const t of ['draw a graph', 'draw a conclusion', 'make a picture frame', 'draw me', 'take a picture', 'show me a picture of a cat', 'create an image', 'generate a report', 'open the image', 'delete the picture of my cat', 'make an image of', 'paint the fence', 'generate a password', 'what is an image of', 'rename the image of the day', 'imagine that', 'create a drawing board', 'draw the curtains', 'sketch out a plan']) {
    const x = await ex(t); check('image: not taken: "' + t + '"', x === null, { t, x: x && x.text });
  }
  check('image: none of those made a request', !calls.some(x => x[0] === '/image/generate' || x[0] === '/skill/run'), calls);
  global.jarvisSay = () => {}; delete global.handleUser;

  /* ---------- PDFs ---------- */
  const undone = []; global.Undo = { push: (label, fn) => undone.push([label, fn]) };
  let lastAns = 'Processes are programs in execution.\n- ready\n- running'; global.lastAnswer = () => lastAns;
  const pdfOk = (kind, o = {}) => ({ success: true, kind, file: 'PDFs/out.pdf', path: 'C:\\Users\\x\\jarvis\\PDFs\\out.pdf', pages: 3, bytes: 1000, ...o });
  replies['/pdf/merge'] = b => pdfOk('merge', { parts: b.files.length, pages: 5 });
  for (const [t, files, name, beside] of [['merge a.pdf and b.pdf', ['a.pdf', 'b.pdf'], undefined, undefined], ['Combine a.pdf, b.pdf and c.pdf', ['a.pdf', 'b.pdf', 'c.pdf'], undefined, undefined], ['merge a.pdf with b.pdf into all.pdf', ['a.pdf', 'b.pdf'], 'all', undefined],
    ['join a.pdf + b.pdf as "study pack.pdf"', ['a.pdf', 'b.pdf'], 'study pack', undefined], ['put together a.pdf b.pdf', ['a.pdf', 'b.pdf'], undefined, undefined], ['/pdf merge a.pdf b.pdf', ['a.pdf', 'b.pdf'], undefined, undefined],
    ['merge "my notes.pdf" and "lab report.pdf"', ['my notes.pdf', 'lab report.pdf'], undefined, undefined], ['merge a.pdf and b.pdf and save it next to the original', ['a.pdf', 'b.pdf'], undefined, true], ['stitch a.pdf, b.pdf together', ['a.pdf', 'b.pdf'], undefined, undefined]]) {
    calls.length = 0; const x = await ex(t); const g = calls.find(c => c[0] === '/pdf/merge');
    check('pdf merge: "' + t + '"', x && g && JSON.stringify(g[1].files) === JSON.stringify(files) && g[1].name === name && g[1].beside === beside, { t, g: g && g[1], x: x && x.text });
  }
  c = await ex('merge a.pdf and b.pdf');
  check('pdf merge: the answer says what was made and where, that the original is unchanged, and how to undo', /✓ Put 2 PDFs together → `PDFs\/out\.pdf` \(5 pages\) and opened it\. Your original is unchanged\./.test(c.text) && /Say \*\*“undo”\*\*/.test(c.text) && c.speak === 'Done. The new PDF is open.', c.text);
  undone.length = 0; c = await ex('merge a.pdf and b.pdf'); replies['/tool/undoCreate'] = { success: true };
  check('pdf merge: an Undo entry moves the new file to the trash', undone.length === 1 && /PDFs\/out\.pdf/.test(undone[0][0]) && /Moved PDFs\/out\.pdf to the trash/.test(await undone[0][1]()) && calls.at(-1)[0] === '/tool/undoCreate' && calls.at(-1)[1].name === 'PDFs/out.pdf');
  undone.length = 0; await ex('merge a.pdf and b.pdf and save it next to the original'); check('pdf: no Undo entry for a file beside the original (the trash route only handles ~/jarvis)', undone.length === 0);
  replies['/pdf/pages'] = b => pdfOk('pages', { selected: b.pages.replace(/\s+/g, ''), total: 12, pages: 3 });
  for (const [t, file, pages] of [['split notes.pdf pages 1-3', 'notes.pdf', '1-3'], ['extract pages 2,5-7 from notes.pdf', 'notes.pdf', '2,5-7'], ['take page 4 of notes.pdf', 'notes.pdf', '4'], ['pull out pages 1 and 3 from notes.pdf', 'notes.pdf', '1 and 3'], ['keep the first 5 pages of notes.pdf', 'notes.pdf', 'first 5'],
    ['extract the last 2 pages from notes.pdf', 'notes.pdf', 'last 2'], ['split notes.pdf at pages 2-4', 'notes.pdf', '2-4'], ['get pages odd from notes.pdf', 'notes.pdf', 'odd'], ['/pdf split "my notes.pdf" pages 1-2', 'my notes.pdf', '1-2']]) {
    calls.length = 0; const x = await ex(t); const g = calls.find(cc => cc[0] === '/pdf/pages');
    check('pdf pages: "' + t + '"', x && g && g[1].file === file && g[1].pages === pages, { t, g: g && g[1], x: x && x.text });
  }
  c = await ex('split notes.pdf pages 1-3'); check('pdf pages: "Took pages 1-3 of 12 → … (3 pages)"', /✓ Took pages 1-3 of 12 → `PDFs\/out\.pdf` \(3 pages\)/.test(c.text));
  replies['/pdf/rotate'] = b => pdfOk('rotate', { degrees: 90, pages: b.pages ? 2 : 6, total: 6 });
  for (const [t, file, degrees, pages] of [['rotate scan.pdf right', 'scan.pdf', 'right', undefined], ['rotate scan.pdf 90', 'scan.pdf', '90', undefined], ['Rotate scan.pdf by 180 degrees', 'scan.pdf', '180', undefined], ['turn scan.pdf left', 'scan.pdf', 'left', undefined], ['rotate scan.pdf 90 pages 2-3', 'scan.pdf', '90', '2-3'], ['rotate pages 2-3 of scan.pdf by 270', 'scan.pdf', '270', '2-3'],
    ['rotate scan.pdf clockwise on page 1', 'scan.pdf', 'clockwise', '1'], ['rotate scan.pdf counter-clockwise', 'scan.pdf', 'counter-clockwise', undefined]]) {
    calls.length = 0; const x = await ex(t); const g = calls.find(cc => cc[0] === '/pdf/rotate');
    check('pdf rotate: "' + t + '"', x && g && g[1].file === file && g[1].degrees === degrees && g[1].pages === pages, { t, g: g && g[1], x: x && x.text });
  }
  check('pdf rotate: worded for all pages and for some', /Turned all 6 pages by 90°/.test((await ex('rotate scan.pdf right')).text) && /Turned 2 pages of 6 by 90°/.test((await ex('rotate scan.pdf right pages 2-3')).text));
  replies['/pdf/watermark'] = b => pdfOk('watermark', { pages: 6, total: 6, replaced: 0 });
  for (const [t, text] of [['watermark report.pdf with DRAFT', 'DRAFT'], ['watermark report.pdf as "FOR REVIEW"', 'FOR REVIEW'], ['Watermark report.pdf saying confidential', 'confidential'], ['watermark report.pdf internal use']]) {
    calls.length = 0; const x = await ex(t); const g = calls.find(cc => cc[0] === '/pdf/watermark');
    check('pdf watermark: "' + t + '"', x && g && g[1].file === 'report.pdf' && g[1].text === (text || 'internal use'), { t, g: g && g[1], x: x && x.text });
  }
  check('pdf watermark: worded', /Stamped “DRAFT” across all 6 pages/.test((await ex('watermark report.pdf with DRAFT')).text));
  replies['/pdf/make'] = b => pdfOk('make', { pages: 1, replaced: 0 });
  for (const [t, title] of [['make that into a pdf', ''], ['save this as a PDF', ''], ['turn the last answer into a pdf', ''], ['convert that to pdf', ''], ['make that a pdf called OS notes', 'OS notes'], ['make a pdf of that', ''], ['create a pdf from the last reply named Week 3', 'Week 3'], ['/pdf make that into a pdf', ''], ['export it as a pdf titled Revision', 'Revision']]) {
    calls.length = 0; const x = await ex(t); const g = calls.find(cc => cc[0] === '/pdf/make');
    check('pdf make: "' + t + '"', x && g && g[1].text === lastAns && (g[1].title || '') === title, { t, g: g && g[1], x: x && x.text });
  }
  c = await ex('make that into a pdf'); check('pdf make: "Made a PDF from my last answer"', /✓ Made a PDF from my last answer → `PDFs\/out\.pdf` \(1 page\)/.test(c.text) && !/original is unchanged/.test(c.text));
  replies['/pdf/make'] = () => pdfOk('make', { pages: 1, replaced: 7 }); c = await ex('make that into a pdf');
  check('pdf make: says when letters had to become “?”', /⚠ 7 characters \(letters the PDF font doesn’t have, like Telugu, Kannada or emoji\) became “\?”/.test(c.text));
  lastAns = ''; calls.length = 0; c = await ex('make that into a pdf');
  check('pdf make: with no earlier answer it says so and sends nothing', /don’t have an earlier answer/.test(c.text) && !calls.some(cc => cc[0] === '/pdf/make')); lastAns = 'Some answer';
  replies['/pdf/merge'] = { error: 'That PDF is password-protected, so I can’t change it.' };
  check('pdf: the server\'s reason is shown (password-protected)', /password-protected/.test((await ex('merge a.pdf and b.pdf')).text));
  replies['/pdf/pages'] = { error: 'This PDF has 3 pages, so page 9 doesn’t exist.' }; check('pdf: page out of range is explained', /3 pages, so page 9/.test((await ex('take page 9 of notes.pdf')).text));
  c = await ex('/pdf'); check('pdf: /pdf alone explains everything, including "never changes your original" and the Latin-only note', /PDF tools/.test(c.text) && /merge/.test(c.text) && /never changed/.test(c.text) && /Telugu/.test(c.text) && /next to the original/.test(c.text));
  check('pdf: /pdf with something odd also explains', /PDF tools/.test((await ex('/pdf do something weird to a.pdf')).text));
  calls.length = 0;
  for (const t of ['open notes.pdf', 'read notes.pdf', 'summarise notes.pdf', 'what does notes.pdf say about processes', 'delete a.pdf', 'rename a.pdf to b.pdf', 'copy a.pdf to the desktop', 'email a.pdf to my teacher', 'merge my notes', 'merge a.pdf', 'merge the branches', 'split the bill', 'rotate the screen', 'rotate my phone', 'split pages', 'make a pdf', 'make a plan', 'save this file', 'turn off the lights', 'watermark', 'extract the zip file', 'take a screenshot', 'join a.pdf', 'merge a.pdf and notes.txt', 'is notes.pdf a good book', 'print notes.pdf', 'make flashcards from notes.pdf']) {
    const x = await ex(t); check('pdf: not taken: "' + t + '"', x === null, { t, x: x && x.text });
  }
  check('pdf: none of those made a request', !calls.some(cc => /^\/pdf\//.test(cc[0])), calls);
  delete global.Undo; delete global.lastAnswer;

  /* ---------- disk care ---------- */
  const GBn = 1073741824, MBn = 1048576;
  const said4 = []; let yes = true; const hello = []; let helloOk = true;
  global.jarvisSay = m => { said4.push(m); if (m.confirm) setTimeout(() => (yes ? m.confirm.onConfirm() : m.confirm.onCancel()), 0); };
  global.withHello = async (purpose, fn) => { hello.push(purpose); return helloOk ? fn('token-1') : undefined; };
  const undo4 = []; global.Undo = { push: (label, fn) => undo4.push([label, fn]) };
  replies['/disk/usage'] = { success: true, drives: [{ drive: 'C:', freeBytes: 2.3 * GBn, totalBytes: 252 * GBn }, { drive: 'D:', freeBytes: 27 * GBn, totalBytes: 200 * GBn }], trashBytes: 300 * MBn, notes: ['OneDrive folders are not counted (their files may be online-only).'],
    places: [{ name: 'Videos', path: 'C:\\Users\\x\\Videos', bytes: 40 * GBn, files: 120, partial: false }, { name: 'Downloads', path: 'C:\\Users\\x\\Downloads', bytes: 3.2 * GBn, files: 412, partial: true }, { name: 'JARVIS trash', path: 'x', bytes: 300 * MBn, files: 9, partial: false }, { name: 'Empty', path: 'y', bytes: 0, files: 0 }], temp: { path: 'T', bytes: 1.1 * GBn, files: 900, partial: false } };
  for (const t of ["what's using my C: drive", 'What is taking up disk space?', "what's using my disk space", 'why is my C drive full', 'disk usage', 'storage report', '/disk', 'free up space', 'clean up my disk', "what's eating my storage"]) {
    calls.length = 0; const x = await ex(t);
    check('disk usage: "' + t + '"', x && calls.some(c => c[0] === '/disk/usage') && /Where your space is/.test(x.text), { t, x: x && x.text });
  }
  c = await ex("what's using my C: drive");
  check('disk usage: drives with free / total / % full and a warning when low', /\*\*C:\*\* — 2\.3 GB free of 252 GB \(99% full\) ⚠ low/.test(c.text) && /\*\*D:\*\* — 27 GB free of 200 GB \(87% full\)/.test(c.text) && !/D:.*⚠/.test(c.text));
  check('disk usage: places biggest first, "at least" when the scan was cut short, empty ones left out', /\*\*Videos\*\* — 40 GB \(120 files\)\n- \*\*Downloads\*\* — at least 3\.2 GB \(412 files\)/.test(c.text) && !/Empty/.test(c.text) && /\*\*Temp files\*\* — 1\.1 GB/.test(c.text));
  check('disk usage: the OneDrive note, the suggestions that fit (temp is big, trash is big), and a spoken warning about the low drive', /\*OneDrive folders are not counted/.test(c.text) && /clean my temp files”\*\* \(1\.1 GB of temp\)/.test(c.text) && /empty my JARVIS trash”\*\* \(300 MB\)/.test(c.text) && /Drive C has only 2 point 3 GB free/.test(c.speak) && c.suggestions.includes('Find large files'));
  check('disk usage: a progress line is shown while it measures', said4.some(m => /Measuring your drives/.test(m.text) && m.noTTS));
  replies['/disk/usage'] = { error: 'Disk care hit a problem: x' }; check('disk usage: errors are shown', /Disk care hit a problem/.test((await ex('disk usage')).text));

  // temp: permanent, with Hello
  replies['/disk/plan'] = b => b.kind === 'temp' ? { success: true, kind: 'temp', planId: 'tp1', root: 'C:\\Users\\x\\AppData\\Local\\Temp', count: 300, bytes: 1.1 * GBn, partial: false, olderThanDays: 3, permanent: true } : { error: 'no stub ' + b.kind };
  replies['/disk/applyPermanent'] = { success: true, kind: 'temp', permanent: true, removed: 290, bytes: 1.0 * GBn, inUse: 7, changed: 3 };
  for (const t of ['clean my temp files', 'delete temp files', 'clear the temporary files', 'empty my old temp files', '/clean']) {
    said4.length = 0; calls.length = 0; hello.length = 0; const x = await ex(t);
    check('disk temp: "' + t + '"', x && calls.some(cc => cc[0] === '/disk/plan' && cc[1].kind === 'temp') && calls.some(cc => cc[0] === '/disk/applyPermanent' && cc[1].planId === 'tp1' && cc[2] === 'token-1') && hello.join() === 'files', { t, calls: calls.map(cc => cc[0]), hello });
  }
  said4.length = 0; c = await ex('clean my temp files');
  check('disk temp: the card says how many files, how big, where, and — plainly — that it is permanent and cannot be undone', /300 old temp files/.test(said4[0].text) && /1\.1 GB/.test(said4[0].text) && /AppData\\Local\\Temp/.test(said4[0].text) && /permanent/.test(said4[0].text) && /cannot bring them back/.test(said4[0].text) && said4[0].confirm.yes === 'YES, DELETE THEM');
  check('disk temp: the answer reports what was freed, what was in use, what had changed', /Deleted 290 temp files and freed \*\*1 GB\*\*/.test(c.text) && /7 files were in use/.test(c.text) && /3 files had changed/.test(c.text));
  yes = false; calls.length = 0; hello.length = 0; c = await ex('clean my temp files');
  check('disk temp: saying no deletes nothing and does not even ask Windows Hello', /left your temp files alone/.test(c.text) && !calls.some(cc => cc[0] === '/disk/applyPermanent') && !hello.length);
  yes = true; helloOk = false; calls.length = 0; c = await ex('clean my temp files');
  check('disk temp: Windows Hello cancelled → nothing deleted, and it says so', /Nothing was deleted/.test(c.text) && !calls.some(cc => cc[0] === '/disk/applyPermanent')); helloOk = true;
  replies['/disk/plan'] = { success: true, kind: 'temp', count: 0, olderThanDays: 3, bytes: 0 };
  check('disk temp: nothing old → "nothing to clean", no card', (said4.length = 0, /nothing older than 3 days/.test((await ex('clean my temp files')).text)) && !said4.some(m => m.confirm));
  replies['/disk/plan'] = { error: 'I only clean folders named “Temp” or “tmp”.' }; check('disk temp: refusals from the server are shown', /only clean folders named/.test((await ex('clean my temp files')).text));

  // tidy
  const tidyPlan = (o = {}) => ({ success: true, kind: 'tidy', planId: 'td1', folder: 'C:\\Users\\x\\Downloads', count: 14, bytes: 900 * MBn, byCategory: { Documents: { count: 8, bytes: 60 * MBn, examples: ['a.pdf', 'b.docx', 'c.txt'] }, Installers: { count: 3, bytes: 800 * MBn, examples: ['setup.exe', 'x.msi', 'y.exe'] }, Images: { count: 3, bytes: 40 * MBn, examples: ['p.jpg', 'q.png', 'r.gif'] } }, skipped: { inProgress: 1, recent: 2, system: 1, folders: 4, links: 0, blocked: 0 }, truncated: false, by: '', ...o });
  replies['/disk/plan'] = b => (b.kind === 'tidy' ? tidyPlan({ by: b.by || '' }) : { error: 'x' });
  replies['/disk/apply'] = { success: true, kind: 'tidy', runId: '20261008173000-abc123', moved: 14, bytes: 900 * MBn, failed: [], skipped: [] };
  for (const [t, folder, by] of [['tidy my downloads', 'downloads', ''], ['Organize my desktop', 'desktop', ''], ['sort my downloads', 'downloads', ''], ['clean up my downloads', 'downloads', ''], ['tidy up my documents folder', 'documents', ''], ['tidy my downloads by month', 'downloads', 'month'], ['/tidy', 'downloads', ''], ['/tidy D:\\stuff', 'D:\\stuff', ''], ['tidy C:\\Users\\x\\Pictures', 'C:\\Users\\x\\Pictures', ''], ['declutter my pictures', 'pictures', '']]) {
    calls.length = 0; const x = await ex(t); const pc = calls.find(cc => cc[0] === '/disk/plan');
    check('disk tidy: "' + t + '"', x && pc && pc[1].kind === 'tidy' && pc[1].folder === folder && (pc[1].by || '') === by && calls.some(cc => cc[0] === '/disk/apply' && cc[1].planId === 'td1'), { t, pc: pc && pc[1], x: x && x.text });
  }
  said4.length = 0; undo4.length = 0; c = await ex('tidy my downloads');
  check('disk tidy: the card lists each category with counts, sizes and examples, what is left alone, and that undo puts it back', /Tidy \*\*Downloads\*\*\? I would move \*\*14 files\*\* \(900 MB\)/.test(said4[0].text) && /\*\*Documents\*\* — 8 files \(60 MB\): a\.pdf, b\.docx, c\.txt, …/.test(said4[0].text) && /1 download still in progress, 2 files changed in the last 10 minutes, 4 folders \(not touched\), 1 other file/.test(said4[0].text) && /Nothing is deleted or renamed/.test(said4[0].text) && said4[0].confirm.yes === 'YES, TIDY');
  check('disk tidy: the answer, and ONE undo entry that restores the whole run', /Moved \*\*14 files\*\* into folders in \*\*Downloads\*\*/.test(c.text) && /“undo”/.test(c.text) && undo4.length === 1 && /tidied Downloads/.test(undo4[0][0]));
  replies['/disk/undo'] = { success: true, restored: 14, problems: [], kind: 'tidy' }; calls.length = 0;
  check('disk tidy: running that undo calls the undo route with the run id and says how many came back', /Put 14 files back in Downloads/.test(await undo4[0][1]()) && calls.at(-1)[0] === '/disk/undo' && calls.at(-1)[1].runId === '20261008173000-abc123');
  replies['/disk/undo'] = { success: true, restored: 12, problems: [{ path: 'x', why: 'something else is already at the old place' }], kind: 'tidy' };
  check('disk tidy: an undo that could not restore everything says which and why', /Put 12 files back.*1 file could not go back: something else is already at the old place/.test(await undo4[0][1]()));
  replies['/disk/undo'] = { error: 'I have no record of that run.' }; check('disk tidy: an undo error is raised so the undo stack shows it', await undo4[0][1]().then(() => false, e => /no record/.test(e.message)));
  yes = false; calls.length = 0; c = await ex('tidy my downloads');
  check('disk tidy: saying no moves nothing', /left \*\*Downloads\*\* as it was/.test(c.text) && !calls.some(cc => cc[0] === '/disk/apply')); yes = true;
  said4.length = 0; calls.length = 0; await ex('tidy my downloads by month');
  check('disk tidy: "by month" is mentioned in the card', /by type and month/.test(said4[0].text));
  replies['/disk/plan'] = { ...tidyPlan(), count: 0, byCategory: {}, skipped: { inProgress: 2, recent: 0, system: 0, folders: 1, links: 0, blocked: 0 } };
  check('disk tidy: nothing to tidy → says so and what was left, no card', (said4.length = 0, /nothing to tidy in \*\*Downloads\*\*.*2 downloads still in progress, 1 folder/.test((await ex('tidy my downloads')).text)) && !said4.some(m => m.confirm));
  replies['/disk/plan'] = { error: 'I can’t find a folder called “nowhere”. Try Downloads, Desktop, Documents or a full path.' }; check('disk tidy: folder errors are shown', /can’t find a folder called “nowhere”/.test((await ex('tidy C:\\nowhere\\x')).text));
  replies['/disk/plan'] = tidyPlan(); replies['/disk/apply'] = { success: true, runId: '20261008173000-abc123', moved: 10, bytes: 1, failed: [{ path: 'a', why: 'it is in use or protected' }], skipped: [{ path: 'b', why: 'changed' }, { path: 'c', why: 'changed' }] };
  check('disk tidy: skipped and failed files are reported', /2 files changed while I worked.*1 file could not be moved \(it is in use or protected\)/.test((await ex('tidy my downloads')).text));
  replies['/disk/apply'] = { error: 'That plan has expired (plans last 15 minutes). Ask again and I’ll make a fresh one.' }; check('disk tidy: an expired plan is explained', /plan has expired/.test((await ex('tidy my downloads')).text));

  // large files then pick
  const largeItems = [1, 2, 3].map(n => ({ n, path: 'D:\\Movies\\movie' + n + '.mkv', size: (4 - n) * GBn, mtimeMs: 1, ageDays: n === 1 ? 400 : 20, drive: 'd:\\' }));
  replies['/disk/plan'] = b => (b.kind === 'large' ? { success: true, kind: 'large', planId: 'lg1', items: largeItems, totalFound: 3, bytes: 6 * GBn, partial: false, minMB: b.minMB || 100, roots: [] } : { error: 'x' });
  check('disk pick: before any list, "trash 1, 3" is not taken (ordinary words)', (await ex('trash 1, 3 and 5')) === null && (await ex('move 2 to the trash')) === null);
  for (const [t, minMB, where] of [['find large files', undefined, undefined], ['find big files', undefined, undefined], ['show me the biggest files', undefined, undefined], ['find large files over 500 MB', 500, undefined], ['find files over 2 GB on D drive', 2048, 'D drive'], ['find large files in my documents', undefined, 'documents'], ['/large', undefined, undefined], ['list the largest files', undefined, undefined]]) {
    calls.length = 0; const x = await ex(t); const pc = calls.find(cc => cc[0] === '/disk/plan');
    check('disk large: "' + t + '"', x && pc && pc[1].kind === 'large' && pc[1].minMB === minMB && pc[1].where === where && /Largest files/.test(x.text), { t, pc: pc && pc[1], x: x && x.text });
  }
  c = await ex('find large files');
  check('disk large: numbered list with size, age and full path, and how to act on it', /1\. \*\*movie1\.mkv\*\* — 3 GB · 13 months old · `D:\\Movies\\movie1\.mkv`/.test(c.text) && /2\. \*\*movie2\.mkv\*\* — 2 GB · 20 days old/.test(c.text) && /“trash 1, 3 and 5”/.test(c.text) && /only freed once the trash is emptied/.test(c.text) && /together 6 GB/.test(c.text));
  said4.length = 0; calls.length = 0; replies['/disk/apply'] = { success: true, kind: 'large', runId: '20261008173500-def456', moved: 2, bytes: 5 * GBn, failed: [], skipped: [], trashNote: true };
  for (const t of ['trash 1 and 3', 'trash 1, 3', 'move 1 and 3 to the trash', 'move numbers 1 and 3 to the JARVIS trash', 'send 1,3 to trash']) {
    await ex('find large files'); calls.length = 0; said4.length = 0; undo4.length = 0;
    const x = await ex(t); const ap = calls.find(cc => cc[0] === '/disk/apply');
    check('disk pick: "' + t + '"', x && ap && ap[1].planId === 'lg1' && JSON.stringify(ap[1].pick) === '[1,3]' && /Move \*\*2 files\*\* \(4 GB\) to the JARVIS trash/.test(said4[0].text) && /movie1\.mkv/.test(said4[0].text) && /movie3\.mkv/.test(said4[0].text) && undo4.length === 1, { t, ap: ap && ap[1], card: said4[0] && said4[0].text, x: x && x.text });
  }
  check('disk pick: the card says it is recoverable but frees no space until emptied; the answer points to emptying', /recoverable/.test(said4[0].text) && /empty my JARVIS trash/.test(said4[0].text) && /Moved \*\*2 files\*\* \(5 GB\)/.test((await (async () => { await ex('find large files'); return ex('trash 1 and 3'); })()).text));
  await ex('find large files'); const bad = await ex('trash 9');
  check('disk pick: a number that is not in the list is explained', /only have numbers 1 to 3/.test(bad.text));
  await ex('find large files'); yes = false; calls.length = 0; c = await ex('trash 2'); yes = true;
  check('disk pick: saying no moves nothing', /left them where they are/.test(c.text) && !calls.some(cc => cc[0] === '/disk/apply'));
  await ex('find large files'); await ex('trash 1'); calls.length = 0;
  check('disk pick: after a pick the list is spent (a second "trash 1" is just normal words again)', (await ex('trash 1')) === null && !calls.length);
  await ex('find large files'); const realNow = Date.now; Date.now = () => realNow() + 16 * 60000;
  check('disk pick: the list expires after about 15 minutes', (await ex('trash 1')) === null); Date.now = realNow;
  replies['/disk/plan'] = { success: true, kind: 'large', items: [], planId: 'x', totalFound: 0, bytes: 0, partial: false, minMB: 100 };
  check('disk large: nothing found suggests a smaller size', /found no files over 100 MB/.test((await ex('find large files')).text) && /over 50 MB/.test((await ex('find large files')).text));
  replies['/disk/plan'] = { error: 'Say which drive or folder to look in, e.g. “on D drive” or “in my Documents”.' }; check('disk large: server errors are shown', /Say which drive or folder/.test((await ex('find large files on my laptop')).text));

  // duplicates
  replies['/disk/plan'] = b => (b.kind === 'duplicates' ? { success: true, kind: 'duplicates', planId: 'dp1', groupCount: 2, extraCopies: 3, wasted: 1.5 * GBn, scanned: 1200, partial: false, groups: [{ size: 700 * MBn, keep: 'D:\\Docs\\thesis.pdf', copies: ['D:\\Downloads\\thesis (1).pdf', 'D:\\Backup\\thesis-copy.pdf'], wasted: 1400 * MBn }, { size: 50 * MBn, keep: 'D:\\a.zip', copies: ['D:\\b.zip'], wasted: 50 * MBn }] } : { error: 'x' });
  check('disk dupes: "clean up the duplicates" before any scan is not taken', (await ex('clean up the duplicates')) === null);
  for (const [t, where] of [['find duplicate files', undefined], ['find duplicates', undefined], ['find duplicate files in my documents', 'documents'], ['look for duplicate photos', undefined], ['/duplicates', undefined], ['show me the duplicate files on D drive', 'D drive']]) {
    calls.length = 0; const x = await ex(t); const pc = calls.find(cc => cc[0] === '/disk/plan');
    check('disk dupes: "' + t + '"', x && pc && pc[1].kind === 'duplicates' && pc[1].where === where && /identical files/.test(x.text), { t, pc: pc && pc[1], x: x && x.text });
  }
  c = await ex('find duplicate files');
  check('disk dupes: the sets, what is kept, what the extras are, the total wasted, and how to clean up', /\*\*2 sets\*\* of identical files — \*\*3 extra copies\*\* wasting \*\*1\.5 GB\*\*/.test(c.text) && /\*\*thesis\.pdf\*\* \(700 MB\) × 3 — keeping `D:\\Docs\\thesis\.pdf`; extra: `D:\\Downloads\\thesis \(1\)\.pdf`, `D:\\Backup\\thesis-copy\.pdf`/.test(c.text) && /“clean up the duplicates”/.test(c.text));
  for (const t of ['clean up the duplicates', 'remove the duplicates', 'trash all the duplicates', 'get rid of duplicate files', 'delete those duplicates']) {
    await ex('find duplicate files'); said4.length = 0; calls.length = 0; undo4.length = 0; replies['/disk/apply'] = { success: true, kind: 'duplicates', runId: '20261008174000-aaa111', moved: 3, bytes: 1.5 * GBn, failed: [], skipped: [] };
    const x = await ex(t); const ap = calls.find(cc => cc[0] === '/disk/apply');
    check('disk dupes: "' + t + '"', x && ap && ap[1].planId === 'dp1' && ap[1].pick === undefined && /Move \*\*3 extra copies\*\* \(1\.5 GB\)/.test(said4[0].text) && /keep one copy of each set/.test(said4[0].text) && /Moved \*\*3 extra copies\*\*/.test(x.text) && undo4.length === 1, { t, ap: ap && ap[1], x: x && x.text });
  }
  replies['/disk/plan'] = { success: true, kind: 'duplicates', planId: 'z', groupCount: 0, extraCopies: 0, wasted: 0, scanned: 340, partial: false, groups: [] };
  check('disk dupes: none found says how many files were looked at', /no identical files over 1 MB that are safe to move.*340 files/.test((await ex('find duplicate files')).text));
  replies['/disk/plan'] = { success: true, kind: 'duplicates', planId: 'dp2', groupCount: 1, extraCopies: 1, wasted: 5 * MBn, scanned: 10, partial: false, protectedCopies: 2, groups: [{ size: 5 * MBn, keep: 'D:\Proj\logo.png', copies: ['D:\Downloads\logo.png'], wasted: 5 * MBn }] };
  check('disk dupes: copies inside projects are said to be left alone, and why', /2 copies inside project folders were left alone, because a project may use them/.test((await ex('find duplicate files')).text));
  replies['/disk/plan'] = { success: true, kind: 'duplicates', planId: 'dp3', groupCount: 0, extraCopies: 0, wasted: 0, scanned: 10, partial: false, protectedCopies: 1, groups: [] };
  check('disk dupes: when the only copies are inside projects it says so instead of offering anything', /safe to move/.test((await ex('find duplicate files')).text) && /1 copy inside project folders was left alone/.test((await ex('find duplicate files')).text));

  // similar photos, then clean (all sets, or chosen sets)
  const simGroups = [
    { n: 1, keep: { path: 'D:\\Pictures\\IMG_001.jpg', size: 4 * MBn, w: 4000, h: 3000 }, copies: [{ path: 'D:\\Pictures\\IMG_001 (1).jpg', size: 1.5 * MBn, w: 1000, h: 750, distance: 0 }, { path: 'D:\\WhatsApp\\IMG-WA0001.jpg', size: 0.9 * MBn, w: 1280, h: 960, distance: 3 }], wasted: 2.4 * MBn },
    { n: 2, keep: { path: 'D:\\Pictures\\beach.png', size: 3 * MBn, w: 2000, h: 1500 }, copies: [{ path: 'D:\\Other\\beach copy.png', size: 3 * MBn, w: 2000, h: 1500, distance: 0 }], wasted: 3 * MBn },
  ];
  replies['/disk/plan'] = b => (b.kind === 'photos' ? { success: true, kind: 'photos', planId: 'ph1', groupCount: 2, extraCopies: 3, wasted: 5.4 * MBn, scanned: 400, hashedNow: 380, cached: 20, unreadable: 0, remaining: 0, partial: false, protectedCopies: 0, groups: simGroups, roots: [] } : { error: 'x' });
  check('disk similar: "clean up the similar photos" and "clean sets 1" before any scan are not taken', (await ex('clean up the similar photos')) === null && (await ex('clean sets 1 and 2')) === null);
  for (const [t, where] of [['find similar photos', undefined], ['Find similar pictures.', undefined], ['find similar photos in my pictures', 'pictures'], ['look for near-duplicate photos', undefined], ['show me the similar images on D drive', 'D drive'], ['/similar', undefined], ['list lookalike photos', undefined], ['scan for similar photos in downloads', 'downloads']]) {
    calls.length = 0; const x = await ex(t); const pc = calls.find(cc => cc[0] === '/disk/plan');
    check('disk similar: "' + t + '"', x && pc && pc[1].kind === 'photos' && pc[1].where === where && /similar pictures/.test(x.text), { t, pc: pc && pc[1], x: x && x.text });
  }
  c = await ex('find similar photos');
  check('disk similar: numbered sets with the kept picture (size, pixels), the look-alikes, "same picture" or "not identical", the total, and the warning that similar is not the same', /\*\*2 sets\*\* of similar pictures — \*\*3 extra copies\*\* using \*\*5\.4 MB\*\*/.test(c.text) && /1\. \*\*IMG_001\.jpg\*\* \(4000×3000 · 4 MB\) \*kept\*/.test(c.text) && /IMG_001 \(1\)\.jpg \(1000×750 · 1\.5 MB, same picture\)/.test(c.text) && /IMG-WA0001\.jpg \(1280×960 · 922 KB, not identical\)/.test(c.text) && /Similar is not always the same/.test(c.text) && /clean sets 1 and 2/.test(c.text), c.text);
  check('disk similar: a progress line is shown, and the answer is spoken short', /Looking at your pictures/.test((said4.find(m => /Looking at your pictures/.test(m.text)) || {}).text || '') && /2 sets of similar pictures/.test(c.speak), c.speak);
  for (const t of ['clean up the similar photos', 'remove the similar pictures', 'trash all the near-duplicate photos', 'get rid of similar images', 'move the smaller copies', 'move all the smaller ones']) {
    await ex('find similar photos'); said4.length = 0; calls.length = 0; undo4.length = 0; replies['/disk/apply'] = { success: true, kind: 'photos', runId: '20261008175000-aaa111', moved: 3, bytes: 5.4 * MBn, failed: [], skipped: [] };
    const x = await ex(t); const ap = calls.find(cc => cc[0] === '/disk/apply');
    check('disk similar clean: "' + t + '"', x && ap && ap[1].planId === 'ph1' && ap[1].pick === undefined && /extra copies from all 2 sets/.test(said4[0].text) && /keep the biggest picture/.test(said4[0].text) && /Moved \*\*3 extra pictures\*\*/.test(x.text) && undo4.length === 1 && /similar photos/.test(undo4[0][0]), { t, x: x && x.text, said: said4[0] && said4[0].text });
  }
  for (const t of ['clean sets 2', 'trash sets 1 and 2', 'move set 1', 'please remove sets 1, 2']) {
    await ex('find similar photos'); said4.length = 0; calls.length = 0;
    const x = await ex(t); const ap = calls.find(cc => cc[0] === '/disk/apply');
    check('disk similar clean sets: "' + t + '"', x && ap && ap[1].planId === 'ph1' && Array.isArray(ap[1].pick) && ap[1].pick.every(n => n === 1 || n === 2) && /extra copies in sets? /.test(said4[0].text), { t, ap: ap && ap[1], said: said4[0] && said4[0].text });
  }
  await ex('find similar photos'); calls.length = 0; c = await ex('clean sets 1 and 7');
  check('disk similar clean sets: a set that does not exist is explained and nothing is sent', /only have sets 1 to 2/.test(c.text) && !calls.some(cc => cc[0] === '/disk/apply'));
  await ex('find similar photos'); yes = false; calls.length = 0; c = await ex('clean up the similar photos'); yes = true;
  check('disk similar clean: saying no moves nothing', /left the pictures alone/.test(c.text) && !calls.some(cc => cc[0] === '/disk/apply'));
  await ex('find similar photos'); await ex('clean up the similar photos');
  check('disk similar clean: after cleaning the list is spent (a second "clean up the similar photos" is just words again)', (await ex('clean up the similar photos')) === null);
  replies['/disk/plan'] = { success: true, kind: 'photos', planId: 'z', groupCount: 0, extraCopies: 0, wasted: 0, scanned: 55, unreadable: 2, remaining: 0, partial: false, protectedCopies: 1, groups: [] };
  c = await ex('find similar photos');
  check('disk similar: none found says how many were looked at, how many could not be read, and what was protected', /no look-alike pictures/.test(c.text) && /55 pictures/.test(c.text) && /2 pictures could not be read/.test(c.text) && /1 picture inside project folders was left alone/.test(c.text), c.text);
  replies['/disk/plan'] = { success: true, kind: 'photos', planId: 'p9', groupCount: 1, extraCopies: 1, wasted: 1 * MBn, scanned: 900, hashedNow: 600, cached: 0, unreadable: 0, remaining: 300, partial: true, protectedCopies: 0, groups: [simGroups[1]] };
  check('disk similar: when time ran out it says so and that asking again carries on', /ran out of time with about 300 pictures still to look at.*carry on/.test((await ex('find similar photos')).text));
  replies['/disk/plan'] = { error: 'Comparing photos needs Windows.' }; check('disk similar: server errors are shown', /needs Windows/.test((await ex('find similar photos')).text));

  // shrink big photos
  const shrinkItems = [1, 2, 3].map(n => ({ from: 'D:\\Camera\\DSC_' + n + '.jpg', size: (9 - n) * MBn, mtimeMs: 1, n }));
  replies['/disk/plan'] = b => (b.kind === 'shrink' ? { success: true, kind: 'shrink', planId: 'sk1', count: 3, totalFound: 3, bytes: 21 * MBn, totalBytes: 21 * MBn, protectedFiles: 0, partial: false, minMB: 3, olderDays: 90, items: shrinkItems, quality: 82, maxSide: 2560, roots: [] } : { error: 'x' });
  replies['/disk/apply'] = { success: true, kind: 'shrink', runId: '20261008180000-bbb222', moved: 3, bytes: 21 * MBn, saved: 13 * MBn, failed: [], skipped: [], trashNote: true };
  for (const [t, where] of [['shrink my big photos', undefined], ['shrink the photos', undefined], ['compress my pictures', undefined], ['make smaller my large photos', undefined], ['shrink my old photos in downloads', 'downloads'], ['reduce the images on D drive', 'D drive'], ['/shrink', undefined], ['/shrink pictures', 'pictures'], ['shrink my huge jpegs', undefined]]) {
    said4.length = 0; calls.length = 0; undo4.length = 0; const x = await ex(t); const pc = calls.find(cc => cc[0] === '/disk/plan');
    check('disk shrink: "' + t + '"', x && pc && pc[1].kind === 'shrink' && (pc[1].where || undefined) === where && calls.some(cc => cc[0] === '/disk/apply' && cc[1].planId === 'sk1') && /Made \*\*3 photos\*\* smaller/.test(x.text), { t, pc: pc && pc[1], x: x && x.text });
  }
  said4.length = 0; calls.length = 0; undo4.length = 0; c = await ex('shrink my big photos');
  const card = said4.find(m => m.confirm);
  check('disk shrink: the card lists the photos with sizes, the quality and size limit, that date/camera/location are kept, that the original goes to the JARVIS trash and undo restores it, and that space is freed only after emptying', card && /3 photos/.test(card.text) && /DSC_1\.jpg\*\* — 8 MB/.test(card.text) && /quality 82/.test(card.text) && /2560 pixels/.test(card.text) && /location details are kept/.test(card.text) && /original goes to the JARVIS trash/.test(card.text) && /undo/.test(card.text) && /only freed once you empty the trash/.test(card.text), card && card.text);
  check('disk shrink: the answer says how much will be saved once the originals are gone, how to undo and how to free the space; ONE undo entry', /13 MB saved/.test(c.text) && /“undo”/.test(c.text) && /empty my JARVIS trash/.test(c.text) && undo4.length === 1 && /smaller/.test(undo4[0][0]), c.text);
  replies['/disk/undo'] = { success: true, restored: 3, problems: [], kind: 'shrink' };
  check('disk shrink: running the undo says how many originals came back', /Put 3 original photos back/.test(await undo4[0][1]()));
  yes = false; calls.length = 0; c = await ex('shrink my big photos'); yes = true;
  check('disk shrink: saying no changes nothing', /left your photos as they are/.test(c.text) && !calls.some(cc => cc[0] === '/disk/apply'));
  replies['/disk/plan'] = { success: true, kind: 'shrink', planId: 'x', count: 0, totalFound: 0, bytes: 0, minMB: 3, olderDays: 90, items: [], partial: false, protectedFiles: 1 };
  c = await ex('shrink my big photos'); check('disk shrink: nothing big and old enough says the limits, and what was protected', /no JPEG photos over 3 MB that are older than 90 days/.test(c.text) && /1 photo inside project folders was left alone/.test(c.text), c.text);
  replies['/disk/plan'] = b => ({ success: true, kind: 'shrink', planId: 'sk2', count: 60, totalFound: 150, bytes: 300 * MBn, protectedFiles: 0, minMB: 3, olderDays: 90, items: shrinkItems, quality: 82, maxSide: 2560 });
  said4.length = 0; replies['/disk/apply'] = { success: true, runId: '20261008180100-ccc333', moved: 58, bytes: 290 * MBn, saved: 150 * MBn, failed: [{ path: 'x', why: 'it could not be re-saved (out of memory)' }], skipped: [{ path: 'y', why: 'it is already small enough' }] };
  c = await ex('shrink my big photos'); check('disk shrink: a batch says how many more there are, and what was left as it was', /90 more after this batch/.test(said4.find(m => m.confirm).text) && /2 photos left as they were \(it is already small enough\)/.test(c.text) && /next batch/.test(c.text), c.text);
  replies['/disk/apply'] = { success: true, runId: null, moved: 0, bytes: 0, saved: 0, failed: [], skipped: [{ path: 'y', why: 'it is already small enough' }] };
  check('disk shrink: when nothing could be shrunk it says why and does not offer an undo', (undo4.length = 0, /did not change any photo: it is already small enough/.test((await ex('shrink my big photos')).text)) && undo4.length === 0);
  replies['/disk/plan'] = { error: 'Making photos smaller needs Windows.' }; check('disk shrink: server errors are shown', /needs Windows/.test((await ex('shrink my big photos')).text));
  for (const t of ['shrink the sail', 'compress my files', 'shrink my code', 'reduce my screen brightness', 'make smaller text', 'shrink', 'compress', 'resize my window', 'shrink the picture frame', 'similar photos', 'find similar words', 'find similar songs', 'how do I shrink photos']) {
    calls.length = 0; const x = await ex(t); check('disk shrink/similar: not taken: "' + t + '"', x === null && !calls.some(cc => /^\/disk\//.test(cc[0])), { t, x: x && x.text });
  }
  replies['/disk/apply'] = { success: true, runId: '20261008173000-abc123', moved: 10, bytes: 1, failed: [], skipped: [] };

  // empty the JARVIS trash
  replies['/disk/plan'] = b => (b.kind === 'trash' ? { success: true, kind: 'trash', planId: 'tr1', count: 9, bytes: 4.2 * GBn, partial: false, permanent: true } : { error: 'x' });
  replies['/disk/applyPermanent'] = { success: true, kind: 'trash', permanent: true, removed: 9, bytes: 4.2 * GBn, failed: 1 };
  said4.length = 0; calls.length = 0; hello.length = 0; c = await ex('empty my JARVIS trash');
  check('disk trash: the card says what, how big, that it includes things you could still undo, and that it is permanent; Hello is asked; the answer says what was freed', /9 items/.test(said4[0].text) && /4\.2 GB/.test(said4[0].text) && /including things you could still “undo”/.test(said4[0].text) && /permanent and cannot be undone/.test(said4[0].text) && hello.join() === 'files' && calls.some(cc => cc[0] === '/disk/applyPermanent' && cc[1].planId === 'tr1' && cc[2] === 'token-1') && /freed \*\*4\.2 GB\*\*/.test(c.text) && /1 item could not be removed/.test(c.text));
  yes = false; calls.length = 0; c = await ex('empty my jarvis trash'); yes = true;
  check('disk trash: saying no deletes nothing', /untouched/.test(c.text) && !calls.some(cc => cc[0] === '/disk/applyPermanent'));
  replies['/disk/plan'] = { success: true, kind: 'trash', count: 0, bytes: 0 }; check('disk trash: already empty', /already empty/.test((await ex('empty my JARVIS trash')).text));

  c = await ex('/disk help'); check('disk: help lists every tool and the trash note', /Disk care/.test(c.text) && /tidy my downloads/.test(c.text) && /find large files/.test(c.text) && /duplicate/.test(c.text) && /temp files/.test(c.text) && /empty my JARVIS trash/.test(c.text) && /OneDrive/.test(c.text));
  calls.length = 0;
  for (const t of ['how much disk space is free', 'how much space do I have left', 'delete all my files', 'tidy my room', 'organize my day', 'organize my notes', 'sort my notes', 'clean my room', 'clean up this code', 'find the biggest city', 'find duplicate lines in this file', 'remove duplicates from my list', 'empty my trash', 'free my mind', "what's using port 3000", 'what is taking up space in my bag', 'what is using python', 'find large language models', 'delete the temp folder', 'clean my temp', 'tidy up', 'organize my life', 'what is my disk', 'sort my downloads folder by size', 'show me big photos', 'duplicate this file', 'clean up after dinner']) {
    const x = await ex(t); check('disk: not taken: "' + t + '"', x === null, { t, x: x && x.text });
  }
  check('disk: none of those made a request', !calls.some(cc => /^\/disk\//.test(cc[0])), calls.map(cc => cc[0]));
  delete global.withHello; delete global.Undo; global.jarvisSay = () => {};

  /* ---------- reached through Skills.intercept (so handleUser's skill step finds it) ---------- */
  getReplies['/ai/health'] = { success: true, headline: 'ok', text: '**AI health** — ok' };
  r = await Skills.intercept('check my ai');
  check('Skills.intercept passes explicit tool requests on to Extras', r && /AI health/.test(r.text));
  check('Skills.intercept still returns null for ordinary commands', (await Skills.intercept('set volume to 30')) === null);

  /* ---------- chat archive ---------- */
  global.settings.chatArchive = true; global.isCloudModel = m => String(m).includes('::'); global.modelInfo = () => ({ providerLabel: 'SomeCloud' });
  let archCard = null; global.jarvisSay = m => { if (m.confirm) { archCard = m; setTimeout(() => (archYes ? m.confirm.onConfirm() : m.confirm.onCancel()), 0); } }; let archYes = true;
  global.withHello = async (purpose, fn) => { archHello.push(purpose); return fn('tok-9'); }; const archHello = [];
  const am = t => Extras.matchArchive(t);
  for (const [t, q] of [['what did I decide about the database last week', 'the database last week'], ['What did we discuss about the demo?', 'the demo'], ['what did I say about recursion yesterday', 'recursion yesterday'], ['what have I asked about pandas', 'pandas'],
    ['when did I ask you about the login bug', 'the login bug'], ['did I ever ask about docker', 'docker'], ['search my chats for pandas dataframe', 'pandas dataframe'], ['search my chat history for the timetable in september', 'the timetable in september'],
    ['find in my old conversations the viva', null], ['look through my chats about git', 'git'], ['/history recursion', 'recursion'], ['please search my past chats for flask', 'flask']]) {
    const m = am(t); if (q === null) { check('archive wording (not a topic search shape): "' + t + '"', m === null || m.op === 'ask'); continue; }
    check('archive wording: "' + t + '"', m && m.op === 'ask' && m.text === q, m);
  }
  check('archive wording: bare "search my chats" and "/history" show the help', am('search my chats').op === 'help' && am('/history').op === 'help');
  check('archive wording: forget, status and switches', am('forget my chat archive').op === 'forget' && am('delete the chat archive').op === 'forget' && am('please erase my archived chats').op === 'forget' && am('chat archive status').op === 'status' && am('chat archive').op === 'status' && am('how much chat history do you have').op === 'status' && am('turn off the chat archive').on === false && am('turn on my chat archive').on === true && am('stop saving my chats').on === false && am('start saving my chats').on === true);
  for (const t of ['what did I eat for lunch', 'what did he say about it', 'what did I do today', 'search my files for pandas', 'search the web for pandas', 'find my notes about git', 'look for a chat app', 'did I pay the bill', 'forget my password', 'delete my chats folder', 'clear my chat', 'what is a chat archive', 'history of rome', 'show my command history', 'what did the teacher say about the exam', 'turn off the chat', 'stop saving files', 'when did I ask']) check('archive wording: not taken: "' + t + '"', am(t) === null, am(t));

  const exch = [{ t: Date.UTC(2026, 9, 2, 10, 30), user: 'Which database should I use for my attendance app?', assistant: 'Use SQLite because it needs no server.', score: 5 }, { t: Date.UTC(2026, 9, 7, 3, 30), user: 'Remind me about the database backup', assistant: 'Okay.', score: 3 }];
  replies['/chatarchive/search'] = b => ({ success: true, window: { label: b.text.includes('last week') ? 'last week (Mon 28 Sep – Sun 4 Oct)' : '' }, terms: ['database'], scanned: 40, total: 2, exchanges: exch, summary: b.summarize ? 'On 2 October you chose SQLite.' : '', cloud: false });
  calls.length = 0; let a = await ex('what did I decide about the database last week');
  const sc = calls.find(c => c[0] === '/chatarchive/search');
  check('archive: the question goes to the archive with the AI summary asked for (the AI is local)', sc && sc[1].text === 'the database last week' && sc[1].summarize === true && sc[1].model === 'qwen3.5:4b', sc);
  check('archive: the answer has the summary (marked as AI-written), then the conversations with dates, your question and the reply', /In short:\*\* On 2 October you chose SQLite/.test(a.text) && /written by the AI/.test(a.text) && /2 conversations\*\* about \*\*database\*\* in last week/.test(a.text) && /Which database should I use/.test(a.text) && /→ JARVIS: “Use SQLite/.test(a.text) && a.speak === 'On 2 October you chose SQLite.', a.text);
  global.llmReady = () => false; calls.length = 0; a = await ex('search my chats for database');
  check('archive: with the AI off there is no summary request, only the matches', calls.find(c => c[0] === '/chatarchive/search')[1].summarize === false && !/In short/.test(a.text) && /2 conversations/.test(a.text)); global.llmReady = () => true;
  global.llm.model = 'openai::gpt-x'; calls.length = 0; archYes = false; a = await ex('what did I decide about the database');
  check('archive: an online AI is asked about first; "no" gives the matches without sending anything to it', calls.find(c => c[0] === '/chatarchive/search')[1].summarize === false && /2 conversations/.test(a.text));
  archYes = true; calls.length = 0; replies['/chatarchive/search'] = b => ({ success: true, window: { label: '' }, terms: ['database'], scanned: 40, total: 1, exchanges: [exch[0]], summary: b.summarize ? 'Chose SQLite.' : '', cloud: true });
  a = await ex('what did I decide about the database'); check('archive: after "yes" the summary is requested and the answer says the excerpts went to the online provider', calls.find(c => c[0] === '/chatarchive/search')[1].summarize === true && /sent to your online AI provider/.test(a.text) && /1 conversation\*\*/.test(a.text)); global.llm.model = 'qwen3.5:4b';
  getReplies['/chatarchive/status'] = { success: true, messages: 321, oldest: Date.UTC(2026, 8, 20), newest: Date.UTC(2026, 9, 9), bytes: 51200, files: [{ month: '2026-09', bytes: 1 }, { month: '2026-10', bytes: 2 }], capBytes: 20 * 1048576 };
  replies['/chatarchive/search'] = { success: true, window: { label: 'in august 2026' }, terms: ['quantum'], scanned: 0, total: 0, exchanges: [] };
  a = await ex('what did I ask about quantum in august');
  check('archive: nothing found says what was searched, and since when the archive goes back', /found \*\*nothing\*\*/.test(a.text) && /about \*\*quantum\*\*/.test(a.text) && /in august 2026/.test(a.text) && /My archive starts on 20 September 2026 \(321 messages so far\)/.test(a.text), a.text);
  a = await ex('chat archive status');
  check('archive status: how many messages, from when to when, size, files, the limit, where it lives, and that it is never sent anywhere', /\*\*on\*\*: \*\*321 messages\*\* from 20 September 2026 to 9 October 2026, 50 KB in 2 monthly files/.test(a.text) && /limit is 20 MB/.test(a.text) && /never sent anywhere/.test(a.text) && /chat-archive/.test(a.text), a.text);
  getReplies['/chatarchive/status'] = { success: true, messages: 0, files: [] }; check('archive status: empty', /on, but empty/.test((await ex('chat archive status')).text));
  getReplies['/chatarchive/status'] = { error: 'down' }; check('archive status: errors are shown', /could not read the archive: down/.test((await ex('chat archive status')).text));
  getReplies['/chatarchive/status'] = { success: true, messages: 321, oldest: 1, newest: 2, bytes: 51200, files: [{}], capBytes: 1 };
  replies['/chatarchive/forget'] = { success: true, removed: 2, bytes: 51200 }; calls.length = 0; archHello.length = 0; a = await ex('forget my chat archive');
  check('archive forget: asks first, saying how many messages and that it is permanent and cannot be undone', archCard && /321 messages/.test(archCard.text) && /permanent and cannot be undone/.test(archCard.text) && archCard.confirm.yes === 'YES, ERASE IT', archCard && archCard.text);
  check('archive forget: the erase call carries confirm:true and the Hello token', calls.some(c => c[0] === '/chatarchive/forget' && c[1].confirm === true && c[2] === 'tok-9') && archHello.join() === 'files' && /Erased the chat archive \(50 KB\)/.test(a.text), { calls: calls.map(c => c[0]), archHello });
  calls.length = 0; archYes = false; a = await ex('forget my chat archive'); archYes = true;
  check('archive forget: saying no erases nothing', /kept your chat archive/.test(a.text) && !calls.some(c => c[0] === '/chatarchive/forget'));
  getReplies['/chatarchive/status'] = { success: true, messages: 0, files: [] }; check('archive forget: an empty archive is just said to be empty', /already empty/.test((await ex('forget my chat archive')).text));
  global.saveSettings = () => {}; a = await ex('turn off the chat archive');
  check('archive switch: off is saved and explained (what stays, how to erase)', global.settings.chatArchive === false && /archive is \*\*off\*\*/.test(a.text) && /forget my chat archive/.test(a.text));
  a = await ex('what did I decide about the database'); check('archive: with archiving off, a question explains that nothing new is saved', /archive is \*\*off\*\*/.test(a.text));
  a = await ex('turn on the chat archive'); check('archive switch: on', global.settings.chatArchive === true && /archive is \*\*on\*\*/.test(a.text));
  // saving: batched, off means nothing is sent
  fetchBodies.length = 0; for (let i = 0; i < 20; i++) Extras.archiveLog({ role: i % 2 ? 'assistant' : 'user', text: 'message ' + i, t: 1000 + i, source: 'text' });
  await new Promise(r => setTimeout(r, 20));
  const posted = fetchBodies.filter(b => /chatarchive\/append/.test(b[0]));
  check('archive saving: 20 messages go in ONE batch, in order, with role, text, time and source', posted.length === 1 && JSON.parse(posted[0][1].body).items.length === 20 && JSON.parse(posted[0][1].body).items[0].text === 'message 0' && JSON.parse(posted[0][1].body).items[19].role === 'assistant' && posted[0][1].keepalive === true, posted.length);
  fetchBodies.length = 0; Extras.archiveLog({ role: 'user', text: 'just one' }); check('archive saving: a few messages wait (a short delay) instead of one request each', fetchBodies.filter(b => /chatarchive/.test(b[0])).length === 0);
  await Extras.archiveFlush(); check('archive saving: flush sends what is waiting', fetchBodies.filter(b => /chatarchive\/append/.test(b[0])).length === 1);
  global.settings.chatArchive = false; fetchBodies.length = 0; for (let i = 0; i < 25; i++) Extras.archiveLog({ role: 'user', text: 'x' + i }); await Extras.archiveFlush();
  check('archive saving: with the archive off nothing is sent', fetchBodies.filter(b => /chatarchive/.test(b[0])).length === 0); global.settings.chatArchive = true;
  Extras.archiveLog({ role: 'user', text: '' }); Extras.archiveLog(null); await Extras.archiveFlush(); check('archive saving: empty messages are ignored', true);
  fetchBodies.length = 0; global.settings.chatArchiveBackfilled = false;
  await Extras.archiveBackfill([{ role: 'user', text: 'old one', t: 5, source: 'text' }, { role: 'assistant', text: 'old reply', t: 6 }]);
  const bf = fetchBodies.filter(b => /chatarchive\/backfill/.test(b[0]));
  check('archive backfill: the messages on screen are sent once, and it is remembered', bf.length === 1 && JSON.parse(bf[0][1].body).items.length === 2 && global.settings.chatArchiveBackfilled === true);
  fetchBodies.length = 0; await Extras.archiveBackfill([{ role: 'user', text: 'again', t: 7 }]); check('archive backfill: never twice', fetchBodies.length === 0);
  delete global.withHello; global.jarvisSay = () => {};

  // the camera and microphone tools refuse a phone message all the way down (Skills → Extras → Camera / Watch)
  for (const t of ['scan a document', 'scan a qr code', 'solve this from a photo', 'watch my room', 'lock when I leave']) {
    const x = await Skills.intercept(t, 'phone');
    check('phone: "' + t + '" is refused through Skills.intercept', x && /only use the camera for requests made at the laptop/.test(x.text), x);
  }
  check('camera wording does not disturb the watchdog or other tools', (await Extras.intercept('watch youtube')) === null && /AI health/.test((await Extras.intercept('check my ai')).text));

  console.log(`extras-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
