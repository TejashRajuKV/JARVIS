'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('(function restoreFocusCtx() {');
const end = source.indexOf('})();', start);
assert(start >= 0 && end > start, 'restoreFocusCtx block should exist');
const restore = source.slice(start, end + 5);
const FOCUS_MS = 15 * 60 * 1000;
const now = Date.now();

function restored(saved) {
  const ctx = { focus: { folder: null, file: null, created: null, results: [] } };
  const store = { get: (_key, fallback) => saved === undefined ? fallback : saved };
  eval(restore);
  return ctx.focus;
}

const recentAction = { intent: 'OPEN_APPLICATION', summary: 'Opened VS Code', t: now - 1000 };
const recentFolder = { path: 'D:\\projects\\jarvis', t: now - 2000 };
const got = restored({ lastAction: recentAction, folder: recentFolder });
assert.deepStrictEqual(got.lastAction, recentAction, 'recent lastAction should survive a page reload');
assert.deepStrictEqual(got.folder, recentFolder, 'recent path focus should still be restored');

const expired = restored({ lastAction: { intent: 'DELETE_ITEM', summary: 'Old action', t: now - FOCUS_MS - 1 } });
assert.strictEqual(expired.lastAction, undefined, 'expired action context should not be restored');

const future = restored({ lastAction: { intent: 'DELETE_ITEM', summary: 'Future timestamp', t: now + 60_000 } });
assert.strictEqual(future.lastAction, undefined, 'future-dated action context should not be restored');

const malformed = restored({ lastAction: { intent: 42, summary: {}, t: now } });
assert.strictEqual(malformed.lastAction, undefined, 'malformed action context should not be restored');

console.log('focus-context: 4/4 checks passed');
