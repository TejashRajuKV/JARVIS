// Everyday tools, chat side (life-page.js): keep-alive, backup to another drive, expenses, habits, quick capture. Page globals are stubbed; the server's
// answers are fakes. Run: node tests/life-page.test.js
'use strict';
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);

const calls = [], said = [], undo = [];
let replies = {}, gets = {}, yes = true, ids = 0;
const store = (() => { const d = {}; return { get: (k, f) => (k in d ? JSON.parse(JSON.stringify(d[k])) : f), set: (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); }, d }; })();
global.store = store; global.rid = () => 'id' + (++ids);
global.Undo = { push: (label, fn) => undo.push([label, fn]) };
global.callTool = async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
global.getJSON = async ep => { const r = gets[ep]; return typeof r === 'function' ? r() : (r || { error: 'no stub for ' + ep }); };
global.jarvisSay = o => { said.push(o); };
global.Extras = { confirmCard: (text, y) => new Promise(r => { said.push({ text, confirmCard: true, yes: y }); setTimeout(() => r(yes), 0); }) };
global.LifeParse = require(root('lifeparse.js'));
global.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, focus() {} }), addEventListener(n, f) { global.__keydown = f; } };
eval(fs.readFileSync(root('life-page.js'), 'utf8') + ';global.Life = Life;');
Life.pollMs = 5;
const S = (t, src) => Life.intercept(t, src || 'text');
const reset = () => { calls.length = 0; said.length = 0; undo.length = 0; replies = {}; gets = {}; yes = true; for (const k in store.d) delete store.d[k]; };
const today = () => LifeParse.ymd(Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---------- keep-alive ---------- */
  reset(); gets['/keepalive/status'] = { success: true, supported: true, on: false, minutes: 5 }; replies['/keepalive/set'] = { success: true, on: true };
  let r = await S('keep JARVIS running');
  const card = said.find(x => x.confirmCard);
  check('keepalive: asks first, says what the task is, and that it never restarts after you stopped it', card && /JARVIS Keepalive/.test(card.text) && /5 minutes/.test(card.text) && /stopped/.test(card.text), card && card.text);
  check('keepalive: after "yes" it switches the task on', calls.some(c => c[0] === '/keepalive/set' && c[1].on === true) && /Keep-alive is on/.test(r.text), r);
  reset(); yes = false; gets['/keepalive/status'] = { success: true, supported: true, on: false, minutes: 5 };
  r = await S('keep jarvis alive'); check('keepalive: "no" changes nothing', !calls.length && /did not change/.test(r.text), r);
  reset(); gets['/keepalive/status'] = { success: true, supported: true, on: true, minutes: 5 }; replies['/keepalive/set'] = { success: true, on: false };
  r = await S('stop keeping JARVIS alive'); check('keepalive: off removes the task (no confirm needed)', calls.some(c => c[1].on === false) && /off/.test(r.text) && !said.some(x => x.confirmCard), r);
  r = await S('is jarvis kept alive?'); check('keepalive: status says on', /on/.test(r.text) && /5 minutes/.test(r.text), r.text);
  reset(); gets['/keepalive/status'] = { success: true, supported: true, on: false, minutes: 5 };
  r = await S('keep JARVIS running', 'phone'); check('keepalive: refused from the phone, nothing called', !calls.length && /laptop/.test(r.text), r);
  reset(); gets['/keepalive/status'] = { success: true, supported: false };
  r = await S('keep JARVIS running'); check('keepalive: not Windows → says so', /Windows/.test(r.text) && !calls.length);
  reset(); gets['/keepalive/status'] = { success: true, supported: true, on: false, minutes: 5 }; replies['/keepalive/set'] = { error: 'Windows would not create the task (Access is denied)' };
  r = await S('keep jarvis running'); check('keepalive: a failure is reported plainly', /Access is denied/.test(r.text), r.text);

  /* ---------- backup wording ---------- */
  const mb = t => Life.matchBackup(t);
  for (const [t, op, dest] of [['back up my files to D:', 'to', 'D:'], ['backup my files to D:\\JARVIS-Backup', 'to', 'D:\\JARVIS-Backup'], ['back up my files to the D drive', 'to', 'the D drive'], ['set my backup folder to E:\\Backups\\Jarvis', 'set', 'E:\\Backups\\Jarvis'], ['change the backup folder to "F:\\my backup"', 'set', '"F:\\my backup"'],
    ['run a backup', 'run', undefined], ['run a backup now', 'run', undefined], ['back up my files', 'run', undefined], ['back up my files now', 'run', undefined], ['backup status', 'status', undefined], ['when was my last backup', 'status', undefined], ['is my backup up to date?', 'status', undefined]]) {
    const m = mb(t); check('backup wording: "' + t + '"', m && m.op === op && (dest === undefined || m.dest === dest), m);
  }
  check('backup wording: weekly on/off, projects in/out', mb('turn on weekly backup').op === 'weekly' && mb('turn on weekly backup').on === true && mb('turn off the weekly backup').on === false && mb('weekly backup off').on === false && mb('include my projects in the backup').on === true && mb('exclude my projects from the backup').on === false && mb('back up my projects too').on === true);
  for (const t of ['back up', 'backup', 'back up jarvis', 'backup my data', 'export my data', 'restore my backup', 'copy this file to D:', 'back up my code', 'save a copy of my chats', 'back up the database', 'run a test', 'make a backup of server.js', 'my backup plan is to study', 'weekly report']) check('backup wording: not taken: "' + t + '"', mb(t) === null, mb(t));
  check('backup destination: a bare drive becomes a folder on it, slashes become backslashes, quotes go', Life.normDest('D:') === 'D:\\JARVIS-Backup' && Life.normDest('the D drive') === 'D:\\JARVIS-Backup' && Life.normDest('d') === 'D:\\JARVIS-Backup' && Life.normDest('"E:/Stuff/Backup/"') === 'E:\\Stuff\\Backup' && Life.normDest('F:\\') === 'F:\\JARVIS-Backup');

  /* ---------- backup flows ---------- */
  reset(); gets['/mirror/status'] = { dest: null }; replies['/mirror/setdest'] = { success: true, dest: 'D:\\JARVIS-Backup' };
  r = await S('set my backup folder to D:');
  const bc = said.find(x => x.confirmCard);
  check('backup set: the card names the folder, says what is and is not copied, and that nothing is deleted', bc && /D:\\JARVIS-Backup/.test(bc.text) && /API keys/.test(bc.text) && /nothing is ever deleted/i.test(bc.text) && bc.yes === 'YES, USE THIS FOLDER', bc && bc.text);
  check('backup set: setdest called with the folder, no run', calls.length === 1 && calls[0][0] === '/mirror/setdest' && calls[0][1].dest === 'D:\\JARVIS-Backup' && /folder set/i.test(r.text), [calls, r.text]);
  reset(); yes = false; gets['/mirror/status'] = { dest: null }; r = await S('set my backup folder to D:'); check('backup set: "no" calls nothing', !calls.length);
  reset(); gets['/mirror/status'] = { dest: 'C:\\Old', approved: 'C:\\Old' }; replies['/mirror/setdest'] = { success: true, dest: 'D:\\JARVIS-Backup' };
  await S('set my backup folder to D:'); check('backup set: replacing an existing folder says so', /replaces your current backup folder/.test(said.find(x => x.confirmCard).text));
  reset(); gets['/mirror/status'] = { dest: null }; replies['/mirror/setdest'] = { error: 'That folder already has other files in it.' };
  r = await S('set my backup folder to D:'); check('backup set: a server refusal is shown', /already has other files/.test(r.text));
  reset(); r = await S('back up my files to D:', 'phone'); check('backup: set/run are refused from the phone', !calls.length && /laptop/.test(r.text));
  // back up to X = set + run + a note when it ends
  reset(); let polls = 0; gets['/mirror/status'] = () => ({ dest: 'D:\\JARVIS-Backup', approved: 'D:\\JARVIS-Backup', running: calls.some(c => c[0] === '/mirror/run') && polls++ < 2, lastRun: Date.now(), last: { files: 40, copied: 12, replaced: 1, errors: [] } });
  replies['/mirror/setdest'] = { success: true, dest: 'D:\\JARVIS-Backup' }; replies['/mirror/run'] = { success: true, started: true };
  r = await S('back up my files to D:');
  check('backup to: sets the folder, starts the run, and says it runs in the background', calls.map(c => c[0]).join() === '/mirror/setdest,/mirror/run' && /Backup started/.test(r.text), [calls.map(c => c[0]), r.text]);
  await sleep(120);
  const fin = said.filter(x => x.text && /Backup finished/.test(x.text));
  check('backup to: when the run ends JARVIS says what happened, once', fin.length === 1 && /12 files copied/.test(fin[0].text), said.map(x => x.text));
  reset(); gets['/mirror/status'] = { dest: null };
  r = await S('run a backup'); check('backup run: without a folder it says how to set one', /back up my files to D:/.test(r.text) && !calls.length);
  reset(); gets['/mirror/status'] = { dest: 'D:\\B', running: true }; r = await S('run a backup'); check('backup run: already running', /already running/.test(r.text) && !calls.length);
  reset(); gets['/mirror/status'] = { dest: 'D:\\B', approved: 'D:\\B', running: false, lastRun: null }; replies['/mirror/run'] = { error: 'The backup drive is nearly full.' };
  r = await S('run a backup'); check('backup run: server error shown', /nearly full/.test(r.text));
  reset(); gets['/mirror/status'] = { dest: 'D:\\B', approved: 'D:\\B', enabled: true, includeProjects: false, lastRun: Date.now() - 2 * 864e5, last: { files: 100, copied: 5, replaced: 0, errors: [{ path: 'a', why: 'in use or protected' }], partial: false }, dueIn: 5 * 864e5 };
  r = await S('backup status'); check('backup status: folder, last run, errors, weekly and projects', /D:\\B/.test(r.text) && /5 files copied/.test(r.text) && /in use or protected/.test(r.text) && /Weekly automatic backup: \*\*on/.test(r.text) && /Projects included: \*\*no/.test(r.text), r.text);
  reset(); gets['/mirror/status'] = { dest: 'D:\\B', approved: 'D:\\B' }; replies['/mirror/config'] = { success: true, dest: 'D:\\B' };
  r = await S('turn on weekly backup'); check('weekly: config called with enabled', calls[0][0] === '/mirror/config' && calls[0][1].enabled === true && /Weekly backup is on/.test(r.text), [calls, r.text]);
  r = await S('include my projects in the backup'); check('projects: config called with includeProjects', calls[1][1].includeProjects === true);
  reset(); gets['/mirror/status'] = { dest: null }; r = await S('turn on weekly backup'); check('weekly: needs a folder first', /Set a backup folder first/.test(r.text) && !calls.length);

  /* ---------- expenses ---------- */
  reset();
  r = await S('spent 120 on lunch');
  check('expense: logged with amount, note, category; today and month totals; undo promised', store.d['jarvis.expenses'].length === 1 && store.d['jarvis.expenses'][0].amount === 120 && store.d['jarvis.expenses'][0].cat === 'Food' && /₹120/.test(r.text) && /Today \*\*₹120\*\*/.test(r.text) && /undo/.test(r.text) && undo.length === 1, r.text);
  await S('paid 80 for auto'); await S('spent 450 on books');
  check('expense: three logged', store.d['jarvis.expenses'].length === 3);
  const u = undo[2][1](); check('expense: undo removes just the last one', store.d['jarvis.expenses'].length === 2 && /450/.test(u), u);
  r = await S('how much did I spend this month');
  check('summary: total, categories with percentages, latest entries, a CSV action', /₹200/.test(r.text) && /Food/.test(r.text) && /Transport/.test(r.text) && /Latest/.test(r.text) && r.actions && r.actions[0].label === 'EXPORT AS CSV', r.text);
  r = await S('how much did I spend on food this month'); check('summary: about a category', /₹120/.test(r.text) && !/Transport/.test(r.text.split('Latest')[0]), r.text);
  r = await S('how much did I spend last month'); check('summary: nothing in the window', /Nothing logged/.test(r.text));
  replies['/tool/writeFile'] = body => ({ success: true, name: body.name });
  r = await S('export my expenses');
  const w = calls.find(c => c[0] === '/tool/writeFile');
  check('export: a CSV in Notes with a header and the rows', w && /^Notes\/expenses-\d{4}-\d\d-\d\d\.csv$/.test(w[1].name) && /^date,amount,category,note\n/.test(w[1].content) && w[1].content.split('\n').filter(Boolean).length === 3 && /Saved \*\*2 expenses\*\*/.test(r.text), [w && w[1].name, r.text]);
  reset(); r = await S('how much did I spend this month'); check('summary: no expenses yet', /not logged any expenses/.test(r.text));
  await S('spent 100 on tea'); yes = false; r = await S('delete all my expenses'); check('forget: "no" keeps them', store.d['jarvis.expenses'].length === 1);
  yes = true; undo.length = 0; r = await S('delete all my expenses'); check('forget: "yes" deletes, and undo brings them back', store.d['jarvis.expenses'].length === 0 && undo.length === 1); undo[0][1](); check('forget: undone', store.d['jarvis.expenses'].length === 1);
  for (const t of ['spent time with friends', 'I spent the whole day studying', 'what is 5 times 6', 'bought milk', 'how much time did I spend studying', 'hello']) { reset(); check('expense: not taken: "' + t + '"', (await S(t)) === null, t); }

  /* ---------- habits ---------- */
  reset();
  r = await S('track habit gym'); check('habit: added', store.d['jarvis.habits'].length === 1 && store.d['jarvis.habits'][0].name === 'gym' && /Now tracking \*\*gym/.test(r.text) && undo.length === 1, r.text);
  r = await S('track habit gym'); check('habit: adding twice is told, not duplicated', store.d['jarvis.habits'].length === 1 && /already tracking/.test(r.text));
  r = await S('I did gym'); check('habit: ticked for today with a 1-day streak', store.d['jarvis.habits'][0].days[today()] === 1 && /1-day streak/.test(r.text), r.text);
  r = await S('I did gym'); check('habit: ticking twice does nothing', /already ticked/.test(r.text) && Object.keys(store.d['jarvis.habits'][0].days).length === 1);
  r = await S('I did gym yesterday'); check('habit: yesterday counts and extends the streak to 2', /2-day streak/.test(r.text) && Object.keys(store.d['jarvis.habits'][0].days).length === 2, r.text);
  r = await S('my gym streak'); check('habit: streak answer', /2\*\* days in a row/.test(r.text) && /🟩/.test(r.text), r.text);
  r = await S('habits'); check('habit: list shows streaks and a week grid', /gym/.test(r.text) && /🔥/.test(r.text) && /🟩/.test(r.text), r.text);
  const hu = undo[undo.length - 1][1](); check('habit: undo of a tick removes only that day', Object.keys(store.d['jarvis.habits'][0].days).length === 1 && /Un-ticked/.test(hu), hu);
  r = await S('done homework'); check('habit: an unknown name is not taken', r === null);
  r = await S('stop tracking gym'); check('habit: stop tracking with few days needs no card, and undo restores it', store.d['jarvis.habits'].length === 0 && undo.length > 0); undo[undo.length - 1][1](); check('habit: restored with its days', store.d['jarvis.habits'].length === 1);
  reset(); r = await S('habits'); check('habit: empty list explains how to start', /track habit gym/.test(r.text));
  reset(); r = await S('done water'); check('habit: with no habits "done water" is not taken', r === null);

  /* ---------- capture ---------- */
  reset(); replies['/tool/writeFile'] = b => ({ success: true, name: b.name });
  r = await S('jot down buy a charger tomorrow');
  const cw = calls[0]; check('capture: appended to today\'s inbox note as a timed bullet', cw[0] === '/tool/writeFile' && cw[1].name === 'Notes/inbox-' + today() + '.md' && cw[1].append === true && /^- \d\d:\d\d — buy a charger tomorrow\n$/.test(cw[1].content) && /Captured/.test(r.text), cw);
  r = await S('note to self: renew the bus pass'); check('capture: second form works', calls.length === 2 && /renew the bus pass/.test(calls[1][1].content));
  reset(); replies['/tool/writeFile'] = { error: 'disk full' }; r = await S('jot down x thing'); check('capture: a write error is reported', /disk full/.test(r.text));
  reset(); replies['/tool/readFile'] = { success: true, content: '- 09:10 — one\n- 10:00 — two\n' }; r = await S('show my inbox');
  check('inbox: lists the items and offers to open the file', /2 items/.test(r.text) && /one/.test(r.text) && /two/.test(r.text) && r.actions[0].label === 'OPEN THE FILE' && calls[0][1].name === 'Notes/inbox-' + today() + '.md', r.text);
  r = await S('show my inbox yesterday'); check('inbox: yesterday reads yesterday\'s file', calls[1][1].name === 'Notes/inbox-' + LifeParse.ymd(Date.now() - 864e5) + '.md');
  reset(); replies['/tool/readFile'] = { error: 'not found' }; r = await S('inbox'); check('inbox: empty message', /empty/.test(r.text));
  for (const t of ['capture the flag', 'inbox zero tips', 'check my email inbox', 'quick note']) { reset(); check('capture: not taken: "' + t + '"', (await S(t)) === null, t); }

  /* ---------- screenshot search ---------- */
  const ms = t => Life.matchShot(t);
  for (const [t, q, win] of [['find the screenshot with the wifi password', 'the wifi password', ''], ['find a screenshot of the flight booking', 'the flight booking', ''], ['search my screenshots for hostel fee receipt', 'hostel fee receipt', ''], ['which screenshot has the zoom link', 'the zoom link', ''], ['where is the screenshot with the error from last week', 'the error', 'last week'], ['show me the screenshot where it says "payment failed"', 'it says "payment failed', ''], ['look for screenshots about invoice yesterday', 'invoice', 'yesterday']]) {
    const m = ms(t); check('shot wording: "' + t + '"', m && m.op === 'find' && (q === undefined || m.q.replace(/["“”]/g, '') === q.replace(/["“”]/g, '')) && m.win === win, m);
  }
  check('shot wording: the other commands', ms('index my screenshots').op === 'index' && ms('update the screenshot index').op === 'index' && ms('make my screenshots searchable').op === 'index' && ms('screenshot index status').op === 'status' && ms('forget my screenshot index').op === 'forget' && ms('add D:\\Shots to my screenshot folders').op === 'add' && ms('add D:\\Shots to my screenshot folders').folder === 'D:\\Shots' && ms('remove D:\\Shots from my screenshot folders').op === 'remove');
  for (const t of ['take a screenshot', 'take a screenshot of this', 'screenshot', 'find my files', 'find the file with the password', 'show me the screenshot tool', 'search for screenshots tips online', 'find screenshots', 'delete my screenshots', 'what is a screenshot']) check('shot wording: not taken: "' + t + '"', ms(t) === null, ms(t));
  const SH = { total: 40, indexed: 40, pending: 0, running: false, folders: ['C:\\Users\\x\\Pictures\\Screenshots'] };
  reset(); gets['/shots/status'] = SH; replies['/shots/search'] = b => ({ success: true, total: 2, results: [{ path: 'C:\\s\\a.png', name: 'a.png', mtime: Date.now() - 864e5, snippet: 'Wi-Fi password is hunter42' }, { path: 'C:\\s\\b.png', name: 'b.png', mtime: Date.now() - 5 * 864e5, snippet: 'hostel wifi' }], words: ['wifi'], status: SH });
  r = await S('find the screenshot with the wifi password');
  check('shot find: search called with the words; results listed with date, name and snippet; one OPEN button each', calls[0][0] === '/shots/search' && calls[0][1].q === 'wifi password'.replace('wifi password', 'the wifi password') && /2 screenshots/.test(r.text) && /hunter42/.test(r.text) && /a\.png/.test(r.text) && r.actions.length === 2 && r.actions[0].label === 'OPEN 1', [calls[0], r.text]);
  replies['/shots/open'] = { success: true }; calls.length = 0; await r.actions[1].fn(); check('shot find: OPEN asks the server to open exactly that indexed file', calls[0][0] === '/shots/open' && calls[0][1].path === 'C:\\s\\b.png');
  reset(); gets['/shots/status'] = SH; replies['/shots/search'] = b => { global.__shotBody = b; return { success: true, total: 0, results: [], words: ['x'], status: { ...SH, pending: 3 } }; };
  r = await S('find the screenshot with the invoice last week');
  check('shot find: a date window becomes from/to; nothing found says how many were read and mentions the 3 not yet read', global.__shotBody.from > 0 && global.__shotBody.to > global.__shotBody.from && /no screenshot with/.test(r.text) && /40 screenshots/.test(r.text) && /3 newer or changed screenshots are not read yet/.test(r.text), [global.__shotBody, r.text]);
  reset(); gets['/shots/status'] = { ...SH, total: 0, indexed: 0 }; r = await S('find the screenshot with the invoice'); check('shot find: no screenshots at all → says where it looks and how to add a folder', /Pictures\\Screenshots/.test(r.text) && /screenshot folders/.test(r.text) && !calls.length);
  // first search: nothing read yet → asks, then reads in the background, then searches by itself
  reset(); let stRun = 0; gets['/shots/status'] = () => (calls.some(c => c[0] === '/shots/update') ? (stRun++ < 1 ? { ...SH, indexed: 10, pending: 30, running: true } : { ...SH, indexed: 40, pending: 0, running: false }) : { ...SH, indexed: 0, pending: 40 });
  replies['/shots/update'] = { success: true, started: true }; replies['/shots/search'] = { success: true, total: 1, results: [{ path: 'C:\\s\\a.png', name: 'a.png', mtime: Date.now(), snippet: 'invoice 42' }], status: SH };
  r = await S('find the screenshot with the invoice');
  const sc = said.find(x => x.confirmCard);
  check('shot first run: the card says it reads them on this laptop, nothing is sent, the index is private, nothing is changed', sc && /on this laptop/.test(sc.text) && /nothing is sent/.test(sc.text) && /backup skips it/.test(sc.text) && /never change, move or delete/.test(sc.text) && sc.yes === 'YES, READ THEM', sc && sc.text);
  check('shot first run: after "yes" reading starts (150 at most) and the answer says the search follows', calls[0][0] === '/shots/update' && calls[0][1].max === 150 && /search for “the invoice” as soon as it is done/.test(r.text), [calls[0], r.text]);
  await sleep(200);
  check('shot first run: when reading ends JARVIS searches by itself and shows the result', said.some(x => x.text && /1 screenshot\*\* with/.test(x.text) && /invoice 42/.test(x.text)), said.map(x => x.text));
  reset(); yes = false; gets['/shots/status'] = { ...SH, indexed: 0, pending: 40 }; r = await S('find the screenshot with the invoice'); check('shot first run: "no" reads nothing', !calls.length && /did not read/.test(r.text));
  reset(); gets['/shots/status'] = { ...SH, indexed: 0, pending: 40 }; r = await S('find the screenshot with the invoice', 'phone'); check('shot first run: from the phone nothing is read', !calls.length && /laptop/.test(r.text));
  reset(); gets['/shots/status'] = { ...SH, indexed: 30, pending: 10 }; replies['/shots/update'] = { success: true, started: true }; r = await S('index my screenshots'); check('shot index: starts the update and says how many', calls[0][0] === '/shots/update' && /Reading \*\*10\*\*/.test(r.text));
  reset(); gets['/shots/status'] = { ...SH, running: true }; r = await S('index my screenshots'); check('shot index: already running', /Already reading/.test(r.text) && !calls.length);
  reset(); gets['/shots/status'] = SH; r = await S('index my screenshots'); check('shot index: nothing pending', /already read/.test(r.text) && !calls.length);
  reset(); gets['/shots/status'] = { ...SH, pending: 5 }; r = await S('index my screenshots', 'phone'); check('shot index: refused from the phone', !calls.length && /laptop/.test(r.text));
  reset(); gets['/shots/status'] = { ...SH, pending: 5, running: true, progress: { done: 3, of: 5 } }; r = await S('screenshot index status'); check('shot status: counts and progress', /\*\*40\*\*/.test(r.text) && /waiting: 5/.test(r.text) && /3\/5/.test(r.text));
  reset(); replies['/shots/forget'] = { success: true, forgotten: 12 }; r = await S('forget my screenshot index'); check('shot forget: asks, then deletes, and says screenshots are untouched', said[0].confirmCard && /not touched/.test(said[0].text) && /12 screenshots/.test(r.text)); reset(); yes = false; await S('forget my screenshot index'); check('shot forget: "no" calls nothing', !calls.length);
  reset(); replies['/shots/folders'] = { success: true, folder: 'D:\\Shots' }; r = await S('add D:\\Shots to my screenshot folders'); check('shot folders: add', calls[0][1].add === 'D:\\Shots' && /D:\\Shots/.test(r.text)); replies['/shots/folders'] = { error: 'I could not find that folder.' }; r = await S('add Z:\\nope to my screenshot folders'); check('shot folders: a refusal is shown', /could not find/.test(r.text));

  /* ---------- the rest ---------- */
  r = await S('/life'); check('help lists all five areas', /Expenses/.test(r.text) && /Habits/.test(r.text) && /capture/i.test(r.text) && /keep JARVIS running/.test(r.text) && /backup/i.test(r.text));
  check('junk input: empty, null, odd characters do not throw', (await S('')) === null && (await Life.intercept(null)) === null && (await S('¯\\_(ツ)_/¯')) === null);

  console.log(`life-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0; process.exit();
})();
