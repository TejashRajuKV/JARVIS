'use strict';
// Load the real checkpoint code with a disposable browser store and a controlled clock.
const assert = require('./lib/assertions')('phase2-recovery');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'agent.js'), 'utf8');
const now = Date.now(), key = 'jarvis.agentRuns';
const stale = { id:'AGT-TEST-001', checkpointVersion:1, running:true, updated:now - 181_000,
  steps:[{ label:'Save sample', status:'verified', args:{ content:'fixture private text' } }, { label:'Next step' }] };
const fresh = { id:'AGT-TEST-002', running:true, updated:now - 179_000, steps:[] };
const state = new Map([[key, [stale, fresh]]]);
let writes = 0;
const agent = vm.runInNewContext(source + '\nAgent', {
  store:{ get:(k, fallback) => structuredClone(state.get(k) ?? fallback),
    set:(k, value) => { writes++; state.set(k, structuredClone(value)); } },
  getJSON: async () => ({}), setTimeout:() => 0, setInterval:() => 0, clearInterval() {},
  performance, log() {}, bumpStat() {}, Persona: {sir:() => 'sir'}, plural: (n, word) => n + ' ' + word + 's'
});
assert.equal(agent.recoverySummary().ok, false, 'no interruption has been recorded yet');
const interrupted = agent.sweepInterrupted(now);
assert.equal(interrupted.length, 1);
assert.equal(interrupted[0].id, stale.id);
assert.equal(state.get(key)[1].running, true, 'a recently refreshed run is left alone');
assert.equal(writes, 1, 'only one checkpoint write');
const summary = agent.recoverySummary('agt-test-001');
assert.equal(summary.checkpoint.status, 'interrupted');
assert.equal(summary.checkpoint.checkpointVersion, 1);
assert.equal(summary.checkpoint.completedSteps, 1);
assert.equal(summary.checkpoint.pendingSteps, 1);
assert.equal(summary.checkpoint.steps[1].status, 'notrun');
assert.ok(!JSON.stringify(summary).includes('fixture private text'), 'the summary omits executable arguments');
assert.equal(agent.sweepInterrupted(now).length, 0, 'interruption reporting is idempotent');
assert.equal(writes, 1, 'sweeping again and reading the checkpoint do not write');
(async () => {
  await agent.execute({goal: 'Empty fixture plan', steps: []}, {unattended: true});
  const written = state.get(key).find(record => record.goal === 'Empty fixture plan');
  assert.equal(written?.checkpointVersion, 1, 'a checkpoint written by the executor carries a schema version');
  assert.equal(agent.active().length, 0, 'the dashboard active-runs accessor is empty after completion');
  assert.report();
})().catch(error => { console.error(error); process.exitCode = 1; });
