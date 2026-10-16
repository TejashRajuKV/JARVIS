// Saving a whole list from a tab that is not up to date (statemerge.js): another tab's additions are kept, this tab's deletions are honoured; plus the real route. Run: node tests/statemerge.test.js
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'statemerge.js'));
const { startServer } = require('./lib/server');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const it = (id, text) => ({ id, text: text || id });
const ids = l => l.map(x => x.id).join();

// ---- the rules
{ const m = M.mergeIdList;
  check('merge: another tab added c; this tab (which knew a, b) added d → a, b, d, c (this tab\'s items first, the other tab\'s after)', ids(m([it('a'), it('b'), it('c')], [it('a'), it('b'), it('d')], ['a', 'b'])) === 'a,b,d,c');
  check('merge: this tab deleted b; the server still has it → b is dropped, not resurrected', ids(m([it('a'), it('b')], [it('a')], ['a', 'b'])) === 'a');
  check('merge: another tab deleted b; this tab still has it (and knew it) → b is dropped', ids(m([it('a')], [it('a'), it('b')], ['a', 'b'])) === 'a');
  check('merge: this tab\'s own new item (not in the base) is kept even though the server has never seen it', ids(m([it('a')], [it('a'), it('n')], ['a'])) === 'a,n');
  check('merge: both tabs changed the same item → this tab\'s version wins', m([it('a', 'server text')], [it('a', 'my text')], ['a'])[0].text === 'my text');
  check('merge: this tab\'s order is kept', ids(m([it('a'), it('b'), it('c')], [it('c'), it('a'), it('b')], ['a', 'b', 'c'])) === 'c,a,b');
  check('merge: nothing changed anywhere → the same list', ids(m([it('a'), it('b')], [it('a'), it('b')], ['a', 'b'])) === 'a,b');
  check('merge: ids are compared as text (1 and "1" are the same item)', ids(m([{ id: 1 }], [{ id: '1' }], [1])) === '1' && m([{ id: 1 }], [{ id: '1' }], [1]).length === 1);
  check('merge: a duplicate id in the tab\'s list is kept once', m([], [it('a'), it('a')], []).length === 1);
  check('merge: an empty list from the tab that knew everything deletes everything', m([it('a'), it('b')], [], ['a', 'b']).length === 0);
  check('merge: …but an empty list from a tab that knew nothing keeps what others added', ids(m([it('a'), it('b')], [], [])) === 'a,b');
  check('not merged: no base sent → null (plain replace as before)', m([it('a')], [it('b')], undefined) === null);
  check('not merged: items without ids → null', m([{ text: 'x' }], [{ text: 'y' }], []) === null && m([it('a')], [{ text: 'y' }], []) === null);
  check('not merged: not lists → null', m('x', [], []) === null && m([], 'x', []) === null);
  const k = M.mergeKeyed;
  check('keyed (attendance): another tab added OS; this tab added DBMS → both', JSON.stringify(Object.keys(k({ OS: 1 }, { DBMS: 2 }, []))) === '["DBMS","OS"]');
  check('keyed: this tab removed OS (it knew it) → gone; another tab’s new CN stays', JSON.stringify(Object.keys(k({ OS: 1, CN: 3, DBMS: 2 }, { DBMS: 2 }, ['OS', 'DBMS']))) === '["DBMS","CN"]');
  check('keyed: this tab\'s numbers for a subject win', k({ OS: { held: 1 } }, { OS: { held: 5 } }, ['OS']).OS.held === 5);
  const s = M.mergeState('jarvis.todos', [it('a'), it('c')], [it('a'), it('d')], ['a']);
  check('mergeState: says the result differs from what the tab sent (so the tab must take it)', s.merged === true && s.changed === true && ids(s.value) === 'a,d,c', s);
  const s2 = M.mergeState('jarvis.todos', [it('a')], [it('a'), it('d')], ['a']);
  check('mergeState: nothing to add → not "changed"', s2.merged === true && s2.changed === false);
  check('mergeState: a key that is not merged (settings) passes straight through', M.mergeState('jarvis.settings', { a: 1 }, { b: 2 }, []).merged === false);
}

// ---- the real route: a tab that is a save behind
(async () => {
  const s = await startServer();
  const base = ids => ids;
  try {
    const save = (src, set, b) => s.post('/api/state', { src, set, base: b });
    await save('A', { 'jarvis.todos': [it('t1', 'milk'), it('t2', 'eggs')] });
    // tab B adds t3 (it knew t1, t2)
    let r = await save('B', { 'jarvis.todos': [it('t1', 'milk'), it('t2', 'eggs'), it('t3', 'bread')] }, { 'jarvis.todos': ['t1', 't2'] });
    check('a save that adds an item is accepted and nothing is sent back to the writer', r.status === 200 && r.json.success && Object.keys(r.json.merged).length === 0, r.json);
    // tab A is a save behind (does not know t3): it deletes t2 and adds t4
    r = await save('A', { 'jarvis.todos': [it('t1', 'milk'), it('t4', 'tea')] }, { 'jarvis.todos': ['t1', 't2'] });
    const got = r.json.merged && r.json.merged['jarvis.todos'];
    check('the stale tab\'s save keeps the other tab\'s item (t3), honours its own delete (t2) and add (t4), and gets the combined list back', got && ids(got) === 't1,t4,t3', r.json);
    const st = (await s.get('/api/state.js')).text;
    check('the server holds the combined list, not the stale tab\'s copy', /bread/.test(st) && /tea/.test(st) && !/eggs/.test(st), st.slice(0, 300));
    // no base → old behaviour (replace)
    r = await save('C', { 'jarvis.todos': [it('only', 'one')] });
    check('a save without a base replaces the list as before (older pages keep working)', Object.keys(r.json.merged || {}).length === 0 && /only/.test((await s.get('/api/state.js')).text) && !/bread/.test((await s.get('/api/state.js')).text));
    // attendance
    await save('A', { 'jarvis.attendance': { DBMS: { held: 4, attended: 3, log: [] } } });
    await save('B', { 'jarvis.attendance': { DBMS: { held: 4, attended: 3, log: [] }, OS: { held: 1, attended: 1, log: [] } } }, { 'jarvis.attendance': ['DBMS'] });
    r = await save('A', { 'jarvis.attendance': { DBMS: { held: 5, attended: 4, log: [] } } }, { 'jarvis.attendance': ['DBMS'] });
    const att = r.json.merged && r.json.merged['jarvis.attendance'];
    check('attendance: the stale tab\'s new DBMS numbers win and the other tab\'s OS is kept', att && att.DBMS.held === 5 && att.OS && att.OS.held === 1, r.json);
    // lists with items that have no ids are not merged
    r = await save('A', { 'jarvis.cmdHistory': ['x', 'y'] }, {}); check('other keys are untouched by merging', r.status === 200 && Object.keys(r.json.merged).length === 0);
  } finally { await s.stop(); }
  console.log(`statemerge: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + e.message); process.exitCode = 1; });
