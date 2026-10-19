// The tool registry (tools/registry.js + tools/<area>.js): every intent has exactly one area, the dispatcher in script.js asks them in turn, failures name
// their area, and every result gets the same ok / errorCode facts without changing what it prints. Run: node tests/toolregistry.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);
const TH = require(root('tools/registry.js'));

// ---- the area files
const files = fs.readdirSync(root('tools')).filter(f => f.endsWith('.js') && f !== 'registry.js');
const html = fs.readFileSync(root('index.html'), 'utf8'), sw = fs.readFileSync(root('sw.js'), 'utf8'), script = fs.readFileSync(root('script.js'), 'utf8');
check('areas: the eight area files exist', ['apps', 'web', 'tasks', 'study', 'system', 'files', 'code', 'productivity'].every(a => files.includes(a + '.js')), files);
const tags = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
check('page: the registry loads first, then every area file, all before script.js', tags.indexOf('tools/registry.js') >= 0 && files.every(f => tags.indexOf('tools/' + f) > tags.indexOf('tools/registry.js') && tags.indexOf('tools/' + f) < tags.indexOf('script.js')), tags.filter(t => /tools|script\.js/.test(t)));
check('offline: every tool file is in the service-worker shell', ['registry.js', ...files].every(f => sw.includes("'tools/" + f + "'")));
const owner = new Map(), dup = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(root('tools'), f), 'utf8');
  check('area ' + f + ': registers exactly one handler and answers NONE for others', (src.match(/ToolHandlers\.add\(/g) || []).length === 1 && /default: return ToolHandlers\.NONE;/.test(src));
  for (const m of src.matchAll(/case '([A-Z_]+)'/g)) { if (owner.has(m[1])) dup.push(m[1] + ' in ' + owner.get(m[1]) + ' and ' + f); owner.set(m[1], f); }
}
check('intents: every intent belongs to exactly one area (no duplicates)', dup.length === 0, dup);
check('intents: script.js no longer has its own tool switch (no case labels left in executeTool)', !/async function executeTool[\s\S]{0,1500}?case '/.test(script));
check('intents: the areas together handle 170+ intents', owner.size >= 170, owner.size);

// load the real area files into a sandbox: they register in order and answer NONE for an unknown intent
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(root('tools/registry.js'), 'utf8') + ';this.ToolHandlers = ToolHandlers;', ctx);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root('tools'), f), 'utf8'), ctx);
const areas = ctx.ToolHandlers.areas();
check('load: every area registers when its file runs', areas.length === files.length, areas);
(async () => {
  let allNone = true;
  for (const h of ctx.ToolHandlers.list) if ((await h.fn({ intent: 'NOT_A_REAL_INTENT', text: '' }, '', '', {})) !== ctx.ToolHandlers.NONE) allNone = false;
  check('load: an intent no area knows gets NONE from every area (nothing runs)', allNone);
  let threw = null; try { ctx.ToolHandlers.add('apps', async () => 1); } catch (e) { threw = e.message; }
  check('register: the same area twice is refused', /twice/.test(threw || ''), threw);

  // ---- normalize
  const N = TH.normalize;
  const ok = N({ text: 'Done.' }), err = N({ text: 'x', error: 'boom' }), can = N({ text: 'Cancelled', cancelled: true }), ai = N({ askLLM: true }), absent = N({ text: 'no backend', absent: true });
  check('normalize: a plain reply is ok with no error code', ok.ok === true && ok.errorCode === null);
  check('normalize: an error is failed, a refusal is cancelled, nothing-to-do is not_found, a hand-over is needs_ai', err.ok === false && err.errorCode === 'failed' && can.errorCode === 'cancelled' && absent.errorCode === 'not_found' && ai.errorCode === 'needs_ai' && ai.ok === false);
  check('normalize: the new facts are hidden from JSON (saved chats and traces look exactly as before)', JSON.stringify(ok) === '{"text":"Done."}' && Object.keys(err).join() === 'text,error');
  check('normalize: a result that already says ok / errorCode keeps its own', N({ text: 'x', ok: 'mine', errorCode: 'custom' }).ok === 'mine' && N({ text: 'x', ok: 'mine', errorCode: 'custom' }).errorCode === 'custom');
  check('normalize: non-objects pass through untouched', N(undefined) === undefined && N('text') === 'text' && Array.isArray(N([1])));
  check('normalize: a frozen result does not crash', (() => { try { N(Object.freeze({ text: 'x' })); return true; } catch { return false; } })());

  // ---- the dispatcher in script.js (the real code, with fake areas)
  const start = script.indexOf('async function executeTool(p, raw) {'), end = script.indexOf('\n}', start) + 2;
  const logs = [], dctx = vm.createContext({ console, log: (k, m) => logs.push([k, m]), conversationReply: p => (p.intent === 'GREETING' ? { text: 'Hello!' } : null) });
  vm.runInContext(fs.readFileSync(root('tools/registry.js'), 'utf8') + ';this.ToolHandlers = ToolHandlers;', dctx);
  dctx.ToolHandlers.add('first', async (p, raw, s, a) => (p.intent === 'A' ? { text: 'from first: ' + s + ' ' + JSON.stringify(a) + ' ' + raw } : p.intent === 'UNDEF' ? undefined : dctx.ToolHandlers.NONE));
  dctx.ToolHandlers.add('second', async p => (p.intent === 'A' ? { text: 'from second' } : p.intent === 'B' ? { text: 'from second', error: 'nope' } : p.intent === 'BOOM' ? (() => { throw new Error('kaput'); })() : dctx.ToolHandlers.NONE));
  vm.runInContext(script.slice(start, end) + ';this.executeTool = executeTool;', dctx);
  const ex = dctx.executeTool;
  let r = await ex({ intent: 'A', text: 'hi there', args: { x: 1 } }, 'RAW');
  check('dispatch: the area that knows the intent answers, with s = p.text, a = p.args and raw passed through; the first area wins', r.text === 'from first: hi there {"x":1} RAW' && r.ok === true, r);
  r = await ex({ intent: 'B', text: '' }); check('dispatch: a later area answers its own intent, and its result is normalized', r.text === 'from second' && r.errorCode === 'failed');
  r = await ex({ intent: 'UNDEF', text: '' }); check('dispatch: a case that returns nothing returns nothing (it does not fall through to other areas)', r === undefined);
  r = await ex({ intent: 'GREETING', text: '' }); check('dispatch: an intent no area knows goes to the conversation reply', r.text === 'Hello!');
  r = await ex({ intent: 'ZZZ', text: '' }); check('dispatch: …or to the AI when there is none', r.askLLM === true);
  let e = null; try { await ex({ intent: 'BOOM', text: '' }); } catch (x) { e = x; }
  check('dispatch: a crash still reaches the caller (handleUser says sorry), and the log names the area and intent', e && /kaput/.test(e.message) && logs.some(l => l[0] === 'err' && /"second"/.test(l[1]) && /BOOM/.test(l[1])), logs);

  console.log(`toolregistry: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
