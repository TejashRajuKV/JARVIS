'use strict';
/* ============ utils ============ */
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
const rid = () => Math.random().toString(36).slice(2, 9);
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const escapeReg = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : /(?:s|sh|ch|x)$/.test(w) ? 'es' : 's');   // class → classes
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ts = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
// Recover the user's original capitalisation for a phrase pulled from normalized (lower-case) text.
function keepCase(p, phrase) {
  if (!phrase || !p.original) return phrase;
  const i = p.original.toLowerCase().indexOf(phrase.toLowerCase());
  return i >= 0 ? p.original.substr(i, phrase.length) : phrase;
}
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDay(d) {
  d = new Date(d); const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
// App data lives on the server (~/jarvis/.jarvis-state.json) so every browser and port sees the same JARVIS.
// /api/state.js runs before this script and provides a snapshot, so reads stay synchronous; writes update the
// snapshot and go to the server in small batches. Values are kept as JSON strings so get() returns a fresh
// copy, exactly like localStorage did. If the snapshot didn't load, this falls back to plain localStorage.
const TAB_ID = Math.random().toString(36).slice(2, 10);   // tells the server (and other tabs) which tab wrote a change
const store = (() => {
  const local = {
    get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    adopt() { return false; },
    pendingKeys: () => [],
    clear() {},
  };
  if (!window.JARVIS_STATE) return local;
  const cache = {}, pending = {};
  for (const [k, v] of Object.entries(window.JARVIS_STATE)) cache[k] = JSON.stringify(v);
  let timer = null;
  // What this tab last knew to be on the server for the lists that several tabs edit (their ids), so the server can tell "I deleted it" from "another tab added it"
  // when this tab saves a whole list (statemerge.js). Updated when the page loads, when another tab's change is taken, and when a save is acknowledged.
  const MERGE_KEYS = /^jarvis\.(todos|deadlines|classes|studyPlans|expenses|habits|memory|marks|attendance)$/;
  const idsOf = s => { try { const v = JSON.parse(s); if (Array.isArray(v)) return v.every(x => x && typeof x === 'object' && x.id !== undefined && x.id !== null) ? v.map(x => x.id) : null; return v && typeof v === 'object' ? Object.keys(v) : null; } catch (e) { return null; } };
  const synced = {}, sentSeq = {};
  for (const k of Object.keys(cache)) if (MERGE_KEYS.test(k)) { const ids = idsOf(cache[k]); if (ids) synced[k] = ids; }
  let onMerged = null;
  const flush = beacon => {
    clearTimeout(timer); timer = null;
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const sent = {}; keys.forEach(k => { sent[k] = pending[k]; });
    const base = {}; keys.forEach(k => { if (MERGE_KEYS.test(k) && pending[k] !== null && synced[k]) base[k] = synced[k]; });
    // From the moment this save leaves, what it carries counts as known to the server: a later save (sent before this one is answered) must not mistake this tab's
    // own items for another tab's additions, or treat what it deletes next as someone else's. If the save fails, the old knowledge is put back.
    const before = {}, seq = {};
    keys.forEach(k => { if (MERGE_KEYS.test(k) && pending[k] !== null) { const ids = idsOf(pending[k]); if (ids) { before[k] = synced[k]; synced[k] = ids; seq[k] = (sentSeq[k] = (sentSeq[k] || 0) + 1); } } });
    const body = '{"src":' + JSON.stringify(TAB_ID) + ',"set":{' + keys.map(k => JSON.stringify(k) + ':' + (pending[k] === null ? 'null' : pending[k])).join(',') + '},"base":' + JSON.stringify(base) + '}';
    keys.forEach(k => delete pending[k]);
    if (beacon && navigator.sendBeacon && body.length < 60000) navigator.sendBeacon('api/state', new Blob([body], { type: 'application/json' }));
    else fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(() => ({})); })
      .then(j => {
        // acknowledged: the server now holds what was sent — or, for a list another tab changed meanwhile, that list combined with the other tab's items, which this tab now takes
        for (const k of keys) {
          if (!MERGE_KEYS.test(k) || sent[k] === null) continue;
          const merged = j && j.merged && j.merged[k];
          // take the combined list only if nothing newer for this key was saved or changed since (answers can arrive out of order)
          if (merged !== undefined && !(k in pending) && seq[k] === sentSeq[k]) { cache[k] = JSON.stringify(merged); const ids = idsOf(cache[k]); if (ids) synced[k] = ids; if (onMerged) onMerged(k, merged); }
        }
      })
      .catch(e => { console.warn('could not save to server:', e.message); keys.forEach(k => { if (k in before && seq[k] === sentSeq[k]) synced[k] = before[k]; });  keys.forEach(k => { if (!(k in pending)) pending[k] = cache[k] === undefined ? null : cache[k]; }); timer = setTimeout(flush, 3000); });
  };
  const queue = () => { clearTimeout(timer); timer = setTimeout(flush, 250); };
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  // First browser with real history opened after the switch to server storage: its data becomes the shared copy.
  // Settings/UI-state keys don't count as "real data", so a fresh browser can't claim the slot by merely opening.
  // Once claimed, jarvis.migrated stays set (even through "Erase all"), so old copies can't resurrect later.
  // Other browsers' old localStorage is left untouched, just no longer used.
  const TRIVIAL = /^jarvis\.(settings|chipTab|cmdHistory|focusToday|focusCtx|focusState|agentCounter|migrated|serverAlerted)$/;
  if (!cache['jarvis.migrated'] && !Object.keys(cache).some(k => !TRIVIAL.test(k))) {
    const local = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!/^jarvis\.[\w.-]{1,40}$/.test(k)) continue;
      const v = localStorage.getItem(k);
      try { JSON.parse(v); local[k] = v; } catch (e) {}
    }
    if (Object.keys(local).some(k => !TRIVIAL.test(k))) {
      Object.assign(cache, local, { 'jarvis.migrated': 'true' });
      Object.assign(pending, local, { 'jarvis.migrated': 'true' });
      flush();
    }
  }
  return {
    get(k, f) { return cache[k] === undefined ? f : JSON.parse(cache[k]); },
    set(k, v) { const s = JSON.stringify(v); if (s === undefined) return; cache[k] = pending[k] = s; queue(); },
    // A change made in another tab (server push): take it without writing it back. Skipped while this tab has an unsent change of its own.
    adopt(k, v) { if (k in pending) return false; cache[k] = JSON.stringify(v); if (MERGE_KEYS.test(k)) { const ids = idsOf(cache[k]); if (ids) synced[k] = ids; } return true; },
    // script.js sets this: called with (key, value) when the server combined this tab's list with another tab's changes, so the in-memory list and the screen follow
    set onMerged(fn) { onMerged = fn; },
    pendingKeys: () => Object.keys(pending),          // what this tab has not sent yet (tests wait for it to be empty)
    clear(helloToken) {
      return fetch('api/state', { method: 'DELETE', headers: helloToken ? { 'X-Hello-Token': helloToken } : {} }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        for (const k of Object.keys(cache)) delete cache[k]; for (const k of Object.keys(pending)) delete pending[k]; clearTimeout(timer);
      });
    },
  };
})();

/* ============ data ============ */
const settings = Object.assign(
  { wakeWord: 'jarvis', tts: true, rate: 1, voice: '', sound: true, online: false, responseLen: 'balanced', llm: true, model: '', city: '', focusMin: 25, breakMin: 5, alerts: true, chargerAlerts: true, address: 'sir', neuralVoice: true, translateOnline: true, speechLang: 'en', replyLang: 'auto', persona: 'jarvis', theme: 'arc', phonePush: false, phoneTopic: '', qwenNlu: false, hudOverlay: false, bootCinema: true, attendancePrompt: true, offlineStt: false, attendanceMin: 75 },
  store.get('jarvis.settings', {})
);
Persona.setAddressSource(() => {
  const a = settings.address === 'name' ? (memGet('name') || 'sir') : settings.address;
  return settings.persona === 'friday' && a === 'sir' ? 'boss' : a;
});
const saveSettings = () => store.set('jarvis.settings', settings);
// The attendance percentage your college asks for (75 unless you changed it: "my college needs 80% attendance" or Settings).
const attMin = () => Math.min(95, Math.max(40, Math.round(+settings.attendanceMin) || 75));
let memory = store.get('jarvis.memory', []);        // [{id,key,value,ts}]
let todos = store.get('jarvis.todos', []);          // [{id,text,done,ts}]
let reminders = store.get('jarvis.reminders', []);  // [{id,text,at,fired}]
let deadlines = store.get('jarvis.deadlines', []);  // [{id,title,due,done}]
let classes = store.get('jarvis.classes', []);      // [{id,name,day,h,m}]
let attendance = store.get('jarvis.attendance', {}); // { Subject: {held, attended, log:[{d,s}]} }
let marks = store.get('jarvis.marks', []);          // [{id,title,gpa,credits,ts}]
let chatLog = store.get('jarvis.chat', []);         // [{role,text,meta,t}]
// An assignment's to-dos are linked to its deadline (deadlineId). The deadline shows "2/5 done", and when the last one is ticked JARVIS offers to mark the
// deadline submitted (asked once per deadline); marking the deadline submitted ticks any to-dos still open for it.
const linkedTodos = dd => todos.filter(t => t.deadlineId === dd.id);
function checkLinkedDeadlines() {
  for (const dd of deadlines) {
    if (dd.done || dd.allDoneAsked) continue;
    const ts = linkedTodos(dd);
    if (!ts.length || ts.some(t => !t.done)) continue;
    dd.allDoneAsked = true;
    if (typeof jarvisSay === 'function') jarvisSay({ text: '✓ All ' + ts.length + ' to-dos for **' + dd.title + '** are done. Mark the deadline as submitted?', intent: 'DEADLINE', noPersona: true, noTTS: true,
      actions: [{ label: 'MARK SUBMITTED', fn: () => { completeDeadline(dd); bumpStat('deadlinesDone'); saveTasks(); toast('Nice — "' + dd.title + '" marked done'); } }] });
  }
}
function finishLinkedTodos(dd) { for (const t of linkedTodos(dd)) if (!t.done) t.done = true; }
// Marking a deadline submitted: its open to-dos are ticked, and a weekly one adds next week's (the first due date after now, same weekday and time).
function completeDeadline(dd) {
  dd.done = true; finishLinkedTodos(dd);
  if (dd.repeat === 'weekly') {
    let next = dd.due + 7 * 864e5; while (next < Date.now()) next += 7 * 864e5;
    if (!deadlines.some(x => !x.done && x.title === dd.title && x.due === next)) deadlines.push({ id: rid(), title: dd.title, due: next, done: false, repeat: 'weekly' });
  }
}
const saveTasks = () => {
  try { checkLinkedDeadlines(); } catch (e) { /* only a nicety */ }
  store.set('jarvis.todos', todos); store.set('jarvis.reminders', reminders);
  store.set('jarvis.deadlines', deadlines); store.set('jarvis.classes', classes);
  store.set('jarvis.attendance', attendance); store.set('jarvis.marks', marks);
  renderTasks();
  if (typeof Routines !== 'undefined') Routines.render();
};
function memSet(key, value) {
  const ex = memory.find(m => m.key === key);
  if (ex) { ex.value = value; ex.ts = Date.now(); } else memory.push({ id: rid(), key, value, ts: Date.now() });
  store.set('jarvis.memory', memory); renderMemory(); pulse('mem');
}
function memAdd(key, value) { memory.push({ id: rid(), key, value, ts: Date.now() }); store.set('jarvis.memory', memory); renderMemory(); pulse('mem'); }
function memGet(key) { const m = memory.find(m => m.key === key); return m ? m.value : null; }
// Undo helpers: put removed list items back where they were (skipping any that are back already).
function undoRemoved(label, getList, setList, save, removed) {
  if (!removed.length) return;
  Undo.push(label, () => {
    const list = getList().slice();
    for (const [i, item] of removed.slice().sort((a, b) => a[0] - b[0])) if (!list.some(x => x === item || (x && item && x.id !== undefined && x.id === item.id))) list.splice(Math.min(i, list.length), 0, item);
    setList(list); save();
    return 'Put back ' + label.replace(/^(deleted|cleared|removed)\s+/i, '') + '.';
  });
}
const removedFrom = (list, keep) => list.map((x, i) => [i, x]).filter(([, x]) => !keep(x));
async function runUndo(say = true) {
  const r = await Undo.undo();
  const text = !r ? 'There’s nothing I can undo right now. (I can undo deletes, file moves and renames, a cleared chat, volume, brightness and dark mode for 30 minutes; shutdowns, sent messages and commits can’t be undone.)'
    : r.error ? 'I couldn’t undo **' + r.label + '**: ' + r.error + '.' : '↶ Undone: ' + (r.msg || r.label);
  if (say) jarvisSay({ text, intent: 'UNDO', tool: 'undo' });
  return text;
}
// "Undo that task": reverse every reversible action of one multi-step plan, newest first, and say plainly what was
// reversed, what couldn't be, and which steps have nothing to reverse (a started server, an opened editor).
async function runUndoTask(id, say = true) {
  // "That task" is the plan that ran last. Once it is undone (or expired) asking again does NOT reach back to an
  // older plan by surprise; name it ("undo AGT-…") to go further back.
  const target = id || (Agent.lastRuns(1)[0] || {}).id;
  const r = target ? await Undo.undoRun(target) : null;
  let text;
  if (!r) text = target
    ? 'There’s no whole plan I can undo right now: `' + target + '` has nothing left to reverse (already undone, more than 30 minutes ago, or it had no reversible steps). For an older plan, name it: “undo AGT-…”; plain “undo” takes back one single action.'
    : 'There’s no whole plan I can undo right now. I can reverse a multi-step plan for 30 minutes after it ran; plain “undo” takes back just the last single action.';
  else {
    const rec = (Agent.lastRuns(50) || []).find(x => x.id === r.id);
    const notTracked = rec ? rec.steps.filter(s => (s.status === 'verified' || s.status === 'unverified') && !s.undoable).map(s => s.label) : [];
    const lines = r.done.map(d => '- ↶ ' + (d.msg || d.label)).concat(r.failed.map(f => '- ✗ Couldn’t undo **' + f.label + '**: ' + f.error));
    text = '**Undid ' + plural(r.done.length, 'step') + '** of `' + r.id + '`' + (r.failed.length ? ' · ' + r.failed.length + ' couldn’t be undone' : '') + '\n' + lines.join('\n')
      + (r.expired ? '\n\n' + plural(r.expired, 'step') + ' happened more than 30 minutes ago, so I can’t undo ' + (r.expired === 1 ? 'it' : 'them') + '.' : '')
      + (notTracked.length ? '\n\nNothing to reverse for: ' + notTracked.join(', ') + '. (Opened editors, and servers that were already running, are left alone; close them yourself if you want.)' : '');
  }
  if (say) jarvisSay({ text, intent: 'UNDO', tool: 'undo', noPersona: true });
  return text;
}
function memDel(id) { undoRemoved('deleted memory', () => memory, v => { memory = v; }, () => { store.set('jarvis.memory', memory); renderMemory(); }, removedFrom(memory, m => m.id !== id)); memory = memory.filter(m => m.id !== id); store.set('jarvis.memory', memory); renderMemory(); }

// Conversation context for follow-ups ("close it", "what about RAM").
const ctx = { lastApp: null, lastIntent: null, lastFile: null, pending: null };
// What the conversation is about right now: the folder / file JARVIS last showed, found or made, and the numbered
// results of the last list or search — so "create a folder there", "open it" and "open the second one" mean something.
ctx.focus = { folder: null, file: null, created: null, results: [] };
const FOCUS_MS = 15 * 60 * 1000;
// The focus survives a reload (a page refresh in the middle of "open it" / "create a folder there" used to forget what "it" was): kept in the store,
// picked up again on load for whatever is still inside the 15 minutes.
let focusSaveT = null;
const saveFocusCtx = () => { clearTimeout(focusSaveT); focusSaveT = setTimeout(() => { try { store.set('jarvis.focusCtx', ctx.focus); } catch (e) { /* only a convenience */ } }, 300); };
(function restoreFocusCtx() {
  try {
    const f = store.get('jarvis.focusCtx', null), now = Date.now();
    if (!f || typeof f !== 'object') return;
    for (const k of Object.keys(f)) if (f[k] && typeof f[k] === 'object' && !Array.isArray(f[k]) && f[k].path && Number.isFinite(f[k].t) && now >= f[k].t && now - f[k].t < FOCUS_MS) ctx.focus[k] = f[k];
    // lastAction intentionally has no path, so the generic path-only restore above skipped it.
    // Restore a validated, recent action too; otherwise contextual follow-ups lose their topic after reload.
    const a = f.lastAction;
    if (a && typeof a === 'object' && typeof a.intent === 'string' && typeof a.summary === 'string'
      && Number.isFinite(a.t) && now >= a.t && now - a.t < FOCUS_MS) {
      ctx.focus.lastAction = { intent: a.intent.slice(0, 80), summary: a.summary.slice(0, 160), t: a.t };
    }
    if (Array.isArray(f.results) && Number.isFinite(f.resultsT) && now >= f.resultsT && now - f.resultsT < FOCUS_MS) { ctx.focus.results = f.results.slice(0, 30); ctx.focus.resultsT = f.resultsT; }
  } catch (e) { /* start fresh */ }
})();
const CONFIRM_MIN = 0.6;   // medium-confidence band for spoken commands: [CONFIRM_MIN, 0.85) → "did you mean …?"
// (a drive root keeps its slash: "D:\" — "D:" alone would mean the current folder on D)
function setFocus(kind, p) { if (p) { ctx.focus[kind] = { path: /^[a-z]:[\\/]*$/i.test(String(p)) ? String(p)[0].toUpperCase() + ':\\' : String(p).replace(/[\\/]+$/, '') || String(p), t: Date.now() }; saveFocusCtx(); } }
function focusOf(kind) { const f = ctx.focus[kind]; return f && Date.now() - f.t < FOCUS_MS ? f : null; }
function setResults(paths) { ctx.focus.results = (paths || []).filter(Boolean).slice(0, 30); ctx.focus.resultsT = Date.now(); saveFocusCtx(); }
const joinPath = (dir, name) => /[\\/]$/.test(dir) ? dir + name : dir + (/\\/.test(dir) || /^[a-z]:/i.test(dir) ? '\\' : '/') + name;
// The newest thing in focus ("open it"): a folder or file shown, found or created in the last 15 minutes.
function focusNewest() {
  // (made in the same moment as the folder it went into → the new one is "it")
  const c = ['created', 'file', 'folder'].map(k => focusOf(k) && Object.assign({ kind: k }, focusOf(k))).filter(Boolean);
  return c.sort((a, b) => (b.t + (b.kind === 'created' ? 1000 : 0)) - (a.t + (a.kind === 'created' ? 1000 : 0)))[0] || null;
}
// Where a request points. "in that directory" / "there" → the folder in focus ({ref:true, path}); "in D drive",
// "on my desktop", "in C:\x\y", "inside calculator", "in my laptop" → {scope} as said (the server reads it);
// rest = the request without the place.
const REF_RE = /\s*\b(?:in|inside|into|under|at|to|on|of)\s+(?:that|this|the same|the current|current|the above|the last|same|my current)\s+(?:directory|folder|dir|location|place|path|one|project)\b|\s+(?:in\s+|inside\s+)?(?:there|over there|in there)\s*$/i;
function scopeFrom(original, forCreate) {
  // creating: only "in/inside/into/on/under" name a place — "a folder called history of art" is a name
  const P = forCreate ? '(?:in|inside|into|under|on)' : '(?:in|inside|into|under|on|of|from|across)';
  const o = String(original || '').trim().replace(/[.?!]+$/, '');
  // "in it" = inside what was just created; "there" / "that folder" = where you were looking (or the new folder, if
  // that came after).
  const inIt = /\s+(?:in|inside|into)\s+it\s*$/i;
  if (inIt.test(o)) { const f = focusOf('created') || focusOf('folder'); return { ref: true, path: f ? f.path : '', rest: o.replace(inIt, '').trim() }; }
  if (REF_RE.test(o)) {
    // "…in the same project" → the project in focus first
    if (/\bproject\b/i.test((o.match(REF_RE) || [''])[0]) && focusOf('project')) return { ref: true, path: focusOf('project').path, rest: o.replace(REF_RE, '').trim() };
    const fo = focusOf('folder'), cr = focusOf('created');
    const f = fo && (!cr || fo.t >= cr.t - 1000) ? fo : (cr || fo);   // same moment → "there" is the folder it went into
    return { ref: true, path: f ? f.path : '', rest: o.replace(REF_RE, '').trim() };
  }
  // The LAST "in/on …" is the place: "list number OF folders IN my laptop" → "my laptop".
  const abs = o.match(/^(.*)\s+(?:in|inside|into|under|at|to|on|of|from)\s+["']?([a-z]:(?:[\\/][^"']*)?)["']?\s*$/i);
  if (abs) return { scope: abs[2], rest: abs[1].trim() };
  const m = o.match(new RegExp('^(.*)\\s+' + P + '\\s+(?:(?:the|my|this|whole|entire|all)\\s+)*([\\w\\- ]+?)(?:\\s+(?:folder|directory))?\\s*$', 'i'));
  if (m && !/^(?:it|that|this|total|all|folders?|files?|directories)$/i.test(m[2])) return { scope: m[2].trim(), rest: m[1].trim() };
  return { rest: o };
}
// "open it" / "open the second one" / "open number 2" → { path } of the thing meant, { text } to explain, or null
// (not about the focus — the normal pipeline handles it).
const ORDINAL = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6, last: -1 };
function openFocusTarget(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:please|can you|could you|jarvis,?)\s+/, '').replace(/\s+(?:please|now|for me)$/, '');
  let idx = null, m = t.match(/^(?:open|show|launch)(?: up)?\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|last)(?:\s+(?:one|result|folder|file|match|item))?$/);
  if (m) idx = ORDINAL[m[1]];
  else if ((m = t.match(/^(?:open|show)\s+(?:number|no\.?|#|item|result)\s*(\d{1,2})$/))) idx = +m[1];
  if (idx !== null) {
    const R = ctx.focus.results || [];
    if (!R.length || Date.now() - (ctx.focus.resultsT || 0) > FOCUS_MS) return null;
    const p = idx === -1 ? R[R.length - 1] : R[idx - 1];
    return p ? { path: p } : { text: 'There ' + (R.length === 1 ? 'is only 1 item' : 'are only ' + R.length + ' items') + ' in that list, ' + Persona.sir() + '.' };
  }
  if (/^(?:open|show)(?: up)?\s+(?:it|that|this|it up|that folder|this folder|the folder|that file|the file|the new folder|the one you (?:just )?(?:made|created))$/.test(t)) {
    const f = focusNewest();
    if (!f || (ctx.lastAppT && ctx.lastAppT > f.t)) return null;   // "open it" right after an app is about the app
    return { path: f.path };
  }
  return null;
}
async function openFocusPath(p) {
  toolStep('open → ' + p);
  const r = await callTool('/tool/openFolder', { name: p });
  if (!r.error) { setFocus('folder', r.path || p); return { text: 'Opening `' + (r.path || p) + '` in your file explorer.', speak: 'Opening it.', tool: 'openFolder' }; }
  const f = await callTool('/tool/openFile', { name: p });
  if (!f.error) { setFocus('file', f.path || p); return { text: 'Opening **' + (f.path || p) + '**.', speak: 'Opening it.', tool: 'openFile' }; }
  const e = await callTool('/tool/openInEditor', { name: p });
  if (!e.error) return { text: 'Opening **' + p + '** in VS Code.', speak: 'Opening it in VS Code.', tool: 'openInEditor' };
  return { text: 'I couldn’t open `' + p + '`: ' + (f.error || r.error) + '.' };
}
/* Intent inspector: how JARVIS understood this turn — what was heard, the intent and its confidence, the details it
   pulled out, the context it used, the route, the permission tier and timings. Shown under each reply when
   Settings → "Show how I understood you" is on; "how did you understand that?" shows the last one any time. */
let turnTrace = null, lastTrace = null;
function noteTrace(k, v) { if (turnTrace && v !== undefined && v !== null && v !== '') turnTrace.notes.push([k, String(v)]); }
function traceRoute(r) { if (turnTrace && !turnTrace.route) turnTrace.route = r; }
function traceRows(t) {
  if (!t) return [];
  const rows = [['You ' + (t.source === 'voice' || t.source === 'wake' ? 'said' : 'typed'), t.said]];
  if (t.heard) rows.push(['Mic heard', t.heard + '  → repaired']);
  if (t.normalized && t.normalized !== String(t.said || '').toLowerCase()) rows.push(['Read as', t.normalized]);
  if (t.intent) rows.push(['Intent', t.intent + (t.confidence !== undefined ? '  ·  confidence ' + Number(t.confidence).toFixed(2) : '') + (t.corrected ? '  ·  typo-corrected to “' + t.corrected + '”' : '')]);
  const args = t.args && Object.entries(t.args).filter(([, v]) => v !== undefined && v !== '' && typeof v !== 'object');
  if (args && args.length) rows.push(['Details', args.map(([k, v]) => k + ' = ' + v).join(', ')]);
  (t.notes || []).forEach(([k, v]) => rows.push([k.charAt(0).toUpperCase() + k.slice(1), v]));
  if (t.context) rows.push(['Context', t.context]);
  if (t.decision && typeof Decider !== 'undefined') {
    rows.push(['Decision', (Decider.LABEL[t.decision.route] || t.decision.route) + (t.decision.confidence ? '  ·  confidence ' + t.decision.confidence.toFixed(2) : '') + (t.decision.override ? '  ·  took over from the rule match' : '') + (t.decision.needsReview ? '  ·  signals disagree' : '') + ' — ' + t.decision.reason]);
    const sg = t.signals; if (sg) rows.push(['Signals', ['fresh', 'source', 'local', 'reasoning', 'question'].map(k => k + ' ' + (sg[k] ? '✓' : '✗')).join(' · ')]);
  }
  rows.push(['Route', t.route || '—']);
  if (t.tier) rows.push(['Permission', t.tier[0] + (t.tier[1] ? ' — ' + t.tier[1] : '')]);
  if (t.ms) rows.push(['Time', t.ms + ' ms']);
  return rows;
}
function traceBlock(t) {
  const d = document.createElement('details'); d.className = 'trace';
  d.innerHTML = '<summary>🔍 How I understood this</summary><dl>' + traceRows(t).map(([k, v]) => '<dt>' + escHtml(k) + '</dt><dd>' + escHtml(v) + '</dd>').join('') + '</dl>';
  return d;
}
// "in the same project calculator" / "in my calculator project" / "continue in project X" / "in this project" → the
// project's folder: the one in focus if it's that name, else found on the laptop (exact name), else "did you mean…?".
// → null (no project mentioned) · { path, how } · { ask: reply } · { missing: name }
const PROJ_RE = /\b(?:in|inside|into|for|within|continue(?:\s+(?:in|with))?|continuing(?:\s+(?:in|with))?)\s+(?:the\s+|my\s+|this\s+|that\s+|our\s+)?(?:same\s+|current\s+|existing\s+)?(?:project\s+(?:called\s+|named\s+)?["']?([\w\-.]+)|([\w\-.]+)\s+project\b)|\b(?:the\s+)?(?:same|this|current|that|existing)\s+project\b/i;
async function resolveProject(original) {
  const m = String(original || '').match(PROJ_RE);
  if (!m) return null;
  let name = (m[1] || m[2] || '').trim();
  if (/^(?:same|current|this|that|the|my|existing|new|a|python|java|web|node|react|code)$/i.test(name)) name = '';
  const sq = x => String(x || '').toLowerCase().replace(/[\s_-]+/g, '');
  const baseOf = x => String(x || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const inFocus = [focusOf('project'), focusOf('folder'), focusOf('created')].filter(Boolean);
  if (!name) return inFocus.length ? { path: inFocus[0].path, how: 'the project we’re working in' } : { missing: 'that project' };
  for (const f of inFocus) if (sq(baseOf(f.path)) === sq(name)) return { path: f.path, how: 'the ' + name + ' project we’re working in' };
  toolStep('find project → ' + name);
  const r = await callTool('/tool/findFolderAnywhere', { name });
  const exact = ((r && r.paths) || []).find(x => sq(baseOf(x)) === sq(name));
  if (exact) return { path: exact, how: 'your ' + name + ' project' };
  const sims = await similarTo(name, 'folder');
  if (sims.length) return { ask: didYouMeanReply(name, sims, 'I can’t find a project called exactly **' + name + '**.', 'show') };
  return { missing: name };
}
// "Did you mean…?": names on the laptop close to one that wasn't found (typo, short form, extra words), best first.
async function similarTo(name, kind) {
  const r = await callTool('/tool/similar', { name: String(name || '').slice(0, 80), kind }).catch(() => null);
  return (r && r.suggestions) || [];
}
// lead: what wasn't found; then: what to do with the one you pick ('show' | 'open' | 'list' | 'count').
function didYouMeanReply(name, sims, lead, then) {
  setResults(sims.map(x => x.path));
  ctx.pending = { intent: 'DID_YOU_MEAN', paths: sims.map(x => x.path), dirs: sims.map(x => !!x.dir), then: then || 'show' };
  return { text: lead + '\n\n**Did you mean ' + (sims.length === 1 ? 'this' : 'one of these') + ', ' + Persona.sir() + '?**\n'
      + sims.map((x, i) => (i + 1) + '. ' + (x.dir ? '📁 ' : '📄 ') + '**' + x.name + '** — `' + x.path + '`').join('\n')
      + '\n\n_Say **yes** for the first one, a number like **2**, or **no**._',
    noPersona: true, speak: 'I couldn’t find ' + name + '. Did you mean ' + sims[0].name + '?', suggestions: sims.length > 1 ? ['Yes', '2', 'No'] : ['Yes', 'No'] };
}
// A short line for the AI (chat + planner) so it knows what "that folder" / "it" refer to.
function focusSummary() {
  const parts = [];
  if (focusOf('folder')) parts.push('folder being looked at: ' + focusOf('folder').path);
  if (focusOf('created')) parts.push('just created: ' + focusOf('created').path);
  if (focusOf('file')) parts.push('last file: ' + focusOf('file').path);
  if (focusOf('project')) parts.push('current project: ' + focusOf('project').path);
  else if (ctx.lastProject) parts.push('last project: ' + ctx.lastProject);
  if (ctx.focus.lastAction && Date.now() - ctx.focus.lastAction.t < FOCUS_MS) parts.push('last thing done: ' + ctx.focus.lastAction.intent.toLowerCase().replace(/_/g, ' ') + ' — ' + ctx.focus.lastAction.summary.replace(/[*`_]/g, '').slice(0, 100));
  return parts.join('; ');
}

/* ============ dom refs ============ */
const stateChip = $('#stateChip'), stateMsg = $('#stateMsg'), liveTranscript = $('#liveTranscript');
const micBtn = $('#micBtn'), wakeBtn = $('#wakeBtn'), chatInput = $('#chatInput'), sendBtn = $('#sendBtn');
const messages = $('#messages'), logBox = $('#logStream'), memoryList = $('#memoryList'), timerChips = $('#timerChips');
const bgCanvas = $('#bgCanvas'), waveCanvas = $('#waveCanvas');
const API = location.protocol.startsWith('http') ? '/api' : 'http://localhost:3000/api';
// face-greet.js, nlu-qwen.js and the port-watch switch build their addresses from window.API — a plain `const` is not
// a window property, so without this they all called "/facegreet/…", "/nlu/parse", "/portwatch/…" (404).
window.API = API;

/* ============ log / toast / sfx ============ */
let logN = 0;
function log(type, msg) {
  const el = document.createElement('div'); el.className = 'll ' + type;
  el.innerHTML = '<span class="lt">' + ts() + '</span><span class="lm">' + escHtml(msg) + '</span>';
  logBox.appendChild(el);
  while (logBox.children.length > 150) logBox.removeChild(logBox.firstChild);
  logBox.scrollTop = logBox.scrollHeight;
  $('#logCount').textContent = (++logN) + ' events';
}
function toast(msg, alert) {
  const t = document.createElement('div'); t.className = 'toast' + (alert ? ' alert' : ''); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.4s'; setTimeout(() => t.remove(), 400); }, alert ? 6000 : 2800);
}
let AC = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
function blip(freq, dur, type, gain) {
  if (!settings.sound) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || .045, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  wake() { blip(740, .07); setTimeout(() => blip(1180, .09), 75); },
  ok() { blip(1040, .06, 'sine', .035); },
  err() { blip(170, .22, 'sawtooth', .05); },
  key() { blip(1500, .03, 'square', .018); },
  alarm() { [0, 220, 440].forEach(d => setTimeout(() => blip(880, .16, 'triangle', .07), d)); },
  // Arc-reactor style power-up: a rising sweep over a low hum.
  boot() {
    if (!settings.sound) return;
    try {
      const c = ac(), t = c.currentTime;
      const sweep = c.createOscillator(), g1 = c.createGain();
      sweep.type = 'sawtooth'; sweep.frequency.setValueAtTime(90, t); sweep.frequency.exponentialRampToValueAtTime(1400, t + .9);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(4000, t + .9);
      g1.gain.setValueAtTime(.0001, t); g1.gain.exponentialRampToValueAtTime(.05, t + .25); g1.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
      sweep.connect(lp); lp.connect(g1); g1.connect(c.destination); sweep.start(t); sweep.stop(t + 1.15);
      const hum = c.createOscillator(), g2 = c.createGain();
      hum.type = 'sine'; hum.frequency.value = 55;
      g2.gain.setValueAtTime(.0001, t); g2.gain.exponentialRampToValueAtTime(.06, t + .4); g2.gain.exponentialRampToValueAtTime(.0001, t + 1.8);
      hum.connect(g2); g2.connect(c.destination); hum.start(t); hum.stop(t + 1.85);
      setTimeout(() => blip(1320, .12, 'sine', .04), 950);
    } catch (e) {}
  }
};

/* ============ state ============ */
let state = 'BOOT';
const stateMeta = {
  IDLE: ['◈ READY', 'Ask me anything, or give me a command'],
  LISTENING: ['◉ LISTENING', 'Speak — I am listening'],
  PROCESSING: ['◐ THINKING', 'Understanding your request…'],
  EXECUTING: ['▲ EXECUTING', 'Running tool…'],
  SPEAKING: ['◍ RESPONDING', 'Responding…'],
  ERROR: ['✕ ERROR', 'Something went wrong'],
  BOOT: ['◈ BOOTING', 'Running system checks…']
};
function setState(s, msg) {
  state = s; const m = stateMeta[s] || stateMeta.IDLE;
  document.body.dataset.state = { IDLE: 'idle', LISTENING: 'listen', PROCESSING: 'proc', EXECUTING: 'exec', SPEAKING: 'speak', ERROR: 'err', BOOT: 'boot' }[s];
  stateChip.textContent = m[0];
  stateMsg.textContent = msg !== undefined ? msg : m[1];
  stateMsg.removeAttribute('lang');
}
function idleState() { setState(wakeOn ? 'LISTENING' : 'IDLE', wakeOn ? 'Say "' + settings.wakeWord + '" to wake me' : undefined); }

/* ============ engines / status ============ */
function setEngine(key, status, sub) {
  const el = $('#eng-' + key); if (!el) return;
  el.classList.remove('boot', 'on', 'down'); el.classList.add(status);
  if (sub !== undefined) el.querySelector('.ei i').textContent = sub;
}
function engine(key, on) { const el = $('#eng-' + key); if (el) el.classList.toggle('active', !!on); }
function pulse(key) { engine(key, true); setTimeout(() => engine(key, false), 900); }
function setPill(id, status, title) { const el = $('#' + id); el.className = 'pill ' + status; if (title) el.title = title; }
function setLastTool(t) { $('#lastTool').textContent = t + '()'; }
// Panic-mode pill: visible while jarvis.panic is set; click or "resume" ends it. Other tabs see it too (shared state).
function renderPanic() {
  const pill = $('#panicPill');
  if (pill) { pill.hidden = !store.get('jarvis.panic', false); pill.onclick = () => handleUser('resume', 'chip'); }
}
renderPanic();

const backend = { online: false, sandbox: '~/jarvis' };
const llm = { online: false, ollamaOnline: false, models: [], groups: [], errors: {}, model: '', warm: false, warming: false };
// Cloud models are "<provider>::<model>" (llm.js); plain names are local Ollama models.
const isCloudModel = m => String(m || '').includes('::');
const modelInfo = m => llm.groups.find(g => g.id === m) || { id: m, label: m, providerLabel: isCloudModel(m) ? m.split('::')[0] : 'Local (Ollama)' };
const llmReady = () => settings.llm && llm.online && !!llm.model;

// A server that was online and misses one check is asked again with more time before the page calls it offline:
// on a laptop busy running the local AI, one slow answer is not an outage (and the offline screen interrupts you).
async function checkBackend(patient = backend.online) {
  try {
    let r;
    try { r = await fetch(API + '/health', { signal: AbortSignal.timeout(2500) }); }
    catch (e) { if (!patient) throw e; await new Promise(res => setTimeout(res, 1000)); r = await fetch(API + '/health', { signal: AbortSignal.timeout(8000) }); }
    const d = await r.json();
    // A different pid means the server really restarted (the page reloads for that); the same pid was just slow.
    backend.restarted = !!(backend.pid && d.pid && d.pid !== backend.pid);
    if (d.pid) backend.pid = d.pid;
    backend.online = true; backend.sandbox = d.sandbox || backend.sandbox;
    setEngine('core', 'on', 'node · express · ' + d.platform);
    setPill('pillCore', 'ok', 'Backend online');
    $('#sandboxPath').textContent = 'SANDBOX ' + backend.sandbox;
    $('#sandboxNote').textContent = backend.sandbox;
  } catch (e) {
    backend.online = false;
    setEngine('core', 'down', 'offline — press START JARVIS');
    setPill('pillCore', 'bad', 'Backend offline — press START JARVIS above (or the desktop icon)');
    offlineUI();
  }
  if (backend.online) onlineUI();
  return backend.online;
}

/* Offline watchdog: when the server is down, the page offers a START button instead of a terminal
   lesson. The button opens jarvis://start (a link the launcher registers), Windows runs the silent
   launcher, and the page polls until the server answers — then reloads itself, fully back. */
let offlineTimer = null, offlineReloading = false;
function offlineUI() {
  let box = $('#offlineBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'offlineBox';
    box.innerHTML = '<div class="ob-card"><svg class="ob-mark" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="var(--cyan)" stroke-width="1.6" stroke-dasharray="6 4"/><circle cx="20" cy="20" r="6" fill="var(--cyan)"/></svg>' +
      '<h2>I AM NOT RUNNING YET</h2><p class="ob-sub">The JARVIS server on this laptop is offline.</p>' +
      '<button id="obStart" class="btn primary" type="button">▶ START JARVIS</button><div class="ob-status" id="obStatus"></div></div>';
    document.body.appendChild(box);
    $('#obStart').addEventListener('click', startJarvisFromPage);
  }
  box.classList.add('open');
  if (!offlineTimer) offlineTimer = setInterval(async () => {
    const seen = !!backend.pid;   // the page has talked to this server before (it didn't open while it was down)
    if (await checkBackend(false)) {
      clearInterval(offlineTimer); offlineTimer = null;
      // Same server as before (it was only slow or briefly unreachable): carry on without losing what's on screen.
      if (seen && !backend.restarted) { onlineUI(); toast('JARVIS is back'); return; }
      if (!offlineReloading) { offlineReloading = true; toast('JARVIS is back — reconnecting'); setTimeout(() => location.reload(), 600); }
    }
  }, 3000);
}
function onlineUI() { const box = $('#offlineBox'); if (box) box.classList.remove('open'); }
function startJarvisFromPage() {
  const st = $('#obStatus'), btn = $('#obStart');
  btn.disabled = true; btn.textContent = 'STARTING…';
  st.textContent = 'Asking Windows to start JARVIS…';
  try { location.href = 'jarvis://start'; } catch {}
  setTimeout(() => {
    if (backend.online) return;
    btn.disabled = false; btn.textContent = '▶ TRY AGAIN';
    st.textContent = 'Still offline. If Windows showed a prompt just now, choose “Open”. Otherwise double-click the JARVIS icon on your desktop — I will connect by myself the moment it runs.';
  }, 6000);
}
async function checkLLM() {
  if (!backend.online) { llm.online = false; updateLLMUI(); return false; }
  try {
    const d = await (await fetch(API + '/llm/status', { signal: AbortSignal.timeout(4000) })).json();
    llm.online = d.online; llm.ollamaOnline = !!d.ollamaOnline; llm.models = d.models || []; llm.groups = d.groups || []; llm.errors = d.errors || {};
    llm.model = llm.models.includes(settings.model) ? settings.model : (d.defaultModel || '');
  } catch (e) { llm.online = false; }
  updateLLMUI();
  return llm.online;
}
function updateLLMUI() {
  const sel = $('#modelSelect');
  if (!llm.models.length) sel.innerHTML = '<option value="">(no models found)</option>';
  else {
    const byProv = new Map();
    for (const g of (llm.groups.length ? llm.groups : llm.models.map(m => ({ id: m, label: m, providerLabel: 'Local (Ollama)' })))) {
      if (!byProv.has(g.providerLabel)) byProv.set(g.providerLabel, []);
      byProv.get(g.providerLabel).push(g);
    }
    sel.innerHTML = [...byProv].map(([label, list]) => '<optgroup label="' + escHtml(label) + '">' +
      list.map(g => '<option value="' + escHtml(g.id) + '"' + (g.id === llm.model ? ' selected' : '') + '>' + escHtml(g.label) + '</option>').join('') + '</optgroup>').join('');
  }
  const note = $('#llmNote');
  const cloud = isCloudModel(llm.model), info = modelInfo(llm.model);
  if (!settings.llm) {
    setEngine('llm', 'boot', 'disabled in settings — rules only'); setPill('pillLLM', 'off', 'AI brain disabled');
    note.textContent = 'AI brain is off. JARVIS uses its fast rule engine only.';
  } else if (llm.online && llm.model && cloud) {
    setEngine('llm', 'on', info.providerLabel.toLowerCase() + ' · ' + info.label);
    setPill('pillLLM', 'ok', 'Cloud AI: ' + info.providerLabel + ' · ' + info.label);
    note.innerHTML = '☁ Cloud model selected — your messages, and any screenshots, clipboard text or files you ask about, are sent to <b>' + escHtml(info.providerLabel) + '</b>. Pick a Local (Ollama) model to keep everything on this laptop.';
  } else if (llm.online && llm.model) {
    setEngine('llm', 'on', 'ollama · ' + llm.model + (llm.warming ? ' · loading…' : ''));
    setPill('pillLLM', 'ok', 'Local AI: ' + llm.model);
    note.innerHTML = 'Connected to Ollama. Free-form questions go to <em>' + escHtml(llm.model) + '</em>; clear commands run instantly via rules.';
  } else if (llm.online) {
    setEngine('llm', 'down', 'no model — ollama pull qwen3.5:4b'); setPill('pillLLM', 'bad', 'Ollama has no models');
    note.innerHTML = 'Ollama is running but has no models. Run <em>ollama pull qwen3.5:4b</em>.';
  } else {
    setEngine('llm', 'down', 'ollama offline — rules only'); setPill('pillLLM', 'bad', 'Ollama not reachable');
    note.innerHTML = 'Ollama is not reachable. Start it (open the Ollama app) — until then JARVIS uses rules only.';
  }
  $('#brainLabel').textContent = llmReady() ? 'rules + ' + (cloud ? info.label : llm.model) : 'rule engine only';
}
async function warmLLM() {
  if (!llmReady() || llm.warm || llm.warming) return;
  if (isCloudModel(llm.model)) { llm.warm = true; return; } // nothing to load for a cloud model
  llm.warming = true; updateLLMUI(); log('ai', 'loading ' + llm.model + ' into memory…');
  const t0 = performance.now();
  try {
    const d = await (await fetch(API + '/llm/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: llm.model }) })).json();
    llm.warm = !!d.success;
    log(d.success ? 'ai' : 'warn', d.success ? 'AI brain ready (' + ((performance.now() - t0) / 1000).toFixed(1) + 's)' : 'AI warm-up failed: ' + (d.error || 'unknown'));
  } catch (e) { log('warn', 'AI warm-up failed'); }
  llm.warming = false; updateLLMUI();
}
function updateNetUI() {
  setPill('pillNet', settings.online ? 'ok' : 'off', settings.online ? 'Online tools enabled' : 'Online tools off — enable in settings');
}

/* ============ API ============ */
// Changes outside ~/jarvis need your permission (the server answers needsApproval). While a phone command or an
// unattended routine/trigger is running there is nobody to ask, so the change is refused instead.
let approvalsBlocked = 0;
// An approval card waiting for ALLOW/CANCEL. Typed "yes"/"no" answers it too (see handleUser) —
// otherwise a "yes" becomes a brand-new chat turn and the approved action never runs.
var pendingApproval = null;
const APPROVAL_VERB = { create: 'create', 'create the folder': 'create the folder', overwrite: 'overwrite', 'add to': 'add to', delete: 'move to the trash', rename: 'rename', 'copy into': 'copy into', move: 'move', restore: 'restore', 'restore the earlier version of': 'restore the earlier version of', 'move back': 'move back', remove: 'remove' };
const APPROVAL_YES = /^(y|yes|yeah|yep|yup|ya|sure|ok(?:ay)?|allow|approve[d]?|go ahead|do it|proceed)(?:\s+(?:please|jarvis|sir|boss|thanks?))?$/i;
const APPROVAL_NO = /^(n|no|nope|nah|deny|denied|cancel|never ?mind|forget it|stop)(?:\s+(?:please|jarvis|sir|boss|thanks?))?$/i;
// A card that a running turn is WAITING on (ALLOW/CANCEL, YES/NO). While one is open JARVIS is in an explicit "awaiting an answer" state: typed yes/no answers it, anything else
// waits in the input queue (handleUser) instead of starting a second turn in the middle of the first, and an answer that never comes counts as "no" after 10 minutes.
// `show(answer)` puts the card on screen; its buttons call answer(true / false). Resolves to true or false.
function awaitAnswer(show, ms = 600000) {
  return new Promise(resolve => {
    let timer = null;
    const fin = ok => {
      clearTimeout(timer); if (pendingApproval === fin) pendingApproval = null; resolve(!!ok);
      // input that waited behind the card: the paused turn drains it when it ends; if no turn is running (the card came from a button, not a turn), start it now
      setTimeout(() => { if (!busy && !pendingApproval && inputQueue.length) { const [t, s2] = inputQueue.shift(); handleUser(t, s2); } }, 150);
    };
    pendingApproval = fin;
    timer = setTimeout(() => { if (pendingApproval === fin) { toast('No answer for ' + Math.round(ms / 60000) + ' minutes — taking that as “no”', true); fin(false); } }, ms);
    show(fin);
  });
}
function askApproval(action, paths) {
  if (approvalsBlocked > 0) return Promise.resolve(false);
  const wasBusy = typeof busy !== 'undefined' ? busy : false;
  if (typeof busy !== 'undefined') { busy = false; }
  if (typeof idleState === 'function') idleState();
  return awaitAnswer(done => {
    const list = paths.map(p => '`' + p + '`').join(' and ');
    jarvisSay({ text: '⚠ JARVIS wants to **' + (APPROVAL_VERB[action] || action) + '** ' + list + '.\nThat is outside `~/jarvis`, so I need your permission. _(You can also just say **yes**.)_', intent: 'APPROVAL', noPersona: true, noTTS: true,
      confirm: { yes: 'ALLOW', no: 'CANCEL', onConfirm: () => done(true), onCancel: () => done(false) } });
  }).then(ok => { if (typeof busy !== 'undefined') busy = wasBusy; return ok; });
}
// A name that matches several places on the laptop (the server answers { choices }): list them with numbered OPEN
// buttons; each repeats the request with that full path. Returns null when there's nothing to choose.
function pickPlace(r, what, redo) {
  if (!r || !Array.isArray(r.choices) || !r.choices.length) return null;
  return { text: 'I found ' + r.choices.length + ' places matching **' + what + '** — which one?\n\n' + r.choices.map((x, i) => (i + 1) + '. `' + x + '`').join('\n'), noPersona: true,
    actions: r.choices.slice(0, 6).map((x, i) => ({ label: 'OPEN ' + (i + 1), fn: async () => deliver(await redo(x), { intent: 'OPEN', confidence: 1 }) })) };
}
async function callTool(endpoint, data, helloToken) {
  const j = await callToolRaw(endpoint, data, helloToken);
  if (j && j.needsApproval && !(data && data.approved)) {
    if (!(await askApproval(j.action, j.paths || []))) return { error: approvalsBlocked > 0 ? 'That changes files outside ~/jarvis — do it at the laptop, where I can ask you first' : 'Cancelled — nothing was changed', cancelled: true };
    return callToolRaw(endpoint, Object.assign({}, data, { approved: true, approvalToken: j.approvalToken }), helloToken);
  }
  return j;
}
// How long a call may take before the page stops waiting. Without a limit, one stuck request (a hung PowerShell, a dead provider) keeps JARVIS "busy" forever.
// Anything that runs the AI or walks a big folder is allowed minutes; everything else is a quick local action.
const LONG_CALL = /^\/(?:code\/|lecture\/|exam\/|skill\/|wiki|projectwiki|research|summarize|agent\/plan|disk\/|scan\/|vision\/|ocr\/|whisper\/|dev\/|chatarchive\/search|mirror\/verify|tool\/(?:research|webAnswer|codeAsk|summari[sz]e|projectWiki|imageGen|csv|pdf|gitClone|installDeps|startProcess))/i;
const callTimeoutMs = ep => (LONG_CALL.test(String(ep)) ? 15 * 60000 : 3 * 60000);
async function callToolRaw(endpoint, data, helloToken) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (helloToken) headers['X-Hello-Token'] = helloToken;
    const res = await fetch(API + endpoint, { method: 'POST', headers, body: JSON.stringify(data || {}), signal: AbortSignal.timeout(callTimeoutMs(endpoint)) });
    const j = await res.json().catch(() => ({ error: 'Bad response (' + res.status + ')' }));
    if (!res.ok && !j.error) j.error = 'HTTP ' + res.status;
    if (j.needHello) { Hello.refresh(); j.error = 'Windows Hello approval is required for that — please try again'; }
    return j;
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) { log('err', 'no answer in time — ' + endpoint); return { error: 'that took too long and I stopped waiting (' + endpoint + '). The action may still be running on the laptop; check before trying again', timedOut: true }; }
    log('err', 'backend unreachable — ' + endpoint);
    return { error: 'the backend is offline (press START JARVIS above, or the desktop icon)' };
  }
}
async function getJSON(endpoint) {
  try { const r = await fetch(API + endpoint); return await r.json(); } catch (e) { return { error: 'backend offline' }; }
}

/* ---- Windows Hello approvals (verified by the server, see hello.js) ---- */
const Hello = (() => {
  let status = { enrolled: false, required: false };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  async function refresh() { const j = await getJSON('/hello/status'); if (!j.error) status = j; return status; }
  // Why Windows Hello can't be used here, or null when it can.
  async function unavailable() {
    if (/\.ts\.net$/i.test(location.hostname)) return 'Shutdown, restart, sleep and deleting need Windows Hello at the laptop — they can’t be approved from another device.';
    if (location.hostname !== 'localhost') return 'Open JARVIS at http://localhost:' + location.port + ' to use Windows Hello.';
    if (!window.PublicKeyCredential || !navigator.credentials) return 'This browser can’t use Windows Hello — open JARVIS in Chrome or Edge.';
    try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return 'Windows Hello isn’t set up on this PC (Windows Settings → Accounts → Sign-in options).'; }
    catch (e) { return 'Windows Hello isn’t available in this browser window.'; }
    return null;
  }
  async function enroll(token) {
    const why = await unavailable(); if (why) throw new Error(why);
    const c = await callTool('/hello/challenge', { purpose: 'enroll' }); if (c.error) throw new Error(c.error);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'JARVIS', id: 'localhost' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'jarvis', displayName: 'JARVIS' },
      challenge: fromB64u(c.challenge), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none', timeout: 60000 } });
    const r = cred.response;
    const res = await callTool('/hello/enroll', { credId: b64u(cred.rawId), spki: b64u(r.getPublicKey()), alg: r.getPublicKeyAlgorithm(),
      clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.getAuthenticatorData()) }, token);
    if (res.error) throw new Error(res.error);
    return refresh();
  }
  // Asks Windows Hello (fingerprint / face / PIN) and returns a single-use server approval token, or null.
  async function approve(purpose) {
    const why = await unavailable(); if (why) { toast(why, true); return null; }
    try {
      const c = await callTool('/hello/challenge', { purpose }); if (c.error) throw new Error(c.error);
      const a = await navigator.credentials.get({ publicKey: { challenge: fromB64u(c.challenge), rpId: 'localhost',
        allowCredentials: [{ type: 'public-key', id: fromB64u(c.credId), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
      const v = await callTool('/hello/verify', { purpose, authenticatorData: b64u(a.response.authenticatorData),
        clientDataJSON: b64u(a.response.clientDataJSON), signature: b64u(a.response.signature) });
      if (v.error) throw new Error(v.error);
      return v.token;
    } catch (e) { log('warn', 'Windows Hello: ' + e.message); return null; }
  }
  async function disable() {
    const t = await approve('hello'); if (!t) return false;
    const r = await callTool('/hello/disable', {}, t); if (r.error) { toast(r.error, true); return false; }
    await refresh(); return true;
  }
  return { refresh, unavailable, enroll, approve, disable, required: () => !!status.required };
})();
// Runs fn(token) only after a Windows Hello approval when it's required; otherwise runs it straight away.
async function withHello(purpose, fn) {
  if (!Hello.required()) return fn(undefined);
  const token = await Hello.approve(purpose);
  if (!token) { jarvisSay({ text: 'Not approved — Windows Hello was cancelled or didn’t verify, so nothing was changed.', intent: 'CANCELLED', noPersona: true }); return; }
  return fn(token);
}
Hello.refresh();
// Apps installed on this laptop (Start menu) — so "open canva" opens the Canva app, not canva.com.
getJSON('/apps').then(j => { if (Array.isArray(j.installed)) { NLU.setInstalledApps(j.installed); log('info', j.installed.length + ' installed apps can be opened by name'); } });
function toolStep(label) { log('tool', label); sfx.key(); setLastTool(label.split(' ')[0]); }
const CODE_TOOL_LABELS = { vscode: 'VS Code (Copilot)', kiro: 'Kiro', trae: 'Trae', antigravity: 'Antigravity IDE', devin: 'Devin', opencode: 'OpenCode', claude: 'Claude Code', gemini: 'Gemini', codex: 'Codex', qwen: 'Qwen', codebuff: 'Codebuff' };

/* ============ telemetry ============ */
const sys = { cpu: 0, ram: 0, ramUsed: 0, ramTotal: 0, diskUsed: 0, diskFree: 0, uptime: 0, osName: '', cpuModel: '', cpus: 0 };
function bar(id, pct) {
  const el = $(id); el.style.width = clamp(pct, 0, 100) + '%';
  const cls = Thresholds.barClass(pct);
  el.classList.toggle('hot', cls === 'hot'); el.classList.toggle('crit', cls === 'crit');
}
function renderTele() {
  bar('#cpuBar', sys.cpu); $('#cpuVal').textContent = sys.cpu + '%';
  bar('#ramBar', sys.ram); $('#ramVal').textContent = sys.ramTotal ? sys.ramUsed + ' / ' + sys.ramTotal + ' GB' : '—';
  bar('#dskBar', sys.diskUsed); $('#dskVal').textContent = sys.diskFree !== null ? sys.diskFree + ' GB free' : '—';
  const h = Math.floor(sys.uptime / 60); $('#upVal').textContent = h ? h + 'h ' + (sys.uptime % 60) + 'm' : sys.uptime + 'm';
}
async function refreshSystem() {
  if (!backend.online) return false;
  const d = await getJSON('/tool/systemInfo');
  if (!d.success) return false;
  Object.assign(sys, {
    cpu: d.cpuUsage, ram: d.memoryUsagePercent, ramUsed: d.usedMemoryGB, ramTotal: d.totalMemoryGB,
    diskUsed: d.disk.usedPercent || 0, diskFree: d.disk.freeGB, uptime: d.uptimeMin, osName: d.osName, cpuModel: d.cpuModel, cpus: d.cpus
  });
  // Feed pattern learning baselines (Phase 2.9).
  if (typeof Learn !== 'undefined') {
    try { Learn.sample('cpu', sys.cpu); Learn.sample('ram', sys.ram); } catch (e) {}
  }
  renderTele();
  return true;
}
setInterval(() => { if (!document.hidden) refreshSystem(); }, 3000);
setInterval(async () => { const was = backend.online; await checkBackend(); if (backend.online !== was || !llm.online) await checkLLM(); }, 20000);

/* ============ clock / uptime ============ */
const bootTime = Date.now(); let latSum = 0, latN = 0;
setInterval(() => {
  const d = new Date();
  $('#clockTime').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  $('#clockDate').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const up = Math.floor((Date.now() - bootTime) / 1000);
  $('#statUp').textContent = pad(Math.floor(up / 60)) + ':' + pad(up % 60);
  $('#statLat').textContent = latN ? Math.round(latSum / latN) + 'ms' : '—';
}, 1000);

/* ============ canvas: background + wave + orb ============ */
let themeRGB = '63,217,255', themeHiRGB = '157,241,255'; // follow the HUD theme (see applyTheme)
const bctx = bgCanvas.getContext('2d'), wctx = waveCanvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
function fit(c, cx) { const r = c.getBoundingClientRect(); c.width = Math.max(2, r.width * DPR); c.height = Math.max(2, r.height * DPR); cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
function fitAll() { fit(bgCanvas, bctx); fit(waveCanvas, wctx); }
window.addEventListener('resize', fitAll);
const stars = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), s: rand(.4, 1.6), v: rand(.008, .03) }));
function drawBG(dt) {
  const w = bgCanvas.width / DPR, h = bgCanvas.height / DPR;
  bctx.clearRect(0, 0, w, h);
  bctx.strokeStyle = 'rgba(' + themeRGB + ',.045)'; bctx.lineWidth = 1;
  const hy = h * .64;
  for (let i = -8; i <= 8; i++) { bctx.beginPath(); bctx.moveTo(w / 2 + i * w * .02, hy); bctx.lineTo(w / 2 + i * w * .16, h); bctx.stroke(); }
  const off = (performance.now() / 140) % 28;
  for (let y = hy + off; y < h; y += 28) {
    const t = (y - hy) / (h - hy);
    bctx.strokeStyle = 'rgba(' + themeRGB + ',' + (0.015 + t * 0.05) + ')';
    bctx.beginPath(); bctx.moveTo(0, y); bctx.lineTo(w, y); bctx.stroke();
  }
  for (const p of stars) {
    p.y -= p.v * dt / 60; if (p.y < 0) p.y = 1;
    bctx.fillStyle = 'rgba(' + themeHiRGB + ',' + (0.08 + p.s * 0.1) + ')';
    bctx.fillRect(p.x * w, p.y * h, p.s, p.s);
  }
}
let waveLevel = 0, waveTarget = .08;
function drawWave() {
  const w = waveCanvas.width / DPR, h = waveCanvas.height / DPR;
  wctx.clearRect(0, 0, w, h);
  waveLevel += (waveTarget - waveLevel) * .12;
  const N = 64, bw = w / N, t = performance.now() / 1000;
  let freq = null;
  if (analyser && micActive) { const d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); freq = d; }
  // Muted state colours, matching the dial in ui.css: green while listening/doing, the theme accent otherwise.
  const colors = { EXECUTING: '143,181,115', LISTENING: '143,181,115', ERROR: '216,104,92' };
  const col = colors[state] || themeRGB;
  for (let i = 0; i < N; i++) {
    let v;
    if (freq) v = (freq[Math.floor(i * freq.length / N / 2)] || 0) / 255;
    else { const base = Math.sin(i * .42 + t * 3.1) * .5 + .5; v = (base * .7 + Math.random() * .3) * waveLevel + 0.015; }
    const bh = clamp(v, 0.02, 1) * h * .48;
    wctx.fillStyle = 'rgba(' + col + ',' + (0.2 + v * .5) + ')';
    wctx.fillRect(i * bw + 1, h / 2 - bh, bw - 2, bh * 2);
  }
}
const coilG = $('#coilG');
for (let i = 0; i < 12; i++) {
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', '196'); r.setAttribute('y', '86'); r.setAttribute('width', '8'); r.setAttribute('height', '16'); r.setAttribute('rx', '2');
  r.setAttribute('fill', 'var(--ring)'); r.setAttribute('opacity', '.5');
  r.setAttribute('transform', 'rotate(' + (i * 30) + ' 200 200)');
  coilG.appendChild(r);
}
const ringA = $('#ringA'), ringB = $('#ringB'), ringC = $('#ringC');
let aA = 0, aB = 0, aC = 0;
const ringSpeeds = { idle: [4, -2.4, 7], listen: [26, -14, 34], proc: [70, -95, 120], exec: [40, -26, 54], speak: [34, -20, 44], err: [90, -60, 110], boot: [10, -6, 14] };
const curSp = [4, -2.4, 7];
function spinOrb(dt) {
  const tgt = ringSpeeds[document.body.dataset.state] || ringSpeeds.idle;
  for (let i = 0; i < 3; i++) curSp[i] += (tgt[i] - curSp[i]) * .04;
  aA += curSp[0] * dt / 1000; aB += curSp[1] * dt / 1000; aC += curSp[2] * dt / 1000;
  ringA.setAttribute('transform', 'rotate(' + aA + ' 200 200)');
  ringB.setAttribute('transform', 'rotate(' + aB + ' 200 200)');
  ringC.setAttribute('transform', 'rotate(' + aC + ' 200 200)');
  coilG.setAttribute('transform', 'rotate(' + (-aB * .5) + ' 200 200)');
  speechPulse *= .9;
  waveTarget = state === 'LISTENING' ? (micActive ? .9 : .35) : state === 'SPEAKING' ? (speechPulse > .05 ? .3 + .6 * speechPulse + rand(0, .1) : rand(.5, .85))
    : state === 'PROCESSING' ? rand(.25, .45) : state === 'EXECUTING' ? rand(.35, .55) : state === 'ERROR' ? rand(.1, .2) : .08;
}
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(50, t - lastT); lastT = t;
  // The background grid is hidden by ui.css (clientWidth 0) — don't keep painting it.
  if (!document.hidden) { if (!reduceMotion && bgCanvas.clientWidth) drawBG(dt); spinOrb(dt); drawWave(); }
  requestAnimationFrame(frame);
}
fitAll(); requestAnimationFrame(frame);
if (reduceMotion) drawBG(16);

/* ============ TTS ============ */
let voices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  const sel = $('#voiceSelect'); sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'AUTO (British preferred)'; sel.appendChild(auto);
  voices.filter(v => /^en/i.test(v.lang)).forEach(v => { const o = document.createElement('option'); o.value = v.name; o.textContent = v.name.replace(/^Microsoft /, '') + ' · ' + v.lang; if (v.name === settings.voice) o.selected = true; sel.appendChild(o); });
  const v = pickVoice(); setEngine('tts', settings.tts ? 'on' : 'boot', settings.tts ? (v ? v.name.replace(/^Microsoft /, '').slice(0, 28) : 'browser voice') : 'muted');
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function pickVoice(l) {
  if (l && l !== 'en') return Lang.voiceFor(l);
  if (settings.voice) { const v = voices.find(x => x.name === settings.voice); if (v) return v; }
  if (settings.persona === 'friday') {
    const fprefs = [/emily.*(natural|online)/i, /(sonia|libby|maisie).*(natural|online)/i, /google uk english female/i, /hazel|susan|emily/i];
    for (const re of fprefs) { const v = voices.find(x => /en[-_](IE|GB)/i.test(x.lang) && re.test(x.name)); if (v) return v; }
  }
  // Closest to film JARVIS first: Edge's neural British male voices, then Chrome's, then Windows' George.
  const prefs = [/ryan.*natural|ryan online/i, /thomas.*natural|thomas online/i, /google uk english male/i, /george/i, /ryan|thomas|daniel|arthur|oliver|male/i];
  for (const re of prefs) { const v = voices.find(x => /en[-_]GB/i.test(x.lang) && re.test(x.name)); if (v) return v; }
  return voices.find(v => /en[-_]GB/i.test(v.lang) && !/hazel|susan|libby|sonia|maisie|female/i.test(v.name))
    || voices.find(v => /en[-_]GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
}
// Code blocks and markdown are for the eyes; speak a short, clean version.
function spokenVersion(t) {
  let s = String(t).replace(/```[\s\S]*?(```|$)/g, ' (code shown on screen) ')
    .replace(/`([^`]+)`/g, '$1').replace(/\*\*|__|[*_#>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '').replace(/https?:\/\/\S+/g, 'the link').replace(/\s+/g, ' ').trim();
  if (s.length > 320) {
    const parts = s.match(/[^.!?।]+[.!?।]+/g) || [s];
    const more = { te: ' పూర్తి సమాధానం స్క్రీన్‌పై ఉంది.', kn: ' ಪೂರ್ಣ ಉತ್ತರ ಪರದೆಯ ಮೇಲಿದೆ.' }[Lang.detect(s)] || ' The full answer is on screen.';
    s = parts.slice(0, 2).join(' ').trim() + more;
  }
  return s;
}
// Telugu / Kannada replies are spoken with Microsoft's neural voices (via the server), so they work in any browser.
let ttsAudio = null;
function stopSpeaking() {
  if (typeof speechQueue !== 'undefined') speechQueue.clear();   // sentences still waiting (speak-while-writing) go too
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
}
// The neural voice in two steps, so speak-while-writing can fetch the next sentence while the current one plays.
async function neuralClip(clean, l) {
  const r = await fetch(API + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean, lang: l, gender: settings.persona === 'friday' ? 'female' : 'male', rate: settings.rate }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'voice error');
  return URL.createObjectURL(await r.blob());
}
function playClip(url) {                 // does NOT call stopSpeaking(): the queue owns the order
  return new Promise(res => {
    const a = new Audio(url); ttsAudio = a;
    const pulse = setInterval(() => { speechPulse = .6 + Math.random() * .4; }, 160);
    const done = () => { clearInterval(pulse); URL.revokeObjectURL(url); if (ttsAudio === a) ttsAudio = null; res(); };
    a.onended = done; a.onerror = done; a.onpause = done;
    a.play().catch(done);
  });
}
async function speakNeural(clean, l) {
  const url = await neuralClip(clean, l);
  stopSpeaking();
  return playClip(url);
}
function speak(text) {
  return new Promise(res => {
    if (!settings.tts) return res();
    const clean = spokenVersion(text);
    if (!clean) return res();
    const lang = Lang.detect(clean);
    // FRIDAY's English also uses the neural voice (en-IN Neerja) unless a specific browser voice was picked.
    const fridayNeural = lang === 'en' && settings.persona === 'friday' && !settings.voice;
    if ((lang !== 'en' || fridayNeural) && settings.neuralVoice !== false) {
      const first = (clean.match(/^[^.!?।]{1,110}[.!?।]?/) || [clean])[0];
      lastSpoken = { text: clean, at: Date.now() };
      stateMsg.textContent = first; stateMsg.classList.add('caption'); markLang(stateMsg, first);
      engine('tts', true);
      speakNeural(clean, lang).then(res, e => { log('warn', 'neural voice unavailable: ' + e.message); speakBrowser(clean, res); });
      return;
    }
    speakBrowser(clean, res);
  }).then(() => { engine('tts', false); stateMsg.classList.remove('caption'); });
}
function speakBrowser(clean, res) {
    if (!('speechSynthesis' in window)) return res();
    try {
      const u = new SpeechSynthesisUtterance(clean);
      const l = Lang.detect(clean);
      const v = pickVoice(l);
      if (l !== 'en' && !v) { const w = Lang.warnNoVoiceOnce(l); if (w) toast(w); return res(); } // no Telugu/Kannada voice → text only
      u.rate = clamp(parseFloat(settings.rate) || 1, .5, 2); u.pitch = settings.persona === 'friday' ? 1.05 : .9;
      if (v) { u.voice = v; u.lang = v.lang; } else if (l !== 'en') u.lang = Lang.SPEECH[l];
      u.onend = res; u.onerror = res;
      // Film-style subtitle under the orb + orb flares on each spoken word.
      const first = (clean.match(/^[^.!?]{1,110}[.!?]?/) || [clean])[0];
      lastSpoken = { text: clean, at: Date.now() };
      stateMsg.textContent = first; stateMsg.classList.add('caption'); markLang(stateMsg, first);
      u.onboundary = () => { speechPulse = 1; document.body.classList.add('word'); clearTimeout(wordTimer); wordTimer = setTimeout(() => document.body.classList.remove('word'), 110); };
      engine('tts', true);
      speechSynthesis.speak(u);
      setTimeout(res, clean.length * 90 + 3000);
    } catch (e) { res(); }
}
let speechPulse = 0, wordTimer = 0, lastSpoken = { text: '', at: 0 };
// Speak while writing (speech-stream.js): sentences of the answer are spoken as they are finished, one at a time.
const earlyNeural = () => settings.persona === 'friday' && !settings.voice && settings.neuralVoice !== false;   // English only: other languages are translated after the stream
const speechQueue = SpeechStream.createQueue({
  prefetch: clean => (earlyNeural() ? neuralClip(clean, 'en') : undefined),
  play: async (clean, prep) => {
    engine('tts', true);
    try {
      lastSpoken = { text: clean, at: Date.now() };
      if (earlyNeural() && prep) { try { await playClip(await prep); return; } catch (e) { log('warn', 'neural voice unavailable: ' + e.message); } }
      await new Promise(res => speakBrowser(clean, res));
    } finally { if (!speechQueue.waiting) { engine('tts', false); stateMsg.classList.remove('caption'); } }
  },
});
// "stop" / the STOP button / Esc: the voice, the sentences still waiting, and the answer being written, all at once.
function stopEverything() { stopSpeaking(); if (llmAbort) llmAbort.abort(); }
// Keeps Telugu/Kannada letters too — otherwise every Telugu reply looked empty and was never recognised as an echo.
const simpleWords = s => String(s).toLowerCase().replace(/[^a-zఀ-೿' ]/g, ' ').replace(/\s+/g, ' ').trim();
// Chrome's speechSynthesis.speaking can stay stuck at true after a reply; trusting it forever kept the wake word
// muted (animation on, nothing heard). So a browser-voice reply only counts as "still speaking" for as long as it
// could plausibly take.
const isSpeakingNow = () => !!(ttsAudio && !ttsAudio.paused) ||
  ('speechSynthesis' in window && speechSynthesis.speaking && Date.now() - lastSpoken.at < String(lastSpoken.text || '').length * 90 + 3000);
function isEcho(heard) {
  if (Date.now() - lastSpoken.at > 6000) return false;
  const h = simpleWords(heard), s = simpleWords(lastSpoken.text);
  return !!h && (s.includes(h) || NLU.lev(h, s) <= Math.max(2, s.length * .25));
}

/* ============ markdown (escape first, then format) ============ */
function renderMD(src) {
  const blocks = [];
  let s = String(src || '').replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') }); return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  s = escHtml(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + i + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
  for (const line of s.split('\n')) {
    let m;
    if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) { flushPara(); flushList(); out.push('<h4>' + m[1] + '</h4>'); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); }
    else if (/^\s*\u0000\d+\u0000\s*$/.test(line)) { flushPara(); flushList(); out.push(line.trim()); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const b = blocks[+i];
    return '<div class="codeblock"><div class="ch"><span>' + escHtml(b.lang || 'code').toUpperCase() + '</span><button class="copy" type="button">COPY</button></div><pre><code>' + escHtml(b.code) + '</code></pre></div>';
  });
}
messages.addEventListener('click', async e => {
  const btn = e.target.closest('.copy'); if (!btn) return;
  const code = btn.closest('.codeblock').querySelector('code').textContent;
  try { await navigator.clipboard.writeText(code); } catch (err) { await callTool('/tool/writeClipboard', { text: code }); }
  btn.textContent = 'COPIED ✓'; setTimeout(() => btn.textContent = 'COPY', 1500);
});

/* ============ messages / reply queue ============ */
const AVATAR = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="var(--cyan)" stroke-width="1.4" stroke-dasharray="5 3"/><circle cx="20" cy="20" r="6" fill="var(--cyan)"/><circle cx="20" cy="20" r="10.5" fill="none" stroke="#9df1ff" stroke-width=".7" opacity=".7"/></svg>';
function updateMsgCount() { $('#msgCount').textContent = chatLog.filter(m => m.role === 'user').length; }
function addMsg(role, text, opts) {
  opts = opts || {};
  const empty = messages.querySelector('.empty-chat'); if (empty) empty.remove();
  const when = opts.t ? new Date(opts.t) : new Date();
  const time = pad(when.getHours()) + ':' + pad(when.getMinutes());
  const wrap = document.createElement('div'); wrap.className = 'msg ' + role;
  if (role === 'user') {
    wrap.innerHTML = '<div class="mhead"><button class="mdel" type="button" title="Delete this message and JARVIS’s reply" aria-label="Delete this message and its reply">✕</button><button class="mdel medit" type="button" title="Edit and send again" aria-label="Edit this message and send it again">✏️</button><span>' + time + '</span><span>' + escHtml((opts.source || 'text').toUpperCase()) + '</span><span class="who">YOU</span></div><div class="mbody"></div>';
    wrap.querySelector('.mbody').textContent = text;
    wrap._t = when.getTime(); wrap._text = text;
    wrap.querySelector('.mdel').onclick = () => deleteExchange(findUserEntry(wrap._text, wrap._t));
    wrap.querySelector('.medit').onclick = () => { editing = { text: wrap._text, t: wrap._t }; chatInput.value = wrap._text; chatInput.focus(); chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); toast('Edit your message and press Enter — the old one and its reply are replaced'); };
    markLang(wrap.querySelector('.mbody'), text);
  } else {
    wrap.innerHTML = '<div class="avatar">' + AVATAR + '</div><div class="mcontent"><div class="mhead"><span class="who">JARVIS</span><span>' + time + '</span><span class="meta"></span><button class="mdel mregen" type="button" title="Ask again for a new answer" aria-label="Get a new answer">🔄</button></div><div class="mbody"></div><div class="mextra"></div></div>';
    wrap.querySelector('.mregen').onclick = () => { let u = wrap.previousElementSibling; while (u && !u.classList.contains('user')) u = u.previousElementSibling; if (!u || !u._text) return toast('I can’t find the question for this answer', true); regenerate(u._text, u._t); };
    if (text) { wrap.querySelector('.mbody').innerHTML = renderMD(text); markLang(wrap.querySelector('.mbody'), text); }
    if (opts.meta) { const me = wrap.querySelector('.meta'); me.textContent = opts.meta; if (/AI/.test(opts.meta)) me.classList.add('ai'); }
  }
  messages.appendChild(wrap); messages.scrollTop = messages.scrollHeight;
  return { root: wrap, bodyEl: wrap.querySelector('.mbody'), metaEl: wrap.querySelector('.meta'), extraEl: wrap.querySelector('.mextra') };
}
// Deleting a message you sent: it goes together with JARVIS's reply to it (everything up to your next message).
// Undoable ("undo" / the ↶ chip).
// 🔄 / "regenerate": ask the same question again. For the latest exchange the old answer is replaced (undo brings it back).
let editing = null;
function regenerate(text, t) {
  if (busy) return toast('JARVIS is busy — try again in a moment');
  let lastUser = -1; for (let k = chatLog.length - 1; k >= 0; k--) if (chatLog[k].role === 'user') { lastUser = k; break; }
  const i = findUserEntry(text, t);
  if (i >= 0 && i === lastUser) deleteExchange(i, true);
  handleUser(text, 'text');
}
function findUserEntry(text, t) {
  let best = -1, bestD = Infinity;
  chatLog.forEach((m, i) => { if (m.role === 'user' && m.text === text) { const d = Math.abs((m.t || 0) - t); if (d < bestD) { best = i; bestD = d; } } });
  return best;
}
function deleteExchange(i, quiet) {
  if (i < 0 || !chatLog[i]) { if (!quiet) toast('That message is no longer in the saved chat', true); return null; }
  let j = i + 1; while (j < chatLog.length && chatLog[j].role !== 'user') j++;
  const removed = chatLog.slice(i, j);
  chatLog.splice(i, j - i); store.set('jarvis.chat', chatLog); restoreChat();
  Undo.push('deleted your message', () => {
    chatLog = chatLog.concat(removed).sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-80);
    store.set('jarvis.chat', chatLog); restoreChat();
    return 'Brought back your message and its reply.';
  });
  if (!quiet) toast('Message deleted — say "undo" to bring it back');
  return removed;
}
function logChat(role, text, meta, source) {
  chatLog.push({ role, text, meta: meta || '', source: source || '', t: Date.now() });
  if (typeof Extras !== 'undefined') Extras.archiveLog({ role, text, t: chatLog[chatLog.length - 1].t, source });   // also kept for "what did I decide about X last week" (chatarchive.js)
  if (chatLog.length > 80) chatLog = chatLog.slice(-80);
  store.set('jarvis.chat', chatLog); updateMsgCount();
}
function typeMD(el, text, instant) {
  return new Promise(res => {
    if (instant || reduceMotion || text.length > 500 || /```/.test(text)) { el.innerHTML = renderMD(text); messages.scrollTop = messages.scrollHeight; return res(); }
    el.classList.add('typing'); let i = 0;
    (function step() {
      i += 3; el.textContent = text.slice(0, i);
      if (i < text.length) { messages.scrollTop = messages.scrollHeight; setTimeout(step, 14); }
      else { el.classList.remove('typing'); el.innerHTML = renderMD(text); messages.scrollTop = messages.scrollHeight; res(); }
    })();
  });
}
const replyQ = []; let pumping = false;
function jarvisSay(o) { replyQ.push(o); pump(); }
async function pump() {
  if (pumping) return; pumping = true;
  while (replyQ.length) { const o = replyQ.shift(); await renderReply(o); if (replyQ.length) await sleep(140); }
  pumping = false;
  if (!busy && (state === 'SPEAKING' || state === 'ERROR' || state === 'EXECUTING')) idleState();
}
async function renderReply(o) {
  const node = o.node || addMsg('jarvis', '');
  const text = o.text || '';
  markLang(node.bodyEl, text);
  if (o.alert || /^(I am afraid|⚠|🔋|⏳)/.test(text)) node.root.classList.add('alert');
  if (state !== 'ERROR') setState('SPEAKING');
  const meta = o.meta || ((o.intent || '') + (o.tool ? ' · ' + o.tool + '()' : '') + (o.intent ? ' · LOCAL' : ''));
  if (node.metaEl) { node.metaEl.textContent = meta; if (/AI/.test(meta)) node.metaEl.classList.add('ai'); }
  const typed = o.node ? Promise.resolve() : typeMD(node.bodyEl, text, o.instant);
  // spokenEarly: the answer was already spoken sentence by sentence while it was being written; only the closing note (if any) is left to say
  const spoken = o.spokenEarly ? (async () => { if (o.earlySuffix && settings.tts) speechQueue.add(o.earlySuffix); await speechQueue.idle(); })()
    : (!o.noTTS && settings.tts) ? speak(o.speak || text) : sleep(200);
  if (o.card) {
    const dl = document.createElement('dl'); dl.className = 'info-card';
    dl.innerHTML = o.card.map(([k, v]) => '<dt>' + escHtml(k) + '</dt><dd>' + escHtml(v) + '</dd>').join('');
    node.extraEl.appendChild(dl);
  }
  if (o.confirm) {
    const d = document.createElement('div'); d.className = 'confirmRow';
    const yes = document.createElement('button'); yes.className = 'cbtn danger'; yes.textContent = o.confirm.yes || 'CONFIRM';
    const no = document.createElement('button'); no.className = 'cbtn'; no.textContent = o.confirm.no || 'CANCEL';
    yes.addEventListener('click', () => { d.classList.add('done'); sfx.ok(); o.confirm.onConfirm(); });
    no.addEventListener('click', () => { d.classList.add('done'); if (o.confirm.onCancel) o.confirm.onCancel(); else jarvisSay({ text: 'Understood — cancelled.', intent: 'CANCELLED' }); });
    d.append(yes, no); node.extraEl.appendChild(d);
  }
  if (o.actions) {
    const d = document.createElement('div'); d.className = 'confirmRow';
    o.actions.forEach(a => { const b = document.createElement('button'); b.className = 'cbtn'; b.textContent = a.label; b.addEventListener('click', () => { d.classList.add('done'); a.fn(); }); d.appendChild(b); });
    node.extraEl.appendChild(d);
  }
  if (o.extraNode) node.extraEl.appendChild(o.extraNode);   // a picture or widget made by a tool (e.g. a QR code); never untrusted HTML
  if (o.suggestions && o.suggestions.length) {
    const d = document.createElement('div'); d.className = 'suggestRow';
    o.suggestions.forEach(sg => { const b = document.createElement('button'); b.className = 'chip-cmd'; b.textContent = sg; b.addEventListener('click', () => handleUser(sg, 'text')); d.appendChild(b); });
    node.extraEl.appendChild(d);
  }
  if (o.trace && (settings.inspect || o.showTrace)) node.extraEl.appendChild(traceBlock(o.trace));
  if (text && !o.noLog) logChat('assistant', text, meta);
  messages.scrollTop = messages.scrollHeight;
  await Promise.all([typed, spoken]);
}
function restoreChat() {
  messages.innerHTML = '';
  if (!chatLog.length) {
    messages.innerHTML = '<div class="empty-chat">NO MESSAGES YET<br>TYPE, HOLD THE MIC, OR PRESS <b>/</b></div>';
  } else {
    chatLog.slice(-40).forEach(m => m.role === 'user' ? addMsg('user', m.text, { source: m.source, t: m.t }) : addMsg('jarvis', m.text, { meta: m.meta, t: m.t }));
  }
  updateMsgCount();
}

/* ============ safe math ============ */
function tryCalc(text) {
  let e = text.toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent) of\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)')
    .replace(/(?:square root of|sqrt)\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/g, (_, n) => String(Math.sqrt(+n)))
    .replace(/(?:cube root of|cbrt)\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/g, (_, n) => String(Math.cbrt(+n)))
    .replace(/(\d+(?:\.\d+)?)\s*squared/g, '($1**2)').replace(/(\d+(?:\.\d+)?)\s*cubed/g, '($1**3)')
    .replace(/(\d+)\s*!/g, (_, n) => { let f = 1; for (let i = 2; i <= Math.min(+n, 170); i++) f *= i; return String(f); })
    .replace(/what is|what's|calculate|compute|solve|evaluate|equals|equal to|\?|=/g, ' ')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\b(times|multiplied by|into)\b/g, '*')
    .replace(/\b(divided by|over|by)\b/g, '/').replace(/\b(mod|modulo)\b/g, '%').replace(/to the power of|\bpower\b/g, '**')
    .replace(/(\d)\s*[x×]\s*(?=[\d(])/g, '$1*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/(\d),(\d{3})/g, '$1$2');
  e = e.replace(/[^0-9+\-*/().%\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\d/.test(e) || !/[+\-*/%]/.test(e.replace(/^-/, ''))) return null;
  if (!/^[0-9+\-*/().%\s]+$/.test(e)) return null;
  try {
    const val = Function('"use strict";return (' + e + ')')();
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return { expr: e, val: parseFloat(val.toPrecision(12)) };
  } catch (err) { return null; }
}

/* ============ CS quick tools ============ */
const BASES = { binary: 2, bin: 2, hex: 16, hexadecimal: 16, octal: 8, oct: 8, decimal: 10, dec: 10 };
const BASE_NAME = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hex' };
const PREFIX = { 2: '0b', 8: '0o', 10: '', 16: '0x' };
function parseBig(str, base) {
  str = str.toLowerCase();
  if (/^0x/.test(str)) { base = 16; str = str.slice(2); } else if (/^0b/.test(str)) { base = 2; str = str.slice(2); } else if (/^0o/.test(str)) { base = 8; str = str.slice(2); }
  const digits = '0123456789abcdef'.slice(0, base);
  if (!str || [...str].some(c => !digits.includes(c))) return null;
  let n = 0n; for (const c of str) n = n * BigInt(base) + BigInt(digits.indexOf(c));
  return { n, base };
}
const group4 = s => s.replace(/\B(?=(\d{4})+$)/g, '_');
function baseConvert(s) {
  let m, src = 10, numStr, target;
  if ((m = s.match(/\b(binary|hex|hexadecimal|octal|decimal) ([0-9a-fx]+) (?:to|in|into) (decimal|binary|hex|hexadecimal|octal)\b/))) { src = BASES[m[1]]; numStr = m[2]; target = BASES[m[3]]; }
  else if ((m = s.match(/\b(binary|bin|hex(?:adecimal)?|octal|oct|decimal|dec)(?: value| form| representation)? of (0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\b/))) { target = BASES[m[1]]; numStr = m[2]; }
  else if ((m = s.match(/\b(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s*(?:in|to|into|as)\s*(binary|bin|hex(?:adecimal)?|octal|oct|decimal|dec)\b/))) { numStr = m[1]; target = BASES[m[2]]; }
  if (!numStr) return null;
  const p = parseBig(numStr, src);
  if (!p) return { text: '"' + numStr + '" is not a valid ' + BASE_NAME[src] + ' number.' };
  const out = p.n.toString(target);
  const shown = target === 2 ? group4(out) : target === 16 ? out.toUpperCase() : out;
  return {
    text: '**' + numStr + '** (' + BASE_NAME[p.base] + ') = **' + PREFIX[target] + shown + '** in ' + BASE_NAME[target] + '.\n\n```text\ndec  ' + p.n.toString(10) + '\nhex  0x' + p.n.toString(16).toUpperCase() + '\noct  0o' + p.n.toString(8) + '\nbin  0b' + group4(p.n.toString(2)) + '\n```',
    speak: numStr + ' in ' + BASE_NAME[target] + ' is ' + (target === 16 ? out.toUpperCase().split('').join(' ') : target === 2 && out.length > 16 ? 'shown on screen' : out.split('').join(target === 2 ? ' ' : ''))
  };
}
const SIZE_UNITS = { bit: 1 / 8, bits: 1 / 8, b: 1, byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
function dataSize(s) {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(bits?|bytes?|b|kb|mb|gb|tb|kib|mib|gib|tib)\s*(?:to|in|into)\s*(bits?|bytes?|b|kb|mb|gb|tb|kib|mib|gib|tib)\b/);
  if (!m) return null;
  const n = +m[1], from = m[2], to = m[3];
  const fmt = v => parseFloat(v.toPrecision(8)).toLocaleString();
  const si = n * SIZE_UNITS[from] / SIZE_UNITS[to];
  let text = '**' + n + ' ' + from.toUpperCase() + ' = ' + fmt(si) + ' ' + to.toUpperCase() + '**';
  const binMap = { kb: 'kib', mb: 'mib', gb: 'gib', tb: 'tib' };
  if (binMap[from] && binMap[to]) {
    const bin = n * SIZE_UNITS[binMap[from]] / SIZE_UNITS[binMap[to]];
    text += ' (SI, powers of 1000).\nIn binary units (what Windows shows, powers of 1024): **' + fmt(bin) + ' ' + to.toUpperCase() + '**.';
  } else text += '.';
  return { text, speak: n + ' ' + from + ' is ' + fmt(si) + ' ' + to };
}
function asciiTool(original) {
  let m = original.match(/ascii (?:code |value )?(?:of|for) ['"]?(\S)/i);
  if (m) { const c = m[1].charCodeAt(0); return { text: "ASCII of **'" + m[1] + "'** is **" + c + '** (hex 0x' + c.toString(16).toUpperCase() + ', binary ' + c.toString(2).padStart(8, '0') + ').', speak: 'The ASCII code of ' + m[1] + ' is ' + c }; }
  m = original.match(/(?:char(?:acter)?|ascii) (?:for|of) (?:code )?(\d{1,3})/i);
  if (m && +m[1] < 256) { const ch = String.fromCharCode(+m[1]); const vis = +m[1] < 33 ? ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US', 'SPACE'][+m[1]] : "'" + ch + "'"; return { text: 'Code **' + m[1] + '** is **' + vis + '**.' }; }
  return null;
}
function bitwise(s) {
  const m = s.match(/(\d+)\s*(xor|bitwise and|bitwise or|and|or|<<|>>|&|\||\^)\s*(\d+)/);
  if (!m) return null;
  const a = +m[1], b = +m[3], op = m[2];
  if (a > 2 ** 31 || b > 2 ** 31) return { text: 'Numbers are too large for 32-bit bitwise ops.' };
  const ops = { xor: [(x, y) => x ^ y, 'XOR'], '^': [(x, y) => x ^ y, 'XOR'], and: [(x, y) => x & y, 'AND'], 'bitwise and': [(x, y) => x & y, 'AND'], '&': [(x, y) => x & y, 'AND'],
    or: [(x, y) => x | y, 'OR'], 'bitwise or': [(x, y) => x | y, 'OR'], '|': [(x, y) => x | y, 'OR'], '<<': [(x, y) => x << y, '<<'], '>>': [(x, y) => x >> y, '>>'] };
  const [fn, name] = ops[op];
  const r = fn(a, b) >>> 0;
  const w = Math.max(8, r.toString(2).length, a.toString(2).length, /<<|>>/.test(name) ? 0 : b.toString(2).length);
  const row = (lbl, v) => lbl.padEnd(6) + v.toString(2).padStart(w, '0') + '  (' + v + ')';
  return { text: '**' + a + ' ' + name + ' ' + b + ' = ' + r + '**\n\n```text\n' + row('a', a) + '\n' + (/<<|>>/.test(name) ? 'shift ' + b : row('b', b)) + '\n' + '-'.repeat(w + 6) + '\n' + row('=', r) + '\n```', speak: a + ' ' + name + ' ' + b + ' is ' + r };
}

/* ============ timers & focus ============ */
const timers = [];
// A timer lives in this page, so a reload used to lose it. Each one is also written down as a SAFETY-NET reminder (20 seconds after it should ring): if the page
// is open, the page rings at the right moment and removes the reminder first; if the page was closed or reloaded, the laptop's scheduler rings it (also on the phone,
// if phone alerts are on), and a reloaded page puts the countdown back from the same reminder.
const TIMER_NET_MS = 20000;
function addTimer(label, ms, onDone, restored) {
  const el = document.createElement('span'); el.className = 'tchip'; timerChips.appendChild(el);
  const t = restored ? { id: restored.id, label, end: restored.end, el, onDone } : { id: rid(), label, end: Date.now() + ms, el, onDone };
  timers.push(t);
  if (!restored) { reminders.push({ id: rid(), text: '⏱ Your ' + label + ' timer is up', at: t.end + TIMER_NET_MS, fired: false, timerId: t.id, timerLabel: label, timerEnd: t.end }); saveTasks(); }
  return t;
}
const dropTimerReminder = t => { const n = reminders.length; reminders = reminders.filter(r => r.timerId !== t.id); if (reminders.length !== n) saveTasks(); };
function cancelTimer(t) { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.el.remove(); } dropTimerReminder(t); }
// after a reload: the timers that were still running come back from their safety-net reminders
function restoreTimers() {
  const now = Date.now(); let n = 0;
  for (const r of reminders) if (r.timerId && !r.fired && r.timerEnd && !timers.some(t => t.id === r.timerId) && now - r.timerEnd < 6 * 3600e3) { addTimer(r.timerLabel || 'timer', 0, undefined, { id: r.timerId, end: r.timerEnd }); n++; }
  if (n) log('info', 'restored ' + n + ' running timer' + (n === 1 ? '' : 's') + ' after the reload');
  return n;
}
let focus = null;
// A focus session (and its break) survives a reload: its state is kept in the shared store and picked up again when the page opens, if its time has not run out.
const saveFocus = () => { try { store.set('jarvis.focusState', focus ? { phase: focus.phase, end: focus.end, min: focus.min, count: focus.count, subject: focus.subject || '' } : null); } catch (e) {} };
function restoreFocus() {
  try {
    const f = store.get('jarvis.focusState', null);
    if (!f || !f.end || f.end <= Date.now() || (f.phase !== 'focus' && f.phase !== 'break') || focus) { if (f) store.set('jarvis.focusState', null); return false; }
    focus = { phase: f.phase, end: f.end, min: f.min || 25, count: f.count || 0, subject: f.subject || undefined };
    log('info', 'restored the ' + f.phase + ' session after the reload');
    return true;
  } catch (e) { return false; }
}
const fmtLeft = ms => { const s = Math.ceil(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) : Math.floor(s / 60)) + ':' + pad(s % 60); };
function startFocus(min) {
  stopFocus(true);
  min = clamp(Math.round(min || settings.focusMin || 25), 1, 180);
  const saved = store.get('jarvis.focusToday', { d: '', n: 0 });
  const count = saved.d === new Date().toDateString() ? saved.n : 0;
  focus = { phase: 'focus', end: Date.now() + min * 6e4, min, count };
  saveFocus();
  return min;
}
function stopFocus(silent) {
  if (!focus) return false;
  focus = null; $('#focusStat').hidden = true; saveFocus();
  if (!silent) log('info', 'focus session stopped');
  return true;
}
function focusTick(now) {
  const el = $('#focusStat');
  if (!focus) return;
  const left = focus.end - now;
  el.hidden = false;
  el.textContent = (focus.phase === 'focus' ? '● FOCUS ' : '☕ BREAK ') + fmtLeft(Math.max(0, left)) + ' · #' + (focus.count + (focus.phase === 'focus' ? 1 : 0));
  if (left > 0) return;
  sfx.alarm();
  if (focus.phase === 'focus') {
    focus.count++;
    logSession(focus.min, focus.subject);
    bumpStat('focusMin', focus.min); bumpStat('focusSessions');
    store.set('jarvis.focusToday', { d: new Date().toDateString(), n: focus.count });
    const b = clamp(+settings.breakMin || 5, 1, 60);
    focus.phase = 'break'; focus.end = now + b * 6e4; saveFocus();
    notify('Focus session complete', 'Take a ' + b + '-minute break.');
    jarvisSay({ text: 'Focus session ' + focus.count + ' complete, ' + Persona.sir() + '. Well done. I would recommend a ' + b + '-minute break — stretch, and perhaps some water.', intent: 'FOCUS', tool: 'focus' });
  } else {
    const n = focus.count; stopFocus(true);
    notify('Break over', 'Ready for the next focus session?');
    jarvisSay({ text: 'Break is over, ' + Persona.sir() + '. That makes ' + plural(n, 'session') + ' today. Shall we go another round?', intent: 'FOCUS', suggestions: ['Start a focus session', 'What is on my to-do list?'] });
  }
}

/* ============ tasks: todos, reminders, deadlines, timetable ============ */
let notifAsked = false;
function askNotify() {
  if (notifAsked || !('Notification' in window) || Notification.permission !== 'default') return;
  notifAsked = true; Notification.requestPermission().catch(() => {});
}
function notify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('JARVIS — ' + title, { body }); } catch (e) {}
}
function nextClassTime(c, from) {
  const d = new Date(from); d.setHours(c.h, c.m, 0, 0);
  let diff = (c.day - d.getDay() + 7) % 7;
  if (diff === 0 && d <= from) diff = 7;
  d.setDate(d.getDate() + diff);
  return d;
}
function upcomingClasses(now) {
  return classes.map(c => ({ c, at: nextClassTime(c, now) })).sort((a, b) => a.at - b.at);
}
const announced = new Set();
// With two tabs open both run the same checks and would both say the same thing. An alert is CLAIMED first: the server gives it to the first tab that asks (for ttlSec
// seconds) and the other tabs stay quiet. If the server cannot be reached the tab just says it (better twice than never).
async function claimAlert(key, ttlSec) {
  try {
    const r = await fetch('api/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, ttlSec: Math.round(ttlSec) || 3600 }) });
    if (!r.ok) return true;
    const j = await r.json(); return j.won !== false;
  } catch (e) { return true; }
}
/* ---- phone commands (ntfy), only after the server checked an authenticator unlock (scheduler.js) ---- */
// Everyday commands work as on the laptop. Replies travel through ntfy's public server, so nothing that would send
// your screen, clipboard, files or saved memory; shutdown/restart/sleep/delete stay at the laptop (explicit tier);
// of the permission-needing (confirm) actions, only closing apps and blocking distractions are allowed.
const PHONE_DENY = new Set(['SCREEN_READ', 'SCREEN_EXPLAIN', 'CLIPBOARD_IMAGE_READ', 'SCREENSHOT', 'CLIP_HISTORY', 'CLIP_TOOL', 'CLIP_TRANSFORM',
  'EXPLAIN_CLIPBOARD', 'READ_CLIPBOARD', 'WRITE_CLIPBOARD', 'CLIPBOARD_TO_FILE', 'PASTE_TO_EDITOR', 'COPY_CONTENT', 'SUMMARISE_LINK', 'SUMMARISE_FILE',
  'READ_FILE', 'LIST_FILES', 'SEARCH_FILES', 'ASK_FILES', 'UNDO', 'DELETE_LAST_MSG', 'WRITE_FILE', 'RENAME_FILE', 'COPY_FILE', 'MOVE_FILE', 'SNIPPET_COPY', 'SNIPPET_SAVE', 'RECALL_NAME', 'RECALL_ALL', 'RUN_FILE']);
const PHONE_CONFIRM_OK = new Set(['CLOSE_APPLICATION', 'BLOCK_DISTRACTIONS', 'CODE_ASK']);
let phoneQueue = Promise.resolve();
const phonePlain = t => String(t || '').replace(/```[\s\S]*?```/g, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
async function handlePhone(text) {
  if (!text) return;
  while (busy) await sleep(300); // let a command typed on the laptop finish first
  busy = true;
  addMsg('user', text, { source: 'phone' }); logChat('user', text, '', 'phone');
  let reply;
  approvalsBlocked++;   // nobody at the laptop to approve changes outside ~/jarvis
  try {
    const norm = NLU.normalize(text, settings.wakeWord);
    const p = NLU.classify(norm, {}); p.original = norm.original; // fresh context: no "close it" follow-ups from the laptop
    const routine = typeof Routines !== 'undefined' && Routines.match(norm.text);
    const refuse = msg => { reply = msg; jarvisSay({ text: '📱 ' + msg, intent: 'PHONE', noTTS: true, noPersona: true }); };
    const tier = Agent.tierFor(p.intent, p.text)[0];
    if (routine) {
      const r = await Routines.run(routine); // unattended: only the routine's no-permission steps run
      reply = phonePlain(r && r.text) || 'Done.';
      if (r) jarvisSay(Object.assign({}, r, { noTTS: true }));
    } else if (p.intent === 'CONVERSATION' || p.confidence < 0.85) {
      const ai = llmReady() ? await askLLM(text, { noTools: true }) : null;
      if (ai && ai.text) { logChat('assistant', ai.text, ai.meta); reply = ai.text; } else reply = 'The local AI isn’t available right now.';
    } else if (PHONE_DENY.has(p.intent)) {
      refuse('Not from the phone — that would send your screen, clipboard, files or saved memory through ntfy.');
    } else if (tier === 'explicit') {
      refuse('Shutdown, restart, sleep and deleting only work at the laptop.');
    } else if (tier === 'confirm' && !PHONE_CONFIRM_OK.has(p.intent)) {
      refuse('That needs you at the laptop (it asks for permission there).');
    } else if (tier !== 'safe' && tier !== 'confirm') {
      refuse('I can’t run that from the phone.');
    } else {
      const before = ctx.pending;
      const r = await executeTool(p, text);
      const askedFollowUp = ctx.pending !== before; ctx.pending = before;
      const one = Array.isArray(r) ? r[0] : r;
      if (one && one.confirm) {
        // Closing apps / blocking distractions: the authenticator unlock is the approval.
        await one.confirm.onConfirm();
        reply = 'Done — ' + phonePlain(one.text).replace(/\?\s*$/, '.');
      } else reply = phonePlain(one && one.text) || 'Done.';
      if (askedFollowUp) reply += ' (Send it again as one message with the details, e.g. "remind me to call mom at 6pm".)';
      if (one && !one.confirm) jarvisSay({ text: one.text || reply, intent: p.intent, tool: one.tool, noTTS: true });
    }
  } catch (e) { reply = 'Something went wrong: ' + e.message; }
  finally { busy = false; idleState(); approvalsBlocked--; }
  const sent = await callTool('/phone/reply', { text: phonePlain(reply).slice(0, 1500) });
  if (sent.error) log('warn', 'could not reply to the phone: ' + sent.error);
}
// With shared server storage, the server fires reminders and deadline alerts (scheduler.js) — even with no tab
// open — and this page only displays them (see the EventSource below). Scheduled routines still fire here.
const serverScheduler = !!window.JARVIS_STATE;
function tasksTick(now) {
  let changed = false;
  for (const r of reminders) {
    if (serverScheduler && !r.routineId) continue;
    if (!r.fired && r.at <= now) {
      changed = true;
      if (r.repeat) r.at = nextOccurrence(r, now); else r.fired = true;
      if (r.routineId && typeof Routines !== 'undefined') { log('ok', 'scheduled routine: ' + r.text); Routines.runById(r.routineId); continue; }
      if (r.kind === 'tenders' && typeof Tenders !== 'undefined') { log('ok', 'tender digest'); Tenders.digest(r); continue; }
      sfx.alarm(); toast('⏰ ' + r.text, true); notify('Reminder', r.text);
      log('ok', 'reminder fired: ' + r.text);
      jarvisSay({ text: '⏰ ' + Persona.Sir() + ', you asked me to remind you: **' + r.text + '**.', speak: Persona.Sir() + ', you asked me to remind you: ' + r.text.replace(/\s—\shttps?:\/\/\S+/, ''), intent: 'REMINDER', tool: 'remind' });
    }
  }
  for (const { c, at } of upcomingClasses(new Date(now))) {
    const mins = (at - now) / 6e4, key = c.id + at.toDateString();
    if (mins <= 10 && mins > 9 && !announced.has(key)) {
      announced.add(key);
      claimAlert('class:' + key, 1800).then(won => {
        if (!won) return;
        toast('📚 ' + c.name + ' starts in 10 minutes', true); notify('Class soon', c.name + ' at ' + fmtTime(at));
        jarvisSay({ text: Persona.Sir() + ', **' + c.name + '** begins in ten minutes, at ' + fmtTime(at) + '.', intent: 'TIMETABLE' });
      });
    }
  }
  try { if (typeof Student !== 'undefined' && Student.attendanceTick) Student.attendanceTick(now); } catch (e) {}
  try { if (typeof Life !== 'undefined' && Life.recurTick) Life.recurTick(now); } catch (e) {}
  if (changed) saveTasks();
}
setInterval(() => {
  const now = Date.now();
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i], left = tm.end - now;
    if (left <= 0) {
      timers.splice(i, 1); tm.el.remove(); dropTimerReminder(tm); sfx.alarm(); log('ok', 'timer complete: ' + tm.label);
      notify('Timer', tm.label + ' timer finished');
      jarvisSay({ text: Persona.Sir() + ', your **' + tm.label + '** timer is up.', speak: Persona.Sir() + ', your ' + tm.label + ' timer is up.', intent: 'TIMER_DONE' });
    } else tm.el.textContent = '⏱ ' + tm.label + ' ' + fmtLeft(left);
  }
  focusTick(now);
  tasksTick(now);
}, 500);
restoreTimers(); restoreFocus();
if (serverScheduler && 'EventSource' in window) {
  const events = new EventSource('api/events');
  events.addEventListener('reminder', e => {
    const ev = JSON.parse(e.data);
    const r = reminders.find(x => x.id === ev.id);
    if (r) { r.at = ev.at; r.fired = ev.fired; saveTasks(); }
    if (!ev.lead) return; // only one open tab announces it
    if (ev.digest) { sfx.alarm(); jarvisSay({ text: ev.text, intent: 'WEEK_REPORT', noTTS: true }); return; } // the Sunday weekly summary
    if (r && r.kind === 'tenders' && typeof Tenders !== 'undefined') { log('ok', 'tender digest'); Tenders.digest(r); return; }   // the daily KPPP digest (tenders-page.js)
    sfx.alarm(); toast('⏰ ' + ev.text, true); notify('Reminder', ev.text);
    log('ok', 'reminder fired: ' + ev.text);
    jarvisSay({ text: '⏰ ' + Persona.Sir() + ', you asked me to remind you: **' + ev.text + '**.', speak: Persona.Sir() + ', you asked me to remind you: ' + ev.text.replace(/\s—\shttps?:\/\/\S+/, ''), intent: 'REMINDER', tool: 'remind' });
  });
  // The chat was changed in another tab of this same JARVIS: show it here too (never written back, so tabs can't ping-pong).
  // Waits for a reply in progress to finish, so a half-typed answer isn't wiped.
  // The same goes for the lists (todos, deadlines, classes, attendance, marks, study plans, memory, reminders, expenses, habits, budget): another tab or the phone page saved a
  // change, so this tab takes the new copy instead of later writing its old one back over it. Never written back, and skipped if this tab has a save of its own in flight.
  const SYNCED = {
    'jarvis.todos': v => { todos = v; }, 'jarvis.reminders': v => { reminders = v; }, 'jarvis.deadlines': v => { deadlines = v; }, 'jarvis.classes': v => { classes = v; },
    'jarvis.attendance': v => { attendance = v || {}; }, 'jarvis.marks': v => { marks = v || []; }, 'jarvis.studyPlans': v => { studyPlans = v; }, 'jarvis.memory': v => { memory = v; },
    'jarvis.expenses': () => {}, 'jarvis.habits': () => {}, 'jarvis.budget': () => {},       // read from the store each time they are used
  };
  // A backup was restored or imported (from this tab or another one): everything on screen is out of date, so reload rather than risk writing the old copy back.
  events.addEventListener('statereset', () => { toast('Your data was replaced by a restore or import — reloading…', true); setTimeout(() => location.reload(), 1500); });
  store.onMerged = (key, value) => { const take = SYNCED[key]; if (!take) return; take(value); try { renderTasks(); if (key === 'jarvis.memory' && typeof renderMemory === 'function') renderMemory(); if (typeof renderDash === 'function') renderDash(); if (typeof Routines !== 'undefined') Routines.render(); } catch (err) { /* a panel that is not drawn yet */ } };
  events.addEventListener('state', e => {
    const ev = JSON.parse(e.data), take = SYNCED[ev.key];
    if (!take || ev.src === TAB_ID) return;
    if (ev.value === null && !/budget/.test(ev.key)) return;
    if (/memory|todos|reminders|deadlines|classes|studyPlans|expenses|habits/.test(ev.key) && !Array.isArray(ev.value)) return;
    if (!store.adopt(ev.key, ev.value)) return;
    take(ev.value);
    try { renderTasks(); if (ev.key === 'jarvis.memory' && typeof renderMemory === 'function') renderMemory(); if (typeof renderDash === 'function') renderDash(); if (typeof Routines !== 'undefined') Routines.render(); } catch (err) { /* a panel that is not drawn yet */ }
  });
  events.addEventListener('state', e => {
    const ev = JSON.parse(e.data);
    if (ev.key !== 'jarvis.chat' || ev.src === TAB_ID || !Array.isArray(ev.value)) return;
    const apply = () => {
      if (busy || pumping || replyQ.length) return setTimeout(apply, 1000);
      if (!store.adopt('jarvis.chat', ev.value)) return;
      chatLog = store.get('jarvis.chat', []); restoreChat();
    };
    apply();
  });
  // Service watchdog (watchdog.js): something you watch went down, or came back. Only the leading tab says it.
  events.addEventListener('watchdog', e => {
    const ev = JSON.parse(e.data);
    if (!ev.lead) return;
    const mins = Math.max(1, Math.round((ev.downForMs || 0) / 60000));
    const down = ev.status === 'down';
    const text = down ? '🔴 **' + ev.label + '** has stopped answering, ' + Persona.sir() + '.' : '🟢 **' + ev.label + '** is back up' + (ev.downForMs ? ' after ' + plural(mins, 'minute') : '') + '.';
    sfx.alarm(); toast((down ? '🔴 ' : '🟢 ') + ev.label + (down ? ' is down' : ' is back up'), true); notify('JARVIS watchdog', ev.label + (down ? ' is down' : ' is back up'));
    jarvisSay({ text, speak: ev.label.replace(/[:.]/g, ' ') + (down ? ' is down.' : ' is back up.'), intent: 'WATCHDOG', noPersona: true });
    log(down ? 'warn' : 'ok', 'watchdog: ' + ev.label + (down ? ' is down' : ' is back up'));
  });
  // Ctrl+Shift+J pressed in another app: the selected text arrives here (see hotkey.js).
  events.addEventListener('hotkey', e => {
    const ev = JSON.parse(e.data);
    if (ev.lead) HotkeyBar.show(ev.text || '', !!ev.truncated);
  });
  // "Jarvis" heard by the Windows listener while this page is in the background (wakeword.js): bring the JARVIS
  // window forward; once it's in front, the page asks "Yes, sir?" and takes the command (visibility/focus handlers).
  events.addEventListener('wake', async e => {
    const ev = JSON.parse(e.data);
    if (!ev.lead || !wakeOn) return;
    if (!document.hidden && document.hasFocus()) return;   // in front: the browser listener already handles it
    nativeWakeAt = Date.now(); sfx.wake();
    log('ok', 'wake word heard while you were in another tab/app (“' + ev.text + '”, ' + Math.round(ev.conf * 100) + '%)');
    const r = await callTool('/wake/front', {});
    if (r.result !== 'front') {
      // No JARVIS window to bring forward (e.g. a background tab in a browser window showing another tab).
      try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification('JARVIS — I heard you', { body: 'Click here, then say your command.' }); n.onclick = () => { window.focus(); n.close(); }; } } catch (x) {}
      toast('I heard “' + settings.wakeWord + '” — switch to JARVIS and say your command', true);
    }
    if (!document.hidden && document.hasFocus()) wakePageBack();
  });
  // A trigger fired on the server (charger, app, Wi-Fi…): one tab runs the routine.
  events.addEventListener('trigger', e => {
    const ev = JSON.parse(e.data);
    if (!ev.lead) return;
    sfx.alarm(); log('ok', 'trigger: ' + ev.text);
    jarvisSay({ text: ev.text, intent: 'TRIGGER', noTTS: true });
    if (typeof Routines !== 'undefined') Routines.runById(ev.routineId);
  });
  // Charger plugged in / unplugged (announced by the server, needs no trigger): one tab says it out loud.
  events.addEventListener('charger', e => {
    const ev = JSON.parse(e.data);
    if (!ev.lead || settings.chargerAlerts === false) return;
    const line = ev.plugged ? 'Charger connected' : 'Charger disconnected';
    const detail = typeof ev.battery === 'number' ? ' — battery at ' + ev.battery + '%' : '';
    sfx.wake(); toast('🔌 ' + line + detail, true); notify('Charger', line + detail.replace(' — ', ', '));
    log('ok', 'charger: ' + line + detail);
    jarvisSay({ text: '🔌 **' + line + '**' + detail + '.', speak: line + ', ' + Persona.Sir() + '.', intent: 'CHARGER_ALERTS' });
  });
  // A message from the phone (via the ntfy topic): handled by one tab, reply goes back to the phone.
  events.addEventListener('phone', e => {
    const ev = JSON.parse(e.data);
    if (ev.lead) phoneQueue = phoneQueue.then(() => handlePhone(String(ev.text || ''))).catch(err => log('warn', 'phone message: ' + err.message));
  });
  events.addEventListener('deadline', e => {
    const ev = JSON.parse(e.data);
    if (!ev.lead) return;
    const hrs = Math.max(1, Math.round((ev.due - Date.now()) / 36e5));
    sfx.wake(); toast('⏳ ' + ev.title + ' is due soon', true); notify('Heads up', ev.title + ' is due at ' + fmtTime(ev.due));
    jarvisSay({ text: '⏳ **' + ev.title + '** is due at ' + fmtTime(ev.due) + ' — about ' + hrs + 'h left.', intent: 'ALERT', alert: true, suggestions: ['Start a focus session', 'Block distractions'] });
  });
}

function dueClass(due) {
  const h = (due - Date.now()) / 36e5;
  return h < 0 ? 'past' : h < 24 ? 'urgent' : h < 72 ? 'soon' : '';
}
function dueLabel(due) {
  const h = (due - Date.now()) / 36e5;
  if (h < 0) return 'overdue';
  if (h < 24 && new Date(due).toDateString() === new Date().toDateString()) return 'today';
  return fmtDay(due);
}
// "Ask about this selection" bar for the global hotkey: pick what to do with the text you selected in another app.
const HotkeyBar = (() => {
  let el = null, sel = '', timer = null;
  const ACTIONS = [
    ['Explain', 'Explain this clearly and briefly:\n\n', false], ['Summarise', 'Summarise this in a few bullet points:\n\n', false],
    ['Rewrite', 'Rewrite this so it reads better, keeping the meaning. Reply with only the rewritten text.\n\n', true],
    ['Translate', 'Translate this to English (or, if it is already English, to Telugu). Reply with only the translation.\n\n', true],
    ['Fix code', 'Fix any bugs in this code and reply with only the corrected code.\n\n', true],
  ];
  function ensure() {
    if (el) return;
    el = document.createElement('div'); el.id = 'hkBar'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Ask about the selected text');
    el.innerHTML = '<div class="hk-head"><b>Selected text</b><button class="hk-x" aria-label="Close" type="button">✕</button></div><div class="hk-sel"></div><div class="hk-acts"></div><div class="hk-ask"><input type="text" placeholder="Or ask something about it…" maxlength="300"><button class="btn" type="button">ASK</button></div>';
    document.body.appendChild(el);
    el.querySelector('.hk-x').onclick = hide;
    const acts = el.querySelector('.hk-acts');
    for (const [label, pre, copy] of ACTIONS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'hk-act'; b.textContent = label; b.onclick = () => run(label, pre, copy); acts.appendChild(b); }
    const inp = el.querySelector('.hk-ask input'), go = () => { if (inp.value.trim()) run('Ask', inp.value.trim() + '\n\nText:\n\n', false, inp.value.trim()); };
    el.querySelector('.hk-ask .btn').onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open')) hide(); });
  }
  function hide() { if (el) el.classList.remove('open'); clearTimeout(timer); }
  function show(text, truncated) {
    ensure(); sel = text;
    const box = el.querySelector('.hk-sel');
    box.textContent = text ? (text.length > 260 ? text.slice(0, 260) + '…' : text) : 'Nothing was selected — type a question below, or select text and press Ctrl+Shift+J again.';
    box.classList.toggle('empty', !text);
    el.querySelectorAll('.hk-act').forEach(b => { b.disabled = !text; });
    el.classList.add('open'); sfx.ok(); clearTimeout(timer); timer = setTimeout(hide, 90000);
    if (truncated) toast('Selection was long — using the first 8000 characters');
    setTimeout(() => el.querySelector('.hk-ask input').focus(), 50);
  }
  async function run(label, pre, copy, question) {
    if (!llmReady()) { toast('The AI brain is off or unreachable — check Settings', true); return; }
    if (busy) { toast('JARVIS is busy — try again in a moment'); return; }
    hide();
    if (!(await confirmCloud('selection'))) { busy = false; idleState(); toast('Okay — nothing was sent'); return; }      // the card leaves JARVIS "busy"; hand it back
    busy = true;
    try {
      const shown = sel.length > 140 ? sel.slice(0, 140) + '…' : sel;
      addMsg('user', '⌨ ' + (question ? question + ' — ' : label + ': ') + shown, { source: 'hotkey' }); logChat('user', label + ' (selected text)', '', 'hotkey');
      setState('PROCESSING', 'Thinking…');
      const ai = await askLLM(pre + sel, { noTools: true, noHistory: true, limitText: question || '' });
      if (ai && ai.delivered) idleState();
      else if (ai) await finishAIAnswer(ai, copy ? { copyAnswer: true } : undefined, { intent: 'CONVERSATION', confidence: 1 });
      else await deliver({ text: 'I could not reach my AI brain.' }, { intent: 'UNKNOWN' });
    } catch (e) { jarvisSay({ text: 'Something went wrong: ' + e.message, intent: 'ERROR' }); }
    finally { busy = false; idleState(); }
  }
  return { show, hide };
})();
// Triggers list (Tasks tab): each with an on/off switch and delete.
function renderTriggers() {
  const el = document.getElementById('triggerList'); if (!el) return;
  el.innerHTML = triggers.length ? '' : '<div class="tempty">None yet — try "when I plug in my charger, start study mode".</div>';
  triggers.forEach(t => {
    const d = document.createElement('div'); d.className = 'titem' + (t.enabled === false ? ' done' : '');
    d.innerHTML = '<button class="check" title="On / off" aria-label="Turn trigger on or off"></button><span class="tx"></span><button class="x" title="Delete">✕</button>';
    d.querySelector('.tx').textContent = t.label + ' → ' + t.routineName;
    d.querySelector('.check').onclick = () => { t.enabled = t.enabled === false; saveTriggers(); };
    d.querySelector('.x').onclick = () => { undoRemoved('deleted trigger', () => triggers, v => { triggers = v; }, saveTriggers, removedFrom(triggers, x => x !== t)); triggers = triggers.filter(x => x !== t); saveTriggers(); };
    el.appendChild(d);
  });
}
// Progress: 7-day focus chart, streak, per-subject time and the active study plan (Tasks tab).
function renderDash() {
  const box = document.getElementById('dashBox'); if (!box || typeof Study === 'undefined') return;
  const w = Study.weekSummary(stats, sessions, todayKey());
  const max = Math.max(30, ...w.days.map(d => d.focusMin));
  const bars = w.days.map((d, i) => { const h = Math.round(d.focusMin / max * 44); return '<g><rect x="' + (i * 30 + 4) + '" y="' + (50 - h) + '" width="22" height="' + Math.max(h, d.focusMin ? 2 : 1) + '" rx="3" class="' + (d.key === todayKey() ? 'today' : '') + '"><title>' + escHtml(d.label + ': ' + Study.fmtMin(d.focusMin)) + '</title></rect><text x="' + (i * 30 + 15) + '" y="60" text-anchor="middle">' + escHtml(d.label.slice(0, 2)) + '</text></g>'; }).join('');
  const subj = w.subjects.slice(0, 3).map(x => '<span>' + escHtml(x.subject) + ' <b>' + Study.fmtMin(x.min) + '</b></span>').join('');
  const today = Study.ymd(new Date());
  const plan = studyPlans.filter(x => x.examDate >= today).sort((x, y) => x.examDate < y.examDate ? -1 : 1)[0];
  let planHtml = '';
  if (plan) {
    const done = plan.days.filter(d => d.done).length, day = plan.days.find(d => d.date === today), left = Study.daysBetween(new Date(), new Date(plan.examDate + 'T00:00:00'));
    planHtml = '<div class="dash-plan"><div><b>' + escHtml(plan.name) + '</b> · exam in ' + plural(left, 'day') + '</div><div class="dash-bar"><i style="width:' + Math.round(100 * done / plan.days.length) + '%"></i></div><div class="dash-sub">' + done + '/' + plan.days.length + ' days done' +
      (day ? ' · today: ' + escHtml(day.topic) + ' <button class="linkbtn" id="dashDone" type="button">' + (day.done ? 'UNDO' : 'MARK DONE') + '</button>' : '') + '</div></div>';
  }
  box.innerHTML = '<div class="dash-top"><span>🔥 <b>' + w.totals.streak + '</b> day streak</span><span><b>' + Study.fmtMin(w.totals.focusMin) + '</b> focused this week</span></div>' +
    '<svg class="dash-chart" viewBox="0 0 210 64" role="img" aria-label="Focus minutes, last 7 days">' + bars + '</svg>' + (subj ? '<div class="dash-subj">' + subj + '</div>' : '') + planHtml;
  const b = document.getElementById('dashDone');
  if (b) b.onclick = () => { const d = plan.days.find(x => x.date === today); d.done = !d.done; if (d.done) sfx.ok(); saveStudyPlans(); };
}
function renderTasks() {
  renderDash(); renderTriggers();
  const pend = todos.filter(t => !t.done);
  $('#todoMeta').textContent = todos.length ? pend.length + ' left' : '';
  const tl = $('#todoList'); tl.innerHTML = '';
  if (!todos.length) tl.innerHTML = '<div class="tempty">Nothing yet — try "add revise graphs to my list".</div>';
  todos.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'titem' + (t.done ? ' done' : '');
    d.innerHTML = '<span class="num">' + (i + 1) + '</span><button class="check" title="Toggle done" aria-label="Toggle done"></button><span class="tx"></span><button class="x" title="Delete">✕</button>';
    d.querySelector('.tx').textContent = t.text;
    d.querySelector('.check').addEventListener('click', () => { t.done = !t.done; if (t.done) { sfx.ok(); bumpStat('todosDone'); } saveTasks(); });
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted to-do', () => todos, v => { todos = v; }, saveTasks, removedFrom(todos, x => x !== t)); todos = todos.filter(x => x !== t); saveTasks(); });
    tl.appendChild(d);
  });
  const dl = $('#deadlineList'); dl.innerHTML = '';
  const ds = deadlines.filter(d => !d.done).sort((a, b) => a.due - b.due);
  if (!ds.length) dl.innerHTML = '<div class="tempty">No deadlines — try "add assignment OS lab due Friday".</div>';
  ds.forEach(dd => {
    const d = document.createElement('div'); d.className = 'titem';
    d.innerHTML = '<button class="check" title="Mark submitted"></button><span class="tx"></span><span class="due ' + dueClass(dd.due) + '">' + escHtml(dueLabel(dd.due)) + '</span><button class="x" title="Delete">✕</button>';
    const lt = linkedTodos(dd);
    d.querySelector('.tx').textContent = dd.title + (dd.repeat === 'weekly' ? ' ↻' : '') + (lt.length ? ' · ' + lt.filter(t => t.done).length + '/' + lt.length + ' done' : '');
    d.querySelector('.check').addEventListener('click', () => { completeDeadline(dd); sfx.ok(); bumpStat('deadlinesDone'); toast('Nice — "' + dd.title + '" marked done'); saveTasks(); });
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted deadline', () => deadlines, v => { deadlines = v; }, saveTasks, removedFrom(deadlines, x => x !== dd)); deadlines = deadlines.filter(x => x !== dd); saveTasks(); });
    dl.appendChild(d);
  });
  const rl = $('#reminderList'); rl.innerHTML = '';
  const rs = reminders.filter(r => !r.fired && !r.routineId && !r.timerId).sort((a, b) => a.at - b.at);
  if (!rs.length) rl.innerHTML = '<div class="tempty">No reminders — try "remind me to drink water in 30 minutes".</div>';
  rs.forEach(r => {
    const d = document.createElement('div'); d.className = 'titem';
    d.innerHTML = '<span class="tx"></span><span class="due">' + (r.repeat ? '↻ ' : '') + escHtml(r.repeat ? describeRepeat(r.repeat, r.at) :fmtDay(r.at) + ' ' + fmtTime(r.at)) + '</span><button class="x" title="Cancel">✕</button>';
    d.querySelector('.tx').textContent = r.text;
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted reminder', () => reminders, v => { reminders = v; }, saveTasks, removedFrom(reminders, x => x !== r)); reminders = reminders.filter(x => x !== r); saveTasks(); });
    rl.appendChild(d);
  });
  const cl = $('#classList'); cl.innerHTML = '';
  if (!classes.length) cl.innerHTML = '<div class="tempty">No classes — try "add class DBMS on Monday and Wednesday at 10am".</div>';
  classes.slice().sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.h - b.h || a.m - b.m).forEach(c => {
    const d = document.createElement('div'); d.className = 'titem';
    const t = new Date(); t.setHours(c.h, c.m);
    d.innerHTML = '<span class="tx"></span><span class="due">' + NLU.DAYS[c.day].slice(0, 3).toUpperCase() + ' ' + escHtml(fmtTime(t)) + '</span><button class="x" title="Delete">✕</button>';
    d.querySelector('.tx').textContent = c.name;
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted class', () => classes, v => { classes = v; }, saveTasks, removedFrom(classes, x => x !== c)); classes = classes.filter(x => x !== c); saveTasks(); });
    cl.appendChild(d);
  });
  const al = $('#attList'); al.innerHTML = '';
  const attNames = Object.keys(attendance);
  $('#attMeta').textContent = attNames.length ? attMin() + '% required' : '';
  if (!attNames.length) al.innerHTML = '<div class="tempty">No attendance yet — try "mark DBMS present" after class.</div>';
  attNames.sort((a, b) => (Study.attendancePct(attendance[a].held, attendance[a].attended) || 0) - (Study.attendancePct(attendance[b].held, attendance[b].attended) || 0)).forEach(n => {
    const e = attendance[n], pct = Study.attendancePct(e.held, e.attended);
    const d = document.createElement('div'); d.className = 'titem';
    const w = Math.max(4, Math.min(100, Math.round(pct)));
    d.innerHTML = '<span class="tx"></span><span class="due ' + (pct < attMin() ? 'soon' : '') + '">' + pct + '%</span><button class="x" title="Stop tracking">✕</button><div class="att-bar"><i style="width:' + w + '%" class="' + (pct < attMin() ? 'low' : '') + '"></i></div>';
    d.querySelector('.tx').textContent = n + ' (' + e.attended + '/' + e.held + ')';
    d.title = Study.bunkable(e.held, e.attended, attMin()) + ' bunks still safe';
    d.querySelector('.x').addEventListener('click', () => {
      const snap = attendance[n];
      Undo.push('stopped tracking ' + n, () => { attendance[n] = snap; saveTasks(); return 'Tracking ' + n + ' again.'; });
      delete attendance[n]; saveTasks();
    });
    al.appendChild(d);
  });
  const ml = $('#marksList'); ml.innerHTML = '';
  $('#marksMeta').textContent = marks.length ? 'CGPA ' + Study.cgpa(marks) : '';
  if (!marks.length) ml.innerHTML = '<div class="tempty">No results yet — try "add S3: 8.6 gpa, 24 credits".</div>';
  marks.slice().sort((a, b) => a.ts - b.ts).forEach(m => {
    const d = document.createElement('div'); d.className = 'titem';
    d.innerHTML = '<span class="tx"></span><span class="due">' + m.gpa + ' · ' + m.credits + ' cr</span><button class="x" title="Delete">✕</button>';
    d.querySelector('.tx').textContent = m.title;
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted ' + m.title + ' result', () => marks, v => { marks = v; }, saveTasks, removedFrom(marks, x => x !== m)); marks = marks.filter(x => x !== m); saveTasks(); });
    ml.appendChild(d);
  });
  $('#taskCount').textContent = pend.length + ds.length + rs.length;
  setEngine('mem', 'on', memory.length + ' facts · ' + pend.length + ' to-dos · ' + ds.length + ' due');
}
function addTodoText(text) {
  text = cap(String(text).trim().replace(/\.$/, ''));
  if (!text) return null;
  todos.push({ id: rid(), text, done: false, ts: Date.now() }); saveTasks(); pulse('mem');
  return text;
}
$('#todoAddBtn').addEventListener('click', () => { const v = $('#todoInput').value; if (addTodoText(v)) { $('#todoInput').value = ''; sfx.ok(); } });
$('#todoInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#todoAddBtn').click(); });

/* ============ replies: conversation ============ */
const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'There are 10 kinds of people: those who understand binary, and those who do not.',
  'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
  'Why did the developer go broke? Because he used up all his cache.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why was the JavaScript developer sad? Because he did not Node how to Express himself.',
  'Recursion: see "Recursion".',
  'My code does not work and I have no idea why. My code works and I have no idea why. The two states of a CS student.',
  'Why do Java developers wear glasses? Because they do not C#.',
  'An optimist says the glass is half full. A pessimist says it is half empty. A programmer says the glass is twice as large as it needs to be.'
];
const HELP_TEXT = `Just talk normally — I understand loose phrasing${'{AI}'}. A few ideas:
- **Apps & web** — "fire up VS Code", "close it", "play lofi on YouTube", "search GFG for heap sort", "open amazon.com"
- **Study** — "start a focus session", "add assignment OS lab due Friday", "when's my next class?", "quiz me on DBMS"
- **To-dos & reminders** — "add revise graphs to my list", "remind me to submit the form at 5pm", "mark 2 done"
- **Code help** — "explain the code in my clipboard", "time complexity of merge sort", "write a python function to reverse a linked list"
- **Code → file → run** — "save that code as bfs.py", "run it", "open it in VS Code", "paste that code into my editor", "write a C++ bubble sort and save it as sort.cpp and run it"
- **Clipboard & snippets** — "fix the code in my clipboard and copy it back", "paste my clipboard into notes.md", "format the JSON in my clipboard", "save my clipboard as snippet dfs", "copy snippet dfs"
- **Web** — "open SIH 2026 problem statements" (opens the best page), "search the web for …" (answers with sources), "upcoming contests", "remind me about the next Codeforces round", "upcoming hackathons"
- **Study tools** — "plan my day", "summarise dbms.md", "make flashcards on normalization", "review my flashcards"
- **Drafts** — "write a leave email to my professor and copy it", "clone https://github.com/user/repo"
- **Focus** — "block distractions", "how productive was I today?", "remind me every weekday at 8am to review notes", "show desktop"
- **CS tools** — "255 to binary", "0x1F in decimal", "1.5 GB to MB", "ascii of A", "12 xor 7"
- **Files (~/jarvis)** — "take a note: revise recursion", "list my files", "read notes"
- **System** — "how's my system?", "battery", "screenshot", "volume up", "lock the screen", "is port 3000 free?"
- **Weather & facts** — "weather in Bengaluru", "who invented Linux?" (turn on Online tools)`;

function conversationReply(p) {
  const nm = memGet('name');
  const h = new Date().getHours();
  switch (p.intent) {
    case 'PRESENCE': return { text: Persona.say('presence') };
    case 'GREETING': {
      const due = deadlines.filter(d => !d.done && d.due - Date.now() < 48 * 36e5 && d.due > Date.now());
      const next = classes.length ? upcomingClasses(new Date())[0] : null;
      let extra = '';
      if (due.length) extra = ' A reminder: **' + due[0].title + '** is due ' + dueLabel(due[0].due) + '.';
      else if (next && next.at - Date.now() < 3 * 36e5) extra = ' Your next class, **' + next.c.name + '**, is at ' + fmtTime(next.at) + '.';
      // "good evening" gets an evening reply whatever the clock says; plain "hi" uses the time of day
      const said = (String(p.original || '').toLowerCase().match(/good\s+(morning|afternoon|evening)/) || [])[1];
      return { text: (said ? Persona.say(said) : Persona.greeting(h)) + extra + (extra || Math.random() < .5 ? ' How may I help?' : '') };
    }
    case 'HOW_ARE_YOU': return { text: Persona.say('howareyou', { cpu: sys.cpu }), noLocalize: true };
    case 'IDENTITY': {
      const friday = settings.persona === 'friday';
      return { text: Persona.say('identity', { name: friday ? 'F.R.I.D.A.Y.' : 'J.A.R.V.I.S.', expansion: friday ? 'your personal AI, successor to JARVIS' : 'Just A Rather Very Intelligent System',
        model: llmReady() ? ', thinking with **' + llm.model + '**' : '' }), noLocalize: true };
    }
    case 'JOKE': return { text: pick(JOKES) + (Lang.replyLang() === 'en' && Math.random() < .5 ? ' I will be here all week, ' + Persona.sir() + '.' : '') };
    case 'THANKS': return { text: Persona.say('thanks') };
    // "don't lock the screen", "never open chrome": nothing is done — and nothing opposite either.
    case 'NEGATED': { const what = [p.args.verb, p.args.rest].filter(Boolean).join(' ').replace(/\bmy\b/g, 'your'); return { text: 'Okay — I won’t ' + what + '.', noTTS: false }; }
    case 'GOODBYE': return { text: Persona.say('bye') };
    case 'GOODNIGHT': return { text: Persona.say('night') + (todos.some(t => !t.done) ? ' Your to-do list will keep until morning.' : '') };
    case 'HOME': return { text: Persona.say('home'), suggestions: ['Give me my briefing', 'Plan my day'] };
    case 'PRAISE': return { text: Persona.say('praise') };
    case 'INSULT': return { text: Persona.say('insult') };
    case 'HELP': return { text: HELP_TEXT.replace('{AI}', llmReady() ? ', and anything I do not recognise goes to my local AI brain' : ''), speak: 'Here is what I can do. Just talk to me normally.' };
    case 'GET_TIME': { const d = new Date(); return { text: 'It is **' + fmtTime(d) + '**.' }; }
    case 'GET_DATE': return { text: 'Today is **' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '**.' };
    case 'SET_NAME': {
      const m = p.text.match(/^(?:my name is|call me|i am called|i'?m called) ([a-z][a-z .'-]{0,30})/);
      const name = m ? m[1].trim().split(' ').map(cap).join(' ') : '';
      if (!name) return { text: 'What should I call you?' };
      memSet('name', name); log('ok', 'memory saved — name');
      return { text: 'Nice to meet you, **' + name + '**. I will remember that.' };
    }
    case 'RECALL_NAME': return nm ? { text: 'You are **' + nm + '**.' } : { text: 'You have not told me your name yet. Say "my name is …".' };
    case 'REMEMBER': {
      const m = p.original.match(/(?:remember|note that|keep in mind)\s+(?:that\s+|this\s+)?(.+)/i);
      const fact = (m ? m[1] : p.original).trim().replace(/[.!]$/, '');
      memAdd('note', cap(fact)); log('ok', 'memory saved');
      return { text: 'Got it — I will remember that ' + fact.replace(/^my /i, 'your ').replace(/\bi am\b/i, 'you are').replace(/\bi\b/g, 'you') + '.' };
    }
    case 'RECALL_ALL':
      if (!memory.length) return { text: 'My memory of you is empty so far. Tell me things like "remember that my exam is on the 12th".' };
      return { text: 'Here is what I remember:\n' + memory.map(m => '- ' + (m.key === 'name' ? 'Your name is ' + m.value : m.value)).join('\n') };
    case 'FORGET': {
      const q = p.text.replace(/^forget (that |about )?|^delete (the )?memory /, '').trim();
      const hit = memory.find(m => m.value.toLowerCase().includes(q));
      if (!hit) return { text: 'I could not find a memory matching "' + q + '".' };
      memDel(hit.id); return { text: 'Forgotten: "' + hit.value + '".' };
    }
    default: return null;
  }
}

/* ============ code & clipboard helpers ============ */
const LANG_EXT = { python: '.py', py: '.py', python3: '.py', cpp: '.cpp', 'c++': '.cpp', cc: '.cpp', c: '.c', javascript: '.js', js: '.js', node: '.js',
  typescript: '.ts', ts: '.ts', java: '.java', html: '.html', css: '.css', sql: '.sql', json: '.json', bash: '.sh', sh: '.sh', shell: '.sh',
  go: '.go', rust: '.rs', kotlin: '.kt', csharp: '.cs', 'c#': '.cs', ruby: '.rb', php: '.php', markdown: '.md', md: '.md', text: '.txt', txt: '.txt', plaintext: '.txt' };
const RUNNABLE = /\.(py|js|mjs|c|cpp|cc)$/i;
function guessLang(code) {
  if (/#include\s*</.test(code)) return /\b(std::|cout|cin|vector<|using namespace)\b/.test(code) ? 'cpp' : 'c';
  if (/^\s*(def |import |from \w+ import|print\()/m.test(code)) return 'python';
  if (/\bpublic (static )?(class|void)\b/.test(code)) return 'java';
  if (/\b(console\.log|function\s*\w*\(|const \w+ =|=>)/.test(code)) return 'javascript';
  return '';
}
// Last fenced code block in a piece of text → {lang, code} | null
function extractCode(text) {
  // ```text blocks are program output / tool results, not code.
  const blocks = [...String(text || '').matchAll(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g)].filter(b => b[1].toLowerCase() !== 'text' || guessLang(b[2]));
  if (!blocks.length) return null;
  const main = blocks.reduce((a, b) => (b[2].length >= a[2].length * 0.5 ? b : a));
  const lang = (main[1] || '').toLowerCase();
  return { lang: lang === 'text' || !lang ? guessLang(main[2]) || lang : lang, code: main[2].replace(/\n$/, '') };
}
// Most recent code JARVIS showed in the chat.
function lastCode() {
  for (let i = chatLog.length - 1; i >= 0; i--) {
    if (chatLog[i].role !== 'assistant') continue;
    const c = extractCode(chatLog[i].text);
    if (c) return c;
  }
  return null;
}
const lastAnswer = () => { for (let i = chatLog.length - 1; i >= 0; i--) if (chatLog[i].role === 'assistant' && chatLog[i].text.length > 20) return chatLog[i].text; return ''; };
// File name from phrases like "save it as bfs.py", "into D:\proj\main.cpp", "called graph".
function extractFileName(original) {
  const s = String(original || '').replace(/\s+(and|then)\s+(run|open|execute|compile)\b.*$/i, '');
  let m = s.match(/((?:[a-z]:)?[\w\-.\/\\]*[\w\-]\.[a-z0-9+]{1,6})(?=["'\s,.!?]*$|["'\s,]+(?:and|then|in|to|please)\b)/i)
    || s.match(/((?:[a-z]:)?[\w\-.\/\\]*[\w\-]\.[a-z0-9+]{1,6})\b/i);
  if (m && !/^(e\.g|i\.e|etc)\.?$/i.test(m[1])) {
    // A name with spaces ("summarise dbms notes.md", "flashcards from os unit 2.pdf"): the words between the command
    // word and the file are part of its name. Only after a clear command word, so "what does unit2.pdf say" is unchanged.
    const before = s.slice(0, s.indexOf(m[1]));
    const lead = before.match(/\b(?:summari[sz]e|summary of|read|open|show|show me|edit|from|of|file|called|named)\s+((?:[\w\-]+\s+){1,4})$/i);
    const extra = lead ? lead[1].trim().split(/\s+/).filter(w => !/^(my|the|a|an|file|this|that)$/i.test(w)).join(' ') : '';
    return extra ? extra + ' ' + m[1] : m[1];
  }
  m = s.match(/\b(?:as|called|named|titled|into|to|in)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+|named\s+)?["']?([\w\-]{2,40})["']?\s*$/i);
  if (m && !/^(file|it|that|this|clipboard|editor|code|vs|the|my)$/i.test(m[1])) return m[1];
  return '';
}
function withExt(name, lang) {
  if (!name || /\.[a-z0-9+]{1,6}$/i.test(name)) return name;
  return name + (LANG_EXT[lang] || '.txt');
}
async function copyText(text) {
  try { if (document.hasFocus()) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
  const r = await callTool('/tool/writeClipboard', { text });
  return !r.error;
}
async function readClip() { const r = await callTool('/tool/readClipboard', {}); return r.content || ''; }
const lines = s => String(s).split('\n').length;

// Writes content to a file; if it exists, asks to overwrite/append. Returns a reply object.
// "EXPLAIN & FIX" on a failed run: the AI explains the error simply and proposes the fixed file; APPLY saves it
// (the old version is kept, so "undo" puts it back) and runs it again with the same input.
async function fixCode(run, inputText) {
  if (busy) { toast('JARVIS is busy — try again in a moment'); return; }
  busy = true; setState('PROCESSING', 'Reading the error and fixing ' + run.name.split('/').pop() + '…');
  jarvisSay({ text: '🛠 Looking at the error in `' + run.name + '`…', intent: 'FIX_CODE', noTTS: true, noPersona: true });
  let r;
  try { r = await callTool('/skill/fix', { name: run.name, stderr: run.stderr, stdout: run.stdout, compile: !!run.compileError, stdin: inputText, model: llm.model }); }
  finally { busy = false; idleState(); }
  if (r.error) return jarvisSay({ text: 'I couldn’t fix it: ' + r.error + (r.explanation ? '\n\n' + r.explanation : ''), intent: 'FIX_CODE' });
  if (r.same) return jarvisSay({ text: (r.explanation || '') + '\n\nThe code itself looks right — ' + (/input/i.test(r.explanation) ? 'it just needs input: try **"run ' + run.name.split('/').pop() + ' with input 5"**.' : 'the problem may be the input or the environment.'), intent: 'FIX_CODE' });
  const lang = (run.name.split('.').pop() || '').replace('mjs', 'js');
  jarvisSay({ text: '**What went wrong:** ' + r.explanation + '\n\n**Fixed code:**\n```' + lang + '\n' + r.code + '```', intent: 'FIX_CODE', noPersona: true, speak: r.explanation.split(/(?<=[.!?])\s/)[0],
    actions: [{ label: 'APPLY FIX & RUN', fn: async () => {
      const w = await callTool('/tool/writeFile', { name: run.name, content: r.code, overwrite: true });
      if (w.error) return jarvisSay({ text: 'Couldn’t save the fix: ' + w.error, intent: 'FIX_CODE' });
      if (w.backup) Undo.push('fixed ' + run.name, async () => { const x = await callTool('/tool/restoreVersion', { backup: w.backup, name: w.name }); if (x.error) throw new Error(x.error); return 'Put back your original `' + x.name + '`.'; });
      jarvisSay({ text: '✓ Saved the fix to `' + w.name + '` (say **undo** to get your version back). Running it again…', intent: 'FIX_CODE', noTTS: true });
      handleUser('run ' + w.name + (inputText ? ' with input ' + inputText : ''), 'chip');
    } }, { label: 'KEEP MINE', fn: () => jarvisSay({ text: 'Okay, your file is unchanged.', intent: 'FIX_CODE' }) }] });
}
async function saveToFile(name, content, opts) {
  opts = opts || {};
  // An explicit folder (conversation focus, e.g. D:\calculator) wins: join it here so the server
  // sees one absolute path (which still asks permission when it is outside ~/jarvis).
  if (opts.folder && !/^[a-z]:[\\/]/i.test(name)) name = joinPath(opts.folder, name);
  toolStep('writeFile → ' + (opts.where && !opts.folder ? opts.where + '/' : '') + name);
  const r = await callTool('/tool/writeFile', { name, content, append: !!opts.append, overwrite: !!opts.overwrite, where: opts.where || undefined });
  if (r.exists) {
    const again = mode => async () => {
      const r2 = await callTool('/tool/writeFile', { name: r.path, content, [mode]: true });
      jarvisSay(r2.error ? { text: 'Could not write: ' + r2.error, intent: 'WRITE_FILE' } : savedReply(r2, content, opts));
      if (!r2.error && opts.run && RUNNABLE.test(r2.name)) handleUser('run it', 'chip');
    };
    return { text: '`' + r.name + '` already exists (' + Math.max(1, Math.round(r.size / 1024)) + ' KB). What should I do?',
      actions: [{ label: 'OVERWRITE', fn: again('overwrite') }, { label: 'APPEND', fn: again('append') }, { label: 'CANCEL', fn: () => jarvisSay({ text: 'Left it untouched.', intent: 'WRITE_FILE' }) }] };
  }
  if (r.error) return { text: 'Could not save: ' + r.error };
  return savedReply(r, content, opts);
}
function savedReply(r, content, opts) {
  ctx.lastFile = r.name; bumpStat('filesSaved');
  if (r.path && typeof setFocus === 'function') { setFocus('file', r.path); setFocus('created', r.path); }
  if (r.created) Undo.push('saved ' + r.name, async () => { const x = await callTool('/tool/undoCreate', { name: r.name }); if (x.error) throw new Error(x.error); return 'Removed `' + r.name + '` (it’s in the trash).'; });
  else if (r.backup) Undo.push((r.appended ? 'added to ' : 'overwrote ') + r.name, async () => { const x = await callTool('/tool/restoreVersion', { backup: r.backup, name: r.name }); if (x.error) throw new Error(x.error); return 'Put back the earlier version of `' + x.name + '`.'; });
  const verb = r.appended ? 'Appended' : r.created === false ? 'Overwrote' : 'Saved';
  const sugg = [];
  if (RUNNABLE.test(r.name) && !opts.run) sugg.push('Run it');
  sugg.push('Open it in VS Code');
  return { text: '✓ ' + verb + ' ' + plural(lines(content.replace(/\n$/, '')), 'line') + (opts.what ? ' of ' + opts.what : '') + ' → `' + r.name + '`', speak: verb + ' to ' + r.name.split('/').pop() + '.', suggestions: sugg, tool: 'writeFile', saved: r.name, op: { kind: 'file', name: r.name } };
}

/* ============ snippets ============ */
let snippets = store.get('jarvis.snippets', []); // [{id,name,lang,code,ts}]
const saveSnippets = () => { store.set('jarvis.snippets', snippets); renderSnippets(); };
function findSnippet(q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return null;
  return snippets.find(x => x.name.toLowerCase() === q) || snippets.find(x => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()))
    || snippets.find(x => NLU.lev(x.name.toLowerCase(), q) <= 2) || null;
}
async function pasteToActiveWindow(code, label) {
  if (!(await copyText(code))) return { text: 'I could not copy to the clipboard.' };
  const r = await callTool('/tool/pasteKeys', { delayMs: 3000 });
  if (r.error) return { text: 'Copied ' + label + ' — but auto-paste failed (' + r.error + '). Press Ctrl+V yourself.' };
  [3, 2, 1].forEach((n, i) => setTimeout(() => toast('Click into your editor… pasting in ' + n, true), i * 1000));
  setTimeout(() => toast('✓ Pasted'), 3100);
  return { text: 'Copied ' + label + '. **Click into your editor now** — I will press Ctrl+V in 3 seconds.', speak: 'Click into your editor. Pasting in 3 seconds.', tool: 'pasteKeys' };
}

/* ============ daily stats ============ */
const todayKey = () => new Date().toISOString().slice(0, 10);
let stats = store.get('jarvis.stats', {});
let triggers = store.get('jarvis.triggers', []);       // [{id,routineId,routineName,when,label,cooldownMin,enabled}] — the server watches these (scheduler.js)
const saveTriggers = () => { store.set('jarvis.triggers', triggers); renderTriggers(); };
let sessions = store.get('jarvis.sessions', []);       // [{t,min,subject}] completed focus sessions
let studyPlans = store.get('jarvis.studyPlans', []);   // [{id,name,examDate,days:[{date,topic,kind,done}]}]
const saveStudyPlans = () => { store.set('jarvis.studyPlans', studyPlans); renderDash(); };
function logSession(min, subject) {
  sessions.push({ t: Date.now(), min, subject: subject || '' });
  if (sessions.length > 300) sessions = sessions.slice(-300);
  store.set('jarvis.sessions', sessions);
}
function bumpStat(key, n) {
  const d = todayKey();
  stats[d] = stats[d] || {};
  stats[d][key] = (stats[d][key] || 0) + (n === undefined ? 1 : n);
  const keys = Object.keys(stats).sort(); while (keys.length > 60) delete stats[keys.shift()];
  store.set('jarvis.stats', stats);
  if (typeof renderDash === 'function') renderDash();
}

/* ============ recurring reminders ============ */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function describeRepeat(rep, at) {
  if (!rep) return '';
  if (rep.type === 'interval') return 'every ' + (rep.ms >= 36e5 ? plural(rep.ms / 36e5, 'hour') : plural(rep.ms / 6e4, 'minute'));
  const t = fmtTime(at);
  if (rep.type === 'daily') return 'every day at ' + t;
  if (rep.type === 'weekdays') return 'every weekday at ' + t;
  if (rep.type === 'monthly') {
    if (!rep.day) return 'every month at ' + t;
    const d = new Date(at); d.setDate(Math.min(rep.day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return 'every month on the ' + d.getDate() + ordinal(d.getDate()) + ' at ' + t;
  }
  if (rep.type === 'yearly') {
    const label = (rep.month !== undefined ? MONTH_NAMES[rep.month] : MONTH_NAMES[new Date(at).getMonth()]) + ' ' + (rep.day || new Date(at).getDate());
    const dd = new Date(at); dd.setMonth(rep.month === undefined ? dd.getMonth() : rep.month, 1); dd.setDate(Math.min(rep.day || dd.getDate(), new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate()));
    return 'every year on ' + label + ordinal(+label.match(/\d+$/)[0]) + ' at ' + t;
  }
  return 'every ' + cap(NLU.DAYS[rep.day]) + ' at ' + t;
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
function nextOccurrence(r, now) {
  let at = r.at;
  const rep = r.repeat;
  // With no explicit day/month in the repeat, keep the reminder's own day-of-month (and month), clamped to month length.
  const dom = rep.day || new Date(r.at).getDate();
  do {
    if (rep.type === 'interval') at += rep.ms;
    else if (rep.type === 'weekly') at += 7 * 864e5;
    else if (rep.type === 'monthly') {
      const d = new Date(at); d.setMonth(d.getMonth() + 1, 1);
      d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      at = d.getTime();
    }
    else if (rep.type === 'yearly') {
      const d = new Date(at); d.setFullYear(d.getFullYear() + 1, rep.month === undefined ? d.getMonth() : rep.month, 1);
      d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      at = d.getTime();
    }
    else {
      const d = new Date(at); d.setDate(d.getDate() + 1);
      if (rep.type === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      at = d.getTime();
    }
  } while (at <= now);
  return at;
}

/* ============ web research ============ */
const TIME_SENSITIVE = /\b(latest|current(ly)?|today'?s|news|this (week|month|year)|20(2[4-9]|3\d)|price of|release date|released|who won|winner|announced|results? of|deadline for|last date|schedule for)\b/;
async function doResearch(q, extraSuggestions) {
  setState('PROCESSING', 'Searching the web…'); toolStep('research → ' + q);
  const r = await callTool('/tool/research', { q, online: true });
  if (r.error || !r.results || !r.results.length) return { text: 'I could not search the web right now' + (r.error ? ' (' + r.error + ')' : '') + '.', suggestions: ['Search Google for ' + q] };
  const sources = '\n\n**Sources**\n' + r.results.slice(0, 4).map((x, i) => (i + 1) + '. [' + x.title + '](' + x.url + ')').join('\n');
  if (!llmReady()) return { text: 'Top results for **' + q + '**:\n' + r.results.slice(0, 5).map((x, i) => (i + 1) + '. [' + x.title + '](' + x.url + ') — ' + x.snippet).join('\n'), suggestions: extraSuggestions };
  const pages = r.pages.map((x, i) => '[' + (i + 1) + '] ' + x.title + ' (' + x.url + ')\n' + ((x.text || '').length > 200 ? x.text : x.snippet).slice(0, 3000)).join('\n\n');
  // Something that changes (a winner, a price, news): a small model will happily "remember" a years-old answer, so the
  // code decides. Results that don't even mention the question's key words are reported as such, without the AI.
  const changing = TIME_SENSITIVE.test(q.toLowerCase()) || /\b(last|recent|now|right now|score|standings)\b/i.test(q);
  const keys = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(who|what|when|where|which|how|the|won|last|latest|news|about|price|current|currently|today|right|now|and|for|with|from|this|that|recent)$/.test(w));
  const hay = r.results.slice(0, 4).map(x => (x.title + ' ' + x.snippet + ' ' + x.url).toLowerCase()).join(' ');
  if (changing && keys.length && !keys.some(k => hay.includes(k)))
    return { text: 'I couldn’t find current results for **' + q + '** — the search returned unrelated pages, and I won’t answer something that changes from memory.', suggestions: ['Search Google for ' + q].concat(extraSuggestions || []) };
  const fallback = changing
    ? 'If they do not contain the answer, say plainly that the sources didn’t have it and suggest a better search. Never answer from your own memory: this changes over time, and your memory is out of date.'
    : 'If they do not contain the answer and it is a settled fact that does not change (history, science, who invented or wrote something, definitions), answer from your own knowledge in one or two sentences and start with "The search didn’t cover this, but from general knowledge:".';
  return { askLLM: 'Question: ' + q + '\nToday is ' + new Date().toDateString() + '.\n\nAnswer using ONLY these web sources I just fetched. Cite them inline like [1] or [2]. ' + fallback + ' Be concise; use bullets for lists.' + (Lang.aiInEnglish() ? '' : { te: ' Write the answer in Telugu (keep technical terms, names and numbers in English).', kn: ' Write the answer in Kannada (keep technical terms, names and numbers in English).' }[Lang.replyLang()] || '') + '\n\n' + pages,
    after: { sources, suggestions: extraSuggestions }, noHistory: true };   // the pages hold everything needed; earlier chat would only crowd the small model's 8K and bias the answer
}

/* ============ flashcards (Leitner boxes) ============ */
let flashcards = store.get('jarvis.flashcards', []); // [{id,deck,q,a,box,due}]
const saveFlash = () => { store.set('jarvis.flashcards', flashcards); renderFlashDecks(); };
const BOX_DAYS = [0, 0, 1, 3, 7, 14];
let flashSession = null;
function flashDecks() {
  const now = Date.now(), m = new Map();
  for (const c of flashcards) { const d = m.get(c.deck) || { name: c.deck, count: 0, due: 0 }; d.count++; if (c.due <= now) d.due++; m.set(c.deck, d); }
  return [...m.values()];
}
function parseFlashcards(text, deck) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.replace(/\*\*/g, '').match(/^\s*(?:[-*\d.)]+\s*)?Q\s*[:.]\s*(.+?)\s*(?:\|\||\|)\s*A\s*[:.]\s*(.+?)\s*$/i);
    if (m) out.push({ id: rid(), deck, q: m[1], a: m[2], box: 1, due: Date.now() });
  }
  return out;
}
function startFlashReview(deckQ) {
  deckQ = String(deckQ || '').toLowerCase().trim();
  if (/^(my|all|the|some)$/.test(deckQ)) deckQ = '';
  if (!flashcards.length) return { text: 'You have no flashcards yet. Try "make flashcards from os-notes.md" or "make flashcards on normalization".' };
  let pool = deckQ ? flashcards.filter(c => c.deck.toLowerCase().includes(deckQ)) : flashcards;
  if (!pool.length) return { text: 'No deck matches "' + deckQ + '". Your decks: ' + flashDecks().map(d => '**' + d.name + '**').join(', ') + '.' };
  const now = Date.now();
  let due = pool.filter(c => c.due <= now);
  const extra = !due.length;
  if (extra) due = pool.slice().sort((x, y) => x.box - y.box || x.due - y.due);
  due = due.sort(() => Math.random() - .5).slice(0, 10);
  flashSession = { queue: due.map(c => c.id), i: 0, right: 0, wrong: 0 };
  switchTab('chat');
  const intro = extra ? 'Nothing is due right now — here is some extra practice. ' : '';
  return nextFlashCard(intro);
}
function nextFlashCard(prefix) {
  const S = flashSession;
  if (!S) return { text: 'No flashcard session is running.' };
  if (S.i >= S.queue.length) {
    const n = S.right + S.wrong; flashSession = null; ctx.pending = null;
    bumpStat('flashReviewed', n);
    return { text: '🏁 Session done: **' + S.right + '/' + n + '** correct.' + (S.wrong ? ' Missed cards will come back sooner.' : ' Perfect!'), speak: 'Session done. ' + S.right + ' out of ' + n + ' correct.', suggestions: ['Show my flashcards'] };
  }
  const card = flashcards.find(c => c.id === S.queue[S.i]);
  if (!card) { S.i++; return nextFlashCard(prefix); }
  ctx.pending = { intent: 'FLASH_ANSWER', id: card.id };
  return { text: (prefix || '') + '**Card ' + (S.i + 1) + '/' + S.queue.length + '** · ' + card.deck + '\n\n❓ ' + card.q + '\n\n_Type or say your answer._', speak: card.q, suggestions: ['Show answer', 'Stop flashcards'], intent: 'FLASH_REVIEW' };
}
function gradeCard(card, ok) {
  card.box = ok ? Math.min(5, card.box + 1) : 1;
  card.due = Date.now() + (card.box === 1 ? 10 * 6e4 : BOX_DAYS[card.box] * 864e5);
  saveFlash();
  if (flashSession) { flashSession[ok ? 'right' : 'wrong']++; flashSession.i++; }
}
function flashAnswer(id, answer) {
  const card = flashcards.find(c => c.id === id);
  if (!card || !flashSession) return { text: 'That flashcard session has ended.' };
  const skipped = /^(show( me)?( the)? answer|i don'?t know|no idea|skip|pass|idk)$/i.test(answer.trim());
  const words = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const want = words(card.a), got = words(answer);
  const overlap = want.size ? [...want].filter(w => got.has(w)).length / want.size : 0;
  const hint = skipped ? '' : overlap >= .5 ? '✅ Looks right! ' : overlap > .2 ? '🤔 Partly there. ' : '';
  return { text: hint + '**Answer:** ' + card.a + '\n\nDid you get it?', speak: 'The answer is: ' + card.a, intent: 'FLASH_REVIEW',
    actions: [
      { label: '✓ GOT IT', fn: () => { gradeCard(card, true); sfx.ok(); jarvisSay(nextFlashCard()); } },
      { label: '✗ MISSED', fn: () => { gradeCard(card, false); jarvisSay(nextFlashCard()); } },
      { label: 'STOP', fn: () => { flashSession.i = flashSession.queue.length; jarvisSay(nextFlashCard()); } },
    ] };
}

/* ============ plan my day ============ */
function planContext() {
  const now = new Date();
  const classesToday = classes.filter(c => c.day === now.getDay()).map(c => ({ c, at: new Date(new Date().setHours(c.h, c.m, 0, 0)) })).filter(x => x.at > now).sort((x, y) => x.at - y.at);
  const dls = deadlines.filter(d => !d.done && d.due > Date.now() && d.due - Date.now() < 7 * 864e5).sort((x, y) => x.due - y.due);
  const pend = todos.filter(t => !t.done);
  return { now, classesToday, dls, pend };
}
function planDay() {
  const { now, classesToday, dls, pend } = planContext();
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (now.getHours() >= 23) return { text: 'It is late — the best plan now is sleep. 😴 Want me to plan tomorrow morning instead? (Add tasks and say "plan my day" tomorrow.)' };
  if (!pend.length && !dls.length && !classesToday.length) return { text: 'Your day is clear — no to-dos, deadlines or classes left. Add tasks with "add … to my list", then ask again.', suggestions: ['Upcoming contests', 'Start a focus session'] };
  if (llmReady()) {
    return { askLLM: 'It is ' + hhmm(now) + ' on ' + now.toDateString() + '. Plan the rest of my day until 23:00 as a CS student.\n'
      + 'Fixed classes (do not move): ' + (classesToday.map(x => hhmm(x.at) + ' ' + x.c.name + ' (60 min)').join('; ') || 'none') + '\n'
      + 'Deadlines: ' + (dls.map(d => d.title + ' due ' + new Date(d.due).toDateString()).join('; ') || 'none') + '\n'
      + 'To-dos: ' + (pend.map(t => t.text).join('; ') || 'none') + '\n'
      + 'Use ' + settings.focusMin + '-minute focus blocks with ' + settings.breakMin + '-minute breaks, urgent deadlines first, a dinner break around 20:00 if in range.\n'
      + 'Output ONLY lines in the format "HH:MM-HH:MM | activity" in time order, then one short motivating sentence.', after: { plan: true } };
  }
  // Rule-based fallback: fill gaps around classes with deadline work first, then to-dos.
  const tasks = dls.map(d => 'Work on ' + d.title).concat(pend.map(t => t.text));
  let t = new Date(now); t.setMinutes(Math.ceil(t.getMinutes() / 10) * 10, 0, 0);
  const end = new Date(now); end.setHours(23, 0, 0, 0);
  const blocks = []; let k = 0;
  while (t < end && blocks.length < 10) {
    const cls = classesToday.find(x => x.at >= t && x.at < new Date(t.getTime() + settings.focusMin * 6e4));
    if (cls) { blocks.push([cls.at, new Date(cls.at.getTime() + 60 * 6e4), '📚 ' + cls.c.name]); t = new Date(cls.at.getTime() + 60 * 6e4); continue; }
    if (k >= tasks.length) break;
    const e = new Date(t.getTime() + settings.focusMin * 6e4);
    blocks.push([new Date(t), e, tasks[k++]]);
    t = new Date(e.getTime() + settings.breakMin * 6e4);
  }
  return planReply(blocks.map(([s0, e0, what]) => ({ start: s0.getTime(), end: e0.getTime(), what })));
}
function parsePlan(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.replace(/\*\*/g, '').match(/(\d{1,2})[:.](\d{2})\s*(?:[-–—to]+)\s*(\d{1,2})[:.](\d{2})\s*[|:\-–]\s*(.+)$/i);
    if (!m) continue;
    const s0 = new Date(); s0.setHours(+m[1], +m[2], 0, 0);
    const e0 = new Date(); e0.setHours(+m[3], +m[4], 0, 0);
    if (e0 <= Date.now()) continue;
    out.push({ start: s0.getTime(), end: e0.getTime(), what: m[5].trim() });
  }
  return out;
}
function planReply(blocks, fromAI) {
  if (!blocks.length) return { text: fromAI ? 'I could not turn that into a timetable — try "plan my day" again.' : 'Nothing to schedule.' };
  const work = blocks.filter(b => !/\b(break|dinner|lunch|rest|relax|snack)\b/i.test(b.what));
  const body = blocks.map(b => '- `' + fmtTime(b.start) + '–' + fmtTime(b.end) + '` ' + b.what).join('\n');
  return { text: (fromAI ? '' : '**Plan for the rest of today**\n' + body + '\n\n') + 'Want reminders at the start of each block?', intent: 'PLAN_DAY',
    actions: [{ label: 'ADD ' + work.length + ' REMINDERS', fn: () => {
      let n = 0;
      for (const b of work) if (b.start > Date.now() + 30e3) { reminders.push({ id: rid(), text: b.what, at: b.start, fired: false }); n++; }
      saveTasks(); askNotify();
      jarvisSay({ text: '✓ Added ' + plural(n, 'reminder') + '. I will ping you at the start of each block.', intent: 'PLAN_DAY', suggestions: ['What are my reminders?'] });
    } }] };
}

/* ============ smart alerts ============ */
const alertedAt = new Map();
function alertOnce(key, everyMs, msg, suggestions) {
  const last = alertedAt.get(key);
  if (last && (everyMs === Infinity || Date.now() - last < everyMs)) return;
  alertedAt.set(key, Date.now());
  claimAlert('alert:' + key, everyMs === Infinity ? 86400 : Math.max(60, everyMs / 1000)).then(won => {
    if (!won) return;                                  // another open tab already said it
    sfx.wake(); toast(msg.replace(/\*\*/g, ''), true); notify('Heads up', msg.replace(/\*\*/g, ''));
    log('warn', 'alert: ' + msg.replace(/\*\*/g, ''));
    const m = msg.match(/^(\p{Extended_Pictographic}\S*)\s+(.*)$/su);
    const body = m ? m[2] : msg;
    const text = (m ? m[1] + ' ' : '') + Persona.Sir() + ', ' + (/^[A-Z][a-z]/.test(body) ? body[0].toLowerCase() + body.slice(1) : body);
    jarvisSay({ text, intent: 'ALERT', suggestions, alert: true });
  });
}
let lastBatteryCheck = 0;
// CPU sustained-load tracking: records the timestamp when CPU first crossed the
// cpuSustained threshold. If it stays above for cpuSustainedSec, an alert fires.
let cpuSustainedSince = 0;
async function smartAlerts() {
  if (!settings.alerts || state === 'BOOT') return;
  const now = Date.now();
  // ---- RAM high (existing, now uses Thresholds) ----
  if (Thresholds.isRamHigh(sys.ram)) alertOnce('ram', Thresholds.reAlertMinutes * 6e4, '⚠ Memory is at **' + sys.ram + '%** — things may slow down. Close something heavy?', ['What are the top processes?']);
  // ---- Disk low (NEW — proactive, not just diagnostics) ----
  if (Thresholds.isDiskLow(sys.diskFree)) alertOnce('disk', Thresholds.reAlertMinutes * 6e4, '💾 Storage is low — only **' + sys.diskFree + ' GB** free on the system drive. Want me to find what is using it?', ['What is taking up disk space?', 'Clean my temp files', 'Find old node_modules', 'Find large files']);
  // ---- CPU sustained load (NEW — fires only after cpuSustainedSec seconds above cpuSustained) ----
  if (sys.cpu >= Thresholds.cpuSustained) {
    if (!cpuSustainedSince) cpuSustainedSince = now;
    else if (now - cpuSustainedSince >= Thresholds.cpuSustainedSec * 1000) {
      alertOnce('cpu', Thresholds.reAlertMinutes * 6e4, '🔥 Processor has been at **' + sys.cpu + '%** for over ' + Thresholds.cpuSustainedSec + 's — something may be stuck. Want the top processes?', ['What are the top processes?']);
    }
  } else {
    cpuSustainedSince = 0; // reset when CPU drops below threshold
  }
  // ---- Battery (existing, now uses Thresholds + escalation tiers) ----
  if (backend.online && now - lastBatteryCheck > Thresholds.batteryPollS * 1000) {
    lastBatteryCheck = now;
    const b = await callTool('/tool/batteryStatus');
    if (Thresholds.isBatteryCritical(b.level, b.status)) alertOnce('battery_crit', Thresholds.reAlertMinutes * 6e4 / 2, '🚨 Battery is at **' + b.level + '%** — plug in NOW, ' + Persona.sir() + '.');
    else if (Thresholds.isBatteryLow(b.level, b.status)) alertOnce('battery', Thresholds.reAlertMinutes * 6e4, '🔋 Battery is at **' + b.level + '%** — plug in soon.');
  }
  // ---- Deadlines (existing, now uses Thresholds) ----
  if (!serverScheduler) for (const d of deadlines) if (!d.done && d.due > now && d.due - now <= Thresholds.deadlineWindowH * 36e5) alertOnce('dl' + d.id, Infinity, '⏳ **' + d.title + '** is due at ' + fmtTime(d.due) + ' — about ' + Math.max(1, Math.round((d.due - now) / 36e5)) + 'h left.', ['Start a focus session', 'Block distractions']);
  // ---- Evening nudge (existing, now uses Thresholds) ----
  const h = new Date().getHours(), pend = todos.filter(t => !t.done).length;
  if (h === Thresholds.eveningHour && pend) alertOnce('evening' + new Date().toDateString(), Infinity, '🌙 You have ' + plural(pend, 'to-do') + ' left today. One more focus session, or call it a day?', ['What is on my to-do list?', 'Start a focus session']);
}
setInterval(() => { smartAlerts().catch(() => {}); }, 60e3);

/* ============ pattern learning suggestions (Phase 2.9) ============ */
// "Yes, make it a routine" really makes one: a routine with the one step ("open vscode", "start a focus session for 25 minutes") scheduled every day at that hour.
// Only apps and focus sessions can be turned into a command line; for a learned command (stored as a bare intent name) it says so instead of pretending.
function routineFromPattern(sug) {
  const hh = String(sug.hour).padStart(2, '0'), h12 = (sug.hour % 12 || 12) + (sug.hour < 12 ? 'am' : 'pm'), at = 'every day at ' + h12;      // "9am": a bare "09:00" is read as the next 9 o'clock, which may be tonight
  let step = '', name = '';
  if (sug.kind === 'apps') { step = 'open ' + sug.label; name = sug.label + ' at ' + hh; }
  else if (sug.kind === 'focus') { const mins = parseInt(sug.label, 10); step = mins ? 'start a focus session for ' + mins + ' minutes' : 'start a focus session'; name = 'focus at ' + hh; }
  else return { made: false, text: 'I can’t turn that one into steps by myself. Tell me the steps, like **“create a routine called morning that opens vscode and starts a focus session”**, and then **“run morning every day at ' + h12 + '”**.' };
  const rt = Routines.create(name, [step]);
  if (!rt) return { made: false, text: 'I couldn’t make that routine.' };
  const repeat = NLU.parseRepeat(at);
  if (!repeat) return { made: false, text: 'I made the routine **' + rt.name + '** but couldn’t schedule it. Say **“run ' + rt.name + ' ' + at + '”**.' };
  const first = repeatStart(repeat, at);
  reminders = reminders.filter(x => x.routineId !== rt.id);
  const rem = { id: rid(), text: 'routine: ' + rt.name, at: first, fired: false, repeat, routineId: rt.id }; reminders.push(rem); saveTasks();
  Undo.push('made the routine ' + rt.name, () => { Routines.remove(rt); return 'Removed the routine **' + rt.name + '**.'; });
  return { made: true, routine: rt, text: '✓ Made the routine **' + rt.name + '** (' + step + ') and scheduled it ' + describeRepeat(repeat, first) + '. First run ' + fmtDay(first) + ' at ' + fmtTime(first) + '. JARVIS needs to be open then. Say **“undo”** to remove it.' };
}
// Every 5 minutes (and only when idle), check if Learn.suggest() found a pattern
// strong enough to surface. If yes, offer it as a non-intrusive toast + chat message.
setInterval(() => {
  if (busy || state === 'BOOT' || state === 'EXECUTING' || state === 'SPEAKING') return;
  if (typeof Learn === 'undefined') return;
  try {
    const s = Learn.suggest();
    if (!s) return;
    // Only surface suggestions for patterns with 3+ occurrences in the current hour.
    if (s.count < Learn.MIN_SAMPLES_FOR_SUGGESTION) return;
    const label = s.kind === 'apps' ? 'open ' + s.label : s.kind === 'cmds' ? s.label.replace(/_/g, ' ').toLowerCase() : 'start a focus session for ' + s.label;
    const msg = '📊 I noticed you have done **' + label + '** ' + s.count + ' times around this hour. Want me to make it a routine?';
    jarvisSay({ text: msg, intent: 'LEARN_SUGGEST', suggestions: ['Yes, make it a routine', 'No, not now'], noPersona: false, noTTS: true,
      confirm: { yes: 'YES', no: 'NOT NOW', onConfirm: () => { Learn.acceptSuggestion(s); const out = routineFromPattern(s); jarvisSay({ text: out.text, intent: 'LEARN_SUGGEST', noPersona: true }); }, onCancel: () => Learn.dismissSuggestion(s) } });
  } catch (e) {}
}, 5 * 60 * 1000); // every 5 minutes

/* ============ languages, themes, persona ============ */
function setLanguage(l) {
  settings.speechLang = l; saveSettings(); Lang.setTurn(l);
  updateLangUI();
  if (wakeOn) { stopWake(); startWake(); }
  if (l === 'en') return { text: 'Back to English, ' + Persona.sir() + '.', noLocalize: true };
  const noVoice = settings.neuralVoice === false && !Lang.voiceFor(l) ? '\n\n' + Lang.line('noVoice', l) : '';
  return { text: Lang.line('switched', l) + noVoice, speak: Lang.line('switched', l), noLocalize: true };
}
// Tags Telugu/Kannada text so CSS can drop the HUD letter-spacing that breaks joined letters.
function markLang(el, text) { if (!el) return; const l = Lang.detect(text); if (l !== 'en') el.lang = l; else el.removeAttribute('lang'); }
function updateLangUI() {
  $$('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === settings.speechLang));
  const sel = $('#speechLangSelect'); if (sel) sel.value = settings.speechLang;
}
const THEMES = {
  // Same values as the html[data-theme] accents in ui.css.
  arc: { label: 'Arc reactor blue', rgb: '111,179,210', hi: '169,211,230' },
  gold: { label: 'Mark 85 gold', rgb: '233,162,59', hi: '243,199,127' },
  crimson: { label: 'Crimson', rgb: '205,92,108', hi: '230,161,171' },
  violet: { label: 'Violet', rgb: '160,140,210', hi: '203,191,232' },
};
function applyTheme(t) {
  if (!THEMES[t]) t = 'arc';
  document.documentElement.dataset.theme = t;
  themeRGB = THEMES[t].rgb; themeHiRGB = THEMES[t].hi;
  settings.theme = t; saveSettings();
  const sel = $('#themeSelect'); if (sel) sel.value = t;
}
// Each theme's small, fixed automated action, fired only on a deliberate switch (never on boot restore —
// see switchTheme below, and the plain applyTheme() call that restores the saved theme at startup). Reuses
// existing safe-tier tools; crimson's block_distractions already asks for confirmation itself when there's
// something to close, exactly like typing "block distractions" would.
const THEME_ACTIONS = {
  arc: () => executeTool({ intent: 'BRIGHTNESS', args: { level: 70 }, text: '' }, ''),
  gold: () => executeTool({ intent: 'BRIGHTNESS', args: { level: 85 }, text: '' }, ''),
  violet: async () => { await executeTool({ intent: 'BRIGHTNESS', args: { level: 30 }, text: '' }, ''); await executeTool({ intent: 'DARK_MODE', args: {}, text: '' }, ''); },
  crimson: () => { sfx.alarm(); return executeTool({ intent: 'BLOCK_DISTRACTIONS', args: {}, text: '' }, ''); },
};
// Use this (not applyTheme directly) for anything the user actually chose — dropdown or voice/text.
async function switchTheme(t) {
  applyTheme(t);
  if (THEME_ACTIONS[t]) { try { await THEME_ACTIONS[t](); } catch (e) { log('warn', 'theme action failed: ' + e.message); } }
}
function applyPersona(who) {
  who = who === 'friday' ? 'friday' : 'jarvis';
  settings.persona = who; saveSettings();
  Persona.setPersona(who);
  document.body.dataset.persona = who;
  const name = who === 'friday' ? 'FRIDAY' : 'JARVIS';
  $('.brand h1').textContent = name;
  document.title = name + ' — Local AI Assistant';
  const sel = $('#personaSelect'); if (sel) sel.value = who;
}
function repeatStart(repeat, whenText) {
  if (repeat.type === 'interval') return Date.now() + repeat.ms;
  let at = NLU.parseWhen(whenText);
  if (!at) { const d = new Date(); d.setHours(9, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); at = d.getTime(); }
  const d = new Date(at);
  if (repeat.type === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  if (repeat.type === 'weekly') while (d.getDay() !== repeat.day) d.setDate(d.getDate() + 1);
  return d.getTime();
}
// "opens steam and discord" → ["open steam", "open discord"]
function expandSteps(steps) {
  const out = [];
  for (let st of steps) {
    st = st.replace(/^(launch|switch)es\b/i, '$1').replace(/^(open|close|start|play|set|mute|lock|turn|show|give|run|block|remind|dim)s\b/i, '$1');
    const m = st.match(/^(open|close|launch|start)\s+(.+?)\s+and\s+(.+)$/i);
    if (m && NLU.findApp(m[2]) && (NLU.findApp(m[3]) || NLU.findSite(m[3]))) { out.push(m[1] + ' ' + m[2], m[1] + ' ' + m[3]); continue; }
    out.push(st);
  }
  return out;
}
// "System status": one read-only snapshot of apps, controls, resources and JARVIS's own timers — every value is
// read live from the same endpoints the agent verifies against; anything that can't be read shows "unknown".
const STATE_APPS = ['vscode', 'chrome', 'spotify', 'discord', 'whatsapp', 'steam'];
async function systemState() {
  toolStep('systemState'); setState('EXECUTING', 'Reading system state…');
  const [apps, vol, bri, wifi, bt, bat] = await Promise.all([
    callTool('/tool/runningApps', { apps: STATE_APPS }), callTool('/sys/volume', {}), callTool('/sys/brightness', {}),
    callTool('/sys/radio', { kind: 'wifi' }), callTool('/sys/radio', { kind: 'bluetooth' }), callTool('/tool/batteryStatus'), refreshSystem()]);
  const unk = 'unknown', row = (k, v, last) => (last ? '└── ' : '├── ') + k.padEnd(14) + ' ' + v;
  const tree = (title, rows) => title + '\n' + rows.map((r, i) => row(r[0], r[1], i === rows.length - 1)).join('\n');
  const checked = new Set(apps.checked || []), running = new Set(apps.running || []);
  const appRows = STATE_APPS.filter(k => NLU.appByKey(k)).map(k => [NLU.appByKey(k).n, checked.has(k) ? (running.has(k) ? 'RUNNING' : 'CLOSED') : unk]);
  const onOff = r => r && r.state ? r.state.toUpperCase() : unk;
  const sysRows = [['Volume', vol.level !== undefined ? vol.level + '%' : unk], ['Brightness', bri.level !== undefined ? bri.level + '%' : unk],
    ['Wi-Fi', onOff(wifi)], ['Bluetooth', onOff(bt)]];
  const resRows = [['CPU', sys.cpu !== undefined ? sys.cpu + '%' : unk], ['RAM', sys.ram !== undefined ? sys.ram + '%' : unk],
    ['Battery', bat && bat.level !== null && bat.level !== undefined ? bat.level + '% · ' + String(bat.status).toLowerCase() : 'no battery']];
  const left = t => Math.max(1, Math.round((t - Date.now()) / 6e4)) + ' min left';
  const jRows = [['Focus', focus ? (focus.phase === 'focus' ? focus.min + '-min session · ' : 'break · ') + left(focus.end) : 'off'],
    ['Timers', timers.length ? timers.length + ' running' : 'none'], ['Panic mode', store.get('jarvis.panic', false) ? 'ON' : 'off']];
  const text = '```text\nSYSTEM STATE\n\n' + [tree('Apps', appRows), tree('System', sysRows), tree('Resources', resRows), tree('JARVIS', jRows)].join('\n\n') + '\n```';
  const open = appRows.filter(r => r[1] === 'RUNNING').map(r => r[0]);
  return { text, speak: (open.length ? open.join(', ') + (open.length === 1 ? ' is' : ' are') + ' open. ' : 'No tracked apps are open. ') + (vol.level !== undefined ? 'Volume ' + vol.level + ' percent.' : ''),
    tool: 'systemState', noPersona: true, suggestions: open.some(n => /spotify|discord|whatsapp|steam/i.test(n)) ? ['Block distractions'] : null };
}
async function runDiagnostics() {
  toolStep('diagnostics'); setState('EXECUTING', 'Running diagnostics…');
  const [sysOk, bat, wifi] = await Promise.all([refreshSystem(), callTool('/tool/batteryStatus'), getJSON('/sys/wifi')]);
  await checkLLM();
  const rows = []; let warn = 0;
  const add = (ok, label, val) => { if (!ok) warn++; rows.push((ok ? '✓' : '⚠') + ' **' + label + '** — ' + val); };
  if (bat && bat.level !== null && bat.level !== undefined) add(!Thresholds.isBatteryLow(bat.level, bat.status), 'Power', bat.level + '% · ' + String(bat.status).toLowerCase());
  else add(true, 'Power', 'mains (no battery reported)');
  if (sysOk) {
    add(!Thresholds.isCpuHigh(sys.cpu), 'Processor', sys.cpu + '% · ' + sys.cpus + ' threads');
    add(!Thresholds.isRamWarn(sys.ram), 'Memory', sys.ram + '% (' + sys.ramUsed + ' / ' + sys.ramTotal + ' GB)');
    add(!Thresholds.isDiskLow(sys.diskFree), 'Storage', sys.diskFree + ' GB free on the system drive');
  } else add(false, 'Telemetry', 'backend offline');
  add(!!(wifi && wifi.ssid), 'Network', wifi && wifi.ssid ? wifi.ssid + ' · signal ' + wifi.signal : 'no Wi-Fi connection');
  add(llmReady(), 'AI core', llmReady() ? llm.model + ' online' + (latN ? ' · avg ' + Math.round(latSum / latN) + ' ms per turn' : '') : 'Ollama offline');
  add(!!SR, 'Voice input', SR ? 'Web Speech · ' + Lang.SPEECH[settings.speechLang] : 'not supported in this browser');
  const v = pickVoice();
  add(true, 'Voice output', v ? v.name.replace(/^Microsoft /, '') : 'browser default');
  const verdict = warn ? plural(warn, 'system') + ' need attention, ' + Persona.sir() + '.' : Persona.say('status');
  return { text: '**' + (settings.persona === 'friday' ? 'FRIDAY' : 'JARVIS') + ' diagnostics**\n' + rows.map(r => '- ' + r).join('\n') + '\n\n' + verdict,
    speak: 'Diagnostics complete. ' + verdict, tool: 'diagnostics', noPersona: true };
}
const posToAction = w => /maxim|full/.test(w) ? 'maximize' : /minim/.test(w) ? 'minimize' : /restore/.test(w) ? 'restore' : w;
async function arrangeWindows(s, a) {
  const jobs = [];
  if (a.app) {
    const app = NLU.findApp(a.app);
    if (app) jobs.push({ app: app.k, action: posToAction(String(a.position || 'maximize').toLowerCase()) });
  } else if (/\bminimi[sz]e (everything|all( windows)?|all other windows) (except|but|apart from)\b/.test(s)) {
    const app = NLU.findApp(s.split(/\b(?:except|but|apart from)\b/)[1] || '');
    if (!app) return { text: 'Which app should stay open, ' + Persona.sir() + '?' };
    jobs.push({ app: app.k, action: 'minimizeOthers' });
  } else if (/\bside by side\b|\bsplit (the )?screen\b/.test(s)) {
    const apps = [];
    for (const part of s.replace(/\b(side by side|split( the)? screen|put|place|show|with|between)\b/g, ' ').split(/\band\b|,/)) { const x = NLU.findApp(part); if (x && !apps.includes(x)) apps.push(x); }
    if (apps.length < 2) return { text: 'Which two apps should I put side by side?' };
    jobs.push({ app: apps[0].k, action: 'left' }, { app: apps[1].k, action: 'right' });
  } else {
    for (const part of s.split(/\band\b|,/)) {
      const app = NLU.findApp(part); if (!app) continue;
      const pos = part.match(/\b(left|right|top|bottom)\b/);
      const verb = part.match(/\b(maximi[sz]e|minimi[sz]e|restore|full ?screen)\b/) || s.match(/^(maximi[sz]e|minimi[sz]e|restore|full ?screen)\b/);
      jobs.push({ app: app.k, action: pos ? pos[1] : verb ? posToAction(verb[1]) : 'maximize' });
    }
  }
  if (!jobs.length) return { text: 'Which app should I move, ' + Persona.sir() + '?' };
  const done = [], failed = [];
  for (const j of jobs) {
    toolStep('window → ' + j.app + ' ' + j.action);
    const r = await callTool('/sys/window', j);
    const n = (NLU.appByKey(j.app) || { n: j.app }).n;
    if (r.error) failed.push(n + ' — ' + r.error);
    else done.push(j.action === 'minimizeOthers' ? 'kept **' + n + '** and minimised ' + plural(r.minimized || 0, 'other window') : '**' + n + '** → ' + j.action);
  }
  if (!done.length) return { text: 'I could not arrange that: ' + failed.join('; ') + '.' };
  return { text: 'Arranged: ' + done.join(', ') + '.' + (failed.length ? ' Skipped: ' + failed.join('; ') + '.' : ''), speak: 'Windows arranged.', tool: 'window' };
}
async function clipHistory(s) {
  if (/\b(stop|turn off|disable)\b/.test(s)) { await callTool('/sys/clipHistory', { action: 'stop' }); return { text: 'Clipboard history is off, and what I held has been forgotten.' }; }
  if (/\bclear\b/.test(s)) { await callTool('/sys/clipHistory', { action: 'clear' }); return { text: 'Clipboard history cleared.' }; }
  if (/\b(start|turn on|enable)\b/.test(s)) {
    const r = await callTool('/sys/clipHistory', { action: 'start' });
    if (r.error) return { text: r.error };
    return { text: 'Clipboard history is on. I keep the last 30 text items **in memory only** — nothing is saved to disk, and it is forgotten when JARVIS restarts. Say "what did I copy earlier" or "copy the 2nd one".', speak: 'Clipboard history is on. I keep it in memory only.' };
  }
  const r = await callTool('/sys/clipHistory', { action: 'list' });
  if (r.error) return { text: r.error };
  if (!r.on) return { text: 'Clipboard history is off. It only records what you copy after you turn it on.', suggestions: ['Start clipboard history'] };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const m = s.match(/\bcopy (?:the )?(\d+|first|second|third|fourth|fifth)/);
  if (m) {
    const n = ORD[m[1]] || +m[1];
    const it = r.items[n - 1];
    if (!it) return { text: 'There is no item ' + n + ' in your clipboard history.' };
    await copyText(it.text);
    return { text: '✓ Copied item ' + n + ' back to your clipboard: "' + it.text.replace(/\s+/g, ' ').slice(0, 80) + (it.text.length > 80 ? '…' : '') + '"', speak: 'Copied item ' + n + '.' };
  }
  if (!r.items.length) return { text: 'Nothing has been copied since I started watching.' };
  return { text: 'Recently copied (newest first):\n' + r.items.slice(0, 10).map(x => x.n + '. `' + x.text.replace(/\s+/g, ' ').replace(/`/g, "'").slice(0, 80) + '`').join('\n') + '\n\nSay "copy the 2nd one" to reuse one.', speak: 'Here is what you copied recently.' };
}

/* ============ tool execution ============ */
// "ya ya song from telugu" → "ya ya telugu song", "the song called believer" → "believer"
function cleanMediaQuery(q) {
  return q
    .replace(/^(me |us )/, '')
    .replace(/^(the |a |some |that )?(song|songs|track|video|music)\s+(called|named|titled)\s+/, '')
    .replace(/\b(some|a|the|that)\s+(video|song|songs|track|music)\s+(of|by|about|called|named)\s+/, '')
    .replace(/\b(song|songs|track|video)\s+(from|in)\s+(the\s+)?(movie|film)\s+/, '$1 ')
    .replace(/\b(song|songs|track|video|music)\s+(from|in)\s+([a-z]+)\s*$/, '$3 $1')
    .replace(/\s+/g, ' ').trim();
}
const confirmPower =(question, yes, fn) => ({ text: question, confirm: { yes, no: 'CANCEL', onConfirm: fn } });
async function openSite(site, query) {
  const url = query && site.q ? site.q + encodeURIComponent(query) : site.url;
  toolStep('openUrl → ' + url);
  const r = await callTool('/tool/openUrl', { url });
  if (r.error) return { text: 'I could not open ' + site.n + ': ' + r.error };
  return { text: query ? 'Searching **' + site.n + '** for "' + query + '".' : 'Opening **' + site.n + '**.', tool: 'openUrl' };
}
function enableOnlineAction() {
  return [{ label: 'ENABLE ONLINE TOOLS', fn: () => { settings.online = true; saveSettings(); bindSwitchState('#onlineToggle', 'online'); updateNetUI(); log('warn', 'online tools enabled'); jarvisSay({ text: 'Online tools enabled. Ask me again.', intent: 'SETTINGS' }); } }];
}
async function fetchWeather(city) {
  const r = await callTool('/tool/weather', { city: city || settings.city || '', online: settings.online });
  return r;
}

async function executeTool(p, raw) {
  const s = p.text, a = p.args || {};
  // The tools live in tools/<area>.js (apps, web, tasks, study, system, files, code, productivity), registered in tools/registry.js. The area that knows
  // this intent answers; a crash names its area in the log and still reaches handleUser's error reply. A file that failed to load costs only its own area.
  for (const h of ToolHandlers.list) {
    let r;
    try { r = await h.fn(p, raw, s, a); }
    catch (e) { try { log('err', 'tool area "' + h.area + '" failed on ' + p.intent + ': ' + String(e && e.message || e).slice(0, 120)); } catch (e2) { /* logging is optional */ } throw e; }
    if (r !== ToolHandlers.NONE) return ToolHandlers.normalize(r);
  }
  return conversationReply(p) || { askLLM: true };
}

/* ============ LLM bridge ============ */
const LLM_TOOLS = {
  open_app: (a) => ({ intent: 'OPEN_APPLICATION', args: { app: a.app } }),
  close_app: (a) => ({ intent: 'CLOSE_APPLICATION', args: { app: a.app } }),
  open_url: (a) => ({ intent: 'OPEN_URL', args: { url: a.url } }),
  youtube: (a) => ({ intent: 'YOUTUBE', args: { query: a.query } }),
  web_search: (a) => ({ intent: 'WEB_SEARCH', args: { query: a.query } }),
  weather: (a) => ({ intent: 'WEATHER', args: { city: a.city } }),
  set_timer: (a) => ({ intent: 'SET_TIMER', args: { seconds: a.seconds, label: a.label } }),
  remind: (a) => ({ intent: 'REMIND', args: { text: a.text, when: a.when }, text: 'remind me ' + (a.when || '') }),
  add_todo: (a) => ({ intent: 'ADD_TODO', args: { text: a.text } }),
  list_todos: () => ({ intent: 'LIST_TODOS' }),
  add_deadline: (a) => ({ intent: 'ADD_DEADLINE', args: { title: a.title, due: a.due } }),
  list_deadlines: () => ({ intent: 'LIST_DEADLINES' }),
  add_class: (a) => ({ intent: 'ADD_CLASS', args: { name: a.name, day: a.day, time: a.time } }),
  next_class: () => ({ intent: 'NEXT_CLASS' }),
  focus: (a) => ({ intent: 'FOCUS_START', args: { minutes: a.minutes } }),
  volume: (a) => ({ intent: { up: 'VOLUME_UP', down: 'VOLUME_DOWN' }[a.action] || 'VOLUME_MUTE', args: { action: a.action } }),
  media: (a) => ({ intent: { next: 'MEDIA_NEXT', prev: 'MEDIA_PREV', stop: 'MEDIA_STOP' }[a.key] || 'MEDIA_PLAY' }),
  screenshot: () => ({ intent: 'SCREENSHOT' }),
  battery: () => ({ intent: 'SYS_BATTERY' }),
  system_info: () => ({ intent: 'SYS_ALL' }),
  processes: () => ({ intent: 'SYS_PROCESSES' }),
  lock: () => ({ intent: 'SYS_LOCK' }),
  network: () => ({ intent: 'SYS_NETWORK' }),
  write_note: (a) => ({ intent: 'WRITE_FILE', args: { name: a.name, content: a.content } }),
  read_file: (a) => ({ intent: 'READ_FILE', args: { name: a.name } }),
  list_files: (a) => ({ intent: 'LIST_FILES', args: { dir: a.dir } }),
  count_folders: (a) => ({ intent: 'COUNT_FOLDERS', args: { scope: a.scope } }),
  create_folder: (a) => ({ intent: 'CREATE_FOLDER', args: { name: a.name, base: a.where } }),
  git_status: () => ({ intent: 'GIT_STATUS' }),
  briefing: () => ({ intent: 'BRIEFING' }),
  save_code: (a) => ({ intent: 'SAVE_CODE', args: { name: a.name } }),
  run_file: (a) => ({ intent: 'RUN_FILE', args: { name: a.name && !/^(it|that|this)$/i.test(a.name) ? a.name : '' }, text: 'run it' }),
  open_in_editor: (a) => ({ intent: 'OPEN_IN_EDITOR', args: { name: a.name && !/^(it|that|this)$/i.test(a.name) ? a.name : '' } }),
  code_ask: (a) => ({ intent: 'CODE_ASK', args: { tool: a.tool, folder: a.folder, prompt: a.prompt } }),
  clipboard_to_file: (a) => ({ intent: 'CLIPBOARD_TO_FILE', args: { name: a.name } }),
  copy_code: () => ({ intent: 'COPY_CONTENT', text: 'copy that code' }),
  paste_to_editor: () => ({ intent: 'PASTE_TO_EDITOR', text: 'paste that code into my editor' }),
  save_snippet: (a) => ({ intent: 'SNIPPET_SAVE', args: { name: a.name }, text: 'save that code as snippet' }),
  copy_snippet: (a) => ({ intent: 'SNIPPET_COPY', args: { name: a.name }, text: 'copy snippet' }),
  block_distractions: () => ({ intent: 'BLOCK_DISTRACTIONS' }),
  show_desktop: () => ({ intent: 'SHOW_DESKTOP' }),
  productivity_report: () => ({ intent: 'PRODUCTIVITY_REPORT' }),
  open_best: (a) => ({ intent: 'OPEN_WEB', args: { query: a.query } }),
  research: (a) => ({ intent: 'RESEARCH', args: { query: a.query } }),
  contests: (a) => ({ intent: 'CONTESTS', args: { platform: a.platform }, text: 'upcoming contests' }),
  plan_day: () => ({ intent: 'PLAN_DAY' }),
  summarise_file: (a) => ({ intent: 'SUMMARISE_FILE', args: { name: a.name } }),
  ask_files: (a) => ({ intent: 'ASK_FILES', args: { query: a.query } }),
  make_flashcards: (a) => ({ intent: 'FLASH_MAKE', args: { name: a.name && !/^(that|this|it)$/i.test(a.name) ? a.name : '' }, text: a.name && /^(that|this|it)$/i.test(a.name) ? 'make flashcards from that' : 'make flashcards' }),
  review_flashcards: (a) => ({ intent: 'FLASH_REVIEW', args: { deck: a.deck } }),
  clone_repo: (a) => ({ intent: 'GIT_CLONE', args: { url: a.url } }),
  run_routine: (a) => ({ intent: 'ROUTINE_RUN', args: { name: a.name } }),
  set_theme: (a) => ({ intent: 'THEME_SET', args: { theme: String(a.theme || '').toLowerCase() } }),
  switch_persona: (a) => ({ intent: 'PERSONA_SET', args: { persona: String(a.persona || '').toLowerCase() } }),
  diagnostics: () => ({ intent: 'DIAGNOSTICS' }),
  read_screen: (a) => ({ intent: a.explain ? 'SCREEN_EXPLAIN' : 'SCREEN_READ', args: { explain: a.explain } }),
  brightness: (a) => ({ intent: 'BRIGHTNESS', args: { level: a.level }, text: 'set brightness to ' + a.level }),
  dark_mode: (a) => ({ intent: 'DARK_MODE', args: { on: a.on }, text: a.on === false || a.on === 'false' ? 'light mode' : 'dark mode' }),
  set_volume: (a) => ({ intent: 'VOLUME_SET', args: { level: a.level }, text: 'set volume to ' + a.level }),
  arrange_window: (a) => ({ intent: 'WINDOW_LAYOUT', args: { app: a.app, position: a.position } }),
  locate_project: (a) => ({ intent: 'LOCATE_PROJECT', args: { name: a.name } }),
  start_process: (a) => ({ intent: 'START_PROCESS', args: { name: a.name, which: a.which } }),
  stop_process: (a) => ({ intent: 'STOP_PROCESS', args: { name: a.name, which: a.which } }),
  open_project_url: (a) => ({ intent: 'OPEN_PROJECT_URL', args: { name: a.name, which: a.which || 'frontend' } }),
  distance: (a) => ({ intent: 'DISTANCE', args: { from: a.from, to: a.to } }),
  directions: (a) => ({ intent: 'DIRECTIONS', args: { from: a.from, to: a.to } }),
  open_directions: (a) => ({ intent: 'DIRECTIONS_OPEN', args: { from: a.from, to: a.to } }),
  check_compiler: (a) => ({ intent: 'CHECK_COMPILER', args: { language: a.language } }),
  check_extension: (a) => ({ intent: 'CHECK_EXTENSION', args: { language: a.language } }),
  check_exists: (a) => ({ intent: 'CHECK_EXISTS', args: { name: a.name } }),
};
let llmAbort = null;
function llmContext() {
  return {
    name: memGet('name'),
    memory: memory.filter(m => m.key !== 'name').map(m => m.value),
    tasks: [
      ...todos.filter(t => !t.done).map(t => 'To-do: ' + t.text),
      ...deadlines.filter(d => !d.done && d.due > Date.now()).map(d => 'Deadline: ' + d.title + ' due ' + new Date(d.due).toDateString()),
      ...upcomingClasses(new Date()).slice(0, 3).map(x => 'Class: ' + x.c.name + ' ' + x.at.toDateString() + ' ' + fmtTime(x.at)),
    ],
    responseLen: settings.responseLen,
    address: Persona.sir(),
    language: Lang.aiInEnglish() ? 'en' : Lang.replyLang(),
    persona: settings.persona,
    focus: typeof focusSummary === 'function' ? focusSummary() : '',
  };
}
const FACTUAL = /^(who|when|where)\b|^what (is|are|was|were) (the |a |an )?(capital|population|height|age|meaning|founder|ceo|president|prime minister)\b|^who is [a-z]+( [a-z]+){0,3}$/;
// Learning / concept requests go straight to the AI tutor, never to an automatic web search.
const LEARNING = /\b(teach|explain|learn|tutorial|basics?|concepts?|examples?|how (to|do|does|can)|implement|code|program|algorithm|data structures?|stacks?|queues?|linked list|trees?|graphs?|recursion|sorting|in (python|java|c\+\+|javascript|c))\b/;
// Explicit length requests: "in 2 lines", "in one sentence", "in 50 words", "3 points", "a one-liner".
const NUM_WORDS = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function lengthLimit(t) {
  t = String(t || '').toLowerCase();
  if (/\bone[- ]?liner\b/.test(t)) return { n: 1, unit: 'line' };
  const m = t.match(/\b(?:in|within|under|using|only|just|max(?:imum)?|at most|no more than)\s+(?:a |an |one )?(\d{1,3}|a|an|one|single|two|three|four|five|six|seven|eight|nine|ten)[\s-]+(lines?|sentences?|words?|points?|bullet points?|bullets?)\b/)
    || t.match(/\b(\d{1,2}|one|single|two|three|four|five)[\s-]+(line|sentence|word|point)\s+(?:answer|explanation|summary|definition|reply|description)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : NUM_WORDS[m[1]];
  const unit = /^line/.test(m[2]) ? 'line' : /^sent/.test(m[2]) ? 'sentence' : /^word/.test(m[2]) ? 'word' : 'point';
  if (!n || n > (unit === 'word' ? 500 : 30)) return null;
  return { n, unit };
}
// Guarantee the limit even if the model overshoots (code answers are left alone).
function enforceLimit(text, lim) {
  if (!lim || /```/.test(text)) return text;
  const rows = text.split('\n').map(x => x.trim()).filter(x => x && !/^#{1,6}\s/.test(x) && !/^[-*_]{3,}$/.test(x));
  if (lim.unit === 'point') {
    const out = []; let k = 0;
    for (const r of rows) { const b = /^([-*•]|\d+[.)])\s/.test(r); if (b && k >= lim.n) break; if (b) k++; if (b || !k) out.push(r); }
    return k ? out.join('\n') : text;
  }
  const flat = rows.map(r => r.replace(/^([-*•]|\d+[.)])\s+/, '')).join(' ').replace(/\s+/g, ' ').trim();
  if (lim.unit === 'word') {
    const w = flat.split(' ');
    if (w.length <= lim.n) return flat;
    const cut = w.slice(0, lim.n).join(' '), end = cut.search(/[.!?][^.!?]*$/);
    return end > cut.length * .6 ? cut.slice(0, end + 1) : cut.replace(/[,;:]$/, '') + '…';
  }
  const sents = flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(*`])/);
  const out = [];
  for (const x of sents) {
    // A short lead-in ("Certainly, sir.") doesn't count as one of the lines; it stays attached to the first.
    if (!out.length && sents.length > lim.n && x.split(' ').length <= 5 && /^(certainly|of course|right|very well|sure|absolutely|indeed|an excellent|a fine|good question)/i.test(x)) { out.lead = x; continue; }
    if (out.length >= lim.n) break;
    out.push(x);
  }
  if (out.lead && out.length) out[0] = out.lead + ' ' + out[0];
  return out.join(lim.unit === 'line' ? '\n' : ' ');
}
/* ============ rolling conversation memory ============ */
// Chat history grows past the 14-message window the model sees. Older turns are folded into one compact
// rolling summary (jarvis.chatSummary) so "what were we talking about?" still works tomorrow.
const CHAT_WINDOW = 13;                 // matches askLLM's slice(-13, -1)
function rollingSummaryFor(keptMessages) {
  const sum = store.get('jarvis.chatSummary', null);
  if (!sum || !sum.text) return null;
  return String(sum.text).slice(0, 3800);
}
async function maybeSummarizeChat() {
  const OVER = 14;
  if (chatLog.length < OVER + 6) return;
  const sum = store.get('jarvis.chatSummary', null);
  // Anchored on the last summarized message's timestamp, so trimming and restarts don't shift the marker.
  const coveredT = (sum && sum.coveredT) || 0;
  let covered = chatLog.findIndex(m => (m.t || 0) > coveredT);
  if (covered < 0) covered = chatLog.length;
  const olderEnd = chatLog.length - OVER;            // messages [covered, olderEnd) sit outside the model's window
  if (olderEnd - covered < 8) return;                // not enough new material yet
  const slice = chatLog.slice(covered, olderEnd).filter(m => m && m.text).map(m => (m.role === 'user' ? 'User: ' : 'JARVIS: ') + String(m.text).slice(0, 400));
  if (!slice.length) return;
  try {
    const prev = sum && sum.text ? 'Summary so far:\n' + String(sum.text).slice(0, 2500) + '\n\n' : '';
    const out = await fetch(API + '/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prev + slice.join('\n'), instruction: 'Merge into an updated rolling summary of this conversation: key facts, decisions, questions still open. Under 250 words, plain text, no preamble.' }) });
    if (!out.ok) return;
    const j = await out.json().catch(() => null);
    const text = j && j.summary;
    if (!text) return;
    store.set('jarvis.chatSummary', { text, coveredT: chatLog[olderEnd - 1].t || Date.now(), at: Date.now() });
    log('ai', 'Conversation memory updated (through ' + olderEnd + ' messages)');
  } catch { /* offline / AI off — try again after more messages pile up */ }
}
// "what were we talking about?" — a plain answer from the rolling summary, not a fresh AI guess.
function chatMemoryReply() {
  const sum = store.get('jarvis.chatSummary', null);
  if (!sum || !sum.text) return { text: 'We have not talked long enough for me to remember a thread, ' + Persona.sir() + '. Keep chatting and I will keep the thread.' };
  const d = new Date(sum.at || Date.now());
  return { text: 'From our conversation so far:\n\n' + String(sum.text).slice(0, 1200) + '\n\n_(memory updated ' + fmtDay(d) + ' at ' + fmtTime(d) + ')_', tool: 'memory' };
}
async function askLLM(userText, opts) {
  opts = opts || {};
  // "in 2 lines" limits come from what the user typed — never from a file or web page inside a tool prompt
  // (a PDF with a "One-Line Explanation" column must not cut the answer to one line).
  const limit = lengthLimit(opts.limitText !== undefined ? opts.limitText : userText);
  const node = addMsg('jarvis', '');
  const thinkingMsg = llm.warm ? 'thinking' : 'loading model — first reply is slow';
  node.bodyEl.innerHTML = '<span class="thinking"><span></span><span></span><span></span><em>' + thinkingMsg + '</em></span>';
  setState('PROCESSING', 'Thinking with ' + llm.model + '…'); engine('llm', true);
  // noHistory: the prompt already holds everything needed (e.g. excerpts from your files) — earlier chat would only
  // bias the answer (a small model copies the style of its previous replies).
  const history = opts.noHistory ? [] : chatLog.slice(-13, -1).filter(m => m.text).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  // Rolling memory: when older messages exist beyond the window, add the rolling summary so context survives.
  const earlier = opts.noHistory ? null : rollingSummaryFor(history.length);
  let content = userText;
  if (opts.web) content += '\n\n[Web lookup (' + opts.web.source + '): ' + opts.web.answer + ']\nUse this if relevant.';
  history.push({ role: 'user', content });
  llmAbort = new AbortController();
  const t0 = performance.now();
  let acc = '', raf = 0;
  // Speak while writing: only for ordinary chat answers in English, with the voice on, and never when the answer is cut to "N lines".
  const early = (opts.earlySpeech && settings.tts && settings.speakWhileWriting !== false && !limit && Lang.replyLang() === 'en')
    ? SpeechStream.createEarly({ enqueue: t => speechQueue.add(t), isEnglish: t => Lang.detect(t) === 'en' }) : null;
  // setTimeout rather than rAF so streaming still renders when the window is in the background.
  const paint = () => { raf = 0; if (!/^\s*</.test(acc)) { node.bodyEl.innerHTML = renderMD(acc); node.bodyEl.classList.add('typing'); messages.scrollTop = messages.scrollHeight; } };
  try {
    const res = await fetch(API + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: llmAbort.signal,
      body: JSON.stringify({ messages: history, context: Object.assign(llmContext(), limit ? { limit } : {}, earlier ? { earlier } : {}, opts.noTools ? { noTools: true } : {}), model: llm.model, imageToken: opts.imageToken })
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'HTTP ' + res.status); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const j = JSON.parse(line); if (j.error) throw new Error(j.error); if (j.message && j.message.content) { acc += j.message.content; if (early && !early.dead) { if (/<</.test(acc)) early.cancel(); else early.feed(j.message.content); } if (acc.length === j.message.content.length) setState('SPEAKING', 'Answering…'); if (!raf) raf = setTimeout(paint, 50); } } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
      }
    }
    llm.warm = true; bumpStat('aiQuestions');
  } catch (e) {
    node.bodyEl.classList.remove('typing');
    engine('llm', false); llmAbort = null; if (early) { early.cancel(); speechQueue.clear(); }
    if (e.name === 'AbortError') { node.bodyEl.innerHTML = renderMD(acc ? acc + '\n\n_(stopped)_' : '_(stopped)_'); if (acc) logChat('assistant', acc, 'LOCAL AI · stopped'); return { delivered: true }; }
    node.root.remove();
    log('err', 'AI brain error: ' + e.message);
    if (/unavailable|ECONNREFUSED|fetch failed/i.test(e.message)) { llm.online = false; updateLLMUI(); }
    return null;
  }
  if (raf) clearTimeout(raf);
  engine('llm', false); llmAbort = null;
  node.bodyEl.classList.remove('typing');
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const tm = acc.match(/<<\s*([a-z_]+)\s*(\{[\s\S]*?\})?\s*>>/);
  // Any tool line — known or invented — goes to the server for validation (handleUser), never straight to executeTool.
  if (tm && !opts.noTools) {
    if (early) { early.cancel(); stopSpeaking(); }   // a tool call is about to run: nothing half-said
    node.root.remove();
    let args = {};
    try { args = tm[2] ? JSON.parse(tm[2]) : {}; } catch (e) {}
    log('ai', 'AI chose tool: ' + tm[1] + ' ' + JSON.stringify(args) + ' (' + secs + 's)');
    const mapped = LLM_TOOLS[tm[1]] ? LLM_TOOLS[tm[1]](args) : { intent: 'UNKNOWN' };
    return { tool: { intent: mapped.intent, args: mapped.args || {}, rawArgs: args, text: (mapped.text || userText).toLowerCase(), original: userText, confidence: .9, tool: tm[1] } };
  }
  let answer = acc.replace(/<<[\s\S]*?>>/g, '').trim() || 'I am not sure how to answer that.';
  if (limit) { const cut = enforceLimit(answer, limit); if (cut !== answer) log('ai', 'Trimmed the answer to ' + limit.n + ' ' + limit.unit + (limit.n > 1 ? 's' : '') + ' as asked'); answer = cut; }
  node.bodyEl.innerHTML = renderMD(answer);
  messages.scrollTop = messages.scrollHeight;
  log('ai', 'AI answered in ' + secs + 's (' + answer.length + ' chars)');
  const earlyResult = early ? early.finish() : null;   // says the last sentence, and whether "the full answer is on screen" is needed
  return { node, text: answer, limit, early: earlyResult, meta: 'LOCAL AI · ' + llm.model + ' · ' + secs + 's' + (opts.web ? ' · +' + opts.web.source : '') };
}

/* ============ main turn pipeline ============ */
let busy = false; const inputQueue = [];
const cmdHistory = store.get('jarvis.cmdHistory', []); let histIdx = -1;
async function askOrFinishGuidedFlow(flowId, step, answers) {
  const flow = Agent.GUIDED_FLOWS[flowId];
  if (step < flow.steps.length) {
    ctx.pending = { intent: 'GUIDED_FLOW', flow: flowId, step, answers };
    await deliver({ text: flow.steps[step].q }, { intent: 'AGENT_RUN', confidence: 1 });
    return;
  }
  const flowResult = flow.finish ? await flow.finish(answers) : await finishStudyPlan(answers);
  await deliver(flowResult, { intent: 'AGENT_RUN', confidence: 1 });
}
// STUDY_PLAN's finish: a real deadline (via the existing ADD_DEADLINE rule handler) plus one real to-do per
// topic (existing ADD_TODO rule handler) — reuses executeTool directly instead of Agent.execute's multi-step
// plan pipeline, since these are the same "safe" rule-tier actions REMIND/ADD_DEADLINE already use.
async function finishStudyPlan(a) {
  const due = a.due.toLowerCase();
  const examResult = await executeTool({ intent: 'ADD_DEADLINE', text: due, args: { title: a.title, due } }, due);
  const topics = a.topics.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
  for (const topic of topics) await executeTool({ intent: 'ADD_TODO', text: '', args: { text: 'Study: ' + topic + ' — for ' + a.title } }, '');
  const summary = (examResult && examResult.text ? examResult.text : 'Deadline saved.')
    + (topics.length ? '\n\nAlso added ' + plural(topics.length, 'study to-do') + ':\n' + topics.map(t => '- Study: ' + t).join('\n') : '');
  return { text: summary, noPersona: true };
}
function resolvePending(norm) {
  const pd = ctx.pending; ctx.pending = null;
  if (!pd) return null;
  const s = norm.text;
  // Bare affirmations / refusals ("yes", "no") answer the pending question itself — never a file name.
  const AFFIRM = /^(y|yes|yeah|yep|yup|ya|sure|ok(?:ay)?|please do|do it|go ahead|proceed|create it|save it|make it|yes (please|sure))$/i;
  const NEG = /^(n|no|nope|nah|none|cancel|never ?mind|forget it|stop)$/i;
  const bare = norm.original.trim().replace(/[.!?]+$/, '');
  if (pd.intent === 'FLASH_ANSWER') {
    if (/^(stop|quit|end|exit|cancel)( (the )?(flash ?cards?|review|session|quiz))?$/.test(s)) { if (flashSession) flashSession.i = flashSession.queue.length; return { intent: 'FLASH_END' }; }
    return { intent: 'FLASH_ANSWER', args: { id: pd.id, answer: norm.original }, text: s };
  }
  if (pd.intent === 'CONFIRM_INTENT') {   // "Did you mean …?" (medium confidence) — yes runs it, no drops it
    const t = norm.original.trim().toLowerCase().replace(/[.!?]+$/, '');
    if (/^(?:y|yes|yeah|yep|yup|sure|correct|right|exactly|ok(?:ay)?|do it|go ahead|please)$/.test(t)) return Object.assign({}, pd.p, { confidence: 0.95, fromPending: true });
    if (/^(?:n|no|nope|nah|wrong|not that|cancel)$/.test(t)) return { intent: 'CANCELLED' };
    return null;
  }
  if (pd.intent === 'DID_YOU_MEAN') {   // "yes" / "2" / "the second one" / "no" — anything else is a new request
    const t = norm.original.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/,?\s*(?:please|sir|jarvis)$/, '');
    let i = /^(?:y|yes|yeah|yep|yup|ya|sure|correct|right|exactly|that one|that's it|thats it|ok(?:ay)?|(?:the )?first(?: one)?)$/.test(t) ? 0 : null;
    const num = t.match(/^(?:the\s+)?(?:number\s+|no\.?\s*|#)?(\d)(?:st|nd|rd|th)?(?:\s+one)?$/);
    if (num) i = +num[1] - 1;
    const ord = t.match(/^(?:the\s+)?(second|third|fourth|fifth|last)(?:\s+one)?$/);
    if (ord) i = ORDINAL[ord[1]] === -1 ? pd.paths.length - 1 : ORDINAL[ord[1]] - 1;
    if (i !== null && pd.paths[i]) {
      const path = pd.paths[i], dir = !!pd.dirs[i];
      if (pd.then === 'list' && dir) return { intent: 'LIST_FILES', args: { dir: path }, text: s, original: 'list files' };
      if (pd.then === 'count' && dir) return { intent: 'COUNT_FOLDERS', args: { scope: path }, text: s, original: 'count folders' };
      return { intent: 'SHOW_PICK', args: { path, dir, open: pd.then === 'open' }, text: s };
    }
    if (/^(?:n|no|nope|nah|none|neither|not that|not those|wrong|none of them|none of these)\b/.test(t)) return { intent: 'CANCELLED' };
    return null;
  }
  if (/^(cancel|never ?mind|forget it|no|stop)$/.test(s)) return { intent: 'CANCELLED' };
  if (pd.intent === 'REMIND' && NLU.parseWhen(s)) return { intent: 'REMIND', args: { text: pd.text, when: s }, text: s };
  if (pd.intent === 'ADD_DEADLINE' && NLU.parseDate(s)) return { intent: 'ADD_DEADLINE', args: { title: pd.title, due: s }, text: s };
  if (pd.intent === 'SET_TIMER' && /\d/.test(s)) return { intent: 'SET_TIMER', args: {}, text: 'timer ' + s };
  if (pd.intent === 'CREATE_FOLDER' && /^[\w\- .()]{1,60}$/.test(norm.original.trim().replace(/^(?:call it|name it|called|named)\s+/i, '')))
    return { intent: 'CREATE_FOLDER', args: { name: norm.original.trim().replace(/^(?:call it|name it|called|named)\s+/i, ''), base: pd.base }, text: s, original: 'create a folder' };
  if (pd.intent === 'GIT_COMMIT') return { intent: 'GIT_COMMIT', args: {}, text: s, original: 'commit with message ' + norm.original };
  if (pd.intent === 'WRITE_FILE') {
    if (NEG.test(bare)) return { intent: 'CANCELLED' };
    const vague = /^(your (wish|choice)|anything|whatever|you (choose|decide|pick|name it)|i (don't|dont) mind|as you (wish|like)|default|surprise me)$/i.test(bare);
    let name = extractFileName('as ' + norm.original.trim()) || '';
    if (!name && /^[\w\-() ]{1,60}$/.test(bare) && !vague && !AFFIRM.test(bare)) name = bare.replace(/\s+/g, '_');
    if (!name) {
      // "your wish" / "yes" with no name yet: prefer "<project>.<ext>" when the request named a project
      // ("continue in the calculator project" → calculator.py), else <folder>.<ext>, else main.<ext>.
      const proj = (pd.hint || '').match(/\bproject\s+([a-z0-9][\w\-]{1,30})/i)
        || (m => (m && !/^(same|the|my|that|this|current|new|last|whole|entire)$/i.test(m[1]) && m))(pd.hint || '').match(/([a-z0-9][\w\-]{1,30})\s+project\b/i);
      const base = (proj && (proj[1] || proj[2])) || (pd.folder || '').split(/[\\/]/).filter(Boolean).pop() || 'main';
      const stem = base.replace(/[^\w\-]/g, '').slice(0, 40) || 'main';
      name = stem + (LANG_EXT[pd.lang] || '.md');
    }
    return { intent: 'WRITE_FILE', args: { name, folder: pd.folder, where: pd.where, lang: pd.lang, hint: pd.hint, needsCode: pd.needsCode }, text: s, original: 'create file ' + name };
  }
  if (pd.intent === 'SAVE_CODE' && pd.askWhere) {
    const ans = norm.original.trim().replace(/[.!?]+$/, '').replace(/^(?:save it |put it |in |on |to |at |inside |into )+/i, '').replace(/^(?:the |my )+/i, '').replace(/\s+folder$/i, '').trim();
    const where = /^(?:jarvis|jarvis folder|~\/jarvis|default|here|anywhere|you choose|your choice|sandbox|wherever)$/i.test(ans) ? '' : ans;
    return { intent: 'SAVE_CODE', args: { code: pd.code, name: pd.name, folder: pd.folder, where }, text: s, original: 'save the code' };
  }
  if (pd.intent === 'SAVE_CODE' && pd.code && !pd.askWhere && AFFIRM.test(bare))
    return { intent: 'SAVE_CODE', args: { code: pd.code, name: pd.name || '', folder: pd.folder, where: pd.where }, text: s };
  if (pd.intent === 'SAVE_CODE' && !AFFIRM.test(bare) && !NEG.test(bare) && /^[\w\-.\/\\: ]{1,80}$/.test(norm.original.trim())) return { intent: 'SAVE_CODE', args: { code: pd.code, name: extractFileName('as ' + norm.original.trim()) || norm.original.trim() }, text: s };
  if ((pd.intent === 'DIRECTIONS' || pd.intent === 'DIRECTIONS_OPEN' || pd.intent === 'DISTANCE') && norm.original.trim().length >= 2) return { intent: pd.intent, args: { from: norm.original.trim(), to: pd.to }, text: s };
  return null;
}
// Shows an AI answer (plus sources / suggestion chips) and then runs any follow-up work.
async function finishAIAnswer(ai, after, p) {
  // "ANSWER FROM MEMORY" (it needed the web, Online tools was off): say so above the answer
  if (ctx.fromMemory) { ctx.fromMemory = false; ai.text = '⚠ _From my training data, without searching — this may be out of date._\n\n' + ai.text; }
  // the inspector, under AI answers too
  if (turnTrace && !turnTrace.done) { turnTrace.done = true; turnTrace.ms = Math.round(performance.now() - turnTrace.t0); lastTrace = turnTrace; if (settings.inspect && ai.node && ai.node.extraEl) ai.node.extraEl.appendChild(traceBlock(turnTrace)); }
  const isData = after && (after.flashDeck !== undefined || after.plan || after.copyAnswer || after.copyBack || after.save !== undefined);
  if (!isData && !ai.limit) ai.text = Persona.leadIn(ai.text);
  if (after && after.sources) ai.text += after.sources;
  // Telugu/Kannada: the AI answered in English; translate the finished answer (code, links and numbers kept).
  if (!isData && Lang.replyLang() !== 'en' && Lang.detect(ai.text) === 'en') {
    ai.node.bodyEl.innerHTML = renderMD(ai.text) + '<p class="translating"><em>' + ({ te: 'తెలుగులోకి అనువదిస్తున్నాను…', kn: 'ಕನ್ನಡಕ್ಕೆ ಅನುವಾದಿಸುತ್ತಿದ್ದೇನೆ…' }[Lang.replyLang()]) + '</em></p>';
    const t0 = performance.now();
    const tr = await Lang.localize(ai.text);
    if (tr !== ai.text) { ai.text = tr; ai.meta += ' · translated ' + ((performance.now() - t0) / 1000).toFixed(1) + 's'; }
  }
  ai.node.bodyEl.innerHTML = renderMD(ai.text);
  await deliver({ node: ai.node, text: ai.text, meta: ai.meta, suggestions: after && after.suggestions, actions: ai.chips, spokenEarly: !!(ai.early && ai.early.spoke), earlySuffix: ai.early ? ai.early.suffix : '' }, p);
  if (after) await runAfter(after, ai.text, p);
}
// Follow-up work after an AI answer: save its code to a file (and run it) or copy it back to the clipboard.
async function runAfter(after, aiText, p) {
  if (after.flashDeck !== undefined) {
    const cards = parseFlashcards(aiText, after.flashDeck || 'General');
    if (!cards.length) { await deliver({ text: 'The AI did not return cards in the expected format. Try again, maybe with a smaller file.' }, p); return; }
    flashcards = flashcards.concat(cards); saveFlash();
    await deliver({ text: '✓ Added **' + plural(cards.length, 'flashcard') + '** to the deck **' + cards[0].deck + '**.', speak: 'Created ' + cards.length + ' flashcards.', suggestions: ['Review my ' + cards[0].deck + ' flashcards'], intent: 'FLASH_MAKE', tool: 'flashcards' }, p);
    return;
  }
  if (after.plan) { await deliver(planReply(parsePlan(aiText), true), p); return; }
  if (after.copyAnswer) {
    const c = extractCode(aiText);
    const plain = c ? c.code : aiText.replace(/^\s*(here'?s|here is|sure[,!]?)[^\n]*:\s*\n/i, '').replace(/\*\*|__|^#+\s*/gm, '').replace(/`/g, '').trim();
    await copyText(plain);
    await deliver({ text: '✓ Copied to your clipboard — paste it with Ctrl+V.', speak: 'Copied to your clipboard.', suggestions: ['Paste that code into my editor'].filter(() => !!c), intent: 'DRAFT_COPY', tool: 'writeClipboard' }, p);
    return;
  }
  if (!after.copyBack && after.save === undefined) return;
  const code = extractCode(aiText);
  if (!code) { await deliver({ text: 'The answer did not contain a code block, so there was nothing to ' + (after.copyBack ? 'copy' : 'save') + '.' }, p); return; }
  if (after.copyBack) {
    await copyText(code.code);
    await deliver({ text: '✓ Result copied to your clipboard (' + plural(lines(code.code), 'line') + ') — press Ctrl+V to paste.', speak: 'Copied to your clipboard.', suggestions: ['Paste that code into my editor'], intent: 'CLIP_TRANSFORM', tool: 'writeClipboard' }, p);
  }
  if (after.save !== undefined) {
    const res = await executeTool({ intent: 'SAVE_CODE', args: { name: after.save, code, run: after.run, where: after.where, folder: after.folder }, text: 'save', original: 'save' }, 'save');
    await deliver(res, { intent: 'SAVE_CODE', confidence: 1 });
    if (after.run && res && res.saved && RUNNABLE.test(res.saved)) {
      setState('EXECUTING', 'Running…');
      const out = await executeTool({ intent: 'RUN_FILE', args: { name: res.saved }, text: 'run it', original: 'run it' }, 'run it');
      await deliver(out, { intent: 'RUN_FILE', confidence: 1 });
    }
  }
}
async function deliver(result, p) {
  if (!result) return;
  const items = Array.isArray(result) ? result : [result];
  // The inspector: this turn's trace goes with its first reply (and becomes "the last one" for "how did you understand that").
  if (turnTrace && !turnTrace.done && items[0] && !items[0].showTrace) {
    turnTrace.done = true; traceRoute(p && p.viaAI ? 'AI' : 'rules → ' + ((items[0] && items[0].tool) || (p && p.intent) || ''));
    turnTrace.ms = Math.round(performance.now() - turnTrace.t0); items[0].trace = turnTrace; lastTrace = turnTrace;
    // what happened, for "same project" / follow-ups
    if (p && p.intent && !/^(CANCELLED|CONVERSATION|CONFIRM)$/.test(p.intent)) ctx.focus.lastAction = { intent: p.intent, summary: String(items[0].text || '').split('\n')[0].slice(0, 160), t: Date.now() };
  }
  for (const it of items) {
    if (!it.meta) { it.intent = it.intent || p.intent; it.tool = it.tool || null; it.meta = it.intent + (it.tool ? ' · ' + it.tool + '()' : '') + (p.viaAI ? ' · via AI' : ' · ' + (p.confidence || 1).toFixed(2)); }
    // Rule-based replies get JARVIS's voice; AI answers (it.node) already have it via the system prompt.
    if (!it.node && !it.noPersona && it.text) {
      const v = Persona.jarvisify(it.text, it.speak, it.intent || p.intent);
      it.text = v.text; if (v.speak) it.speak = v.speak;
    }
    // Telugu / Kannada replies: short plain answers are translated (code, lists and tables stay as they are).
    if (!it.node && !it.noLocalize && it.text && Lang.replyLang() !== 'en') {
      const t2 = await Lang.localize(it.text);
      if (t2 !== it.text) { it.text = t2; it.speak = t2; }
    }
    replyQ.push(it);
  }
  pump();
}
// Your folder/project names and drive letters, for repairing what the speech recogniser heard (speechfix.js).
const voiceVocab = { names: [], drives: [] };
async function loadVoiceVocab() {
  try { const r = await fetch(API + '/voice/vocab').then(x => x.json()); if (r && r.success) { voiceVocab.names = r.names || []; voiceVocab.drives = r.drives || []; } } catch (e) {}
}
// Undo that survives a reload: the server remembers how to reverse each file action of the last 30 minutes (undolog.js); put them back on the undo stack.
async function restoreUndoFromServer() {
  try {
    const r = await getJSON('/undo/pending');
    if (!r || !Array.isArray(r.items) || !r.items.length) return;
    const n = Undo.restore(r.items.map(i => ({ label: i.label, t: i.t, fn: async () => { const x = await callTool(i.endpoint, i.body); if (x && x.error) throw new Error(x.error); return 'Undone: ' + i.label + '.'; } })));
    if (n) log('info', 'undo: ' + n + ' earlier action' + (n === 1 ? '' : 's') + ' from before the reload can still be undone');
  } catch (e) { /* undo from before the reload is simply not available */ }
}
setTimeout(restoreUndoFromServer, 1500);
setTimeout(loadVoiceVocab, 20000); setInterval(loadVoiceVocab, 10 * 60 * 1000);   // after the laptop list is built; then every 10 min
// Skill packs (SKILL.md folders): load the list once the backend is up; try again if it wasn't ready.
setTimeout(() => { if (typeof Skills !== 'undefined') Skills.loadPacks(); }, 3000);
setTimeout(() => { if (typeof Skills !== 'undefined' && !Skills.packs.length) Skills.loadPacks(); }, 20000);
/* A single typed or spoken command that acts on the laptop without its own confirmation (closing an app, running a program, typing into the front window,
   starting or stopping a dev server, cloning a repo) is held to the same "confirm" tier the multi-step agent uses: a card says what is about to happen and
   nothing runs until YES. A misheard "close chrome" no longer kills the browser. (Commands that already ask for themselves — shutdown, Wi-Fi off, display off,
   git commit… — are not asked twice.) Returns the card, or null when the command may go ahead. */
const CONFIRM_GATE = { CLOSE_APPLICATION: 'close an app', RUN_FILE: 'run a program', PASTE_TO_EDITOR: 'type into the window in front', START_PROCESS: 'start a dev server', STOP_PROCESS: 'stop a dev server', GIT_CLONE: 'download a repository' };
function confirmGate(p, cmdText) {
  if (!CONFIRM_GATE[p.intent] || p.viaAgent || p.confirmed) return null;
  const tier = Agent.tierFor ? Agent.tierFor(p.intent, p.text || '') : ['confirm', ''];
  if (tier[0] === 'safe') return null;
  const heard = String(cmdText || p.original || p.text || '').trim().slice(0, 120);
  return { text: 'You asked me to **' + CONFIRM_GATE[p.intent] + '**: “' + heard + '”.\n\n' + (tier[1] || 'This acts on your laptop.') + ' Go ahead?', intent: p.intent, noPersona: true,
    confirm: { yes: 'YES, DO IT', no: 'CANCEL', onConfirm: async () => deliver(await executeTool({ ...p, confirmed: true }, cmdText), { intent: p.intent, confidence: 1 }) } };
}
/* Anything private that is about to leave the laptop for an ONLINE model asks first: the text you copied, a picture or the text of your screen, excerpts from
   your files, text you selected in another app. A local model (Ollama) never asks. One yes covers that kind until this page is reloaded; "no" sends nothing. */
const CLOUD_KIND = { EXPLAIN_CLIPBOARD: 'clipboard', CLIP_TOOL: 'clipboard', CLIP_TRANSFORM: 'clipboard', SCREEN_READ: 'screen', SCREEN_EXPLAIN: 'screen', CLIPBOARD_IMAGE_READ: 'screen', ASK_FILES: 'files', SUMMARISE_FILE: 'files', FLASH_MAKE: 'files', HOTKEY: 'selection' };
const CLOUD_WHAT = { clipboard: 'the text you copied', screen: 'a picture or the text of your screen', files: 'excerpts from your own files', selection: 'the text you selected' };
const cloudAllowed = new Set();
async function confirmCloud(kind) {
  if (!isCloudModel(llm.model) || cloudAllowed.has(kind)) return true;
  const prov = modelInfo(llm.model).providerLabel;
  const ok = typeof Extras !== 'undefined' && Extras.confirmCard ? await Extras.confirmCard('Your AI model runs online (**' + prov + '**). To answer, I would send them **' + (CLOUD_WHAT[kind] || 'this') + '**, which may be private. Send it? One yes covers this kind until you reload the page; to keep everything on this laptop, switch to a local model in Settings.', 'YES, SEND IT') : false;
  if (ok) cloudAllowed.add(kind);
  return ok;
}
async function handleUser(text, source) {
  text = (text || '').trim(); if (!text) return;
  if (typeof window.__lockPing === 'function') window.__lockPing();   // spoken commands count as "still here" for the auto-lock
  const rawHeard = text;   // for the inspector: what the mic gave us, before repairs
  // Spoken English: repair words the recogniser mishears ("front and" → frontend) before anything reads it.
  if ((source === 'voice' || source === 'wake') && typeof SpeechFix !== 'undefined' && Lang.detect(text) === 'en') {
    // …and your own folder/project names, matched by sound ("ugly loop folder" → AGRILOOP-1), and drive letters
    // that don't exist ("b drive" → D drive).
    const fixed = SpeechFix.fixNames(SpeechFix.fixDrives(SpeechFix.fix(text), voiceVocab.drives), voiceVocab.names);
    if (fixed && fixed !== text) { log('info', 'heard "' + text + '" → understood "' + fixed + '"'); text = fixed; }
  }
  // "stop" / "be quiet": cuts the voice and the answer being written, at any moment. Handled BEFORE the busy check, because in the middle of a reply the turn is busy.
  // It only acts while JARVIS is actually speaking or writing; otherwise it is an ordinary word again ("stop" ends a quiz, "stop coaching" ends coaching…).
  if (typeof SpeechStream !== 'undefined' && SpeechStream.STOP_TALKING.test(text) && (isSpeakingNow() || speechQueue.active || llmAbort)) {
    stopEverything();
    addMsg('user', text, { source: source || 'text' }); logChat('user', text, '', source || 'text');
    jarvisSay({ text: 'Stopped.', intent: 'STOP', noTTS: true, noPersona: true, noLog: true });
    return;
  }
  if (busy) { inputQueue.push([text, source]); toast('Queued: "' + text.slice(0, 40) + '"'); return; }
  // A permission card (ALLOW/CANCEL) is still on screen: typed "yes"/"no" presses it. Anything else is a
  // new request — the card stays up until it is answered or cancelled.
  if (typeof pendingApproval === 'function' && pendingApproval) {
    const t = String(text).trim().replace(/[.!?]+$/, '');
    if (typeof APPROVAL_YES !== 'undefined' && APPROVAL_YES.test(t)) { const done = pendingApproval; pendingApproval = null; addMsg('user', text, { source: source || 'text' }); logChat('user', text, '', source || 'text'); toast('Approved — carrying on…'); done(true); return; }
    if (!(typeof APPROVAL_NO !== 'undefined' && APPROVAL_NO.test(t))) {
      // not an answer: it waits its turn (the running turn is paused on the card)
      inputQueue.push([text, source]); toast('Waiting for your answer on the card above — say yes or no. Queued: "' + text.slice(0, 40) + '"', true); return;
    }
    if (typeof APPROVAL_NO !== 'undefined' && APPROVAL_NO.test(t)) { const done = pendingApproval; pendingApproval = null; addMsg('user', text, { source: source || 'text' }); logChat('user', text, '', source || 'text'); done(false); return; }
  }
  busy = true; const t0 = performance.now();
  turnTrace = { said: text, heard: rawHeard !== text ? rawHeard : '', source: source || 'text', t0, notes: [] };
  // ✏️ edit: the edited message replaces the original and its reply
  if (editing && source === 'text') { const e = editing; editing = null; const i = findUserEntry(e.text, e.t); if (i >= 0 && e.text !== text) deleteExchange(i, true); }
  try {
    stopSpeaking();
    addMsg('user', text, { source: source || 'text' }); logChat('user', text, '', source || 'text');
    if (cmdHistory[cmdHistory.length - 1] !== text) { cmdHistory.push(text); if (cmdHistory.length > 50) cmdHistory.shift(); store.set('jarvis.cmdHistory', cmdHistory); }
    log('info', 'input (' + (source || 'text') + '): "' + text + '"');
    setState('PROCESSING', 'Understanding…');

    // "switch to Telugu" / "తెలుగులో మాట్లాడు" / "english please"
    const sw = Lang.switchRequest(text);
    if (sw) { await deliver(setLanguage(sw), { intent: 'LANG_SWITCH', confidence: 1 }); return; }
    // Telugu / Kannada: translate to English for the rule engine; replies come back in the user's language.
    let cmdText = text;
    const inLang = Lang.detect(text);
    const spoken = source === 'voice' || source === 'wake';
    Lang.setTurn(spoken && settings.speechLang !== 'en' ? settings.speechLang : inLang);
    if (spoken && inLang !== 'en' && settings.speechLang !== 'en' && inLang !== settings.speechLang) log('warn', 'recogniser returned ' + Lang.NAMES[inLang] + ' script — replying in ' + Lang.NAMES[settings.speechLang]);
    if (inLang !== 'en') {
      if (!llmReady()) { await deliver({ text: Lang.line('unsure', inLang) + ' (AI core offline — I can only understand English right now.)', noLocalize: true, intent: 'UNKNOWN' }, { intent: 'UNKNOWN' }); return; }
      setState('PROCESSING', 'Translating…');
      const en = await Lang.toEnglish(text);
      // If the model answered instead of translating (long output), let the AI handle the original text.
      if (en && en.split(/\s+/).length <= Math.max(18, text.split(/\s+/).length * 3)) { cmdText = en; log('info', 'understood as: "' + en + '"'); }
      else if (en) log('info', 'treating as a question for the AI');
    }
    // Telugu/Kannada typed in English letters ("volume penchu", "timer cancel maadu"): replies come in Telugu/Kannada script.
    let srcLang = inLang;
    const rl = inLang === 'en' ? NLU.romanLang(text) : null;
    if (rl) {
      const en = NLU.fromRoman(text, rl);
      let use = NLU.classify(NLU.normalize(en, settings.wakeWord), ctx).intent !== 'CONVERSATION' ? en : null;
      // Not a known command, but clearly Telugu/Kannada (a question, or unusual wording): let the local model read it.
      if (!use && NLU.romanLang(text, 3)) {
        if (llmReady()) {
          setState('PROCESSING', 'Translating…');
          const t2 = await Lang.toEnglish(text, true);
          if (t2 && t2.split(/\s+/).length <= Math.max(18, text.split(/\s+/).length * 3)) use = t2;
          // Keep "in 2 lines" style requests the model may drop.
          const lim = lengthLimit(en);
          if (use && lim && !lengthLimit(use)) use = use.replace(/[?.!]*$/, '') + ' in ' + lim.n + ' ' + lim.unit + (lim.n > 1 ? 's' : '');
        }
        use = use || en;
      }
      if (use) {
        cmdText = use; srcLang = rl;
        if (!(spoken && settings.speechLang !== 'en')) Lang.setTurn(rl);
        log('info', Lang.NAMES[rl] + ' in English letters — understood as: "' + use + '"');
      }
    }
    // TEACH (from "what didn't you understand?"): this message is the command the missed phrase should run.
    if (ctx.pending && ctx.pending.intent === 'TEACH') {
      const pd = ctx.pending; ctx.pending = null;
      if (/^(cancel|never ?mind|forget it|no|stop)$/i.test(cmdText.trim())) { await deliver({ text: 'Okay, not teaching that one.' }, { intent: 'CANCELLED', confidence: 1 }); return; }
      const r = Agent.teach(pd.phrase, cmdText);
      if (!r.ok) ctx.pending = pd;   // ask again
      await deliver({ text: r.text, noPersona: true }, { intent: 'LEARN_TEACH', confidence: 1 }); return;
    }
    // "no, that's wrong" right after JARVIS acted on a command: that command was misunderstood — remember it.
    if (!ctx.pending && ctx.lastCmd && Date.now() - ctx.lastCmd.t < 60e3 && /^(no|nope|wrong|not that)\b.*|^that'?s (wrong|not (it|what i (meant|asked|wanted)))\b|^i meant\b/i.test(cmdText.trim())) {
      Agent.recordMiss(ctx.lastCmd.text, 'corrected');
      ctx.lastCmd = null;
      // "no, I meant open chrome" → run "open chrome"; a bare "no / that's wrong" → acknowledge and point to TEACH.
      const rest = cmdText.trim().replace(/^(?:no|nope|wrong|not that|that'?s (?:wrong|not (?:it|what i (?:meant|asked|wanted))))\b[\s,.!—-]*/i, '').replace(/^i meant\b[\s,:]*/i, '').trim();
      if (rest.length < 3) { await deliver({ text: 'Sorry about that — noted. Say **what didn’t you understand?** to teach me what that should do.', noPersona: true }, { intent: 'LEARN_TEACH', confidence: 1 }); return; }
      cmdText = rest;
    }
    // "how did you understand that?" — the inspector for the last turn, even with the setting off.
    if (/^(?:how did you (?:understand|interpret|read|get) (?:that|it|me)|show (?:me )?(?:your|the) reasoning|show (?:me )?how you understood(?: that| it| me)?|explain how you understood(?: that| it)?|inspect (?:that|my last (?:message|command)))[?.!]*$/i.test(cmdText.trim())) {
      const t = lastTrace; turnTrace = null;
      await deliver(t ? { text: 'Here is how I understood **“' + t.said + '”**:', showTrace: true, trace: t, noPersona: true, intent: 'SHOW_TRACE' } : { text: 'Nothing to show yet — give me a command first.', intent: 'SHOW_TRACE' }, { intent: 'SHOW_TRACE', confidence: 1 }); return;
    }
    // "and create a python file there" / "also open it" / "then list the folders": a continuation — the context
    // (folder, project, last result) carries on; the joining word is not part of the command.
    const cont = !ctx.pending && cmdText.match(/^(?:and then|and also|and|also|then|now|next|after that|plus)\s*,?\s+(?=\S)/i);
    if (cont && cmdText.split(/\s+/).length >= 3) { cmdText = cmdText.slice(cont[0].length); noteTrace('continuation', 'kept the context — ' + (focusSummary() || 'nothing in focus yet')); }
    // Mid-way through "create a project": resolving a missing language or description before building the plan.
    if (ctx.pending && ctx.pending.intent === 'CREATE_PROJECT') {
      const pd = ctx.pending; ctx.pending = null;
      if (/^(cancel|never ?mind|forget it|no|stop)$/i.test(cmdText.trim())) { await deliver({ text: 'Okay, cancelled.', intent: 'CANCELLED' }, { intent: 'CANCELLED', confidence: 1 }); return; }
      if (!pd.lang) {
        const m = cmdText.match(/\b(python|c\+\+|cpp|c|javascript|js)\b/i);
        if (!m) { ctx.pending = pd; await deliver({ text: 'Please say Python, C++, C or JavaScript.' }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
        const lang = Agent.LEARN_LANG_MAP[m[1].toLowerCase()];
        if (!pd.description) { ctx.pending = { intent: 'CREATE_PROJECT', name: pd.name, lang }; await deliver({ text: 'What should this program do?' }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
        await deliver(await Agent.createProject(cmdText, pd.name, lang, pd.description, 0), { intent: 'AGENT_RUN', confidence: 1 }); return;
      }
      const description = cmdText.trim();
      if (description.length < 3) { ctx.pending = pd; await deliver({ text: 'What should this program do?' }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
      await deliver(await Agent.createProject(cmdText, pd.name, pd.lang, description, 0), { intent: 'AGENT_RUN', confidence: 1 }); return;
    }
    // Mid-way through the TCREI design-prompt flow: one question per turn (Task → Context → References →
    // Evaluate → Iterate), then compile the answers into a single copy-pasteable prompt. No tool/LLM call.
    if (ctx.pending && ctx.pending.intent === 'DESIGN_PROMPT') {
      const pd = ctx.pending; ctx.pending = null;
      const raw = cmdText.trim();
      if (/^(cancel|never ?mind|forget it|no|stop)$/i.test(raw)) { await deliver({ text: 'Okay, cancelled.', intent: 'CANCELLED' }, { intent: 'CANCELLED', confidence: 1 }); return; }
      const skippable = pd.step === 'REFERENCES' || pd.step === 'ITERATE';
      const isSkip = skippable && /^(skip|none|n\/?a)$/i.test(raw);
      if (!isSkip && raw.length < 2) { ctx.pending = pd; await deliver({ text: Agent.DESIGN_PROMPT_QUESTIONS[pd.step] }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
      pd.answers[pd.step.toLowerCase()] = isSkip ? '' : raw;
      const next = Agent.DESIGN_PROMPT_STEPS[Agent.DESIGN_PROMPT_STEPS.indexOf(pd.step) + 1];
      if (next) {
        ctx.pending = { intent: 'DESIGN_PROMPT', step: next, answers: pd.answers };
        await deliver({ text: Agent.DESIGN_PROMPT_QUESTIONS[next] }, { intent: 'AGENT_RUN', confidence: 1 });
        return;
      }
      await deliver({ text: 'Here’s your prompt — copy it into any AI tool:\n\n' + Agent.buildTcreiPrompt(pd.answers), noPersona: true }, { intent: 'AGENT_RUN', confidence: 1 });
      return;
    }
    // Mid-way through a generic guided flow (commit message, bug report, study plan, etc.) — one question
    // per turn, walking Agent.GUIDED_FLOWS[pd.flow].steps in order, then compiling via finish() (or, for
    // STUDY_PLAN, finishStudyPlan() below, since it needs executeTool which only exists here in script.js).
    if (ctx.pending && ctx.pending.intent === 'GUIDED_FLOW') {
      const pd = ctx.pending; ctx.pending = null;
      const flow = Agent.GUIDED_FLOWS[pd.flow];
      const raw = cmdText.trim();
      if (/^(cancel|never ?mind|forget it|no|stop)$/i.test(raw)) { await deliver({ text: 'Okay, cancelled.', intent: 'CANCELLED' }, { intent: 'CANCELLED', confidence: 1 }); return; }
      const stepDef = flow.steps[pd.step];
      const isSkip = stepDef.skippable && /^(skip|none|n\/?a)$/i.test(raw);
      if (!isSkip) {
        if (stepDef.validate && !stepDef.validate(raw)) { ctx.pending = pd; await deliver({ text: stepDef.invalidMsg || stepDef.q }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
        if (!stepDef.skippable && raw.length < 2) { ctx.pending = pd; await deliver({ text: stepDef.q }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
      }
      pd.answers[stepDef.key] = isSkip ? '' : raw;
      await askOrFinishGuidedFlow(pd.flow, pd.step + 1, pd.answers);
      return;
    }
    // "open it" / "open that folder" / "open the second one" / "open number 3": the folder or file in focus.
    if (!ctx.pending && !(typeof Skills !== 'undefined' && (Skills.state.site || Skills.state.uip || Skills.state.viva || (typeof Student !== 'undefined' && Student.active())))) {
      const target = openFocusTarget(cmdText);
      if (target) { await deliver(target.text ? { text: target.text } : await openFocusPath(target.path), { intent: 'OPEN_FOCUS', confidence: 1 }); return; }
    }
    // Website generator, DSA coach and viva practice (skills-page.js): active sessions and their trigger phrases.
    if (!ctx.pending && typeof Skills !== 'undefined') {
      const sk = await Skills.intercept(cmdText, source);
      if (sk) { traceRoute('skill (website / UI prompt / coach / viva / skill pack)'); await deliver(sk, { intent: sk.intent || 'SKILL', confidence: 1 }); return; }
    }
    // Routines by name: "study mode", "run bedtime"
    const routine = !ctx.pending && Routines.match(NLU.normalize(cmdText, settings.wakeWord).text);
    if (routine) {
      setState('EXECUTING', 'Running ' + routine.name + '…');
      await deliver(await Routines.run(routine), { intent: 'ROUTINE_RUN', confidence: 1 });
      return;
    }

    // "JUST ANSWER IT" chip after a failed plan: answer with the AI, no actions.
    const answerOnly = !!ctx.answerOnly; ctx.answerOnly = false;
    // Agent: multi-step requests ("open VS Code, create a folder DSA and start a 25 minute focus").
    // Plain-code router; single commands skip this in well under a millisecond.
    // A phrase JARVIS was taught before ("Spotify jorag open maadu" → open Spotify): replay it directly,
    // no AI call, no re-asking what it means.
    if (!ctx.pending && !answerOnly) {
      // A phrase you taught ("lecture time" → "mute and block distractions"): run the command it stands for,
      // through the same pipeline as if you had typed it.
      const alias = Agent.aliasMatch(cmdText);
      if (alias) { log('info', 'taught phrase → "' + alias.command + '"'); cmdText = alias.command; }
      const learned = Agent.learnedMatch(cmdText);
      if (learned) { await deliver(await Agent.runLearned(learned, cmdText), { intent: 'AGENT_RUN', confidence: 1 }); return; }
    }
    if (!ctx.pending && !answerOnly) {
      const tr0 = performance.now();
      const envName = Agent.envGoal(cmdText);
      if (envName) { await deliver(await Agent.prepareEnvironment(cmdText, envName, performance.now() - tr0), { intent: 'AGENT_RUN', confidence: 1 }); return; }
      const learnLang = Agent.learnGoal(cmdText);
      if (learnLang) { await deliver(await Agent.learnLanguage(cmdText, learnLang, performance.now() - tr0), { intent: 'AGENT_RUN', confidence: 1 }); return; }
      const createGoal = Agent.createProjectGoal(cmdText);
      if (createGoal) {
        if (!createGoal.lang) { ctx.pending = { intent: 'CREATE_PROJECT', name: createGoal.name, description: createGoal.description }; await deliver({ text: 'Which language — Python, C++, C or JavaScript?' }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
        if (!createGoal.description) { ctx.pending = { intent: 'CREATE_PROJECT', name: createGoal.name, lang: createGoal.lang }; await deliver({ text: 'What should this program do?' }, { intent: 'AGENT_RUN', confidence: 1 }); return; }
        await deliver(await Agent.createProject(cmdText, createGoal.name, createGoal.lang, createGoal.description, performance.now() - tr0), { intent: 'AGENT_RUN', confidence: 1 }); return;
      }
      const designGoal = Agent.designPromptGoal(cmdText);
      if (designGoal) {
        if (designGoal.task) {
          ctx.pending = { intent: 'DESIGN_PROMPT', step: 'CONTEXT', answers: { task: designGoal.task } };
          await deliver({ text: Agent.DESIGN_PROMPT_QUESTIONS.CONTEXT }, { intent: 'AGENT_RUN', confidence: 1 }); return;
        }
        ctx.pending = { intent: 'DESIGN_PROMPT', step: 'TASK', answers: {} };
        await deliver({ text: Agent.DESIGN_PROMPT_QUESTIONS.TASK }, { intent: 'AGENT_RUN', confidence: 1 }); return;
      }
      const gf = Agent.matchGuidedFlow(cmdText);
      if (gf) {
        const flow = Agent.GUIDED_FLOWS[gf.id];
        const answers = {}; let step = 0;
        if (gf.seed) { answers[flow.steps[0].key] = gf.seed; step = 1; }
        // "a study plan for my os exam in 5 days": the date is already there — keep it, don't ask "When is it?".
        const dm = gf.id === 'STUDY_PLAN' && gf.seed && gf.seed.match(/^(.+?)\s+((?:in|within)\s+\d+\s+(?:days?|weeks?)|on\s+.+|by\s+.+|next\s+\w+|this\s+\w+|tomorrow|day after tomorrow)$/i);
        if (dm && NLU.parseDate(dm[2].toLowerCase().replace(/^(?:by|on|within)\s+/, m => /within/.test(m) ? 'in ' : ''))) {
          answers.title = dm[1].trim(); answers.due = dm[2].replace(/^within\s+/i, 'in ').replace(/^by\s+/i, ''); step = 2;
        }
        await askOrFinishGuidedFlow(gf.id, step, answers);
        return;
      }
      const route = Agent.route(cmdText);
      if (route.kind === 'multi') {
        const res = await Agent.handleMulti(cmdText, route, performance.now() - tr0);
        if (res) { traceRoute('multi-step agent (' + route.parts.length + ' parts)'); await deliver(res, { intent: 'AGENT_RUN', confidence: 1 }); return; }
      }
    }

    const norm = NLU.normalize(cmdText, settings.wakeWord);
    let p = resolvePending(norm);
    if (p && p.intent === 'CANCELLED') { await deliver({ text: 'Okay, never mind.' }, p); return; }
    if (p && p.intent === 'FLASH_END') { await deliver(nextFlashCard(), { intent: 'FLASH_REVIEW', confidence: 1 }); return; }
    if (p) { p = { confidence: .95, original: norm.original, fromPending: true, ...p }; }
    else { p = NLU.classify(norm, ctx); p.original = norm.original; }
    // === NLUQ hook (additive; default disabled) ============================
    // When the rule engine was unsure (CONVERSATION or confidence < 0.85) and the
    // user has enabled "Qwen NLU assist" in Settings, ask the local Qwen model
    // to extract a structured intent. Qwen is constrained to a strict whitelist
    // and never invents a tool. If Qwen fails or its confidence is below the rule
    // engine's, the rule result is kept unchanged — existing behavior is preserved.
    if (typeof NLUQ !== 'undefined' && NLUQ.enabled && !p.fromPending && llmReady()
        && (p.intent === 'CONVERSATION' || p.confidence < 0.85)
        && !ctx.pending) {
      try {
        const q = await NLUQ.parse(norm, ctx, p);
        if (q) { const oldIntent = p.intent; p = q; if (turnTrace) noteTrace('qwen_nlu', 'rules=' + oldIntent + ' · qwen=' + p.intent + ' · conf ' + p.confidence.toFixed(2) + ' · ' + NLUQ.describe().latencyMs + 'ms'); }
      } catch (e) { if (typeof log === 'function') log('warn', 'NLUQ parse error: ' + e.message); }
    }
    // === end NLUQ hook ======================================================
    log('ok', 'intent: ' + p.intent + ' · conf ' + p.confidence.toFixed(2) + (norm.text !== text.toLowerCase() ? ' · heard "' + norm.text + '"' : '') + (p.corrected ? ' · typo-corrected to "' + p.corrected + '"' : ''));
    if (p.corrected) p.text = p.corrected;
    if (turnTrace) Object.assign(turnTrace, { normalized: norm.text, intent: p.intent, confidence: p.confidence, corrected: p.corrected, args: p.args,
      tier: p.intent && p.intent !== 'CONVERSATION' && Agent.tierFor ? Agent.tierFor(p.intent, norm.text) : null, context: typeof focusSummary === 'function' ? focusSummary() : '' });
    if (p.fromPending && turnTrace) traceRoute('your answer to my question');
    // The decider (decider.js): direct tool, your local things, the local AI, or the web — from plain signals.
    const implicitSearch = p.intent === 'SEARCH_FILES' && !/\b(files?|folders?|documents?|notes?|directory)\b/i.test(norm.text);
    const sig = typeof Decider !== 'undefined' ? Decider.signals(norm.text, { intent: p.intent, confidence: p.confidence, implicitSearch }) : null;
    const decision = sig ? Decider.decide(sig, { online: !!(settings.online && backend.online), aiReady: llmReady() }) : { route: 'LOCAL_AI', reason: '' };
    if (turnTrace) { turnTrace.decision = decision; turnTrace.signals = sig; }
    // "find latest information about react": the file-search rule caught it, but it's a web question
    // The decision can take over from a weaker rule match: "find latest information about react" (caught by file
    // search) → web; "open the nearest atm" (caught by the generic "open the best web page") → Maps.
    if (decision.override || (implicitSearch && (decision.route === 'WEB_AI' || decision.want === 'WEB_AI' || decision.route === 'MAPS'))) p = Object.assign({}, p, { intent: 'CONVERSATION', confidence: 0.5, tool: null });

    // "cancel" / "never mind" with nothing waiting for an answer: say so, instead of asking the AI to plan it (it once
    // planned "close the app jarvis").
    if ((p.intent === 'CONVERSATION' || p.confidence < 0.85) && /^(?:cancel|cancel (?:it|that)|never ?mind|forget it|stop|stop it|abort)[.!]?$/i.test(norm.text.trim())) {
      await deliver({ text: 'There’s nothing to cancel right now.', intent: 'CANCELLED', noPersona: true }, { intent: 'CANCELLED', confidence: 1 }); return;
    }
    const wantsLLM = p.intent === 'CONVERSATION' || p.confidence < 0.85;
    // The rule matched a command that CHANGES something, but the request reads like a question about your own things
    // ("… the latest … in my project"): ask first instead of running it. Read-only commands still just run, and the
    // commands confirmGate already asks about aren't asked twice.
    if (!wantsLLM && decision.actionConflict && !p.fromPending && !CONFIRM_GATE[p.intent] && Agent.tierFor && Agent.tierFor(p.intent, norm.text)[0] !== 'safe') {
      ctx.pending = { intent: 'CONFIRM_INTENT', p };
      traceRoute('the command and the request disagree → asked first');
      await deliver({ text: 'Just to be sure, ' + Persona.sir() + ': should I **' + p.intent.toLowerCase().replace(/_/g, ' ') + '** for **“' + (p.corrected || norm.text) + '”**? “' + ((sig && sig.words.fresh[0]) || 'latest').trim() + '” about your own things usually means you want to see something, and that command changes something.', suggestions: ['Yes', 'No'], noPersona: true, intent: 'CONFIRM' }, p);
      return;
    }
    // Medium confidence on something SPOKEN (the mic may have misheard): ask before acting, instead of guessing or
    // handing it to the AI. Never for questions, and not for "open <something unknown>" (that opens the best web page).
    if (wantsLLM && spoken && p.intent !== 'CONVERSATION' && p.confidence >= CONFIRM_MIN && p.confidence < 0.85 && p.intent !== 'OPEN_APPLICATION'
      && !Agent.isQuestion(norm.text) && !/\?\s*$/.test(norm.text)) {
      ctx.pending = { intent: 'CONFIRM_INTENT', p };
      traceRoute('medium confidence → asked first');
      await deliver({ text: 'I’m not completely sure I heard that right, ' + Persona.sir() + '. Did you mean **“' + (p.corrected || norm.text) + '”** (' + p.intent.toLowerCase().replace(/_/g, ' ') + ')?', suggestions: ['Yes', 'No'], noPersona: true, intent: 'CONFIRM' }, p);
      return;
    }
    let result = null;
    const tUnderstood = performance.now();

    if (!wantsLLM) {
      if (p.tool) { setState('EXECUTING', 'Running ' + p.tool + '…'); engine('core', true); }
      const pre = Agent.preSingle(p);          // before-state for the open/close check, requested in parallel
      result = confirmGate(p, cmdText) || await executeTool(p, cmdText);
      engine('core', false);
      if (result && !result.askLLM) {
        ctx.lastIntent = p.intent; ctx.lastCmd = result.confirm || ctx.pending || /\?\s*$/.test(String(result.text || '')) ? null : { text: cmdText, t: Date.now() }; Agent.watchSingle(p, pre);
        // Pattern learning (Phase 2.9): record the intent + any app/site name.
        if (typeof Learn !== 'undefined') {
          try {
            Learn.event('cmd', p.intent);
            if (p.intent === 'OPEN_APPLICATION' || p.intent === 'CLOSE_APPLICATION') {
              const appName = (p.args && p.args.app) || (p.text && p.text.replace(/^(open|close|launch|kill|quit|exit|shut|terminate|end)\s+/, '').trim()) || 'unknown';
              Learn.event('app', appName);
            }
          } catch (e) {}
        }
      }
      log('agent', '⏱ understand ' + Math.round(tUnderstood - t0) + 'ms · run ' + Math.round(performance.now() - tUnderstood) + 'ms');
    }

    // An action the rules don't know ("set up my coding space: …"): plan it with the model, or fail safely.
    // It never goes to the chat model, which could claim it did something it didn't.
    // A request no rule understood — log it even when the AI is offline, so it can be taught later.
    if (wantsLLM && !answerOnly && !result && Agent.wantsAction(norm.text)) Agent.recordMiss(cmdText, llmReady() ? 'planner' : 'not understood');
    if (wantsLLM && !answerOnly && !result && llmReady() && Agent.wantsAction(norm.text)) {
      const res = await Agent.plan(cmdText, performance.now() - tUnderstood);
      if (res) { traceRoute('AI planner (no rule matched an action)'); await deliver(res, { intent: res.intent || 'AGENT_RUN', confidence: 1 }); return; }
    }

    // Current-events questions: read the web first (Online tools on), so the AI answers from sources instead of guessing.
    // Places ("nearest restaurants to kodigehalli", "hotels near me"): Google Maps in your browser — it knows what's
    // near and where you are. No AI guessing, and no Online-tools search needed (it's your browser).
    // "update my node.js" / "install python": JARVIS never installs software — the local AI explains how, honestly.
    if (wantsLLM && !result && decision.route === 'GUIDE' && llmReady()) {
      traceRoute('how-to from the local AI (I don’t install software)');
      result = { askLLM: 'The user asked: "' + cmdText + '". You (JARVIS) cannot install, update or uninstall software yourself, and must not claim you did. Say so in one short sentence, then give clear numbered steps for doing it on Windows — the official download page or the exact command to run (winget / npm / pip), and how to check it worked. Keep it short.', noHistory: true };
    }
    // "find / show / open the React docs": the page itself — the best match opens in your browser.
    if (wantsLLM && !result && decision.route === 'WEB_OPEN') {
      traceRoute('open the best page');
      await deliver(await executeTool({ intent: 'OPEN_WEB', args: { query: decision.payload.query }, original: cmdText, text: norm.text, confidence: 1 }, cmdText), { intent: 'OPEN_WEB', confidence: 1 });
      return;
    }
    if (wantsLLM && !result && decision.route === 'MAPS') {
      traceRoute('Google Maps (places)');
      // understood as: what kind of place, where (most specific first), how to rank it
      const pq = decision.payload && decision.payload.query ? decision.payload : Decider.placeQuery(cmdText), mq = pq.query;
      noteTrace('place', pq.category || '—'); noteTrace('location', pq.location); noteTrace('sort', pq.sort);
      toolStep('openUrl → Google Maps: ' + mq);
      const r = await callTool('/tool/openUrl', { url: 'https://www.google.com/maps/search/' + encodeURIComponent(mq) });
      const SORT = { nearest: 'nearest first', 'best rated': 'best rated', cheapest: 'cheapest first', 'open now': 'open now' };
      await deliver(r.error ? { text: 'I couldn’t open Google Maps: ' + r.error } : { text: 'Opening **Google Maps**: **' + (pq.category || mq) + '** near **' + pq.location + '**' + (SORT[pq.sort] ? ', ' + SORT[pq.sort] : '') + ' — with ratings, opening hours and directions.' + (pq.sort === 'nearest' ? ' Maps lists the closest ones first, each with its distance.' : ''),
        speak: 'Opening Google Maps for ' + (pq.category || mq) + ' near ' + pq.location.replace('your current location', 'you') + '.', tool: 'openUrl', card: [['PLACE', pq.category || '—'], ['WHERE', pq.location], ['SORT', pq.sort]],
        suggestions: settings.online ? ['Search the web for ' + mq] : null,
        // the same places listed right here in the chat (nearby.js, OpenStreetMap), for kinds of place it knows
        actions: settings.online && pq.category && typeof Extras !== 'undefined' ? [{ label: 'LIST THEM HERE', fn: () => Extras.listNearby(pq.category, pq.location) }] : undefined }, { intent: 'MAPS', confidence: 1 });
      return;
    }
    if (wantsLLM && !result && decision.route === 'WEB_AI') {   // (without the AI, doResearch shows the top links)
      traceRoute('web search → local AI answers from the pages');
      // the whole request goes along ("…and explain how hooks work"), minus a leading "search / find / look up"
      result = await doResearch(norm.text.replace(/[?!.]+$/, '').replace(/^(?:please\s+)?(?:search(?: the web| online| google)?(?: for)?|look up|find(?: me)?(?: out)?)\s+/i, ''));
    }
    // It needs the web, but Online tools is off: ask — never answer something that changes from stale memory silently.
    if (wantsLLM && !result && !answerOnly && decision.route === 'OFFER_ONLINE') {
      traceRoute('needs the web — Online tools is off → asked');
      const ask = cmdText;
      await deliver({ text: 'That changes over time, ' + Persona.sir() + ' — I’d need to search the web for it, and **Online tools** is off.', noPersona: true, intent: 'DECIDE',
        actions: [{ label: 'ENABLE ONLINE TOOLS & SEARCH', fn: () => { settings.online = true; saveSettings(); bindSwitchState('#onlineToggle', 'online'); updateNetUI(); log('warn', 'online tools enabled'); handleUser(ask, 'chip'); } },
          { label: 'ANSWER FROM MEMORY', fn: () => { ctx.answerOnly = true; ctx.fromMemory = true; handleUser(ask, 'chip'); } }] }, { intent: 'DECIDE', confidence: 1 });
      return;
    }

    if (result && !result.askLLM && wantsLLM) {
      await deliver(result, p);
    } else if (wantsLLM || (result && result.askLLM)) {
      traceRoute(result && result.askLLM ? 'rules → ' + (p.tool || p.intent) + ' → AI writes the answer (' + llm.model + ')' : 'AI chat (' + llm.model + ') — no command matched');
      const toolPrompt = result && typeof result.askLLM === 'string';
      const cloudKind = toolPrompt && CLOUD_KIND[p.intent] && (p.intent !== 'FLASH_MAKE' || /material below/.test(result.askLLM)) ? CLOUD_KIND[p.intent] : '';
      if (cloudKind && llmReady() && !(await confirmCloud(cloudKind))) { await deliver({ text: 'Okay — nothing was sent to ' + modelInfo(llm.model).providerLabel + '.', noPersona: true }, { intent: p.intent, confidence: 1 }); return; }
      // Is there a skill pack for this? Plain chat only (never a tool prompt or an "answer from memory"). A button after the answer, or the skill runs straight away if its header says auto: true.
      let skillHint = null;
      if (!result && !toolPrompt && !answerOnly && srcLang === 'en' && typeof SkillRouter !== 'undefined' && typeof Skills !== 'undefined' && settings.skillSuggest !== false && llmReady()) {
        try { skillHint = SkillRouter.pick(cmdText, Skills.packs); } catch (e) { skillHint = null; }
      }
      if (skillHint && skillHint.auto) {
        traceRoute('skill (auto): ' + skillHint.name);
        const sk = await Skills.intercept('/' + skillHint.name + ' ' + cmdText);
        if (sk) { sk.text = 'Using the **' + skillHint.name + '** skill.\n\n' + sk.text; await deliver(sk, { intent: sk.intent || 'SKILL', confidence: 1 }); return; }
      }
      // Telugu/Kannada: include our English reading too — speech recognition often mangles English technical words.
      const userAsk = srcLang !== 'en' && cmdText !== text
        ? (Lang.aiInEnglish() ? cmdText : text + '\n\n(Meaning, in English: "' + cmdText + '". Answer that, in ' + ({ te: 'Telugu', kn: 'Kannada' }[Lang.replyLang()] || 'English') + '.)')
        : text;
      let ai = llmReady() ? await askLLM(toolPrompt ? result.askLLM : userAsk, { earlySpeech: !toolPrompt, noTools: toolPrompt || answerOnly, imageToken: toolPrompt ? result.imageToken : undefined, noHistory: toolPrompt && !!result.noHistory, limitText: toolPrompt ? cmdText : undefined }) : null;
      // The chat model chose a tool: the server validates the name and arguments and sets the permission tier.
      let checked = null;
      if (ai && ai.tool) {
        checked = await callTool('/agent/validate', { tool: ai.tool.tool, args: ai.tool.rawArgs || {} });
        if (!checked.ok) {
          // A broken tool call (e.g. open_best with no "query"): nothing runs — and instead of giving up, the AI is
          // asked again for a plain answer, with no tools.
          log('warn', 'AI tool call rejected: ' + (checked.reason || checked.error) + ' — answering without tools');
          noteTrace('AI tool call refused', (checked.reason || checked.error) + ' → answered without tools');
          if (ai.node && ai.node.root) ai.node.root.remove();
          ai = await askLLM(userAsk, { noTools: true, limitText: cmdText });
          checked = null;
        }
        if (checked && checked.step.tier !== 'safe') {
          await deliver(await Agent.chatTool(ai.tool.tool, ai.tool.rawArgs || {}, performance.now() - tUnderstood), { intent: 'AGENT_RUN', confidence: 1 });
          return;
        }
        if (checked) {
          const mapped = LLM_TOOLS[checked.step.tool](checked.step.args);
          ai.tool = { ...ai.tool, intent: checked.step.intent, args: Object.assign({}, mapped.args || {}, checked.step.args) };
        }
      }
      if (ai && ai.tool && checked && checked.ok) {
        const tp = { ...ai.tool, viaAI: true };
        setState('EXECUTING', 'Running ' + tp.tool + '…'); engine('core', true);
        const pre2 = Agent.preSingle(tp);
        let r2 = await executeTool(tp, cmdText);
        engine('core', false);
        ctx.lastIntent = tp.intent;
        Agent.watchSingle(tp, pre2);
        if (r2 && typeof r2.askLLM === 'string') {
          const ai2 = await askLLM(r2.askLLM, { noTools: true, imageToken: r2.imageToken, noHistory: !!r2.noHistory, limitText: cmdText });
          if (ai2 && ai2.delivered) idleState();
          else if (ai2) await finishAIAnswer(ai2, r2.after, tp);
          else await deliver({ text: 'I could not reach my AI brain to finish that.' }, tp);
        } else {
          if (r2 && r2.askLLM) r2 = { text: 'I understood that as **' + tp.intent + '**, but could not complete it. Could you rephrase?' };
          await deliver(r2, tp);
        }
      } else if (ai && ai.delivered) {
        idleState();
      } else if (ai) {
        if (skillHint) ai.chips = [{ label: 'USE THE ' + skillHint.name.toUpperCase() + ' SKILL', fn: () => handleUser('/' + skillHint.name + ' ' + cmdText, 'chip') }];
        await finishAIAnswer(ai, result && result.after, p);
      } else {
        const why = !settings.llm ? 'My AI brain is switched off in settings, so I only understand direct commands.'
          : !backend.online ? 'The backend is offline, so I cannot reach my AI brain. Press START JARVIS (top of the page) or double-click the desktop icon.'
          : !llm.online ? 'My AI brain (Ollama) is not running, so I only understand direct commands right now.'
          : 'I did not quite catch that.';
        await deliver({ text: (llm.online && settings.llm && backend.online ? Persona.say('unsure') : why) + ' Did you mean one of these?', suggestions: NLU.suggest(norm.text), intent: 'UNKNOWN', noPersona: true }, p);
      }
    } else {
      await deliver(result, p);
    }
    const ms = Math.round(performance.now() - t0); latSum += ms; latN++;
    log('ok', 'turn complete in ' + ms + 'ms');
    maybeSummarizeChat(); // fire-and-forget: folds turns that fell out of the model's window into the rolling summary
  } catch (err) {
    console.error(err);
    log('err', String(err && err.message || err)); sfx.err();
    setState('ERROR');
    jarvisSay({ text: 'Sorry — something broke on my side: ' + String(err && err.message || err), intent: 'ERROR', noTTS: true });
  } finally {
    busy = false;
    if (!pumping && state !== 'LISTENING') idleState();
    if (inputQueue.length) { const [t, s2] = inputQueue.shift(); setTimeout(() => handleUser(t, s2), 50); }
  }
}

/* ============ speech recognition ============ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, wakeRec = null, wakeOn = false, awaitingCmd = false, micHeld = false, wakePaused = false;
let analyser = null, micStream = null, micActive = false;
async function ensureAnalyser() {
  if (analyser) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const c = ac(); const src = c.createMediaStreamSource(micStream);
    analyser = c.createAnalyser(); analyser.fftSize = 128; src.connect(analyser);
    log('ok', 'microphone ready');
  } catch (e) {
    if (e.name === 'NotAllowedError') { log('err', 'microphone permission denied'); toast('Microphone permission denied'); }
    else log('warn', 'mic visualiser unavailable: ' + e.message);
  }
}
function makeRec(continuous) { const r = new SR(); r.lang = Lang.SPEECH[settings.speechLang] || 'en-IN'; r.continuous = continuous; r.interimResults = true; r.maxAlternatives = 3; return r; }

/* Mic sensitivity — speaking from across the room. Chrome/Edge 135+ can recognise speech from an audio track we hand
   them (start(track)) instead of the raw microphone, so quiet, far-away speech is cleaned up and lifted first:
   the browser's noise suppression + automatic gain, then a gain stage and a compressor that raises soft speech without
   letting loud speech clip. Normal = raw microphone (as before); High (default) and Max boost more. Older browsers
   ignore the track and use the microphone as before. */
const MIC_BOOST = { normal: 0, high: 2.2, max: 4 };
let boost = null;   // { level, ctx, track, stream }
async function boostedTrack() {
  const level = MIC_BOOST[settings.micBoost] !== undefined ? settings.micBoost : 'high';
  if (!MIC_BOOST[level] || !window.AudioContext || !navigator.mediaDevices) { dropBoost(); return null; }   // Normal: plain mic, release any boost
  if (boost && boost.level === level && boost.track.readyState === 'live' && boost.ctx.state === 'running') return boost.track;
  dropBoost();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ctx = new AudioContext();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
    if (ctx.state !== 'running') { stream.getTracks().forEach(t => t.stop()); ctx.close(); return null; }   // no user click yet: plain mic
    const src = ctx.createMediaStreamSource(stream), gain = ctx.createGain(), comp = ctx.createDynamicsCompressor(), dest = ctx.createMediaStreamDestination();
    gain.gain.value = MIC_BOOST[level];
    comp.threshold.value = -42; comp.knee.value = 18; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
    src.connect(gain).connect(comp).connect(dest);
    boost = { level, ctx, stream, track: dest.stream.getAudioTracks()[0] };
    log('ok', 'mic sensitivity: ' + level + ' (boosted audio → speech recogniser)');
    return boost.track;
  } catch (e) { log('warn', 'mic boost unavailable (' + e.message + ') — using the plain microphone'); return null; }
}
function dropBoost() { if (!boost) return; try { boost.stream.getTracks().forEach(t => t.stop()); boost.ctx.close(); } catch (e) {} boost = null; }
// Starts a recogniser on the boosted track when possible, the plain microphone otherwise.
async function startRec(r) {
  const track = await boostedTrack();
  if (track) { try { r.start(track); return; } catch (e) { log('warn', 'recogniser refused the boosted audio — using the plain microphone'); } }
  r.start();
}
// Speech recognition marks text "final" at every short pause; Voice.createUtterance (voice.js) collects the whole
// sentence and hands it over only when you have gone quiet for the "Pause before I answer" setting.
const pauseMs = () => clamp(+settings.pauseMs || 1600, 600, 4000);
// Final results: of the recogniser's alternatives, the one that reads most like a JARVIS command (speechfix.js).
const piecesOf = ev => Array.from(ev.results, r => ({ isFinal: r.isFinal,
  text: r.isFinal && r.length > 1 && typeof SpeechFix !== 'undefined' ? SpeechFix.pickAlternative(Array.from(r, a => a.transcript)) : (r[0] && r[0].transcript) || '' }));
const showHeard = t => { liveTranscript.textContent = t; liveTranscript.classList.toggle('on', !!t); };
let dictUtt = null, dictTick = 0, dictSource = 'voice';
// opts.source: 'voice' (mic button) or 'wake' (after "Jarvis" was heard in the background); opts.prompt: say
// "Yes, sir?" first, then listen — the mic starts only after the prompt so JARVIS doesn't hear itself.
async function startDictation(opts = {}) {
  if (!SR) { toast('Speech recognition needs Chrome or Edge — type instead'); chatInput.focus(); return; }
  if (micHeld) return;
  if (wakeOn) { wakePaused = true; retireWakeRec(); }   // one recogniser at a time: the wake listener steps aside
  stopSpeaking();
  ensureAnalyser();
  dictSource = opts.source || 'voice';
  if (opts.prompt) { micHeld = true; sfx.wake(); const yes = Persona.say('wake'); setState('LISTENING', yes); await speak(yes); micHeld = false; }
  try {
    rec = makeRec(true); micActive = true;
    dictUtt = Voice.createUtterance({ silenceMs: pauseMs(), maxMs: 30000, idleMs: 8000, isEcho,
      onProgress: showHeard, onCommit: t => finishDictation(t), onIdle: () => finishDictation(''), onDrop: () => finishDictation('') });
    rec.onresult = ev => { if (dictUtt) dictUtt.update(piecesOf(ev)); };
    // Chrome ends continuous recognition now and then — carry on (keeping the words) until the sentence is done.
    rec.onend = () => { if (dictUtt && micHeld && rec) { dictUtt.sessionEnded(); const r = rec; startRec(r).catch(() => finishDictation(dictUtt ? dictUtt.text : '')); } };
    rec.onerror = ev => { if (ev.error === 'no-speech' || ev.error === 'aborted') return; finishDictation(''); voiceError(ev.error); };
    startRec(rec).catch(e => { log('err', 'speech failed to start: ' + e.message); finishDictation(''); });
    micHeld = true; micBtn.classList.add('live');
    setState('LISTENING', 'Listening… I’ll answer when you pause (tap the mic to send now)'); engine('stt', true);
    clearInterval(dictTick); dictTick = setInterval(() => dictUtt && dictUtt.tick(), 150);
  } catch (e) { log('err', 'speech failed to start: ' + e.message); micActive = false; micHeld = false; }
}
function finishDictation(t) {
  clearInterval(dictTick); dictUtt = null;
  const r = rec; rec = null;
  if (r) { r.onend = null; r.onresult = null; try { r.stop(); } catch (e) {} }
  micHeld = false; micActive = false; micBtn.classList.remove('live'); showHeard(''); engine('stt', false);
  if (wakeOn && wakePaused) { wakePaused = false; loopWake(); }
  if (!wakeOn) dropBoost();   // release the microphone when nothing is listening
  if (t) handleUser(t, dictSource);
  else if (state === 'LISTENING') idleState();
}
// Tap again / let go of a held mic: send what was heard right away.
function stopDictation() { if (dictUtt) dictUtt.flush(); else if (rec) finishDictation(''); }

const shownVoiceErrors = new Set();
const EMBEDDED = /\bClaude\/|Electron\//.test(navigator.userAgent);
const BROWSER_HINT = EMBEDDED ? ' This built-in app browser blocks the microphone — open **' + location.origin + '** in Chrome or Edge instead.' : '';
// Explains speech failures in the chat instead of failing silently.
function voiceError(code) {
  log(code === 'no-speech' || code === 'aborted' ? 'info' : 'err', 'speech: ' + code);
  if (code === 'aborted') return;
  if (code === 'no-speech') { toast('I did not hear anything — tap the mic and speak a bit louder'); idleState(); return; }
  const fatal = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture'].includes(code);
  if (fatal && wakeOn) stopWake();
  setEngine('stt', 'down', code === 'network' ? 'speech service unreachable' : code === 'audio-capture' ? 'no microphone found' : 'mic blocked');
  if (shownVoiceErrors.has(code)) { toast('Voice unavailable: ' + code); return; }
  shownVoiceErrors.add(code);
  const msg = {
    'not-allowed': '**I cannot access your microphone.** Click the 🔒 / site icon at the left of the address bar → set **Microphone** to *Allow* → reload the page.' + BROWSER_HINT,
    'service-not-allowed': '**Speech recognition is blocked in this browser.**' + (BROWSER_HINT || ' Use Google Chrome or Microsoft Edge.'),
    'network': '**The speech service is unreachable.** Chrome/Edge voice typing sends audio to Google/Microsoft to transcribe it, so it needs an internet connection and does not work in embedded browsers.' + BROWSER_HINT,
    'audio-capture': '**No microphone detected.** Check it is plugged in and set as the default input in Windows *Settings → System → Sound*.',
    'language-not-supported': 'Your speech language is not supported — I will switch to English (India).'
  }[code] || 'Voice input failed (' + code + '). You can always type instead.';
  setState('ERROR', 'Voice input unavailable');
  jarvisSay({ text: msg, intent: 'VOICE', noTTS: true });
}
async function checkVoiceSupport() {
  if (!SR) return;
  let perm = 'prompt';
  try { perm = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (e) {}
  if (perm === 'denied' || EMBEDDED) {
    setEngine('stt', 'down', EMBEDDED ? 'not supported in app browser' : 'mic permission denied');
    micBtn.title = EMBEDDED ? 'Voice needs Chrome or Edge — open ' + location.origin + ' there' : 'Microphone blocked — allow it in the address bar';
    log('warn', EMBEDDED ? 'voice input unavailable in this embedded browser — use Chrome/Edge' : 'microphone permission denied for this site');
  }
}

// Tap = start, then it stops by itself after you pause (or tap again). Hold = push-to-talk.
let pressStart = 0, pressing = false;
micBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (micHeld) { stopDictation(); return; }
  pressStart = performance.now(); pressing = true;
  startDictation();
});
window.addEventListener('pointerup', () => {
  if (!pressing) return;
  pressing = false;
  if (micHeld && performance.now() - pressStart > 600) stopDictation();
});
micBtn.addEventListener('contextmenu', e => e.preventDefault());

let wakeNetFails = 0, wakeUtt = null, wakeTick = 0;
// One collector for the whole time the wake word is on: it survives recogniser restarts, so a sentence split by
// a restart (or by pauses) still arrives whole.
function makeWakeUtt() {
  return Voice.createUtterance({ silenceMs: pauseMs(), maxMs: 30000, idleMs: 8000, wakeWords: Lang.wakeWords(settings.wakeWord), isEcho,
    onWake: hasCmd => { awaitingCmd = true; sfx.wake(); log('ok', hasCmd ? 'wake word + command' : 'wake word detected'); setState('LISTENING', 'Listening… I’ll answer when you pause'); },
    // Only if you said just "Jarvis" and then nothing for a moment: answer "Yes, sir?" (muted, so it isn't heard as a command).
    onPrompt: () => { const yes = Persona.say('wake'); setState('LISTENING', yes); speak(yes); },
    onProgress: showHeard,
    onCommit: t => { awaitingCmd = false; showHeard(''); log('ok', 'heard: "' + t + '"'); handleUser(t, 'wake'); },
    onIdle: () => { awaitingCmd = false; showHeard(''); if (state === 'LISTENING') setState('LISTENING', 'Say "' + settings.wakeWord + '" to wake me'); },
    onDrop: () => { awaitingCmd = false; showHeard(''); } });
}
// Browsers stop speech recognition while the page is hidden (Web Speech spec), so the browser listener pauses then;
// the Windows listener (wakeword.js) covers other tabs/apps. wakeRunning/wakeEndedAt feed a watchdog that restarts
// a recogniser Chrome ended without telling us — the "animation on, but it doesn't hear me" state.
let wakeRunning = false, wakeEndedAt = 0, wakeHidden = false, lastHeardLog = '';
// "I can hear sound but not words": the mic level shows someone talking (voice-band energy for 2.5 s) while the
// recogniser has returned nothing for 4 s — usually speaking from too far away. Say so (at most every 2 minutes)
// instead of just animating.
let lastResultAt = 0, soundSince = 0, quietHintAt = 0;
function quietCheck() {
  if (!analyser || !wakeUtt || wakeUtt.mode !== 'wait' || isSpeakingNow()) { soundSince = 0; return; }
  const d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d);
  let sum = 0; for (let i = 1; i <= 9 && i < d.length; i++) sum += d[i];   // ≈ 300–3500 Hz: where speech is
  const now = Date.now();
  if (sum / 9 > 35) { if (!soundSince) soundSince = now; } else soundSince = 0;
  if (soundSince && now - soundSince > 2500 && now - lastResultAt > 4000 && now - quietHintAt > 120000) {
    quietHintAt = now;
    const tip = settings.micBoost === 'max' ? 'come a little closer to the laptop' : 'come a little closer, or set Settings → Mic sensitivity to Max';
    toast('I can hear sound but can’t make out words — ' + tip, true); log('warn', 'wake word: sound but no words — ' + tip);
  }
}
// One wake-word recogniser at a time. Chrome allows a single recognition session: starting a second one aborts the
// first, and the aborted one's "ended" used to schedule yet another start — recognisers kept killing each other and
// never listened long enough to hear "Jarvis" (reproduced in tests/e2e with a Chrome-like fake: 5 starts in 3.5 s).
// Now each recogniser has a generation number; a newer loopWake retires the older one (its events are ignored), and
// the watchdog only restarts a listener that is neither running nor still starting.
let wakeGen = 0, wakeStarting = false;
function retireWakeRec() {
  wakeGen++;
  const old = wakeRec; wakeRec = null; wakeRunning = false; wakeStarting = false;
  if (old) { old.onstart = old.onresult = old.onerror = old.onend = null; try { old.abort(); } catch (e) {} }
  // Its session is over: the next recogniser's results start from zero (otherwise the collector skipped them).
  if (old && wakeUtt) wakeUtt.sessionEnded();
}
function loopWake() {
  if (!wakeOn || wakeHidden || wakePaused) return;
  if (wakeRec && (wakeRunning || wakeStarting)) return;   // already listening (or about to): never start a second one
  try {
    if (!wakeUtt) wakeUtt = makeWakeUtt();
    clearInterval(wakeTick); wakeTick = setInterval(() => {
      if (wakeUtt) { wakeUtt.setMuted(isSpeakingNow()); wakeUtt.tick(); }
      quietCheck();
      // Watchdog: if listening has been down for 3 s and nothing is starting it, start it.
      if (wakeOn && !wakePaused && !wakeHidden && !wakeRunning && !wakeStarting && Date.now() - wakeEndedAt > 3000) { log('warn', 'wake word: listener had stopped — restarting'); wakeEndedAt = Date.now(); retireWakeRec(); loopWake(); }
    }, 150);
    retireWakeRec();
    const gen = wakeGen, r = wakeRec = makeRec(true);
    const mine = () => gen === wakeGen;
    wakeStarting = true;
    r.onstart = () => { if (!mine()) return; wakeStarting = false; wakeRunning = true; };
    r.onresult = ev => {
      if (!mine()) return;
      wakeNetFails = 0; lastResultAt = Date.now(); // a result came back at all, so the speech service is reachable again
      // What the mic hears while JARVIS is talking is JARVIS — skipped, not collected.
      wakeUtt.setMuted(isSpeakingNow());
      wakeUtt.update(piecesOf(ev));
      // While waiting for the wake word, show what the recogniser heard in the activity log — so "it didn't
      // react" can be told apart from "it heard 'service' instead of 'Jarvis'".
      const last = ev.results[ev.results.length - 1];
      if (wakeUtt.mode === 'wait' && last && last.isFinal) { const t = (last[0].transcript || '').trim(); if (t && t !== lastHeardLog) { lastHeardLog = t; log('info', 'wake word: heard “' + t + '” (no wake word)'); } }
    };
    // A "network" error from the speech service (Google/Microsoft, reached over the internet) is often a
    // brief blip, not a real outage — retry a few times with backoff before actually giving up on wake word.
    // Other errors (permission revoked, no microphone) are genuinely fatal and stop it immediately, as before.
    r.onerror = ev => {
      if (!mine()) return;
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      if (document.hidden) return;   // errors from being in the background aren't real failures — resume on return
      if (ev.error === 'network' && wakeOn) {
        wakeNetFails++;
        if (wakeNetFails < 4) { log('warn', 'wake word: speech service unreachable (' + wakeNetFails + '/4) — retrying'); return; }
        notify('Wake word turned off', 'The speech service was unreachable several times in a row — tap the mic to turn it back on.');
      }
      voiceError(ev.error);
    };
    r.onend = () => {
      if (!mine()) return;
      wakeRunning = false; wakeStarting = false; wakeEndedAt = Date.now(); wakeRec = null;
      if (wakeUtt) wakeUtt.sessionEnded();   // keeps a half-finished sentence across the restart
      if (!wakeOn || wakePaused || wakeHidden) return;
      setTimeout(() => { if (mine()) loopWake(); }, wakeNetFails > 0 ? Math.min(8000, 500 * Math.pow(2, wakeNetFails)) : 250);
    };
    startRec(r).catch(e => { if (!mine()) return; wakeStarting = false; wakeRunning = false; wakeEndedAt = Date.now(); wakeRec = null; log('err', 'wake listener failed: ' + e.message); });
  } catch (e) { wakeStarting = false; wakeRunning = false; wakeEndedAt = Date.now(); log('err', 'wake listener failed: ' + e.message); }
}
// The Windows listener (wakeword.js): on while the wake word is on, so "Jarvis" is heard in other tabs/apps too.
function setNativeWake(on) {
  callTool('/wake/native', { on, persona: settings.persona === 'friday' ? 'friday' : 'jarvis', sensitivity: settings.micBoost || 'high' }).then(r => {
    if (on && r && r.supported && !r.error) log('ok', 'wake word also works in other tabs and apps (Windows speech recogniser)');
    if (on && r && r.error) log('warn', 'wake word in other apps unavailable: ' + r.error);
  });
}
function startWake() {
  if (!SR) { toast('Wake word needs Chrome or Edge speech support'); return; }
  wakeOn = true; wakeNetFails = 0; wakeBtn.classList.add('on'); ensureAnalyser(); micActive = true;
  wakeUtt = null; wakeHidden = document.hidden; wakeEndedAt = Date.now();   // fresh collector: picks up the current wake word, language and pause setting
  log('ok', 'wake word armed — say "' + settings.wakeWord + '"');
  setState('LISTENING', 'Say "' + settings.wakeWord + '" to wake me'); engine('stt', true);
  setNativeWake(true);
  loopWake();
}
function stopWake() {
  wakeOn = false; awaitingCmd = false; wakeBtn.classList.remove('on'); micActive = false; engine('stt', false);
  clearInterval(wakeTick); wakeUtt = null; showHeard(''); wakeRunning = false;
  retireWakeRec();   // off means off: the running (or starting) recogniser is stopped and its events ignored
  setNativeWake(false); dropBoost();   // release the microphone
  if (state === 'LISTENING') setState('IDLE');
  log('info', 'wake word off');
}
// Page hidden (another tab, minimised): pause the browser listener instead of letting it fail and switch itself off.
// Back in front: resume it — and if "Jarvis" was just heard by the Windows listener, take the command now.
let nativeWakeAt = 0;
function wakePageBack() {
  if (!wakeOn) return;
  if (wakeHidden) { wakeHidden = false; wakeEndedAt = Date.now(); loopWake(); }
  if (Date.now() - nativeWakeAt < 8000 && !micHeld) { nativeWakeAt = 0; startDictation({ source: 'wake', prompt: true }); }
}
document.addEventListener('visibilitychange', () => {
  if (!wakeOn) return;
  if (document.hidden) { wakeHidden = true; retireWakeRec(); }
  else wakePageBack();
});
window.addEventListener('focus', wakePageBack);
wakeBtn.addEventListener('click', () => { wakeOn ? stopWake() : startWake(); });
if (!SR) { micBtn.classList.add('off'); wakeBtn.classList.add('off'); }

/* ============ input / chips / shortcuts ============ */
function sendInput() { const v = chatInput.value; chatInput.value = ''; histIdx = -1; if (v.trim()) handleUser(v, 'text'); }
sendBtn.addEventListener('click', sendInput);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendInput();
  else if (e.key === 'ArrowUp' && cmdHistory.length) { e.preventDefault(); histIdx = histIdx < 0 ? cmdHistory.length - 1 : Math.max(0, histIdx - 1); chatInput.value = cmdHistory[histIdx]; }
  else if (e.key === 'ArrowDown' && histIdx >= 0) { e.preventDefault(); histIdx++; chatInput.value = histIdx < cmdHistory.length ? cmdHistory[histIdx] : ''; if (histIdx >= cmdHistory.length) histIdx = -1; }
});
let spaceHeld = false;
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === 'Escape') {
    stopEverything();
    closeDrawer(); document.body.classList.remove('show-left');
  } else if (e.key === '/' && !typing) { e.preventDefault(); chatInput.focus(); }
  else if (e.code === 'Space' && !typing && !e.repeat && !spaceHeld && SR) {
    e.preventDefault();
    if (micHeld) { stopDictation(); return; }
    spaceHeld = true; pressStart = performance.now(); startDictation();
  }
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && spaceHeld) { spaceHeld = false; if (performance.now() - pressStart > 600) stopDictation(); } });

const CHIP_GROUPS = {
  CODE: ['Write fizzbuzz in python and save it as fizz.py and run it', 'Save that code as main.py', 'Run it', 'Open it in VS Code', 'Paste that code into my editor', 'Fix the code in my clipboard and copy it back', 'Paste my clipboard into scratch.py', 'Format the JSON in my clipboard', 'List my snippets'],
  WEB: ['Open SIH 2026 problem statements', 'Upcoming contests', 'Remind me about the next Codeforces contest', 'Upcoming hackathons', 'Search the web for latest Python version', 'Open GATE 2027 CSE syllabus', 'Write a short leave email to my professor and copy it'],
  CONTROL: ['Run diagnostics', 'Read my screen', 'Explain the error on my screen', 'Set brightness to 60', 'Set volume to 30', 'Put VS Code on the left and Chrome on the right', 'Which power plan am I on?', 'Is my Bluetooth on?', 'Start clipboard history'],
  ROUTINES: ['Study mode', 'List my routines', 'Create a routine called exam prep: open VS Code, open LeetCode, start a 45 minute focus session', 'Run my morning routine every day at 7am'],
  STYLE: ['Switch to FRIDAY', 'Switch to JARVIS', 'Gold theme', 'Red alert', 'Stand down alert', 'Violet theme', 'Arc reactor blue theme', 'Switch to Telugu', 'Switch to Kannada', 'Switch to English'],
  FOCUS: ['Block distractions', 'How productive was I today?', 'Remind me every day at 9pm to revise', 'Show desktop', 'Open my downloads folder', '100 F to C', '5 km in miles'],
  STUDY: ['Plan my day', 'Make flashcards on normalization in DBMS', 'Review my flashcards', 'Summarise welcome.md', 'Start a focus session', 'What is due this week?', 'When is my next class?', 'Quiz me on operating systems', 'Explain the code in my clipboard', 'Give me my briefing'],
  TASKS: ['Add revise DBMS to my to-do list', 'What is on my to-do list?', 'Remind me to drink water in 30 minutes', 'Add assignment OS lab due Friday', 'Add class DBMS on Monday at 10am'],
  DEV: ['Open VS Code', 'Prepare my coding environment', 'Open LeetCode', 'Search Stack Overflow for segmentation fault', 'Git status', 'Is port 3000 free?', '255 to binary', '1.5 GB to MB'],
  SYSTEM: ['How is my system doing?', 'What is my battery?', 'Top processes', 'Take a screenshot', 'What is my IP address?', 'Lock the screen'],
  MEDIA: ['Play lofi beats on YouTube', 'Play / pause', 'Next song', 'Volume up', 'Volume down', 'Mute'],
  FILES: ['List my files', 'Take a note: revise recursion', 'Read my notes', 'Create a folder called DSA', 'Open my projects folder'],
  CHAT: ['What can you do?', 'What is the weather?', 'Tell me a joke', 'Explain Big-O like I am five', 'Who are you?'],
};
function renderChips(group) {
  $$('.cmd-tab').forEach(b => b.classList.toggle('active', b.dataset.g === group));
  const row = $('#chipsRow'); row.innerHTML = '';
  CHIP_GROUPS[group].forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'chip-cmd'; b.textContent = c; b.style.animationDelay = (i * 25) + 'ms';
    b.addEventListener('click', () => handleUser(c.replace('Play / pause', 'pause'), 'chip'));
    row.appendChild(b);
  });
  store.set('jarvis.chipTab', group);
}
Object.keys(CHIP_GROUPS).forEach(g => {
  const b = document.createElement('button'); b.className = 'cmd-tab'; b.dataset.g = g; b.textContent = g; b.setAttribute('role', 'tab');
  b.addEventListener('click', () => renderChips(g)); $('#cmdTabs').appendChild(b);
});
renderChips(CHIP_GROUPS[store.get('jarvis.chipTab', 'CODE')] ? store.get('jarvis.chipTab', 'CODE') : 'CODE');

/* ============ tabs / memory panel ============ */
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
  if (name === 'chat') messages.scrollTop = messages.scrollHeight;
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function renderMemory() {
  memoryList.innerHTML = '';
  $('#memCount').textContent = memory.length;
  if (!memory.length) { memoryList.innerHTML = '<div class="tempty">I do not know anything about you yet.<br>Try "my name is …" or "remember that my exam is on the 12th".</div>'; return; }
  memory.slice().reverse().forEach(m => {
    const d = document.createElement('div'); d.className = 'mem';
    d.innerHTML = '<b>' + escHtml(m.key.toUpperCase()) + '</b><span>' + escHtml(m.value) + '</span><button title="Forget">✕</button>';
    d.querySelector('button').addEventListener('click', () => { memDel(m.id); log('info', 'memory entry deleted'); });
    memoryList.appendChild(d);
  });
  renderTasks();
}
function renderSnippets() {
  const el = $('#snippetList'); if (!el) return;
  el.innerHTML = '';
  $('#snipMeta').textContent = snippets.length ? snippets.length : '';
  if (!snippets.length) { el.innerHTML = '<div class="tempty">No snippets yet — copy some code and say "save my clipboard as snippet binary search".</div>'; return; }
  snippets.forEach(sn => {
    const d = document.createElement('div'); d.className = 'snip';
    d.innerHTML = '<div class="sh"><span class="sn"></span>' + (sn.lang ? '<span class="lang">' + escHtml(sn.lang) + '</span>' : '') + '<button class="sb" data-a="copy">COPY</button><button class="sb" data-a="paste" title="Paste into the active window after 3s">PASTE</button><button class="sb x" data-a="del" title="Delete">✕</button></div><pre></pre>';
    d.querySelector('.sn').textContent = sn.name;
    d.querySelector('pre').textContent = sn.code.split('\n').slice(0, 2).join('\n');
    d.querySelector('[data-a=copy]').addEventListener('click', async () => { await copyText(sn.code); toast('Copied "' + sn.name + '"'); });
    d.querySelector('[data-a=paste]').addEventListener('click', async () => { const r = await pasteToActiveWindow(sn.code, 'snippet ' + sn.name); if (!/Click into/.test(r.text)) toast(r.text); });
    d.querySelector('[data-a=del]').addEventListener('click', () => { snippets = snippets.filter(x => x !== sn); saveSnippets(); });
    el.appendChild(d);
  });
}

function renderFlashDecks() {
  const el = $('#flashList'); if (!el) return;
  const decks = flashDecks();
  el.innerHTML = '';
  $('#flashMeta').textContent = flashcards.length ? flashcards.length + ' cards' : '';
  if (!decks.length) { el.innerHTML = '<div class="tempty">No flashcards yet — say "make flashcards on normalization" or "make flashcards from os-notes.md".</div>'; return; }
  decks.forEach(d => {
    const row = document.createElement('div'); row.className = 'deck';
    row.innerHTML = '<span class="dn"></span><span class="dc">' + d.count + '</span>' + (d.due ? '<span class="dd">' + d.due + ' due</span>' : '') + '<button class="sb snipbtn" data-a="rev">REVIEW</button><button class="sb x snipbtn" data-a="del" title="Delete deck">✕</button>';
    row.querySelector('.dn').textContent = d.name;
    row.querySelector('[data-a=rev]').addEventListener('click', () => handleUser('Review my ' + d.name + ' flashcards', 'chip'));
    row.querySelector('[data-a=del]').addEventListener('click', () => { if (confirm('Delete deck "' + d.name + '"?')) { flashcards = flashcards.filter(c => c.deck !== d.name); saveFlash(); } });
    el.appendChild(row);
  });
}
setInterval(renderFlashDecks, 5 * 6e4);

/* ============ project folders (settings) ============ */
let projectRoots = [];
function renderRoots(roots) {
  projectRoots = roots.map(r => r.split(/[/\\]/).pop());
  const el = $('#rootList'); el.innerHTML = '';
  if (!roots.length) el.innerHTML = '<div class="tempty">No project folders yet.</div>';
  roots.forEach(r => {
    const d = document.createElement('div'); d.className = 'root';
    d.innerHTML = '<span></span><button title="Remove">✕</button>';
    d.querySelector('span').textContent = r;
    d.querySelector('button').addEventListener('click', async () => {
      const res = await callTool('/config', { action: 'remove', path: r });
      if (res.roots) { renderRoots(res.roots); log('info', 'project folder removed: ' + r); }
    });
    el.appendChild(d);
  });
}
async function loadConfig() { const d = await getJSON('/config'); if (d.roots) renderRoots(d.roots); }
$('#rootAddBtn').addEventListener('click', async () => {
  const v = $('#rootInput').value.trim();
  if (!v) return;
  const res = await callTool('/config', { action: 'add', path: v });
  if (res.error) { toast(res.error); return; }
  $('#rootInput').value = ''; renderRoots(res.roots); sfx.ok(); log('ok', 'project folder added: ' + v);
  toast('Added — JARVIS can now use this folder');
});
$('#rootInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#rootAddBtn').click(); });

/* ============ backup & restore (backup.js) ============ */
function bkDownload(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function bkExport(withKeys, password) {
  const r = await callTool('/backup/export', { includeSecrets: !!withKeys, password: password || '' });
  if (r.error) return { error: r.error };
  bkDownload(r.filename, r.content); log('ok', 'backup exported (' + r.filename + ')');
  return r;
}
async function renderSnaps() {
  const box = document.getElementById('bkSnaps'); if (!box) return;
  let d; try { d = await (await fetch(API + '/backup/snapshots')).json(); } catch { d = { error: 'backend offline' }; }
  if (d.error) { box.innerHTML = '<div class="tempty">' + escHtml(d.error) + '</div>'; return; }
  box.innerHTML = d.snapshots.length ? '' : '<div class="tempty">None yet — the first one is taken soon after JARVIS starts.</div>';
  for (const s of d.snapshots.slice(0, 8)) {
    const row = document.createElement('div'); row.className = 'root'; row.style.marginBottom = '6px';
    const label = (s.name.startsWith('daily-') ? 'Daily' : s.name.replace(/-\d{4}-.*$/, '').replace(/-/g, ' ')) + ' · ' + new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    row.innerHTML = '<span></span><button class="linkbtn" type="button">RESTORE</button>'; row.querySelector('span').textContent = label;
    row.querySelector('button').onclick = () => {
      if (!confirm('Restore this snapshot? Your current data is snapshotted first, then replaced. Close other JARVIS tabs before you continue.')) return;
      withHello('wipe', async tok => { const r = await callTool('/backup/restore', { name: s.name }, tok); if (r.error) return toast(r.error, true); toast('Restored — reloading…'); setTimeout(() => location.reload(), 900); });
    };
    box.appendChild(row);
  }
}
(function bindBackup() {
  const tg = $('#bkSecretsToggle'), pw = $('#bkPassword'), note = $('#bkNote'), file = $('#bkFile'), box = $('#bkImportBox');
  tg.addEventListener('click', () => { const on = !tg.classList.contains('on'); tg.classList.toggle('on', on); tg.setAttribute('aria-checked', String(on)); $('#bkPwRow').hidden = !on; if (on) pw.focus(); });
  $('#bkExport').addEventListener('click', async () => {
    const keys = tg.classList.contains('on');
    if (keys && pw.value.length < 8) { note.textContent = 'Choose a password of at least 8 characters to seal the API keys.'; pw.focus(); return; }
    note.textContent = 'Exporting…';
    const r = await bkExport(keys, pw.value);
    note.textContent = r.error ? '✗ ' + r.error : '✓ Saved ' + r.filename + (r.secrets ? ' (API keys sealed with your password — keep the password safe; JARVIS can’t recover it).' : ' (no API keys inside).');
  });
  $('#bkImport').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    if (f.size > 6 * 1024 * 1024) { note.textContent = '✗ That file is too big to be a JARVIS backup.'; return; }
    const content = await f.text();
    note.textContent = 'Reading the backup…';
    const p = await callTool('/backup/preview', { content });
    if (p.error) { note.textContent = '✗ ' + p.error; box.innerHTML = ''; return; }
    note.textContent = '';
    const list = Object.entries(p.areas).map(([k, n]) => n + ' ' + k).join(', ') || 'settings only';
    box.innerHTML = '<div class="dash-plan"><div><b>Backup from ' + escHtml(p.createdAt ? new Date(p.createdAt).toLocaleString() : 'unknown date') + '</b></div><div class="dash-sub">' + escHtml(list) + (p.roots ? ' · ' + p.roots + ' project folder(s)' : '') + '</div>' +
      '<div class="dash-sub" style="margin-top:8px"><label><input type="radio" name="bkMode" value="merge" checked> <b>Merge</b> — keep what’s here, add what’s missing (recommended)</label><br><label><input type="radio" name="bkMode" value="replace"> <b>Replace</b> — make this laptop match the backup</label></div>' +
      (p.hasSecrets ? '<div class="dash-sub" style="margin-top:8px"><label><input type="checkbox" id="bkWithKeys"> Also restore API keys</label> <input type="password" id="bkImpPw" placeholder="Backup password" style="margin-left:6px;background:rgba(5,15,26,.9);border:1px solid var(--line);border-radius:6px;color:var(--ink);padding:5px 8px"></div>' : '') +
      '<div class="root-add" style="margin-top:10px"><button class="btn" id="bkGo" type="button">IMPORT</button><button class="btn" id="bkCancel" type="button">CANCEL</button></div><div class="dash-sub">Close other JARVIS tabs first. A safety snapshot is taken automatically.</div></div>';
    $('#bkCancel').onclick = () => { box.innerHTML = ''; };
    $('#bkGo').onclick = () => {
      const mode = box.querySelector('input[name=bkMode]:checked').value, withSecrets = !!($('#bkWithKeys') && $('#bkWithKeys').checked);
      if (mode === 'replace' && !confirm('Replace everything on this laptop with the backup? A safety snapshot is taken first.')) return;
      withHello('wipe', async tok => {
        const r = await callTool('/backup/import', { content, mode, withSecrets, password: withSecrets ? $('#bkImpPw').value : '' }, tok);
        if (r.error) { note.textContent = '✗ ' + r.error; return; }
        note.textContent = '✓ Imported (' + r.mode + '). Reloading…'; toast('Backup imported — reloading'); setTimeout(() => location.reload(), 1200);
      });
    };
  });
  $('#settingsBtn').addEventListener('click', renderSnaps);
})();

/* ============ AI providers: bring your own API key (llm.js keeps the keys server-side) ============ */
let providerPresets = [];
async function renderProviders() {
  let d;
  try { d = await (await fetch(API + '/llm/providers')).json(); } catch (e) { d = { error: 'backend offline' }; }
  const list = $('#providerList'), note = $('#providerNote');
  if (d.error) { list.innerHTML = '<div class="tempty">' + escHtml(d.error) + '</div>'; return; }
  providerPresets = d.presets || [];
  const sel = $('#providerPreset');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="auto">Auto-detect from my key (recommended)</option>' + providerPresets.map(p => '<option value="' + p.id + '">' + escHtml(p.label) + '</option>').join('');
    sel.onchange = updateProviderForm; updateProviderForm();
  }
  list.innerHTML = d.providers.length ? '' : '<div class="tempty">No cloud providers yet — JARVIS uses local Ollama only.</div>';
  for (const p of d.providers) {
    const row = document.createElement('div'); row.className = 'root'; row.style.marginBottom = '6px';
    row.innerHTML = '<span></span><button class="linkbtn" data-a="test" type="button">TEST</button><button data-a="rm" title="Remove">✕</button>';
    row.querySelector('span').textContent = p.label + '  ' + (p.key || '(no key)') + (llm.errors[p.id] ? '  ⚠ ' + llm.errors[p.id] : '');
    row.querySelector('[data-a=test]').onclick = async () => {
      note.textContent = 'Testing ' + p.label + '…';
      const r = await callTool('/llm/providers/' + encodeURIComponent(p.id) + '/test', { model: settings.model });
      note.textContent = r.success ? '✓ ' + p.label + ' works — ' + r.model + ' replied "' + r.reply + '" in ' + (r.ms / 1000).toFixed(1) + 's.' : '✗ ' + (r.error || 'test failed');
    };
    row.querySelector('[data-a=rm]').onclick = async () => {
      if (!confirm('Remove ' + p.label + ' and its API key from this laptop?')) return;
      const r = await fetch(API + '/llm/providers/' + encodeURIComponent(p.id), { method: 'DELETE' }).then(x => x.json()).catch(() => ({ error: 'backend offline' }));
      if (r.error) return toast(r.error, true);
      if (isCloudModel(settings.model) && settings.model.split('::')[0] === p.id) { settings.model = ''; saveSettings(); }
      log('info', 'AI provider removed: ' + p.label); await checkLLM(); renderProviders();
    };
    list.appendChild(row);
  }
}
function updateProviderForm() {
  const p = providerPresets.find(x => x.id === $('#providerPreset').value) || {};
  const custom = p.id === 'custom';
  $('#providerUrl').hidden = !custom; $('#providerModel').hidden = !custom;
  $('#providerKey').placeholder = custom ? 'API key (optional for local servers)' : p.label ? p.label + ' API key' : 'Paste your API key — I’ll work out the provider';
  $('#providerNote').innerHTML = p.keyUrl ? 'Get a key: <a href="' + escHtml(p.keyUrl) + '" target="_blank" rel="noopener noreferrer">' + escHtml(p.keyUrl.replace(/^https:\/\//, '')) + '</a>' : custom ? 'Any server with an OpenAI-style <code>/chat/completions</code> endpoint — LM Studio, vLLM, llama.cpp, Ollama’s <code>/v1</code>.' : '';
}
$('#providerAddBtn').addEventListener('click', async () => {
  const preset = $('#providerPreset').value, keyEl = $('#providerKey');
  const body = { preset, apiKey: keyEl.value.trim(), baseUrl: $('#providerUrl').value.trim(), model: $('#providerModel').value.trim() };
  $('#providerNote').textContent = 'Checking the key…';
  const r = await callTool('/llm/providers', body);
  keyEl.value = ''; // the key never stays in the page
  if (r.error) { $('#providerNote').textContent = '✗ ' + r.error; return; }
  $('#providerUrl').value = ''; $('#providerModel').value = '';
  $('#providerNote').textContent = '✓ Added ' + r.provider.label + ' — ' + plural(r.models, 'model') + ' available. Pick one under Model above.';
  sfx.ok(); log('ok', 'AI provider added: ' + r.provider.label);
  if (r.defaultModel) { settings.model = r.defaultModel; saveSettings(); llm.warm = false; } // start using it straight away
  await checkLLM(); renderProviders();
});
/* ============ image service key: "draw me …" (imagegen.js keeps the key server-side and never sends it back) ============ */
async function renderImageService() {
  const note = $('#imageNote'); if (!note) return;
  let d; try { d = await (await fetch(API + '/image/status')).json(); } catch (e) { d = null; }
  if (!d || !d.success) { note.textContent = ''; return; }
  $('#imageKeyRemove').hidden = !d.hasKey;
  note.textContent = (d.hasKey ? '✓ A key is saved on this laptop. ' : 'No key saved. That is fine if the service lets you in without one. ') + (d.local ? 'A Stable Diffusion server was found on this PC and is used first.' : '');
}
$('#imageKeySave').addEventListener('click', async () => {
  const el = $('#imageKey'), key = el.value.trim();
  if (!key) { $('#imageNote').textContent = 'Paste the key first.'; return; }
  const r = await callTool('/image/key', { apiKey: key });
  el.value = '';                                         // the key never stays in the page
  if (r.error) { $('#imageNote').textContent = '✗ ' + r.error; return; }
  sfx.ok(); log('ok', 'image service key saved'); renderImageService();
});
$('#imageKeyRemove').addEventListener('click', async () => {
  if (!confirm('Remove the image service key from this laptop?')) return;
  const r = await callTool('/image/key', { apiKey: '' });
  if (r.error) { $('#imageNote').textContent = '✗ ' + r.error; return; }
  log('info', 'image service key removed'); renderImageService();
});
$('#imageKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('#imageKeySave').click(); });
/* ============ attach a file: 📎 or drag & drop anywhere ============ */
async function uploadFile(f) {
  if (!f) return;
  if (f.size > 40 * 1024 * 1024) return toast('That file is bigger than 40 MB', true);
  toast('Adding ' + f.name + '…');
  let r;
  try { r = await (await fetch(API + '/tool/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f })).json(); }
  catch (e) { r = { error: 'the backend is offline' }; }
  if (r.error) return jarvisSay({ text: 'I couldn’t add **' + f.name + '**: ' + r.error + '.', intent: 'UPLOAD' });
  ctx.lastFile = r.name; sfx.ok(); log('ok', 'file added: ' + r.name);
  const nm = r.file;
  const what = r.pages ? ' (' + plural(r.pages, 'page') + ')' : '';
  if (r.scanned) return jarvisSay({ text: 'Saved **' + nm + '**' + what + ' to ~/jarvis/Documents, but it’s a scan — pictures of pages with no text layer — so I can’t read its words. Open it and say **"read my screen"** to read a page.', intent: 'UPLOAD' });
  jarvisSay({ text: '📄 Added **' + nm + '**' + what + ' to `~/jarvis/Documents`. Ask me anything about it — e.g. **"what does ' + nm + ' say about …"**.', intent: 'UPLOAD', tool: 'upload',
    actions: [{ label: 'SUMMARISE', fn: () => handleUser('summarise ' + nm, 'chip') }, { label: 'MAKE FLASHCARDS', fn: () => handleUser('make flashcards from ' + nm, 'chip') }],
    suggestions: ['What does ' + nm + ' say about ', 'Explain the main ideas in ' + nm] });
}
$('#attachBtn').addEventListener('click', () => $('#attachFile').click());
$('#attachFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; uploadFile(f); });
addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); document.body.classList.remove('dropping'); [...e.dataTransfer.files].slice(0, 5).forEach(uploadFile); });
$('#wizAiBtn').addEventListener('click', () => { closeDrawer(); Wizard.open('welcome'); });
$('#wizPhoneBtn').addEventListener('click', () => { closeDrawer(); Wizard.open('phone1'); });
$('#providerKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('#providerAddBtn').click(); });
$('#settingsBtn').addEventListener('click', () => { renderProviders(); renderImageService(); });

$('#clearMemBtn').addEventListener('click', () => { if (!confirm('Forget everything JARVIS knows about you?')) return; const prev = memory.slice(); memory = []; store.set('jarvis.memory', memory); renderMemory(); toast('Memory cleared'); if (prev.length) Undo.push('cleared memory', () => { memory = prev.concat(memory); store.set('jarvis.memory', memory); renderMemory(); return 'Brought back ' + plural(prev.length, 'memory') + '.'; }); });
$('#clearChatBtn').addEventListener('click', () => {
  const prev = chatLog.slice();
  chatLog = []; store.set('jarvis.chat', chatLog); restoreChat(); toast('Chat cleared — say "undo" to bring it back');
  if (prev.length) Undo.push('cleared chat', () => { chatLog = prev.concat(chatLog).slice(-80); store.set('jarvis.chat', chatLog); restoreChat(); return 'Brought back ' + plural(prev.length, 'message') + '.'; });
});
$('#leftToggle').addEventListener('click', () => document.body.classList.toggle('show-left'));

/* ============ settings drawer ============ */
const drawer = $('#settingsDrawer'), backdrop = $('#backdrop');
function openDrawer() { drawer.classList.add('open'); backdrop.classList.add('open'); checkLLM(); }
function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); }
$('#settingsBtn').addEventListener('click', openDrawer);
// Phone access (Tailscale): shows the private URL, or the next setup step.
async function renderRemoteNote() {
  const n = $('#remoteNote'), r = await getJSON('/remote/status');
  if (r.error) { n.textContent = 'Couldn’t check Tailscale.'; return; }
  if (r.tailscale && r.serving) n.innerHTML = 'On your phone (signed in to Tailscale), open <code>' + escHtml(r.url) + '</code> — every command works as here, except Windows Hello approvals.';
  else if (r.tailscale) n.innerHTML = 'Tailscale is signed in. Publish JARVIS to your devices by running <code>tailscale serve --bg ' + r.port + '</code> on this laptop, then open <code>' + escHtml(r.url) + '</code> on your phone.';
  else n.textContent = 'Sign in to Tailscale on this laptop (tray icon → Log in) and on your phone with the same account to use JARVIS from your phone.';
}
$('#settingsBtn').addEventListener('click', renderRemoteNote);
$('#closeSettings').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);
function bindSwitchState(id, key) { const el = $(id); el.classList.toggle('on', !!settings[key]); el.setAttribute('aria-checked', String(!!settings[key])); }
function bindSwitch(id, key, after) {
  bindSwitchState(id, key);
  $(id).addEventListener('click', () => {
    settings[key] = !settings[key]; bindSwitchState(id, key); saveSettings(); sfx.key();
    if (after) after(settings[key]);
  });
}
/* ---- screen readers ---- */
// Every settings switch is named after the label in its row (a bare button says only "switch" to a screen reader).
document.querySelectorAll('.s-row').forEach(row => { const lab = row.querySelector('label'); if (!lab) return; const l = lab.cloneNode(true); l.querySelectorAll('small').forEach(x => x.remove()); const name = l.textContent.trim(); row.querySelectorAll('button.switch, select, input:not([type=hidden]):not([type=checkbox])').forEach(c => { if (!c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby') && !c.placeholder && !c.title) c.setAttribute('aria-label', name); }); });
// A quiet live region reads each FINISHED reply once (not every streamed word): a new JARVIS message is watched until its text stops changing.
const srLive = document.getElementById('srLive'); let srReady = false; setTimeout(() => { srReady = true; }, 4000);
function srAnnounce(text) { if (!srLive || !text) return; srLive.textContent = ''; setTimeout(() => { srLive.textContent = String(text).replace(/\s+/g, ' ').trim().slice(0, 800); }, 60); }
function srWatch(node) {
  let last = '', stable = 0, tries = 0;
  const iv = setInterval(() => {
    const body = node.querySelector('.mbody'), tx = body ? body.innerText.trim() : '';
    tries++; stable = tx && tx === last && !node.querySelector('.thinking') && !(body && body.classList.contains('typing')) ? stable + 1 : 0; last = tx;
    if (stable >= 3 || tries > 400) { clearInterval(iv); if (tx && stable >= 3) srAnnounce(tx); }
  }, 500);
}
new MutationObserver(muts => { if (!srReady) return; for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('msg') && n.classList.contains('jarvis')) srWatch(n); }).observe(messages, { childList: true });
bindSwitch('#ttsToggle', 'tts', v => { if (!v) stopSpeaking(); loadVoices(); });
bindSwitch('#soundToggle', 'sound');
bindSwitch('#attendancePromptToggle', 'attendancePrompt');
{ const sel = $('#attendanceMinSel'); if (sel) { sel.value = String(attMin()); sel.addEventListener('change', () => { settings.attendanceMin = +sel.value; saveSettings(); renderTasks(); toast('Attendance target: ' + attMin() + '%'); }); } }
bindSwitch('#phoneStrictToggle', 'phoneStrict', v => log('info', 'phone commands: ' + (v ? 'strict — a fresh authenticator code with every command' : 'unlock for 10 minutes')));
bindSwitch('#offlineSttToggle', 'offlineStt', v => { if (v) Stt.ready().then(ok => { if (!ok) { settings.offlineStt = false; saveSettings(); bindSwitchState('#offlineSttToggle', 'offlineStt'); jarvisSay({ text: 'Offline speech is not installed yet. Say **“is offline speech installed”** for how to install it.', noPersona: true }); } }); });
bindSwitch('#translateOnlineToggle', 'translateOnline', v => log('info', 'online translation ' + (v ? 'on' : 'off — replies translated by the local model')));
bindSwitch('#neuralVoiceToggle', 'neuralVoice', v => log('info', 'online neural voice (FRIDAY, Telugu, Kannada) ' + (v ? 'on' : 'off')));
bindSwitch('#hotkeyToggle', 'hotkey', v => { log('info', 'global hotkey ' + (v ? 'on' : 'off')); setTimeout(updateHotkeyNote, 5500); });
async function updateHotkeyNote() {
  const n = $('#hotkeyNote'); if (!n) return;
  const r = await getJSON('/hotkey/status');
  if (r.error) { n.textContent = ''; return; }
  n.textContent = !r.supported ? 'Windows only.' : !settings.hotkey ? 'Select text in any app, press Ctrl+Shift+J, and JARVIS can explain, rewrite, translate or summarise it.'
    : r.taken ? '⚠ Ctrl+Shift+J is already used by another program.' : r.running ? '✓ Active: select text in any app and press Ctrl+Shift+J.' : 'Starting…';
}
$('#settingsBtn').addEventListener('click', updateHotkeyNote);
bindSwitch('#alertsToggle', 'alerts', v => log('info', 'smart alerts ' + (v ? 'on' : 'off')));
if (settings.skillSuggest === undefined) { settings.skillSuggest = true; }
bindSwitch('#skillSuggestToggle', 'skillSuggest');
if (settings.speakWhileWriting === undefined) settings.speakWhileWriting = true;
bindSwitch('#speakWhileWritingToggle', 'speakWhileWriting');
if (settings.chatArchive === undefined) settings.chatArchive = true;
bindSwitch('#chatArchiveToggle', 'chatArchive');
setTimeout(() => { if (typeof Extras !== 'undefined') Extras.archiveBackfill(chatLog); }, 6000);
// the STOP button shows while JARVIS is speaking or writing
{ const stopBtn = $('#stopBtn'); stopBtn.addEventListener('click', () => { stopEverything(); stopBtn.hidden = true; });
  setInterval(() => { stopBtn.hidden = !(isSpeakingNow() || speechQueue.active || llmAbort); }, 250); }
// camera watchers (watch-page.js): off until you switch them on; the switch stays as you left it
bindSwitch('#presenceToggle', 'presenceLock', v => { if (typeof Watch !== 'undefined') Watch.setPresence(v); });
bindSwitch('#presenceWinToggle', 'presenceLockWindows');
$('#presenceSecsSelect').value = String(settings.presenceSecs || 60);
$('#presenceSecsSelect').addEventListener('change', e => { settings.presenceSecs = +e.target.value; saveSettings(); if (typeof Watch !== 'undefined') Watch.applySeconds(); toast('Presence lock: ' + e.target.selectedOptions[0].textContent.toLowerCase()); });
setTimeout(() => { if (typeof Watch !== 'undefined') Watch.resume(); }, 4000);
bindSwitch('#chargerAlertsToggle', 'chargerAlerts', v => log('info', 'charger alerts ' + (v ? 'on' : 'off')));
bindSwitch('#inspectToggle', 'inspect', v => toast(v ? 'I’ll show how I understood each request (🔍 under the reply)' : 'Inspector off — say “how did you understand that?” any time'));
// Phone alerts: the server pushes reminders/deadline alerts to ntfy.sh under a random, unguessable topic.
function updatePhoneNote() {
  const n = $('#phonePushNote');
  n.hidden = !settings.phonePush;
  if (!settings.phonePush) return;
  n.innerHTML = 'Install the free <b>ntfy</b> app on your phone, tap <b>+</b> and subscribe to <code>' + escHtml(settings.phoneTopic) +
    '</code>. Anyone who knows this topic name could read these alerts, so keep it private. <button class="linkbtn" id="phoneTestBtn" type="button">SEND TEST</button>';
  $('#phoneTestBtn').onclick = async () => { const r = await callTool('/notify/test', { topic: settings.phoneTopic }); toast(r.error || 'Test sent — check your phone'); };
  renderPhoneAuth();
}
// Explains in plain words why a phone unlock code is refused (checked on the laptop; doesn't use the code up).
async function checkPhoneCode(code, out) {
  out.textContent = 'Checking…';
  const r = await callTool('/phone/auth/check', { code });
  const skew = r.skew != null && Math.abs(r.skew) > 20 ? ' Your laptop clock is ' + Math.abs(r.skew) + ' seconds ' + (r.skew > 0 ? 'fast' : 'slow') + ' — fix it: Windows Settings → Time & language → Date & time → turn on "Set time automatically" and click "Sync now".' : '';
  out.innerHTML = r.error ? '✗ ' + escHtml(r.error)
    : r.result === 'bad-format' ? 'Type all 6 digits.'
    : r.result === 'no-key' ? 'Phone commands aren’t set up yet — use Guided setup → PHONE.'
    : r.result === 'ok' ? '✓ That code is right. Send exactly these 6 digits in ntfy within 30 seconds of it appearing (JARVIS must be running). Each code works once.' + skew
    : r.result === 'clock' ? '⏱ The code belongs to JARVIS, but the phone and laptop clocks disagree by about ' + Math.abs(r.offset) + ' seconds.' + (skew || ' Turn on automatic time on both the laptop and the phone.')
    : '✗ That code is from a <b>different key</b>. The JARVIS entry in your authenticator app is old (maybe from before a NEW KEY). Delete every "JARVIS" entry in Google Authenticator, then scan again: <b>Guided setup → PHONE → step 3</b>.' + skew;
}
// Phone commands: unlocked with a 6-digit code from an authenticator app (checked by the server, scheduler.js).
async function renderPhoneAuth(shown) {
  const n = $('#phonePushNote'); if (n.hidden) return;
  let box = $('#phoneAuthBox');
  if (!box) { box = document.createElement('div'); box.id = 'phoneAuthBox'; box.style.marginTop = '10px'; n.appendChild(box); }
  const st = await getJSON('/phone/auth');
  const status = st.unlockedUntil ? '🔓 Phone commands unlocked until ' + fmtTime(st.unlockedUntil) + '.' : '🔒 Phone commands locked.';
  if (shown) {
    const key = shown.secret.replace(/(.{4})/g, '$1 ').trim();
    box.innerHTML = '<b>Phone commands.</b> In <b>Google Authenticator</b> (or Microsoft Authenticator): <b>+</b> → <b>Enter a setup key</b> → account <code>JARVIS</code>, key <code>' +
      escHtml(key) + '</code>, time-based. Then send <code>unlock 123456</code> (your current code) in ntfy, and commands work for 10 minutes (or turn on strict mode: a fresh code with every command). Keep this key secret. <button class="linkbtn" id="phoneAuthHide" type="button">HIDE KEY</button>';
    $('#phoneAuthHide').onclick = () => renderPhoneAuth();
    return;
  }
  box.innerHTML = st.configured
    ? '<b>Phone commands:</b> ' + status + ' Send <code>unlock</code> + your authenticator code in ntfy; <code>lock</code> to lock. <button class="linkbtn" id="phoneAuthShow" type="button">SHOW KEY</button> <button class="linkbtn" id="phoneAuthReset" type="button">NEW KEY</button>'
    : '<b>Phone commands</b> (open apps, volume, media, to-dos… from ntfy) need an authenticator app. <button class="linkbtn" id="phoneAuthSetup" type="button">SET UP PHONE COMMANDS</button>';
  if (st.configured) {
    box.insertAdjacentHTML('beforeend', '<div style="margin-top:8px">Code not working? Type what Google Authenticator shows under JARVIS: <input id="phoneCodeIn" inputmode="numeric" maxlength="7" placeholder="123456" style="width:80px;background:rgba(5,15,26,.9);border:1px solid var(--line);border-radius:6px;color:var(--ink);padding:3px 6px"> <button class="linkbtn" id="phoneCodeBtn" type="button">CHECK</button><div id="phoneCodeOut" style="margin-top:4px"></div></div>');
    $('#phoneCodeBtn').onclick = () => checkPhoneCode($('#phoneCodeIn').value, $('#phoneCodeOut'));
    $('#phoneCodeIn').onkeydown = e => { if (e.key === 'Enter') $('#phoneCodeBtn').click(); };
  }
  const setup = async reset => { const r = await callTool('/phone/auth/setup', reset ? { reset: true } : {}); if (r.error) toast(r.error, true); else renderPhoneAuth(r); };
  if ($('#phoneAuthSetup')) $('#phoneAuthSetup').onclick = () => setup(false);
  if ($('#phoneAuthShow')) $('#phoneAuthShow').onclick = () => setup(false);
  if ($('#phoneAuthReset')) $('#phoneAuthReset').onclick = () => { if (confirm('Make a new key? The old one in your authenticator app will stop working.')) setup(true); };
}
$('#settingsBtn').addEventListener('click', () => renderPhoneAuth());
bindSwitch('#phonePushToggle', 'phonePush', v => {
  if (v && !/^jarvis-[0-9a-f]{16}$/.test(settings.phoneTopic || '')) {
    const b = new Uint8Array(8); crypto.getRandomValues(b);
    settings.phoneTopic = 'jarvis-' + [...b].map(x => x.toString(16).padStart(2, '0')).join(''); saveSettings();
  }
  log('info', 'phone alerts ' + (v ? 'on' : 'off')); updatePhoneNote();
});
updatePhoneNote();
$('#personaSelect').value = settings.persona;
$('#personaSelect').addEventListener('change', e => { applyPersona(e.target.value); speak(Persona.say('presence')); });
$('#themeSelect').value = settings.theme;
$('#themeSelect').addEventListener('change', e => switchTheme(e.target.value));
$('#speechLangSelect').value = settings.speechLang;
$('#pauseSelect').value = String(settings.pauseMs || 1600);
$('#micBoostSelect').value = settings.micBoost || 'high';
$('#micBoostSelect').addEventListener('change', e => {
  settings.micBoost = e.target.value; saveSettings();
  dropBoost();                                // the next listen builds the new boost level
  if (wakeOn) { stopWake(); startWake(); }    // also re-tunes the Windows listener
  toast('Mic sensitivity: ' + e.target.selectedOptions[0].textContent.toLowerCase());
});
$('#pauseSelect').addEventListener('change', e => {
  settings.pauseMs = +e.target.value; saveSettings();
  if (wakeOn) { stopWake(); startWake(); }   // the wake-word collector picks the new pause up
  toast('I’ll answer after a ' + (settings.pauseMs / 1000) + ' s pause');
});
$('#speechLangSelect').addEventListener('change', e => { setLanguage(e.target.value); });
$('#replyLangSelect').value = settings.replyLang;
$('#replyLangSelect').addEventListener('change', e => { settings.replyLang = e.target.value; saveSettings(); });
$$('.lang-btn').forEach(b => b.addEventListener('click', () => { const r = setLanguage(b.dataset.lang); toast(r.text.split(/\n/)[0]); speak(r.speak || r.text); }));
// Shows which Telugu/Kannada voices and speech recognition this browser offers.
$('#voiceCheckBtn').addEventListener('click', () => {
  const rows = ['te', 'kn', 'en'].map(l => {
    const v = l === 'en' ? pickVoice('en') : Lang.voiceFor(l);
    const fridayEn = l === 'en' && settings.persona === 'friday' && !settings.voice;
    const neural = (l !== 'en' || fridayEn) && settings.neuralVoice !== false ? '🔊 ' + { te: 'Mohan / Shruti', kn: 'Gagan / Sapna', en: 'Neerja (FRIDAY)' }[l] + ' (online neural voice)' : null;
    return '<span lang="' + l + '">' + Lang.NAMES[l] + '</span>: ' + escHtml(neural || (v ? '🔊 ' + v.name.replace(/^Microsoft /, '') : '— no voice (text replies only)'));
  });
  const browser = /Edg\//.test(navigator.userAgent) ? 'Edge' : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : 'this browser';
  $('#voiceCheckOut').innerHTML = rows.join('<br>') + '<br>Speech recognition: ' + (SR ? escHtml(browser) + ' — tap the mic after choosing a language to test it' : 'not supported here');
});
// Mic test: measures what the recogniser really hears for the words JARVIS commands depend on (raw), and what
// SpeechFix turns it into (fixed) — instead of guessing "the mic works". Last results kept in jarvis.micTest.
const MIC_TEST = ['frontend', 'create a frontend', 'create a folder', 'folder', 'directory', 'calculator project', 'VS Code', 'JavaScript', 'React', 'Python',
  'brightness', 'Chrome', 'make UI', 'create UI for calculator'];
let micTesting = false;
function micHear(timeoutMs) {
  return new Promise(resolve => {
    let done = false; const r = makeRec(false);
    const finish = v => { if (done) return; done = true; clearTimeout(t); try { r.stop(); } catch (e) {} resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    r.onresult = ev => { const res = ev.results[ev.results.length - 1]; if (res && res.isFinal) finish(Array.from(res, a => a.transcript.trim())); };
    r.onerror = () => finish(null); r.onend = () => finish(null);
    try { r.start(); } catch (e) { finish(null); }
  });
}
$('#micTestBtn').addEventListener('click', async () => {
  const out = $('#micTestOut');
  if (micTesting) { micTesting = false; return; }
  if (!SR) { out.textContent = 'Speech recognition needs Chrome or Edge.'; return; }
  if (micHeld) { toast('Finish the current voice command first'); return; }
  micTesting = true; $('#micTestBtn').textContent = 'STOP';
  if (wakeOn) { wakePaused = true; retireWakeRec(); }
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const rows = [];
  for (let i = 0; i < MIC_TEST.length && micTesting; i++) {
    const want = MIC_TEST[i];
    out.innerHTML = '<b>' + (i + 1) + ' / ' + MIC_TEST.length + '</b> — say: <b>“' + escHtml(want) + '”</b> 🎙';
    const alts = await micHear(7000);
    const raw = alts ? alts[0] : '', picked = alts ? SpeechFix.pickAlternative(alts) : '', fixed = SpeechFix.fix(picked);
    rows.push({ want, raw, fixed, rawOk: norm(raw) === norm(want), ok: norm(fixed) === norm(want) });
    await sleep(250);
  }
  micTesting = false; $('#micTestBtn').textContent = 'START';
  if (wakeOn && wakePaused) { wakePaused = false; loopWake(); }
  store.set('jarvis.micTest', { t: Date.now(), rows });
  const rawOk = rows.filter(r => r.rawOk).length, ok = rows.filter(r => r.ok).length;
  out.innerHTML = 'Heard right: <b>' + rawOk + ' / ' + rows.length + '</b> · after JARVIS’s corrections: <b>' + ok + ' / ' + rows.length + '</b>'
    + rows.filter(r => !r.rawOk || !r.ok).map(r => '<br>' + (r.ok ? '✓' : '✗') + ' “' + escHtml(r.want) + '” — heard “' + escHtml(r.raw || '(nothing)') + '”' + (r.fixed !== r.raw ? ' → “' + escHtml(r.fixed) + '”' : '')).join('');
  log('info', 'mic test: ' + rawOk + '/' + rows.length + ' heard right, ' + ok + '/' + rows.length + ' after corrections');
});
bindSwitch('#onlineToggle', 'online', v => { updateNetUI(); log(v ? 'warn' : 'info', 'online tools ' + (v ? 'enabled — weather & web answers use the internet' : 'disabled — fully offline')); });
bindSwitch('#llmToggle', 'llm', v => { updateLLMUI(); if (v) warmLLM(); });
$('#modelSelect').addEventListener('change', e => { settings.model = e.target.value; llm.model = e.target.value; llm.warm = false; saveSettings(); updateLLMUI(); warmLLM(); });
$('#voiceSelect').addEventListener('change', e => { settings.voice = e.target.value; saveSettings(); loadVoices(); speak('Voice updated.'); });
$('#rateRange').value = settings.rate; $('#rateVal').textContent = parseFloat(settings.rate).toFixed(1) + '×';
$('#rateRange').addEventListener('input', e => { settings.rate = parseFloat(e.target.value); $('#rateVal').textContent = settings.rate.toFixed(1) + '×'; saveSettings(); });
$('#wakeWordInput').value = settings.wakeWord;
$('#wakeWordInput').addEventListener('change', e => {
  const v = e.target.value.trim().toLowerCase().replace(/\s+/g, ' ') || 'jarvis';
  settings.wakeWord = v; e.target.value = v; saveSettings(); log('info', 'wake word: "' + v + '"');
  if (wakeOn) { stopWake(); startWake(); }
});
$('#addressSelect').value = settings.address;
$('#addressSelect').addEventListener('change', e => {
  settings.address = e.target.value; saveSettings();
  if (settings.address === 'name' && !memGet('name')) toast('Tell me your name first: "my name is …"');
  speak('Very well, ' + Persona.sir() + '.');
});
$('#lenSelect').value = settings.responseLen;
$('#lenSelect').addEventListener('change', e => { settings.responseLen = e.target.value; saveSettings(); });
$('#cityInput').value = settings.city;
$('#cityInput').addEventListener('change', e => { settings.city = e.target.value.trim(); saveSettings(); });
$('#focusMin').value = settings.focusMin; $('#breakMin').value = settings.breakMin;
$('#focusMin').addEventListener('change', e => { settings.focusMin = clamp(+e.target.value || 25, 5, 120); e.target.value = settings.focusMin; saveSettings(); });
$('#breakMin').addEventListener('change', e => { settings.breakMin = clamp(+e.target.value || 5, 1, 60); e.target.value = settings.breakMin; saveSettings(); });
// ---- Alert threshold inputs (Phase 1.6) ----
// Each input reads/writes through Thresholds.set() so the values flow into
// settings.thresholds and persist across reloads.
(function wireThresholdInputs() {
  const snap = Thresholds.snapshot();
  const bind = (id, key, min, max, def) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = snap[key];
    el.addEventListener('change', () => {
      let v = Number(el.value);
      if (!isFinite(v)) v = def;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      Thresholds.set({ [key]: v });
      log('info', 'threshold ' + key + ' set to ' + v);
    });
  };
  bind('thrBatteryLow',   'batteryLow',     5,  50,  20);
  bind('thrBatteryCrit',  'batteryCritical', 1, 30,  10);
  bind('thrRamHigh',      'ramHigh',       50,  99,  92);
  bind('thrCpuSustained', 'cpuSustained',   50,  99,  95);
  bind('thrCpuSec',       'cpuSustainedSec', 10, 600, 60);
  bind('thrDiskLow',      'diskLowGB',      0.1, 100, 2);
  bind('thrDeadlineH',    'deadlineWindowH', 1,  72,  3);
  bind('thrReAlert',      'reAlertMinutes',  5, 1440, 30);
  bind('thrBarHot',       'barHotPct',       50, 99,  75);
  bind('thrBarCrit',      'barCritPct',      50, 100, 90);
  // Telemetry poll interval is stored in ms (3000) but the UI is in seconds.
  const pollEl = document.getElementById('thrPollMs');
  if (pollEl) {
    pollEl.value = Math.round(Thresholds.pollMs / 1000);
    pollEl.addEventListener('change', () => {
      let v = Number(pollEl.value);
      if (!isFinite(v)) v = 3;
      v = Math.max(1, Math.min(60, v));
      pollEl.value = v;
      Thresholds.set({ pollMs: v * 1000 });
      log('info', 'telemetry poll interval set to ' + v + 's — takes effect on next reload');
    });
  }
})();
// ---- Port scan watch toggle (Phase 1.6) ----
(function wirePortwatchToggle() {
  const btn = document.getElementById('portwatchToggle');
  if (!btn) return;
  // Read the current state from the server on first paint.
  fetch((window.API || '') + '/portwatch/status').then(r => r.json()).then(s => {
    btn.classList.toggle('on', !!s.enabled);
    btn.setAttribute('aria-checked', String(!!s.enabled));
  }).catch(() => {});
  btn.addEventListener('click', async () => {
    const turnOn = !btn.classList.contains('on');
    btn.classList.toggle('on', turnOn);
    btn.setAttribute('aria-checked', String(turnOn));
    try {
      const r = await fetch((window.API || '') + '/portwatch/enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: turnOn }),
      }).then(r => r.json());
      if (r.unavailable) { toast('Port watch unavailable on this platform'); btn.classList.remove('on'); btn.setAttribute('aria-checked', 'false'); }
      else log('ok', 'Port scan watch ' + (turnOn ? 'enabled' : 'disabled'));
    } catch (e) { log('warn', 'Port watch toggle failed: ' + e.message); btn.classList.toggle('on', !turnOn); }
  });
})();
// "Require Windows Hello" is owned by the server (.config.json), not settings: turning it off needs an approval.
async function renderHelloToggle() {
  const st = await Hello.refresh(), el = $('#helloToggle'), note = $('#helloNote');
  el.classList.toggle('on', !!st.required); el.setAttribute('aria-checked', String(!!st.required));
  const why = st.required ? null : await Hello.unavailable();
  note.hidden = !why; note.textContent = why || '';
}
$('#helloToggle').addEventListener('click', async () => {
  sfx.key();
  if (Hello.required()) {
    if (await Hello.disable()) toast('Windows Hello no longer required');
  } else {
    try { await Hello.enroll(); toast('Windows Hello is now required for shutdown, restart, sleep and deleting'); log('ok', 'Windows Hello enrolled'); }
    catch (e) { toast(e.name === 'NotAllowedError' ? 'Windows Hello was cancelled' : e.message, true); }
  }
  renderHelloToggle();
});
renderHelloToggle();

/* ---- App lock (applock.js): JARVIS opens only after Windows Hello ---- */
async function renderAppLock() {
  const st = await getJSON('/lock/status');
  if (st.error) return;
  const on = $('#appLockToggle'), opts = $('#appLockOpts'), note = $('#appLockNote');
  on.classList.toggle('on', !!st.enabled); on.setAttribute('aria-checked', String(!!st.enabled));
  opts.hidden = !st.enabled; $('#appLockIdle').value = String(st.enabled ? st.idleMin || 0 : 15);
  const why = !st.helloEnrolled ? 'Turn on “Require Windows Hello” above first — the lock opens with it.'
    : st.enabled ? 'On: JARVIS asks for Windows Hello every time it opens' + (st.idleMin ? ', and after ' + st.idleMin + ' minutes of no use' : '') + '. Reminders and phone alerts keep working while it’s locked. It can only be unlocked at the laptop — Windows Hello works there only.' : '';
  note.hidden = !why; note.textContent = why;
  if (typeof window.__lockSetActive === 'function') window.__lockSetActive(st.active);
}
// Turning the lock on / off / changing the auto-lock time always needs a fresh Windows Hello approval.
async function setAppLock(enable, idleMin) {
  const token = await Hello.approve('lock');
  if (!token) { toast('Windows Hello wasn’t verified — nothing changed', true); return false; }
  const r = enable ? await callTool('/lock/enable', { idleMin }, token) : await callTool('/lock/disable', {}, token);
  if (r.error) { toast(r.error, true); return false; }
  return true;
}
$('#appLockToggle').addEventListener('click', async () => {
  sfx.key();
  const st = await getJSON('/lock/status');
  if (st.enabled) { if (await setAppLock(false)) toast('Lock off — JARVIS opens without Windows Hello'); }
  else if (!st.helloEnrolled) toast('Turn on “Require Windows Hello” first — the lock opens with it', true);
  else if (await setAppLock(true, Number($('#appLockIdle').value))) toast('Lock on — JARVIS will ask for Windows Hello each time it opens');
  renderAppLock();
});
$('#appLockIdle').addEventListener('change', async e => {
  const st = await getJSON('/lock/status');
  if (st.enabled && await setAppLock(true, Number(e.target.value))) toast('Auto-lock updated');
  renderAppLock();
});
$('#appLockNow').addEventListener('click', async () => { await callTool('/lock/lock'); location.reload(); });
renderAppLock();
$('#wipeBtn').addEventListener('click', () => {
  if (!confirm('Erase all JARVIS data (settings, chat, memory, tasks)? This is shared, so it clears it for every browser. Files in ~/jarvis are kept.')) return;
  withHello('wipe', async tok => {
    // Local copies go first, so the reload doesn't re-upload them as "first browser" data.
    Object.keys(localStorage).filter(k => k.startsWith('jarvis.')).forEach(k => localStorage.removeItem(k));
    try { await store.clear(tok); location.reload(); }
    catch (e) { toast('Nothing was erased — ' + (/403/.test(e.message) ? 'Windows Hello approval is required.' : e.message), true); Hello.refresh(); }
  });
});

/* ============ keep JARVIS running (keepalive.js: a scheduled task that restarts it) ============ */
(function KeepaliveUI() {
  const sw = $('#keepaliveToggle'), note = $('#keepaliveNote');
  const fmt = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const render = async () => {
    const st = await getJSON('/keepalive/status').catch(() => ({}));
    if (st.error) { note.textContent = st.error; return st; }
    if (!st.supported) { note.textContent = 'Available on Windows.'; sw.style.display = 'none'; return st; }
    sw.style.display = ''; sw.classList.toggle('on', !!st.on); sw.setAttribute('aria-checked', String(!!st.on));
    note.textContent = st.note || (st.on ? 'On: if JARVIS stops by itself, it is started again within 5 minutes (without opening a window).' : 'Off.');
    return st;
  };
  sw.addEventListener('click', async () => {
    sfx.key();
    const on = !sw.classList.contains('on');
    const r = await callTool('/keepalive/set', { on });
    if (r.error) return toast(r.error, true);
    toast(on ? 'JARVIS will be kept running' : 'JARVIS will no longer be restarted automatically');
    render();
  });
  $('#settingsBtn').addEventListener('click', render);
  // after an automatic restart: say so once
  setTimeout(async () => {
    const st = await render();
    if (st && st.restarted && st.restarted.at) {
      jarvisSay({ text: '🔁 **JARVIS was restarted automatically** at ' + fmt(st.restarted.at) + ' because it had stopped. Reminders and chats from the time it was down were not delivered; check ~/jarvis/.keepalive.log if it keeps happening.', noPersona: true, intent: 'KEEPALIVE', alert: true });
      callTool('/keepalive/ack', {}).catch(() => {});
    }
  }, 5000);
  window.__keepalive = { render };
})();

/* ============ start with Windows + stop JARVIS (no-terminal running) ============ */
(function AutostartUI() {
  const sw = $('#autostartToggle'), note = $('#autostartNote');
  const render = async () => {
    const st = await getJSON('/autostart').catch(() => ({}));
    if (st.error) { note.textContent = st.error; return; }
    if (!st.supported) { note.textContent = 'Available on Windows.'; sw.style.display = 'none'; return; }
    sw.style.display = ''; sw.classList.toggle('on', !!st.on); sw.setAttribute('aria-checked', String(!!st.on));
    note.textContent = st.foreign ? 'There is already a Startup entry pointing at ' + st.target + ' — JARVIS left it alone.'
      : st.note || (st.on ? 'JARVIS starts quietly in the background when you sign in.' : 'Off — start JARVIS from the desktop icon.');
  };
  sw.addEventListener('click', async () => {
    sfx.key();
    const on = !sw.classList.contains('on');
    const r = await callTool('/autostart', { on });
    if (r.error) return toast(r.error, true);
    toast(on ? 'JARVIS will start with Windows' : 'JARVIS will no longer start with Windows');
    log('info', 'start with windows ' + (on ? 'on' : 'off'));
    render();
  });
  $('#quitBtn').addEventListener('click', () => {
    if (!confirm('Stop the JARVIS server? Reminders will not fire until you start JARVIS again.')) return;
    fetch(API + '/quit', { method: 'POST' }).catch(() => {});
    setTimeout(() => {
      document.title = 'JARVIS — stopped';
      offlineUI();
      const st = $('#obStatus'); if (st) st.textContent = 'JARVIS was stopped on purpose. Press START (or the desktop icon) to bring me back.';
    }, 700);
  });
  $('#settingsBtn').addEventListener('click', render);
  render();
})();

/* ============ updates: Settings → CHECK asks GitHub once, only if Online tools is on ============ */
(function UpdateCheck() {
  const note = $('#updateNote'), btn = $('#updateCheckBtn');
  const render = () => {
    btn.hidden = !settings.online;
    if (!settings.online) note.textContent = 'Turn on Online tools to check for updates — JARVIS never phones home on its own.';
    else note.textContent = 'Asks GitHub for the latest release when you click. You update JARVIS by replacing the project folder (see the README).';
  };
  btn.addEventListener('click', async () => {
    if (!settings.online) return;
    btn.disabled = true; note.textContent = 'Checking GitHub…';
    const r = await getJSON('/update/check');
    btn.disabled = false;
    if (r.error) { note.textContent = '✗ ' + r.error; return; }
    if (r.update) {
      note.innerHTML = '✓ You are running <b>v' + escHtml(r.version) + '</b> — <b>v' + escHtml(r.latest) + '</b> is out. ';
      const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'See what changed →';
      note.appendChild(a);
      log('warn', 'update available: v' + r.latest);
    } else note.textContent = r.note ? '✓ ' + r.note : '✓ You are on the latest release (v' + escHtml(r.version) + ').';
  });
  $('#settingsBtn').addEventListener('click', render);
  render();
})();

/* ============ PWA: service worker + the header INSTALL pill (installable web app) ============ */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
(function Install() {
  const pill = $('#installPill');
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; pill.hidden = false; }); // standalone window = already an app
  pill.addEventListener('click', async () => {
    if (!deferred) return;
    pill.hidden = true;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome === 'accepted') { log('ok', 'JARVIS installed as an app'); toast('Installed — find JARVIS in your Start menu'); }
    deferred = null;
  });
  addEventListener('appinstalled', () => { pill.hidden = true; });
})();

/* ============ boot ============ */
let bootSkip = /[?&]skipboot\b/.test(location.search); // ?skipboot: straight to the app (screenshots, reloads)
$('#bootSkip').addEventListener('click', () => bootSkip = true);
$('#bootOverlay').addEventListener('click', () => bootSkip = true);
async function bootSequence() {
  const box = $('#bootLines'), barEl = $('#bootBarFill');
  if (/[?&]skipboot\b/.test(location.search)) { $('#bootOverlay').classList.add('done'); $('#bootOverlay').style.display = 'none'; } // checks still run behind it
  const TOTAL = 7; let n = 0;
  const line = async (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = '> ' + txt; box.appendChild(d); barEl.style.width = (++n / TOTAL * 100) + '%'; if (!bootSkip) await sleep(randi(90, 180)); };
  await line('hl', 'JARVIS v4 — local runtime · ' + NLU.TOOL_COUNT + ' tool families');
  const coreOk = await checkBackend();
  await line(coreOk ? 'ok' : 'err', coreOk ? '[ OK ] agent core online · sandbox ' + backend.sandbox : '[FAIL] backend offline — run "npm start" and open http://localhost:3000');
  const llmOk = coreOk && await checkLLM();
  if (!coreOk) updateLLMUI();
  await line(llmOk && llm.model ? 'ok' : 'warn', llmOk && llm.model ? '[ OK ] ai brain · ollama · ' + llm.model : '[ -- ] ai brain offline — rule engine only');
  await line(SR ? 'ok' : 'warn', SR ? '[ OK ] speech input · web speech api' : '[ -- ] speech input unavailable — use Chrome or Edge');
  setEngine('stt', SR ? 'on' : 'down', SR ? 'web speech · tap mic or Space' : 'not supported in this browser');
  await checkVoiceSupport();
  await line('ok', '[ OK ] memory · ' + plural(memory.length, 'fact') + ' · ' + plural(todos.filter(t => !t.done).length, 'to-do') + ' · ' + plural(deadlines.filter(d => !d.done).length, 'deadline'));
  await line(settings.online ? 'warn' : 'ok', settings.online ? '[ !! ] online tools enabled (weather, web answers)' : '[ OK ] fully offline — online tools disabled');
  await line('hl', '[ OK ] ready.');
  await sleep(bootSkip ? 100 : 450);
  $('#bootOverlay').classList.add('done');
  setTimeout(() => $('#bootOverlay').remove(), 800);
  updateNetUI(); loadVoices(); refreshSystem(); if (coreOk) loadConfig();
  $('#toolCount').textContent = NLU.TOOL_COUNT;
  log('ok', 'runtime online' + (llmOk ? ' — AI brain: ' + llm.model : ' — rules only'));
  setState('IDLE');
  if (llmOk) warmLLM();
  if (coreOk && typeof Wizard !== 'undefined') Wizard.maybeOpen(); // first run with no AI: offer the guided setup
  if (!coreOk) {
    jarvisSay({ text: '**Backend offline.** Press **START JARVIS** above (or double-click the desktop icon) — I will connect the moment the server answers. Until then I can only chat, calculate and manage your tasks.', intent: 'SYSTEM', noTTS: true, noLog: true });
    return;
  }
  const nm = memGet('name');
  const due = deadlines.filter(d => !d.done && d.due > Date.now() && d.due - Date.now() < 36 * 36e5);
  const next = classes.length ? upcomingClasses(new Date())[0] : null;
  let msg = Persona.greeting().replace(/[.?!]$/, '') + '. All systems are online.' + (llmOk ? '' : ' My AI core is offline, so I will stick to direct commands for now.');
  if (due.length) msg += ' ' + Persona.Sir() + ', **' + due[0].title + '** is due ' + dueLabel(due[0].due) + '.';
  else if (next && next.at - Date.now() < 3 * 36e5) msg += ' Your next class, **' + next.c.name + '**, is at ' + fmtTime(next.at) + '.';
  if (!nm && !chatLog.length) msg += ' Tell me your name, or ask what I can do.';
  else msg += ' How may I help?';
  jarvisSay({ text: msg, intent: 'SYSTEM', noTTS: true, noLog: true, suggestions: !chatLog.length ? ['What can you do?', 'Give me my briefing'] : null });
  // Browsers block audio until the first click/keypress, so the power-up + greeting waits for it if needed.
  const greet = () => { sfx.boot(); setTimeout(() => speak(msg), 700); };
  if (navigator.userActivation && navigator.userActivation.hasBeenActive) greet();
  else {
    stateMsg.textContent = 'Click anywhere to bring me online, ' + Persona.sir() + '.';
    const once = () => { window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); if (!busy) greet(); };
    window.addEventListener('pointerdown', once, true); window.addEventListener('keydown', once, true);
  }
}

/* ============ init ============ */
applyTheme(settings.theme); applyPersona(settings.persona); updateLangUI();
restoreChat(); renderMemory(); renderSnippets(); renderFlashDecks(); renderTasks(); renderTele();
bootSequence();
