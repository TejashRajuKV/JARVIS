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

  console.log(`undo: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
