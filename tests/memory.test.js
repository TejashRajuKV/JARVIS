// Persistent personal-memory regression tests. Run manually: node tests/memory.test.js
// This file deliberately does not run as part of the assistant's automated editing workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('const MEMORY_MAX_ITEMS = 300;');
const end = source.indexOf('\nlet todos = store.get', start);
assert.ok(start >= 0 && end > start, 'memory policy and initializer should be present');
const memFnsStart = source.indexOf('function memSet(key, value) {', end);
const memFnsEnd = source.indexOf('\n// Undo helpers:', memFnsStart);
assert.ok(memFnsStart >= 0 && memFnsEnd > memFnsStart, 'memory operations should be present');

const values = new Map();
let nextId = 0;
const context = {
  store: {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    set: (key, value) => values.set(key, value)
  },
  rid: () => 'test-' + (++nextId),
  renderMemory: () => {},
  pulse: () => {},
  Date,
  String,
  Number,
  Array,
  Object,
  Math
};
const sourceUnderTest = source.slice(start, end) + '\n' +
  source.slice(memFnsStart, memFnsEnd) +
  '\nglobalThis.api = { normalizeMemoryRecords, memSet, memAdd, memGet, get memory(){ return memory; } };';
vm.runInNewContext(sourceUnderTest, context, { filename: 'script.js memory section' });
const api = context.api;

const migrated = api.normalizeMemoryRecords([
  null,
  { id: '1', key: 'Name', value: 'Old', ts: 1 },
  { id: '2', key: 'name', value: 'Tejash', ts: 2 },
  { id: '3', key: 'note', value: 'Revise DSA', ts: 3 },
  { id: '4', key: 'NOTE', value: 'revise dsa', ts: 4 },
  { id: '5', key: '', value: 'ignored', ts: 5 }
]);
assert.equal(migrated.length, 2, 'invalid rows and duplicate facts should be removed');
assert.equal(migrated[0].value, 'Tejash', 'latest named field should win');
assert.equal(migrated[1].key, 'note', 'note keys should be canonicalized');

assert.equal(api.memSet(' Name ', '  Tejash Raju  '), true);
assert.equal(api.memSet('name', 'Updated'), true);
assert.equal(api.memory.filter(x => x.key.toLowerCase() === 'name').length, 1, 'named fields should update instead of duplicate');
assert.equal(api.memGet('NAME'), 'Updated', 'memory lookup should be case-insensitive');

assert.equal(api.memAdd('note', 'Remember this'), true);
assert.equal(api.memAdd('note', ' remember THIS '), false, 'duplicate notes should not be stored twice');
assert.equal(api.memAdd('   ', 'invalid'), false, 'empty keys should be rejected');
assert.equal(api.memAdd('note', ''), false, 'empty values should be rejected');

api.memSet('long', 'x'.repeat(900));
assert.equal(api.memGet('long').length, 500, 'values should be bounded');
assert.equal(api.memSet('k'.repeat(120), 'value'), true);
assert.equal(api.memory.at(-1).key.length, 80, 'keys should be bounded');

for (let i = 0; i < 350; i++) api.memAdd('note', 'fact-' + i);
assert.ok(api.memory.length <= 300, 'persistent memory should have a fixed upper bound');
assert.equal(values.get('jarvis.memory').length, api.memory.length, 'normalized memory should be persisted');

console.log('memory.test.js: assertions defined and ready to run.');



console.log('memory.test.js: assertions defined and ready to run.');
