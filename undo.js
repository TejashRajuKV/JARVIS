'use strict';
/* "Undo that": a short stack of reversible actions. Each handler in the page pushes { label, undo() } after it has done
   something it knows how to reverse (a deleted to-do, a moved file, a volume change, a cleared chat…). "undo" (or the
   chip that appears for 30 seconds) runs the newest one. Entries expire after 30 minutes, at most 20 are kept.
   Not undoable (and never pushed): shutdown/restart/sleep, sent messages, git commits, coding-AI prompts.
   Entries made while a multi-step plan runs carry that run's id (setRun), so "undo that task" can reverse a whole
   plan, newest step first (undoRun). */
function createUndo({ now = () => Date.now(), ttl = 30 * 60e3, max = 40 } = {}) {
  const stack = [];
  const expired = {};   // run id → how many of its entries timed out (so a task undo can say so)
  let listener = null, curRun = null;
  const fresh = () => { const t = now(); while (stack.length && t - stack[0].t > ttl) { const e = stack.shift(); if (e.run) expired[e.run] = (expired[e.run] || 0) + 1; } };
  function push(label, fn) {
    if (typeof fn !== 'function') return;
    stack.push({ label: String(label || 'that'), fn, t: now(), run: curRun });
    while (stack.length > max) stack.shift();
    if (listener) listener('push', label);
  }
  // Runs the newest entry → null when there is nothing, else { label, msg } or { label, error }.
  async function undo() {
    fresh();
    const e = stack.pop();
    if (!e) return null;
    if (listener) listener('undo', e.label);
    try { return { label: e.label, msg: await e.fn() }; } catch (err) { return { label: e.label, error: (err && err.message) || 'it didn’t work' }; }
  }
  // Everything pushed until setRun(null) belongs to this plan run.
  const setRun = id => { curRun = id || null; };
  const countRun = id => stack.filter(e => e.run === id).length;
  // The newest run that still has entries (null when none).
  const lastRun = () => { fresh(); for (let i = stack.length - 1; i >= 0; i--) if (stack[i].run) return stack[i].run; return null; };
  // Reverse a whole run, newest step first. A step that can't be undone is reported and the rest carry on.
  // → null when the run has nothing to undo, else { id, done: [{label,msg}], failed: [{label,error}], expired }.
  async function undoRun(id) {
    fresh();
    const runId = id || lastRun();
    const mine = runId ? stack.filter(e => e.run === runId) : [];
    const gone = runId ? expired[runId] || 0 : 0;
    if (!mine.length && !gone) return null;
    const out = { id: runId, done: [], failed: [], expired: gone };
    for (const e of mine.reverse()) {
      stack.splice(stack.indexOf(e), 1);
      try { out.done.push({ label: e.label, msg: await e.fn() }); } catch (err) { out.failed.push({ label: e.label, error: (err && err.message) || 'it didn’t work' }); }
    }
    delete expired[runId];
    if (listener) listener('undo', 'the whole task');
    return out;
  }
  const size = () => { fresh(); return stack.length; };
  const peek = () => { fresh(); return stack.length ? stack[stack.length - 1].label : null; };
  const clear = () => { stack.length = 0; };
  return { push, undo, undoRun, setRun, countRun, lastRun, size, peek, clear, onChange: fn => { listener = fn; } };
}

const Undo = createUndo();
// A small "↶ Undo" chip for 30 seconds after a reversible action (page only).
if (typeof document !== 'undefined') {
  let chip = null, timer = null;
  const hide = () => { clearTimeout(timer); if (chip) chip.classList.remove('open'); };
  Undo.onChange((kind, label) => {
    if (kind !== 'push') { hide(); return; }
    if (!chip) {
      chip = document.createElement('button'); chip.id = 'undoChip'; chip.type = 'button';
      chip.onclick = () => { hide(); if (typeof runUndo === 'function') runUndo(); };
      document.body.appendChild(chip);
    }
    chip.textContent = '↶ Undo · ' + label; chip.title = 'Undo: ' + label;
    chip.classList.add('open'); clearTimeout(timer); timer = setTimeout(hide, 30000);
  });
}
if (typeof module !== 'undefined') module.exports = { createUndo, Undo };
