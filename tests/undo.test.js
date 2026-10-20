// Undo stack (undo.js). Run: node tests/undo.test.js
const path = require('path');
const { createUndo } = require(path.join(__dirname, '..', 'undo.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

(async () => {
  let t = 1e6; const U = createUndo({ now: () => t, ttl: 60e3, max: 3 });
  check('empty → null', await U.undo() === null && U.size() === 0 && U.peek() === null);

  const log = [];
  U.push('first', () => { log.push('first'); return 'undid first'; });
  U.push('second', () => { log.push('second'); return 'undid second'; });
  check('peek shows the newest', U.peek() === 'second' && U.size() === 2);
  const r = await U.undo();
  check('newest first (LIFO) with its message', r.label === 'second' && r.msg === 'undid second' && log.join() === 'second');
  check('then the older one, then nothing', (await U.undo()).label === 'first' && await U.undo() === null);

  // cap
  for (const n of ['a', 'b', 'c', 'd', 'e']) U.push(n, () => n);
  check('keeps only the newest 3', U.size() === 3 && U.peek() === 'e');
  check('oldest are dropped', (await U.undo()).label === 'e' && (await U.undo()).label === 'd' && (await U.undo()).label === 'c' && await U.undo() === null);

  // expiry
  U.push('old', () => 'x'); t += 61e3; U.push('new', () => 'y');
  check('expired entries disappear', U.size() === 1 && U.peek() === 'new');
  t += 61e3; check('everything expires', U.size() === 0 && await U.undo() === null);

  // failures
  U.push('boom', () => { throw new Error('the file is gone'); });
  const bad = await U.undo();
  check('an error is reported, not thrown, and the entry is consumed', bad.error === 'the file is gone' && bad.label === 'boom' && U.size() === 0);
  U.push('async boom', async () => { throw new Error('nope'); });
  check('async errors too', (await U.undo()).error === 'nope');
  U.push('async ok', async () => { await null; return 'done later'; });
  check('async success', (await U.undo()).msg === 'done later');

  // listener + bad input
  const seen = []; U.onChange((k, l) => seen.push(k + ':' + l));
  U.push('x', () => 1); await U.undo();
  check('listener sees push then undo', seen.join() === 'push:x,undo:x', seen);
  U.push('not a function', null);
  check('non-function ignored', U.size() === 0);
  U.push('a', () => 1); U.clear();
  check('clear empties', U.size() === 0);

  // whole-task undo: entries made while a run is tagged are reversed together, newest first
  {
    let t2 = 5e6; const R = createUndo({ now: () => t2, ttl: 60e3, max: 40 }); const order = [];
    R.push('loose action before', () => { order.push('loose'); return 'x'; });
    R.setRun('AGT-1'); R.push('made folder', () => { order.push('folder'); return 'Removed the folder.'; }); R.push('set volume', () => { order.push('volume'); return 'Volume back.'; }); R.setRun(null);
    R.setRun('AGT-2'); R.push('other run', () => { order.push('other'); return 'o'; }); R.setRun(null);
    check('countRun counts only that run', R.countRun('AGT-1') === 2 && R.countRun('AGT-2') === 1 && R.countRun('AGT-9') === 0);
    check('lastRun is the newest run with entries', R.lastRun() === 'AGT-2');
    const r1 = await R.undoRun('AGT-1');
    check('undoRun reverses that run newest first', r1.done.map(d => d.label).join() === 'set volume,made folder' && order.join() === 'volume,folder', order);
    check('…and leaves other runs and loose actions alone', R.countRun('AGT-2') === 1 && R.size() === 2 && r1.failed.length === 0);
    check('a second undoRun of the same run has nothing to do', await R.undoRun('AGT-1') === null);
    check('undoRun with no id takes the newest run', (await R.undoRun()).id === 'AGT-2' && R.size() === 1);
    check('plain undo still takes one single action', (await R.undo()).label === 'loose action before' && R.size() === 0);
    // one step failing does not stop the rest, and expiry is reported
    R.setRun('AGT-3'); R.push('ok first', () => 'a'); R.push('boom', () => { throw new Error('file is gone'); }); R.push('ok last', () => 'c'); R.setRun(null);
    const r3 = await R.undoRun('AGT-3');
    check('a failing step is reported and the others still run', r3.done.length === 2 && r3.failed.length === 1 && r3.failed[0].error === 'file is gone', r3);
    R.setRun('AGT-4'); R.push('old step', () => 'x'); t2 += 61e3; R.push('new step', () => 'y'); R.setRun(null);
    const r4 = await R.undoRun('AGT-4');
    check('steps older than the window are counted as expired, the rest still undone', r4.expired === 1 && r4.done.length === 1, r4);
    R.push('later loose', () => 1);
    check('an action made outside any run never joins one', R.lastRun() === null && R.size() === 1);
  }

  {   // actions from before a page reload are put back with their ORIGINAL times
    let tn = 1e6; const Q = createUndo({ now: () => tn, ttl: 30 * 60e3, max: 5 }); const ran = [];
    const mk = (label, age, extra) => ({ label, t: tn - age, fn: async () => { ran.push(label); return 'ok ' + label; }, ...(extra || {}) });
    const n = Q.restore([mk('older', 20 * 60e3), mk('newer', 5 * 60e3), mk('too old', 31 * 60e3), { label: 'no fn', t: tn }, { label: 'bad time', fn: () => 1, t: 'x' }, mk('future', -10 * 60e3), null]);
    check('restore: takes only usable, in-window entries (not too old, not missing a function or a time, not from the future)', n === 2 && Q.size() === 2, [n, Q.size()]);
    check('restore: the newest of them is undone first (order by original time)', Q.peek() === 'newer');
    const u1 = await Q.undo(); const u2 = await Q.undo();
    check('restore: each one runs its own function and reports its message', u1.label === 'newer' && u1.msg === 'ok newer' && u2.label === 'older' && ran.join() === 'newer,older', [u1, u2]);
    Q.restore([mk('a', 29 * 60e3)]); tn += 2 * 60e3; check('restore: the 30 minutes still count from when the action HAPPENED — 2 minutes later it has expired', Q.size() === 0);
    let changes = 0; Q.onChange(() => { changes++; }); Q.restore([mk('quiet', 1000)]); check('restore: quiet — no "Undo" chip is triggered', changes === 0 && Q.size() === 1);
    Q.push('live', () => 1); Q.restore([mk('mixed', 500)]); check('restore: mixes in order with entries made in this session, and the stack keeps its size limit', Q.size() === 3 && (() => { for (let i = 0; i < 9; i++) Q.restore([mk('x' + i, i)]); return Q.size() <= 5; })());
    check('restore: junk input is harmless', Q.restore() === 0 && Q.restore(null) === 0 && Q.restore('x') === 0);
  }
  {   // after a reload the server's records come back with their plan run, so "undo that task" / ROLLBACK still works
    const tr = 5e6, R = createUndo({ now: () => tr }), done = [];
    R.restore([{ label: 'deleted a', t: tr - 60e3, run: 'AGT-20261019-004', fn: () => { done.push('a'); return 'ok a'; } },
      { label: 'renamed b', t: tr - 30e3, run: 'AGT-20261019-004', fn: () => { done.push('b'); return 'ok b'; } },
      { label: 'loose', t: tr - 10e3, run: 'not a run; drop', fn: () => 1 }]);
    check('restore keeps each entry\'s plan run id', R.countRun('AGT-20261019-004') === 2 && R.countRun('not a run; drop') === 0 && R.size() === 3);
    const u = await R.undoRun('AGT-20261019-004');
    check('…and undoRun reverses that plan, newest first, leaving the plain entry', u && u.done.length === 2 && done.join() === 'b,a' && R.size() === 1, [u, done]);
    R.setRun('AGT-20261019-005'); const inPlan = R.currentRun(); R.setRun(null);
    check('currentRun names the plan a call belongs to, null outside one', inPlan === 'AGT-20261019-005' && R.currentRun() === null);
  }
  console.log(`undo: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
