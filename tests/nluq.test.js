// The Qwen intent assist (nlu-qwen.js): the model may only name intents JARVIS really runs, and each is reshaped into what that handler reads. Run: node tests/nluq.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = f => path.join(__dirname, '..', f);
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

let reply = null;                                    // what the fake /nlu/parse answers
const win = { settings: { qwenNlu: true }, API: '/api', llmReady: () => true, llm: { model: '' } };
const doc = { readyState: 'complete', getElementById: () => null, addEventListener() {} };
let timerDelay = 0, timerCleared = false, lastFetchOptions = null, triggerTimeout = false;
const ctx = vm.createContext({ window: win, document: doc, settings: win.settings, llmReady: win.llmReady, llm: win.llm, performance: { now: () => 0 }, console,
  AbortController, setTimeout: (fn, ms) => { timerDelay = ms; if (triggerTimeout) fn(); return 17; }, clearTimeout: id => { timerCleared = id === 17; },
  fetch: async (url, options) => { lastFetchOptions = options; if (options.signal && options.signal.aborted) throw new Error('The operation was aborted'); return { ok: true, json: async () => reply }; } });
vm.runInContext(fs.readFileSync(root('nlu-qwen.js'), 'utf8'), ctx);
const NLUQ = win.NLUQ;

// the tool handlers live in script.js and tools/<area>.js
const script = [root('script.js'), ...fs.readdirSync(root('tools')).filter(f => f.endsWith('.js')).map(f => path.join(root('tools'), f))].map(f => fs.readFileSync(f, 'utf8')).join('\n'), server = fs.readFileSync(root('server.js'), 'utf8');
const wl = [...(server.match(/const NLU_INTENT_WHITELIST = \[([\s\S]*?)\];/)[1]).matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
const mine = NLUQ.INTENT_WHITELIST;
check('the server whitelist and the client map name exactly the same intents', wl.slice().sort().join() === mine.slice().sort().join(), { onlyServer: wl.filter(x => !mine.includes(x)), onlyClient: mine.filter(x => !wl.includes(x)) });

const ask = async (intent, args, conf) => { reply = { success: true, intent, confidence: conf || 0.95, args: args || {} }; return NLUQ.parse({ text: 'please do the thing', original: 'please do the thing' }, {}, { intent: 'CONVERSATION', confidence: 0.3 }); };

(async () => {
  // Every intent the model can name must end up as an intent that executeTool really handles.
  const real = new Set([...script.matchAll(/case '([A-Z_]+)'/g)].map(m => m[1]));
  const bad = [];
  for (const k of mine.filter(x => x !== 'CONVERSATION')) {
    const out = await ask(k, { app: 'chrome', query: 'x', level: 40, minutes: 2, text: 'milk', expression: '2+2', city: 'Pune', name: 'a' });
    if (!out || !real.has(out.intent)) bad.push(k + ' → ' + (out && out.intent));
  }
  check('every intent the model may name becomes an intent that script.js really has a handler for (none are dead)', bad.length === 0, bad);
  check('the intents that can power off, lock, restart, delete or send are NOT offered to the model', ['SHUTDOWN', 'RESTART', 'SLEEP', 'LOCK', 'TASK_DELETE', 'TASK_DONE', 'REMINDER', 'CREATE_FILE'].every(k => !mine.includes(k)), mine);

  await ask('BATTERY');
  check('Qwen requests have an 8-second abort timeout', timerDelay === 8000 && !!lastFetchOptions.signal, { timerDelay, hasSignal: !!lastFetchOptions.signal });
  check('the timeout is cleared after a successful response', timerCleared);
  timerCleared = false;
  triggerTimeout = true;
  const timedOut = await ask('BATTERY');
  check('an aborted Qwen request falls back to the existing rule result', timedOut === null && NLUQ.describe().last.reason === 'timeout', { result: timedOut, last: NLUQ.describe().last });
  check('the timeout timer is also cleared after an abort', timerCleared);
  triggerTimeout = false;
  let o = await ask('CLOSE_APPLICATION', { app: 'x'.repeat(500) });
  check('close-application targets are bounded before reaching the tool', o.args.app.length === 100, o && o.args.app.length);
  o = await ask('CLOSE_APPLICATION', { name: '  notepad\n  ' });
  check('close-application aliases are normalized like other model-provided text', o.args.app === 'notepad', o && o.args.app);
  o = await ask('VOLUME', { level: 140 });
  check('"volume" is VOLUME_SET with the level clamped to 0-100', o.intent === 'VOLUME_SET' && o.args.level === 100, o);
  o = await ask('VOLUME', { level: 0 });
  check('"volume 0" preserves zero instead of treating it as a missing value', o.intent === 'VOLUME_SET' && o.args.level === 0, o);
  o = await ask('BRIGHTNESS', { level: 0 });
  check('"brightness 0" preserves zero instead of treating it as a missing value', o.intent === 'BRIGHTNESS' && o.args.level === 0, o);
  o = await ask('TIMER', { minutes: 2 });
  check('a timer in minutes becomes SET_TIMER in seconds', o.intent === 'SET_TIMER' && o.args.seconds === 120, o);
  o = await ask('TIMER', { minutes: 'soon' });
  check('a timer with nonsense minutes falls back to 5 minutes, not NaN', o.args.seconds === 300, o);
  o = await ask('TIMER', { minutes: 99999 });
  check('a timer is capped at 24 hours', o.args.seconds === 86400, o);
  o = await ask('TASK_ADD', { task: 'buy milk' });
  check('adding a task becomes ADD_TODO with the text', o.intent === 'ADD_TODO' && o.args.text === 'buy milk', o);
  o = await ask('CALCULATE', { expr: '12*3' });
  check('a calculation passes the expression under the name the handler reads', o.intent === 'CALCULATE' && o.args.expression === '12*3', o);
  o = await ask('MUTE'); check('mute is VOLUME_MUTE', o.intent === 'VOLUME_MUTE', o);
  o = await ask('NEXT_TRACK'); check('next track is MEDIA_NEXT', o.intent === 'MEDIA_NEXT', o);
  o = await ask('PLAY_MUSIC', { song: 'blinding lights' });
  check('play music is YOUTUBE_PLAY with the song as the query', o.intent === 'YOUTUBE_PLAY' && o.args.query === 'blinding lights', o);

  // guard rails that already existed keep working
  check('an intent outside the list (e.g. SHUTDOWN) is ignored, so the rule result stands', (await ask('SHUTDOWN')) === null);
  check('low confidence (0.5) is ignored', (await ask('BATTERY', {}, 0.5)) === null);
  reply = { success: true, intent: 'BATTERY', confidence: '0.99', args: {} };
  check('string confidence is rejected instead of coercing model output', (await NLUQ.parse({ text: 'please do the thing' }, {}, { intent: 'CONVERSATION', confidence: 0.3 })) === null && NLUQ.describe().last.reason === 'invalid_response');
  reply = { success: true, intent: 'BATTERY', confidence: 0.99, args: ['unexpected'] };
  check('array arguments are rejected as malformed model output', (await NLUQ.parse({ text: 'please do the thing' }, {}, { intent: 'CONVERSATION', confidence: 0.3 })) === null && NLUQ.describe().last.reason === 'invalid_response');
  reply = { success: true, intent: 'BATTERY', confidence: 1.5, args: {} };
  check('confidence above 1 is rejected', (await NLUQ.parse({ text: 'please do the thing' }, {}, { intent: 'CONVERSATION', confidence: 0.3 })) === null && NLUQ.describe().last.reason === 'invalid_response');
  // Untrusted target arguments are bounded and must be usable before the rule is overridden.
  o = await ask('OPEN_APPLICATION', { app: { nested: 'chrome' } });
  check('object-shaped app arguments are rejected instead of reaching the tool', o === null && NLUQ.describe().last.reason === 'missing_argument');
  o = await ask('OPEN_APPLICATION', { app: '  chrome\n\tstable  ' });
  check('string arguments are trimmed and control characters are normalized', o.args.app === 'chrome stable', o);
  o = await ask('WEB_SEARCH', { query: 'x'.repeat(500) });
  check('model-provided query strings are bounded before tool execution', o.args.query.length === 240, o && o.args.query.length);
  o = await ask('SITE_SEARCH', { target: 'y'.repeat(500) });
  check('site-search target strings are bounded before tool execution', o.args.query.length === 240, o && o.args.query.length);
  o = await ask('TASK_ADD', { task: { title: 'buy milk' } });
  check('object-shaped task text is rejected instead of becoming [object Object]', o === null && NLUQ.describe().last.reason === 'missing_argument');

  check('CONVERSATION is ignored', (await ask('CONVERSATION')) === null);
  win.settings.qwenNlu = false;
  check('with the setting off, the model is never asked', (await ask('BATTERY')) === null);

  console.log(`nluq: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
