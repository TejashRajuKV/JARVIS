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
  // Two routines due at the same moment (or one due while another is still running) used to lose the second. Now it waits in line, once per routine, and runs when the first is done.
  const waitingIds = [];
  async function runById(id) {
    const r = list.find(x => x.id === id);
    if (!r) return;
    if (busy) { if (!waitingIds.includes(id)) { waitingIds.push(id); try { log('info', 'routine "' + r.name + '" waits for the one that is running'); } catch (e) { /* log is optional */ } } return; }
    busy = true;
    try { jarvisSay(await run(r)); } finally { busy = false; const nextId = waitingIds.shift(); if (nextId) setTimeout(() => runById(nextId), 0); }
  }

  /* ---- the routine builder: NEW / EDIT in the Tasks tab ----
     A name, one step per line (each shown the way JARVIS understands it, so a step it cannot do by itself is visible before you save), and an optional schedule
     ("every day at 9am", read like a spoken one). SAVE makes or changes the routine (and its schedule) with one undo. */
  function understood(step) {
    try {
      const q = NLU.classify(NLU.normalize(step, (typeof settings !== 'undefined' && settings.wakeWord) || 'jarvis'), {});
      return q.intent !== 'CONVERSATION' && q.confidence >= 0.85 ? { ok: true, intent: q.intent } : { ok: false };
    } catch (e) { return { ok: false }; }
  }
  function preview(stepsText) {
    const steps = parseSteps(String(stepsText || '').replace(/\r?\n/g, ', '));
    return { steps, rows: steps.map(st => ({ step: st, ...understood(st) })) };
  }
  // save from the builder → { ok, text } (pure enough to test: no DOM)
  function saveFromBuilder(old, nameRaw, stepsText, schedText) {
    const name = String(nameRaw || '').trim().replace(/^["']|["']$/g, '').slice(0, 40);
    const { steps } = preview(stepsText);
    if (!name) return { ok: false, text: 'Give the routine a name.' };
    if (!steps.length) return { ok: false, text: 'Add at least one step, one per line.' };
    const clash = list.find(x => clean(x.name) === clean(name));          // the same name (not a near one: "study mode 2" is fine)
    if (clash && clash !== old) return { ok: false, text: 'There is already a routine called “' + clash.name + '”.' };
    let repeat = null, at = null; const sched = String(schedText || '').trim();
    if (sched) {
      repeat = typeof NLU !== 'undefined' && NLU.parseRepeat ? NLU.parseRepeat(sched) : null;
      if (!repeat) return { ok: false, text: 'I could not read “' + sched + '” as a schedule. Try “every day at 9am” or “every Monday at 7pm”.' };
      at = typeof repeatStart === 'function' ? repeatStart(repeat, sched) : null;
      if (!at) return { ok: false, text: 'I could not work out when “' + sched + '” first happens.' };
    }
    const before = old ? { name: old.name, steps: [...old.steps] } : null, oldRems = reminders.filter(x => old && x.routineId === old.id);
    let r = old;
    if (old) { old.name = name.toLowerCase(); old.steps = steps; save(); } else r = create(name, steps);
    if (repeat) {
      reminders = reminders.filter(x => x.routineId !== r.id);
      reminders.push({ id: rid(), text: 'routine: ' + r.name, at, fired: false, repeat, routineId: r.id }); saveTasks();
    }
    if (typeof Undo !== 'undefined') Undo.push((old ? 'changed' : 'made') + ' the routine ' + r.name, () => {
      reminders = reminders.filter(x => x.routineId !== r.id);
      if (before) { r.name = before.name; r.steps = before.steps; reminders.push(...oldRems); save(); saveTasks(); return 'The routine ' + before.name + ' is back as it was.'; }
      list = list.filter(x => x !== r); save(); saveTasks(); return 'Removed the routine ' + r.name + '.';
    });
    render();
    const when = repeat && typeof describeRepeat === 'function' ? ' and scheduled ' + describeRepeat(repeat, at) : '';
    return { ok: true, routine: r, text: '✓ ' + (old ? 'Saved' : 'Made') + ' the routine **' + r.name + '** (' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + ')' + when + '. Say **“run ' + r.name + '”** to try it, or **“undo”**.' };
  }
  function openBuilder(old) {
    if (typeof Camera === 'undefined' || !Camera.openPanel) return;
    const panel = Camera.openPanel({ title: old ? 'EDIT ROUTINE' : 'NEW ROUTINE', hint: 'One step per line, the way you would say it — “open vs code”, “start a focus session for 25 minutes”. A step marked ? is not one JARVIS knows by itself; it is worked out when the routine runs.' });
    const wrap = document.createElement('div'); wrap.className = 'rt-builder'; wrap.style.cssText = 'display:grid;gap:8px;width:100%';
    const field = (label, el) => { const l = document.createElement('label'); l.style.cssText = 'display:grid;gap:4px;font-size:12px;color:var(--dim, #9ab)'; l.textContent = label; l.appendChild(el); wrap.appendChild(l); return el; };
    const css = 'background:rgba(0,0,0,.4);color:var(--ink);border:1px solid var(--line-hi);border-radius:8px;padding:8px;font-family:var(--code);font-size:13px';
    const nameEl = field('Name', Object.assign(document.createElement('input'), { value: old ? old.name : '', placeholder: 'exam prep', maxLength: 40 })); nameEl.style.cssText = css;
    const stepsEl = field('Steps (one per line)', Object.assign(document.createElement('textarea'), { value: old ? old.steps.join('\n') : '', rows: 6, spellcheck: false })); stepsEl.style.cssText = css;
    const sched = old && reminders.find(x => x.routineId === old.id && !x.fired);
    const schedEl = field('Schedule (optional)', Object.assign(document.createElement('input'), { value: '', placeholder: sched && typeof describeRepeat === 'function' ? 'now: ' + describeRepeat(sched.repeat, sched.at) + ' — type a new one to change it' : 'every day at 9am' })); schedEl.style.cssText = css;
    const out = document.createElement('div'); out.className = 'rt-preview'; out.setAttribute('aria-live', 'polite'); out.style.cssText = 'font-size:12px;line-height:1.6;white-space:pre-wrap'; wrap.appendChild(out);
    const show = () => { const p = preview(stepsEl.value); out.textContent = p.rows.length ? p.rows.map((x, i) => (i + 1) + '. ' + (x.ok ? '✓ ' : '? ') + x.step + (x.ok ? '  — ' + x.intent.toLowerCase().replace(/_/g, ' ') : '  — not a command I know by itself')).join('\n') : 'No steps yet.'; };
    stepsEl.addEventListener('input', show); show();
    panel.body(wrap); (old ? stepsEl : nameEl).focus();
    panel.buttons([
      { label: 'SAVE', primary: true, fn: () => { const r = saveFromBuilder(old, nameEl.value, stepsEl.value, schedEl.value); if (!r.ok) { panel.status(r.text); return; } panel.close(); if (typeof jarvisSay === 'function') jarvisSay({ text: r.text, intent: 'ROUTINE', noPersona: true, noTTS: true }); } },
      { label: 'CANCEL', danger: true, fn: () => panel.close() },
    ]);
  }

  function render() {
    const el = $('#routineList'); if (!el) return;
    el.innerHTML = '';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'cbtn rt-new'; add.textContent = '＋ NEW ROUTINE'; add.setAttribute('aria-label', 'Make a new routine');
    add.addEventListener('click', () => openBuilder(null)); el.appendChild(add);
    if (!list.length) { const e = document.createElement('div'); e.className = 'tempty'; e.textContent = 'No routines — press NEW ROUTINE, or say "create a routine called exam prep: open vs code, open leetcode, start a focus session".'; el.appendChild(e); return; }
    for (const r of list) {
      const sched = reminders.find(x => x.routineId === r.id && !x.fired);
      const d = document.createElement('div'); d.className = 'titem routine';
      d.innerHTML = '<span class="tx"><b></b><span class="sub"></span></span>' + (sched ? '<span class="due">↻ ' + escHtml(describeRepeat(sched.repeat, sched.at).replace(/^every /, '')) + '</span>' : '') + '<button class="sb run">RUN</button><button class="x" title="Delete">✕</button>';
      d.querySelector('b').textContent = r.name;
      d.querySelector('.sub').textContent = r.steps.join(' → ');
      d.querySelector('.run').addEventListener('click', () => handleUser('run ' + r.name, 'chip'));
      const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'cbtn rt-edit'; ed.textContent = 'EDIT'; ed.setAttribute('aria-label', 'Edit the routine ' + r.name);
      ed.addEventListener('click', () => openBuilder(r)); d.querySelector('.run').before(ed);
      d.querySelector('.x').addEventListener('click', () => { if (confirm('Delete routine "' + r.name + '"?')) remove(r); });
      el.appendChild(d);
    }
  }

  return { list: () => list, find, match, parseSteps, create, remove, run, runById, render, openBuilder, saveFromBuilder, preview, get waiting() { return waitingIds.slice(); } };
})();
Routines.render();
