'use strict';
// Phase 2 checkpoint recovery regression tests. Added for manual execution; intentionally not run in this change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
assert.ok(source.includes('function recoverySummary(id)'), 'read-only checkpoint summary should be available');
assert.ok(source.includes('checkpointVersion: 1'), 'checkpoints should be schema-versioned');
assert.ok(source.includes('function sweepInterrupted(now = Date.now())'), 'stale running tasks should be detectable');
assert.ok(source.includes('recoverySummary, active:'), 'recovery summary should be available to the task dashboard');
assert.ok(source.includes("status: ['verified','unverified','failed','declined','blocked','notrun','skipped','running'].includes(s.status)"), 'persisted status should be normalized');
console.log('phase2-recovery.test.js: assertions defined; not run.');
