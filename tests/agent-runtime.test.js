'use strict';
const assert = require('./lib/assertions')('agent-runtime');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const context = require('../agent-context');
const { readAccessible } = require('../screen-perception');
const { createQueue } = require('../agent-jobs');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled(queue, id) {
  for (let i = 0; i < 100; i++) {
    const job = queue.get(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await tick();
  }
  throw new Error('Task did not settle.');
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-runtime-'));
  try {
    const failed = { tool: 'read_file', args: { name: 'missing.md' }, status: 'failed', note: 'Missing file', label: 'Read missing.md' };
    const runs = [{ steps: [failed] }];
    assert.equal(context.priorFailure({ ...failed }, runs).note, 'Missing file');
    assert.equal(context.priorFailure({ ...failed, args: { name: 'other.md' } }, runs), undefined, 'another target must not inherit failure');
    assert.equal(context.failures([...runs, { steps: [{ ...failed, status: 'verified' }] }]).length, 0, 'verified success clears the old failure');
    assert.equal(context.signature({ tool: 'x', args: { a: 1, b: 2 } }), context.signature({ tool: 'x', args: { b: 2, a: 1 } }));
    assert.match(context.failureAdvice(runs), /Missing file/);
    const summary = context.compact(Array.from({ length: 100 }, (_, i) => ({ label: 'Step ' + i, status: 'verified', note: 'x'.repeat(500), args: { image: 'PRIVATE_IMAGE_DATA', approvalToken: 'SECRET' } })));
    assert.ok(summary.length <= 2400 && summary.includes('Step 99') && !summary.includes('PRIVATE_IMAGE_DATA') && !summary.includes('SECRET'));
    let imageNow = 0;
    const images = require('../transient-images').createCache({ now: () => imageNow });
    try {
      const a = images.put('capture-a'), b = images.put('capture-b'), c = images.put('capture-c');
      assert.equal(images.size(), 2, 'only two pending screenshots are retained');
      assert.equal(images.take(a), null, 'older screenshots are evicted');
      assert.equal(images.take(b), 'capture-b');
      assert.equal(images.take(b), null, 'screenshot tokens cannot replay');
      imageNow = 120001;
      assert.equal(images.take(c), null, 'expired screenshots are discarded');
      assert.equal(images.size(), 0);
    } finally { images.close(); }
    let reads = 0;
    const adapter = async () => { reads++; return { title: 'Editor', controls: [
      { name: 'Save', type: 'ControlType.Button' }, { name: 'Password', password: true }, { name: 'Hidden', offscreen: true }
    ] }; };
    const perceived = await readAccessible({ source: 'window', adapter });
    assert.equal(perceived.method, 'accessibility');
    assert.equal(perceived.text, 'Save');
    assert.equal(await readAccessible({ source: 'clipboard', adapter }), null);
    assert.equal(await readAccessible({ source: 'window', vision: true, adapter }), null);
    assert.equal(reads, 1, 'visual and clipboard requests must use the existing capture path');
    assert.equal(await readAccessible({ source: 'window', adapter: async () => { throw Error('UIA unavailable'); } }), null);
    assert.equal(await readAccessible({ source: 'window', adapter: async () => ({ controls: [{ type: 'ControlType.Window', name: 'Only a title' }] }) }), null);

    const registry = require('../agent-tools')({ APPS: [], safePath: x => x, llm: {}, DEFAULT_MODEL: 'fake' });
    const file = path.join(tmp, 'jobs.json');
    const ran = [], notifications = [];
    let release;
    const queue = createQueue({ file, registry, executors: {
      list_todos: async (_args, { signal }) => { ran.push('todos'); await new Promise(resolve => { release = resolve; }); return signal.aborted ? 'cancelled' : 'task list'; },
      list_deadlines: async () => { ran.push('deadlines'); return 'Friday'; },
      read_file: async () => { throw Error('Missing fixture'); }
    }, notify: async ev => notifications.push(ev) });
    assert.throws(() => queue.submit({ steps: [{ tool: 'desktop_click', args: { control: 'Save' } }] }), /interactive/);
    assert.throws(() => queue.submit({ steps: [{ tool: 'invented', args: {} }] }), /not a JARVIS tool/);
    const first = queue.submit({ goal: 'Read tasks', steps: [{ tool: 'list_todos', args: {} }, { tool: 'list_deadlines', args: {} }] });
    assert.equal(JSON.parse(fs.readFileSync(file))[0].status, 'queued', 'checkpoint exists before returning');
    await tick();
    assert.equal(queue.get(first.id).status, 'running', 'execution is independent of the request');
    const second = queue.submit({ steps: [{ tool: 'list_deadlines', args: {} }] });
    assert.equal(queue.cancel(second.id), true);
    release();
    const completed = await settled(queue, first.id);
    await tick();
    assert.equal(completed.status, 'completed');
    assert.equal(completed.steps[0].output, 'task list');
    assert.deepEqual(ran, ['todos', 'deadlines'], 'a cancelled queued task never executes');
    assert.equal(notifications.filter(e => e.id === first.id).length, 1);
    assert.equal(queue.get(second.id).status, 'cancelled');
    const failing = queue.submit({ steps: [{ tool: 'read_file', args: { name: 'missing.md' } }, { tool: 'list_deadlines', args: {} }] });
    const failure = await settled(queue, failing.id);
    assert.equal(failure.status, 'failed');
    assert.equal(failure.steps[0].status, 'failed');
    assert.equal(failure.steps[1].status, 'notrun', 'later steps stop after failure');
    const retry = queue.submit({ steps: [{ tool: 'read_file', args: { name: 'missing.md' } }] });
    assert.match((await settled(queue, retry.id)).note, /failed before/);
    const cancelRunning = queue.submit({ steps: [{ tool: 'list_todos', args: {} }, { tool: 'list_deadlines', args: {} }] });
    await tick(); queue.cancel(cancelRunning.id); release();
    assert.equal((await settled(queue, cancelRunning.id)).status, 'cancelled');
    const restartFile = path.join(tmp, 'restart.json');
    fs.writeFileSync(restartFile, JSON.stringify([{ ...first, status: 'running' }]));
    const restored = createQueue({ file: restartFile, registry, executors: {} });
    assert.equal(restored.get(first.id).status, 'interrupted', 'restart never replays an in-flight step');
    await tick();
    const restrictedFile = path.join(tmp, 'restricted.json');
    fs.writeFileSync(restrictedFile, JSON.stringify([{ ...first, status: 'queued' }]));
    const restricted = createQueue({ file: restrictedFile, registry, executors: {} });
    assert.equal((await settled(restricted, first.id)).status, 'failed', 'queued tasks are revalidated after restart');
    const backend = require('../agent-background-tools')({ getState: () => ({ 'jarvis.todos': ['fixture'] }), safePath: () => null });
    assert.deepEqual(await backend.list_todos(), ['fixture']);
    await assert.rejects(() => backend.read_file({ name: '../.config.json' }), /outside approved/);
    const documentFile = path.join(tmp, 'notes.md');
    fs.writeFileSync(documentFile, 'DBMS joins and normalization.');
    let providerInput;
    const reading = require('../agent-background-tools')({ getState: () => ({}), safePath: name => name === 'notes.md' ? documentFile : null,
      DEFAULT_MODEL: 'fixture-model', llm: { complete: async input => { providerInput = input; return 'Notes discuss joins.'; } } });
    assert.equal(await reading.read_file({ name: 'notes.md' }), 'DBMS joins and normalization.');
    assert.equal(await reading.summarise_file({ name: 'notes.md' }, { signal: new AbortController().signal, summary: 'Earlier step finished.' }), 'Notes discuss joins.');
    assert.ok(providerInput.model === 'fixture-model' && providerInput.messages[0].content.includes('Earlier step finished.') && providerInput.messages[0].content.includes('DBMS joins'));
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(() => reading.summarise_file({ name: 'notes.md' }, { signal: stopped.signal, summary: '' }), /Cancelled/);
    assert.report();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
