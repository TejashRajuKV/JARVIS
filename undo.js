'use strict';
/* "Undo that": a short stack of reversible actions. Each handler in the page pushes { label, undo() } after it has done
   something it knows how to reverse (a deleted to-do, a moved file, a volume change, a cleared chat…). "undo" (or the
   chip that appears for 30 seconds) runs the newest one. Entries expire after 30 minutes, at most 20 are kept.
   Not undoable (and never pushed): shutdown/restart/sleep, sent messages, git commits, coding-AI prompts. */
function createUndo({ now = () => Date.now(), ttl = 30 * 60e3, max = 20 } = {}) {
  const stack = [];
  let listener = null;
  const fresh = () => { const t = now(); while (stack.length && t - stack[0].t > ttl) stack.shift(); };
  function push(label, fn) {
    if (typeof fn !== 'function') return;
    stack.push({ label: String(label || 'that'), fn, t: now() });
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
  const size = () => { fresh(); return stack.length; };
  const peek = () => { fresh(); return stack.length ? stack[stack.length - 1].label : null; };
  const clear = () => { stack.length = 0; };
  return { push, undo, size, peek, clear, onChange: fn => { listener = fn; } };
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
