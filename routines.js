'use strict';
/* Routines: one phrase runs several commands ("study mode" → open VS Code, block distractions, focus).
   Steps go through the normal NLU → executeTool path. Uses globals from script.js at call time. */
const Routines = (() => {
  const DEFAULTS = [
    { id: 'r-study', name: 'study mode', steps: ['open vs code', 'block distractions', 'start a focus session'] },
    { id: 'r-morning', name: 'morning', steps: ['give me my briefing', 'upcoming contests', 'plan my day'] },
    { id: 'r-bedtime', name: 'bedtime', steps: ['mute', 'set brightness to 30', 'what are my reminders'] },
    { id: 'r-leaving', name: 'leaving', steps: ['mute', 'lock the screen'] },
  ];

  let list = store.get('jarvis.routines', null) || DEFAULTS.map(r => ({ ...r, steps: [...r.steps] }));
  let running = false;
  const save = () => { store.set('jarvis.routines', list); render(); };

  const clean = s => String(s || '').toLowerCase().replace(/\b(my|the|routine|protocol)\b/g, ' ').replace(/\s+/g, ' ').trim();
  function find(name) {
    const q = clean(name);
    if (!q) return null;
    return list.find(r => clean(r.name) === q) || list.find(r => clean(r.name).replace(/ mode$/, '') === q.replace(/ mode$/, ''))
      || list.find(r => NLU.lev(clean(r.name), q) <= 2) || null;
  }
  // "run study mode" / "start the bedtime routine" / "study mode" → routine, only when one exists by that name.
  function match(text) {
    const s = String(text || '').toLowerCase().trim();
    const m = s.match(/^(?:run|start|activate|begin|do|execute|launch|engage|initiate|enable|go into|switch to)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:routine|protocol))?$/);
    if (m) return find(m[1]);
    // A bare name only counts when it can't be ordinary speech: "study mode", "bedtime routine" — not just "leaving".
    const named = /\s(routine|protocol)$/.test(s);
    const r = find(s.replace(/\s+(?:routine|protocol)$/, ''));
    return r && (named || /\s/.test(r.name)) ? r : null;
  }

  function parseSteps(str) {
    return String(str || '').split(/\s*(?:,|;|\bthen\b|\band then\b|\n)\s*|\s+and\s+(?=(?:open|close|start|play|set|mute|unmute|lock|turn|switch|show|give|run|block|remind|dim|brighten|volume|search)\b)/i)
      .map(x => x.trim().replace(/^and\s+/i, '').replace(/[.]+$/, '')).filter(x => x.length > 1).slice(0, 12);
  }
  function create(name, steps) {
    name = String(name || '').trim().replace(/^["']|["']$/g, '').slice(0, 40);
    if (!name || !steps.length) return null;
    const old = find(name);
    if (old) { old.steps = steps; save(); return old; }
    const r = { id: 'r-' + rid(), name: name.toLowerCase(), steps };
    list.push(r); save();
    return r;
  }
  function remove(r) {
    const at = list.indexOf(r), rems = reminders.filter(x => x.routineId === r.id);
    if (typeof Undo !== 'undefined') Undo.push('deleted routine ' + r.name, () => { if (!list.includes(r)) list.splice(Math.min(at, list.length), 0, r); reminders.push(...rems.filter(x => !reminders.includes(x))); saveTasks(); save(); return 'Put back the ' + r.name + ' routine.'; });
    list = list.filter(x => x !== r); reminders = reminders.filter(x => x.routineId !== r.id); saveTasks(); save(); }

  // Steps run through the shared agent executor, unattended: anything not "safe" in the server's permission
  // list (power, deleting, committing, Wi-Fi off, closing apps, nested routines) is skipped with a note.
  async function run(r) {
    if (running) return { text: 'A routine is already running, ' + Persona.sir() + '.' };
    running = true;
    let res;
    try { res = await Agent.runUnattended(r.name, r.steps); } finally { running = false; }
    bumpStat('routinesRun');
    return Object.assign(res, { speak: cap(r.name) + ' complete, ' + Persona.sir() + '.', intent: 'ROUTINE_RUN', tool: 'routine' });
  }
  async function runById(id) {
    const r = list.find(x => x.id === id);
    if (!r || busy) return;
    busy = true;
    try { jarvisSay(await run(r)); } finally { busy = false; }
  }

  function render() {
    const el = $('#routineList'); if (!el) return;
    el.innerHTML = '';
    if (!list.length) { el.innerHTML = '<div class="tempty">No routines — try "create a routine called exam prep: open vs code, open leetcode, start a focus session".</div>'; return; }
    for (const r of list) {
      const sched = reminders.find(x => x.routineId === r.id && !x.fired);
      const d = document.createElement('div'); d.className = 'titem routine';
      d.innerHTML = '<span class="tx"><b></b><span class="sub"></span></span>' + (sched ? '<span class="due">↻ ' + escHtml(describeRepeat(sched.repeat, sched.at).replace(/^every /, '')) + '</span>' : '') + '<button class="sb run">RUN</button><button class="x" title="Delete">✕</button>';
      d.querySelector('b').textContent = r.name;
      d.querySelector('.sub').textContent = r.steps.join(' → ');
      d.querySelector('.run').addEventListener('click', () => handleUser('run ' + r.name, 'chip'));
      d.querySelector('.x').addEventListener('click', () => { if (confirm('Delete routine "' + r.name + '"?')) remove(r); });
      el.appendChild(d);
    }
  }

  return { list: () => list, find, match, parseSteps, create, remove, run, runById, render };
})();
Routines.render();
