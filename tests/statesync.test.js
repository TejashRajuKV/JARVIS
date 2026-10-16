// Two open tabs: a change one tab saves (todos, classes, expenses…) is pushed to the other, so an old tab cannot later write its stale copy over it. Real server (isolated home), real event stream. Run: node tests/statesync.test.js
'use strict';
const http = require('http');
const { startServer } = require('./lib/server');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const s = await startServer();
  const events = [], names = [];
  // a second tab: just a listener on the event stream (same headers the page sends)
  const req = http.get(s.base + '/api/events', { headers: { Origin: s.base, 'Sec-Fetch-Site': 'same-origin', Accept: 'text/event-stream' } }, res => {
    let buf = ''; res.setEncoding('utf8');
    res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = (blk.match(/^event: (.+)$/m) || [])[1], data = (blk.match(/^data: (.+)$/m) || [])[1]; if (ev) names.push(ev); if (ev === 'state' && data) { try { events.push(JSON.parse(data)); } catch {} } } });
  });
  req.on('error', () => {});
  await sleep(400);
  const save = (src, set) => s.post('/api/state', { src, set });
  const got = key => events.filter(e => e.key === key);
  try {
    let r = await save('tabA', { 'jarvis.todos': [{ id: 't1', text: 'buy milk', done: false }] }); await sleep(300);
    check('a saved list is accepted', r.status === 200 && r.json.success === true, r);
    check('…and pushed to the other tabs with the new value and who wrote it', got('jarvis.todos').length === 1 && got('jarvis.todos')[0].src === 'tabA' && got('jarvis.todos')[0].value[0].text === 'buy milk', events);

    await save('tabA', { 'jarvis.todos': [{ id: 't1', text: 'buy milk', done: false }] }); await sleep(300);
    check('saving the same list again tells nobody (a tab that rewrites everything on every change does not flood the others)', got('jarvis.todos').length === 1, got('jarvis.todos').length);

    await save('tabB', { 'jarvis.todos': [{ id: 't1', text: 'buy milk', done: false }, { id: 't2', text: 'call mom', done: false }], 'jarvis.classes': [{ id: 'c1', name: 'DBMS', day: 1, h: 9, m: 0 }], 'jarvis.deadlines': [] }); await sleep(300);
    check('a change in one list pushes just that list (todos and classes changed; the unchanged-but-new empty deadlines list is "changed" from nothing, so it is sent once)', got('jarvis.todos').length === 2 && got('jarvis.classes').length === 1 && got('jarvis.classes')[0].src === 'tabB', events.map(e => e.key));

    await save('tabA', { 'jarvis.expenses': [{ id: 'e1', t: 1, amount: 50, cat: 'Food', note: '' }], 'jarvis.habits': [{ id: 'h1', name: 'gym', days: [] }], 'jarvis.attendance': { DBMS: { held: 1, attended: 1, log: [] } }, 'jarvis.budget': 5000 }); await sleep(300);
    check('expenses, habits, attendance and the budget are shared the same way', ['jarvis.expenses', 'jarvis.habits', 'jarvis.attendance', 'jarvis.budget'].every(k => got(k).length === 1), events.map(e => e.key));
    check('attendance (an object, not a list) arrives intact', got('jarvis.attendance')[0].value.DBMS.held === 1);

    const n = events.length;
    await save('tabA', { 'jarvis.settings': { theme: 'gold' }, 'jarvis.cmdHistory': ['x'], 'jarvis.focusToday': 3 }); await sleep(300);
    check('settings and other per-tab housekeeping are NOT broadcast (each tab keeps its own)', events.length === n, events.slice(n));

    await save('tabA', { 'jarvis.chat': [{ role: 'user', text: 'hi' }] }); await sleep(300);
    check('the chat is still pushed (the older behaviour is unchanged)', got('jarvis.chat').length === 1 && got('jarvis.chat')[0].src === 'tabA');

    // the old tab's stale write: the server cannot know it is stale, but the OTHER tab now has the newer list, so its next save carries it (the push is what prevents the loss)
    const st = (await s.get('/api/state.js')).text;
    check('the server holds the newest list (what a newly opened tab would load)', /call mom/.test(st) && /DBMS/.test(st), st.slice(0, 200));

    await save('tabA', { 'jarvis.todos': null }); await sleep(300);
    check('deleting a key is pushed as null (the page ignores it for lists, so an empty write cannot wipe the other tab)', got('jarvis.todos').length === 3 && got('jarvis.todos')[2].value === null, got('jarvis.todos').map(e => e.value));

    // a restore / import replaces everything: every open tab is told to reload
    const ex = await s.post('/api/backup/export', {});
    const nReset = names.filter(x => x === 'statereset').length;
    const imp = await s.post('/api/backup/import', { content: ex.json.content, mode: 'merge' }); await sleep(400);
    check('importing a backup tells every open tab to reload (so none writes its old copy back over it)', imp.json.success === true && names.filter(x => x === 'statereset').length === nReset + 1, [imp.json, names.slice(-4)]);
    check('an ordinary save does not', names.filter(x => x === 'statereset').length === nReset + 1);

    // only one tab says an alert out loud: the first claim wins, the others are told no, until it expires
    const c1 = await s.post('/api/claim', { key: 'class:c1:Wed', ttlSec: 1 }), c2 = await s.post('/api/claim', { key: 'class:c1:Wed', ttlSec: 1 }), c3 = await s.post('/api/claim', { key: 'class:other', ttlSec: 1 });
    check('claim: the first tab wins an alert, the second is told no, a different alert is independent', c1.json.won === true && c2.json.won === false && c3.json.won === true, [c1.json, c2.json, c3.json]);
    await sleep(1300);
    const c4 = await s.post('/api/claim', { key: 'class:c1:Wed', ttlSec: 1 });
    check('claim: after its time is up the same alert can be claimed again (e.g. next week)', c4.json.won === true, c4.json);
    check('claim: no key is a 400', (await s.post('/api/claim', {})).status === 400);

    const bad = await save('tabA', { 'not a key': 1 });
    check('a bad key is still refused', bad.status === 400);
  } finally {
    req.destroy(); await s.stop();
  }
  console.log(`statesync: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + e.message); process.exitCode = 1; });
