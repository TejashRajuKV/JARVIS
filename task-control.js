'use strict';
function createControl({ stopped = false, initialEpoch = 0, save = () => {}, broadcast = () => {} } = {}) {
  let paused = !!stopped, epoch = Number.isSafeInteger(initialEpoch) && initialEpoch >= 0 ? initialEpoch : 0;
  const listeners = new Set(), pending = new Set();
  const status = () => ({ stopped: paused, epoch, note: paused
    ? 'New actions are blocked. Already completed or non-cancellable OS/provider operations may still have effects.'
    : 'Ready; previously cancelled tasks and approvals are not resumed.' });
  function stop() {
    paused = true; epoch++; save(true, epoch);
    for (const controller of pending) controller.abort();
    const results = [];
    for (const listener of listeners) {
      try { results.push(listener()); } catch { results.push({ error: 'A cancellation handler failed; inspect running operations.' }); }
    }
    const result = { ...status(), results }; broadcast({ type: 'emergency-stop', ...result }); return result;
  }
  function resume() {
    if (!paused) return status();
    paused = false; epoch++; save(false, epoch); const result = status(); broadcast({ type: 'emergency-stop', ...result }); return result;
  }
  function assertRunning(expectedEpoch = epoch) {
    if (paused || expectedEpoch !== epoch) throw new Error('Emergency stop invalidated this operation. Review it again after resuming.');
  }
  function operation() {
    assertRunning(); const started = epoch, controller = new AbortController(); pending.add(controller);
    return { signal: controller.signal, check: () => assertRunning(started), release: () => pending.delete(controller) };
  }
  return { status, stop, resume, assertRunning, operation,
    onStop(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
function register(app, control) {
  app.get('/api/safety/status', (_req, res) => res.set('Cache-Control', 'no-store').json(control.status()));
  app.post('/api/safety/stop', (_req, res) => res.json(control.stop()));
  app.post('/api/safety/resume', (_req, res) => res.json(control.resume()));
}
module.exports = { createControl, register };
