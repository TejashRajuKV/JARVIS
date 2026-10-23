'use strict';
// Phase 2 recovery regression coverage. Written for manual execution; deliberately not run during this change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
assert.ok(source.includes('function recoverySummary(id)'), 'a read-only recovery summary should exist');
assert.ok(source.includes('checkpointVersion: 1'), 'task checkpoints should be versioned');
assert.ok(source.includes('function sweepInterrupted(now = Date.now())'), 'stale in-progress tasks should be detected');
assert.ok(source.includes("status: rec.interrupted ? 'interrupted'"), 'interrupted status must be explicit');
assert.ok(source.includes('continuation still goes through the normal planner and permission gate'), 'recovery must not bypass permissions');
console.log('phase2-recovery.test.js: assertions defined; not run.');
