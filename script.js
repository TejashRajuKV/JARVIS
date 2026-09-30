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
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
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
    clear() {},
  };
  if (!window.JARVIS_STATE) return local;
  const cache = {}, pending = {};
  for (const [k, v] of Object.entries(window.JARVIS_STATE)) cache[k] = JSON.stringify(v);
  let timer = null;
  const flush = beacon => {
    clearTimeout(timer); timer = null;
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const body = '{"src":' + JSON.stringify(TAB_ID) + ',"set":{' + keys.map(k => JSON.stringify(k) + ':' + (pending[k] === null ? 'null' : pending[k])).join(',') + '}}';
    keys.forEach(k => delete pending[k]);
    if (beacon && navigator.sendBeacon && body.length < 60000) navigator.sendBeacon('api/state', new Blob([body], { type: 'application/json' }));
    else fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(e => { console.warn('could not save to server:', e.message); keys.forEach(k => { if (!(k in pending)) pending[k] = cache[k] === undefined ? null : cache[k]; }); timer = setTimeout(flush, 3000); });
  };
  const queue = () => { clearTimeout(timer); timer = setTimeout(flush, 250); };
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  // First browser with real history opened after the switch to server storage: its data becomes the shared copy.
  // Settings/UI-state keys don't count as "real data", so a fresh browser can't claim the slot by merely opening.
  // Once claimed, jarvis.migrated stays set (even through "Erase all"), so old copies can't resurrect later.
  // Other browsers' old localStorage is left untouched, just no longer used.
  const TRIVIAL = /^jarvis\.(settings|chipTab|cmdHistory|focusToday|agentCounter|migrated|serverAlerted)$/;
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
    adopt(k, v) { if (k in pending) return false; cache[k] = JSON.stringify(v); return true; },
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
  { wakeWord: 'jarvis', tts: true, rate: 1, voice: '', sound: true, online: false, responseLen: 'balanced', llm: true, model: '', city: '', focusMin: 25, breakMin: 5, alerts: true, address: 'sir', neuralVoice: true, translateOnline: true, speechLang: 'en', replyLang: 'auto', persona: 'jarvis', theme: 'arc', phonePush: false, phoneTopic: '' },
  store.get('jarvis.settings', {})
);
Persona.setAddressSource(() => {
  const a = settings.address === 'name' ? (memGet('name') || 'sir') : settings.address;
  return settings.persona === 'friday' && a === 'sir' ? 'boss' : a;
});
const saveSettings = () => store.set('jarvis.settings', settings);
let memory = store.get('jarvis.memory', []);        // [{id,key,value,ts}]
let todos = store.get('jarvis.todos', []);          // [{id,text,done,ts}]
let reminders = store.get('jarvis.reminders', []);  // [{id,text,at,fired}]
let deadlines = store.get('jarvis.deadlines', []);  // [{id,title,due,done}]
let classes = store.get('jarvis.classes', []);      // [{id,name,day,h,m}]
let attendance = store.get('jarvis.attendance', {}); // { Subject: {held, attended, log:[{d,s}]} }
let marks = store.get('jarvis.marks', []);          // [{id,title,gpa,credits,ts}]
let chatLog = store.get('jarvis.chat', []);         // [{role,text,meta,t}]
const saveTasks = () => {
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

/* ============ dom refs ============ */
const stateChip = $('#stateChip'), stateMsg = $('#stateMsg'), liveTranscript = $('#liveTranscript');
const micBtn = $('#micBtn'), wakeBtn = $('#wakeBtn'), chatInput = $('#chatInput'), sendBtn = $('#sendBtn');
const messages = $('#messages'), logBox = $('#logStream'), memoryList = $('#memoryList'), timerChips = $('#timerChips');
const bgCanvas = $('#bgCanvas'), waveCanvas = $('#waveCanvas');
const API = location.protocol.startsWith('http') ? '/api' : 'http://localhost:3000/api';

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

async function checkBackend() {
  try {
    const r = await fetch(API + '/health', { signal: AbortSignal.timeout(2500) });
    const d = await r.json();
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
    if (await checkBackend()) { clearInterval(offlineTimer); offlineTimer = null; if (!offlineReloading) { offlineReloading = true; toast('JARVIS is back — reconnecting'); setTimeout(() => location.reload(), 600); } }
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
const APPROVAL_VERB = { create: 'create', 'create the folder': 'create the folder', overwrite: 'overwrite', 'add to': 'add to', delete: 'move to the trash', rename: 'rename', 'copy into': 'copy into', move: 'move', restore: 'restore', 'restore the earlier version of': 'restore the earlier version of', 'move back': 'move back', remove: 'remove' };
function askApproval(action, paths) {
  if (approvalsBlocked > 0) return Promise.resolve(false);
  const wasBusy = busy;
  return new Promise(resolve => {
    busy = false; idleState();
    const list = paths.map(p => '`' + p + '`').join(' and ');
    jarvisSay({ text: '⚠ JARVIS wants to **' + (APPROVAL_VERB[action] || action) + '** ' + list + '.\nThat is outside `~/jarvis`, so I need your permission.', intent: 'APPROVAL', noPersona: true, noTTS: true,
      confirm: { yes: 'ALLOW', no: 'CANCEL', onConfirm: () => resolve(true), onCancel: () => resolve(false) } });
  }).then(ok => { busy = wasBusy; return ok; });
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
    return callToolRaw(endpoint, Object.assign({}, data, { approved: true }), helloToken);
  }
  return j;
}
async function callToolRaw(endpoint, data, helloToken) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (helloToken) headers['X-Hello-Token'] = helloToken;
    const res = await fetch(API + endpoint, { method: 'POST', headers, body: JSON.stringify(data || {}) });
    const j = await res.json().catch(() => ({ error: 'Bad response (' + res.status + ')' }));
    if (!res.ok && !j.error) j.error = 'HTTP ' + res.status;
    if (j.needHello) { Hello.refresh(); j.error = 'Windows Hello approval is required for that — please try again'; }
    return j;
  } catch (e) {
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
  el.classList.toggle('hot', pct >= 75 && pct < 90); el.classList.toggle('crit', pct >= 90);
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
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
}
async function speakNeural(clean, l) {
  const r = await fetch(API + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean, lang: l, gender: settings.persona === 'friday' ? 'female' : 'male', rate: settings.rate }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'voice error');
  const url = URL.createObjectURL(await r.blob());
  return new Promise(res => {
    stopSpeaking();
    const a = new Audio(url); ttsAudio = a;
    const pulse = setInterval(() => { speechPulse = .6 + Math.random() * .4; }, 160);
    const done = () => { clearInterval(pulse); URL.revokeObjectURL(url); if (ttsAudio === a) ttsAudio = null; res(); };
    a.onended = done; a.onerror = done; a.onpause = done;
    a.play().catch(done);
  });
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
  const spoken = (!o.noTTS && settings.tts) ? speak(o.speak || text) : sleep(200);
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
  if (o.suggestions && o.suggestions.length) {
    const d = document.createElement('div'); d.className = 'suggestRow';
    o.suggestions.forEach(sg => { const b = document.createElement('button'); b.className = 'chip-cmd'; b.textContent = sg; b.addEventListener('click', () => handleUser(sg, 'text')); d.appendChild(b); });
    node.extraEl.appendChild(d);
  }
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
function addTimer(label, ms, onDone) {
  const el = document.createElement('span'); el.className = 'tchip'; timerChips.appendChild(el);
  const t = { id: rid(), label, end: Date.now() + ms, el, onDone };
  timers.push(t); return t;
}
function cancelTimer(t) { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.el.remove(); } }
let focus = null;
const fmtLeft = ms => { const s = Math.ceil(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) : Math.floor(s / 60)) + ':' + pad(s % 60); };
function startFocus(min) {
  stopFocus(true);
  min = clamp(Math.round(min || settings.focusMin || 25), 1, 180);
  const saved = store.get('jarvis.focusToday', { d: '', n: 0 });
  const count = saved.d === new Date().toDateString() ? saved.n : 0;
  focus = { phase: 'focus', end: Date.now() + min * 6e4, min, count };
  return min;
}
function stopFocus(silent) {
  if (!focus) return false;
  focus = null; $('#focusStat').hidden = true;
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
    focus.phase = 'break'; focus.end = now + b * 6e4;
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
      sfx.alarm(); toast('⏰ ' + r.text, true); notify('Reminder', r.text);
      log('ok', 'reminder fired: ' + r.text);
      jarvisSay({ text: '⏰ ' + Persona.Sir() + ', you asked me to remind you: **' + r.text + '**.', speak: Persona.Sir() + ', you asked me to remind you: ' + r.text.replace(/\s—\shttps?:\/\/\S+/, ''), intent: 'REMINDER', tool: 'remind' });
    }
  }
  for (const { c, at } of upcomingClasses(new Date(now))) {
    const mins = (at - now) / 6e4, key = c.id + at.toDateString();
    if (mins <= 10 && mins > 9 && !announced.has(key)) {
      announced.add(key);
      toast('📚 ' + c.name + ' starts in 10 minutes', true); notify('Class soon', c.name + ' at ' + fmtTime(at));
      jarvisSay({ text: Persona.Sir() + ', **' + c.name + '** begins in ten minutes, at ' + fmtTime(at) + '.', intent: 'TIMETABLE' });
    }
  }
  if (changed) saveTasks();
}
setInterval(() => {
  const now = Date.now();
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i], left = tm.end - now;
    if (left <= 0) {
      timers.splice(i, 1); tm.el.remove(); sfx.alarm(); log('ok', 'timer complete: ' + tm.label);
      notify('Timer', tm.label + ' timer finished');
      jarvisSay({ text: Persona.Sir() + ', your **' + tm.label + '** timer is up.', speak: Persona.Sir() + ', your ' + tm.label + ' timer is up.', intent: 'TIMER_DONE' });
    } else tm.el.textContent = '⏱ ' + tm.label + ' ' + fmtLeft(left);
  }
  focusTick(now);
  tasksTick(now);
}, 500);
if (serverScheduler && 'EventSource' in window) {
  const events = new EventSource('api/events');
  events.addEventListener('reminder', e => {
    const ev = JSON.parse(e.data);
    const r = reminders.find(x => x.id === ev.id);
    if (r) { r.at = ev.at; r.fired = ev.fired; saveTasks(); }
    if (!ev.lead) return; // only one open tab announces it
    if (ev.digest) { sfx.alarm(); jarvisSay({ text: ev.text, intent: 'WEEK_REPORT', noTTS: true }); return; } // the Sunday weekly summary
    sfx.alarm(); toast('⏰ ' + ev.text, true); notify('Reminder', ev.text);
    log('ok', 'reminder fired: ' + ev.text);
    jarvisSay({ text: '⏰ ' + Persona.Sir() + ', you asked me to remind you: **' + ev.text + '**.', speak: Persona.Sir() + ', you asked me to remind you: ' + ev.text.replace(/\s—\shttps?:\/\/\S+/, ''), intent: 'REMINDER', tool: 'remind' });
  });
  // The chat was changed in another tab of this same JARVIS: show it here too (never written back, so tabs can't ping-pong).
  // Waits for a reply in progress to finish, so a half-typed answer isn't wiped.
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
    hide(); busy = true;
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
    d.querySelector('.tx').textContent = dd.title;
    d.querySelector('.check').addEventListener('click', () => { dd.done = true; sfx.ok(); bumpStat('deadlinesDone'); toast('Nice — "' + dd.title + '" marked done'); saveTasks(); });
    d.querySelector('.x').addEventListener('click', () => { undoRemoved('deleted deadline', () => deadlines, v => { deadlines = v; }, saveTasks, removedFrom(deadlines, x => x !== dd)); deadlines = deadlines.filter(x => x !== dd); saveTasks(); });
    dl.appendChild(d);
  });
  const rl = $('#reminderList'); rl.innerHTML = '';
  const rs = reminders.filter(r => !r.fired && !r.routineId).sort((a, b) => a.at - b.at);
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
  $('#attMeta').textContent = attNames.length ? '75% required' : '';
  if (!attNames.length) al.innerHTML = '<div class="tempty">No attendance yet — try "mark DBMS present" after class.</div>';
  attNames.sort((a, b) => (Study.attendancePct(attendance[a].held, attendance[a].attended) || 0) - (Study.attendancePct(attendance[b].held, attendance[b].attended) || 0)).forEach(n => {
    const e = attendance[n], pct = Study.attendancePct(e.held, e.attended);
    const d = document.createElement('div'); d.className = 'titem';
    const w = Math.max(4, Math.min(100, Math.round(pct)));
    d.innerHTML = '<span class="tx"></span><span class="due ' + (pct < 75 ? 'soon' : '') + '">' + pct + '%</span><button class="x" title="Stop tracking">✕</button><div class="att-bar"><i style="width:' + w + '%" class="' + (pct < 75 ? 'low' : '') + '"></i></div>';
    d.querySelector('.tx').textContent = n + ' (' + e.attended + '/' + e.held + ')';
    d.title = Study.bunkable(e.held, e.attended, 75) + ' bunks still safe';
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
      return { text: Persona.greeting(h) + extra + (extra || Math.random() < .5 ? ' How may I help?' : '') };
    }
    case 'HOW_ARE_YOU': return { text: Persona.say('howareyou', { cpu: sys.cpu }), noLocalize: true };
    case 'IDENTITY': {
      const friday = settings.persona === 'friday';
      return { text: Persona.say('identity', { name: friday ? 'F.R.I.D.A.Y.' : 'J.A.R.V.I.S.', expansion: friday ? 'your personal AI, successor to JARVIS' : 'Just A Rather Very Intelligent System',
        model: llmReady() ? ', thinking with **' + llm.model + '**' : '' }), noLocalize: true };
    }
    case 'JOKE': return { text: pick(JOKES) + (Lang.replyLang() === 'en' && Math.random() < .5 ? ' I will be here all week, ' + Persona.sir() + '.' : '') };
    case 'THANKS': return { text: Persona.say('thanks') };
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
  if (m && !/^(e\.g|i\.e|etc)\.?$/i.test(m[1])) return m[1];
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
  toolStep('writeFile → ' + name);
  const r = await callTool('/tool/writeFile', { name, content, append: !!opts.append, overwrite: !!opts.overwrite });
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
  return { askLLM: 'Question: ' + q + '\nToday is ' + new Date().toDateString() + '.\n\nAnswer using ONLY these web sources I just fetched. Cite them inline like [1] or [2]. If they do not contain the answer, say so plainly and suggest what to search instead. Be concise; use bullets for lists.' + (Lang.aiInEnglish() ? '' : { te: ' Write the answer in Telugu (keep technical terms, names and numbers in English).', kn: ' Write the answer in Kannada (keep technical terms, names and numbers in English).' }[Lang.replyLang()] || '') + '\n\n' + pages,
    after: { sources, suggestions: extraSuggestions } };
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
  sfx.wake(); toast(msg.replace(/\*\*/g, ''), true); notify('Heads up', msg.replace(/\*\*/g, ''));
  log('warn', 'alert: ' + msg.replace(/\*\*/g, ''));
  const m = msg.match(/^(\p{Extended_Pictographic}\S*)\s+(.*)$/su);
  const body = m ? m[2] : msg;
  const text = (m ? m[1] + ' ' : '') + Persona.Sir() + ', ' + (/^[A-Z][a-z]/.test(body) ? body[0].toLowerCase() + body.slice(1) : body);
  jarvisSay({ text, intent: 'ALERT', suggestions, alert: true });
}
let lastBatteryCheck = 0;
async function smartAlerts() {
  if (!settings.alerts || state === 'BOOT') return;
  const now = Date.now();
  if (sys.ram >= 92) alertOnce('ram', 30 * 6e4, '⚠ Memory is at **' + sys.ram + '%** — things may slow down. Close something heavy?', ['What are the top processes?']);
  if (backend.online && now - lastBatteryCheck > 2 * 6e4) {
    lastBatteryCheck = now;
    const b = await callTool('/tool/batteryStatus');
    if (b.level !== null && b.level !== undefined && b.level <= 20 && b.status !== 'Charging') alertOnce('battery', 30 * 6e4, '🔋 Battery is at **' + b.level + '%** — plug in soon.');
  }
  if (!serverScheduler) for (const d of deadlines) if (!d.done && d.due > now && d.due - now <= 3 * 36e5) alertOnce('dl' + d.id, Infinity, '⏳ **' + d.title + '** is due at ' + fmtTime(d.due) + ' — about ' + Math.max(1, Math.round((d.due - now) / 36e5)) + 'h left.', ['Start a focus session', 'Block distractions']);
  const h = new Date().getHours(), pend = todos.filter(t => !t.done).length;
  if (h === 21 && pend) alertOnce('evening' + new Date().toDateString(), Infinity, '🌙 You have ' + plural(pend, 'to-do') + ' left today. One more focus session, or call it a day?', ['What is on my to-do list?', 'Start a focus session']);
}
setInterval(() => { smartAlerts().catch(() => {}); }, 60e3);

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
  if (bat && bat.level !== null && bat.level !== undefined) add(!(bat.level <= 20 && bat.status !== 'Charging'), 'Power', bat.level + '% · ' + String(bat.status).toLowerCase());
  else add(true, 'Power', 'mains (no battery reported)');
  if (sysOk) {
    add(sys.cpu < 90, 'Processor', sys.cpu + '% · ' + sys.cpus + ' threads');
    add(sys.ram < 90, 'Memory', sys.ram + '% (' + sys.ramUsed + ' / ' + sys.ramTotal + ' GB)');
    add(sys.diskFree === null || sys.diskFree >= 2, 'Storage', sys.diskFree + ' GB free on the system drive');
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
  switch (p.intent) {
    /* ---- apps ---- */
    case 'OPEN_APPLICATION': {
      const q = a.app || s;
      const app = NLU.findApp(q);
      if (app) {
        toolStep('openApplication → ' + app.k);
        const r = await callTool('/tool/openApplication', { app: app.k });
        if (r.error) return { text: 'I could not open ' + app.n + ' — ' + r.error + '.' };
        ctx.lastApp = app.k;
        { const at = Date.now(); Undo.push('opened ' + app.n, async () => { if (Date.now() - at > 5 * 6e4) throw new Error('it was opened more than 5 minutes ago, so I won’t close it (you may have work in it)'); const x = await callTool('/tool/closeApplication', { app: app.k }); if (!x.success) throw new Error(x.error || 'it isn’t running'); return 'Closed ' + app.n + ' again.'; }); }
        return { text: pick(['Opening ', 'Launching ', 'Starting ']) + '**' + app.n + '**.', speak: 'Opening ' + app.n, tool: 'openApplication' };
      }
      const site = NLU.findSite(q);
      if (site) return openSite(site);
      if (/\b(folder|directory)\b/.test(s)) return executeTool({ ...p, intent: 'OPEN_FOLDER' }, raw);
      const what = s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me)\s+(up\s+)?(the\s+|my\s+)?/, '');
      return { text: 'I couldn’t find an app called "' + what + '" on this laptop. I can open anything in your Start menu by its name — or any website.', suggestions: ['Open ' + what + '.com', 'Search Google for ' + what] };
    }
    case 'CONTEXT_REOPEN':
    case 'CONTEXT_CLOSE':
    case 'CLOSE_APPLICATION': {
      const app = (p.intent === 'CLOSE_APPLICATION' && NLU.findApp(a.app || s)) || NLU.appByKey(ctx.lastApp);
      if (!app) return { text: 'Which app should I ' + (p.intent === 'CONTEXT_REOPEN' ? 'open' : 'close') + '?' };
      if (p.intent === 'CONTEXT_REOPEN') return executeTool({ ...p, intent: 'OPEN_APPLICATION', args: { app: app.names[0] } }, raw);
      toolStep('closeApplication → ' + app.k);
      const r = await callTool('/tool/closeApplication', { app: app.k });
      if (!r.success) return { text: r.error ? cap(r.error) + '.' : app.n + ' does not seem to be running.' };
      Undo.push('closed ' + app.n, async () => { const x = await callTool('/tool/openApplication', { app: app.k }); if (x.error) throw new Error(x.error); return 'Opened ' + app.n + ' again (unsaved work in it can’t come back).'; });
      return { text: 'Closed **' + app.n + '**.', tool: 'closeApplication' };
    }
    case 'WORKFLOW': {
      toolStep('workflow → vscode + projects');
      await callTool('/tool/openApplication', { app: 'vscode' }); ctx.lastApp = 'vscode';
      await callTool('/tool/openFolder', { name: 'Projects' });
      const pend = todos.filter(t => !t.done);
      return { text: 'Coding environment ready: **VS Code** is launching and your **Projects** folder is open.' + (pend.length ? ' Top of your list: "' + pend[0].text + '".' : '') + ' Want a focus session too?', suggestions: ['Start a focus session', 'Git status'] };
    }

    /* ---- web ---- */
    case 'OPEN_URL': {
      const m = (a.url || s).match(/(https?:\/\/)?(([a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?/i);
      if (!m) return { text: 'Which website should I open?' };
      const url = (m[1] || 'https://') + m[2] + (m[4] || '');
      toolStep('openUrl → ' + url);
      const r = await callTool('/tool/openUrl', { url });
      return r.error ? { text: 'Could not open that: ' + r.error } : { text: 'Opening **' + m[2] + '**.', tool: 'openUrl' };
    }
    case 'YOUTUBE':
    case 'YOUTUBE_PLAY': {
      const YT = NLU.SITES[0];
      const searchOnly = !a.query && /^(search|find|look up|show me)\b/.test(s);
      let q = a.query || (s.match(/^(?:play|search|find|watch|put on|put|show me|look up|stream)\s+(.+?)\s+(?:on|in)\s+(?:youtube|yt)$/) || s.match(/^(?:on|in)\s+(?:youtube|yt),?\s+(?:play|put on|put|watch|stream)\s+(.+)$/) || s.match(/^(?:youtube|yt)\s+(.+)$/) || s.match(/^(?:play|put on|stream|watch)\s+(.+)$/) || [])[1] || '';
      q = cleanMediaQuery(String(q).toLowerCase());
      if (!q) return openSite(YT);
      if (searchOnly) return openSite(YT, q);
      toolStep('youtubeTop → ' + q);
      const top = await callTool('/tool/youtubeTop', { query: q });
      if (!top.success) { log('warn', 'youtube top result unavailable: ' + (top.error || '?')); return openSite(YT, q); }
      toolStep('openUrl → ' + top.url);
      const r = await callTool('/tool/openUrl', { url: top.url });
      if (r.error) return { text: 'I found **' + top.title + '** but could not open the browser: ' + r.error };
      return { text: '▶ Playing **' + top.title + '** on YouTube.', speak: 'Playing ' + top.title.split(/[|(\[]/)[0].trim(), tool: 'youtube', suggestions: ['Search YouTube for ' + q, 'Pause'] };
    }
    case 'SITE_SEARCH': {
      const site = NLU.findSite(s) || NLU.SITES[1];
      let m = s.match(/search (?:on |in )?.+? (?:for )(.+)$/) || s.match(/(?:search|look up|find) (?:for )?(.+) on .+$/) || s.match(/search (?:on |in )?\S+(?: \S+)? (.+)$/);
      const q = a.query || (m ? m[1] : '');
      if (!q) return { text: 'What should I search ' + site.n + ' for?' };
      return openSite(site, q.trim());
    }
    case 'WEB_SEARCH': {
      const q = a.query || s.replace(/^(google|search( the web| online| google| the internet)?( for)?|look up|search up|browse for)\s+/, '');
      return openSite(NLU.SITES[1], q);
    }
    case 'WEATHER': {
      if (!settings.online) return { text: 'Weather needs the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let city = a.city || ((s.match(/\b(?:in|at|for|of)\s+([a-z][a-z .'-]+?)(?:\s+(?:today|tomorrow|now|right now|this week|tonight))?$/) || [])[1] || '').trim();
      // "the weather in this/that place" names no city — use the home city, or ask which place.
      if (/^(the|my|here|outside|this place|that place|there)$/.test(city)) city = '';
      if (!city && /\b(this|that) (place|location|area|city)\b/.test(s)) {
        if (settings.city) return executeTool({ ...p, text: p.text.replace(/\b(this|that) (place|location|area|city)\b/g, ' ').replace(/\s+/g, ' ').trim(), args: {} }, raw);
        return { text: 'Which place? Name it — "weather in **Manali**" — or set a home city ("my city is Bengaluru") and "this place" will mean it.', speak: 'Which place should I check the weather for?' };
      }
      toolStep('weather → ' + (city || settings.city || 'auto'));
      const w = await fetchWeather(city);
      if (w.error) {
        // Service down or place unknown: fall back to a web search, never guess.
        const placeName = city || settings.city || '';
        if (placeName && settings.online && backend.online) {
          toolStep('research → weather in ' + placeName);
          const res = await doResearch('current weather in ' + placeName);
          if (!res.askLLM || llmReady()) return { ...res, speak: 'I could not reach the weather service, so I searched the web for the weather in ' + placeName + '.' };
        }
        return { text: 'I could not reach the weather service — ' + w.error };
      }
      if (w.approximate) return { text: 'Your internet connection only tells me the country, not the city, so I would be guessing. Tell me your city — say "my city is Bengaluru" — and I will remember it.', suggestions: ['My city is Bengaluru', 'Weather in Bengaluru'] };
      ctx.lastIntent = 'WEATHER';
      if (/tomorrow/.test(s) && w.tomorrow) return { text: 'Tomorrow in **' + w.place + '**: ' + w.tomorrow.desc.toLowerCase() + ', ' + w.tomorrow.minC + '–' + w.tomorrow.maxC + '°C.', tool: 'weather' };
      const umbrella = w.rainChance >= 50 ? ' Chance of rain is ' + w.rainChance + '% — take an umbrella.' : '';
      return { text: '**' + w.place + '**: ' + w.tempC + '°C and ' + w.desc.toLowerCase() + ' (feels like ' + w.feelsC + '°C). Today ' + w.minC + '–' + w.maxC + '°C.' + umbrella, card: [['HUMIDITY', w.humidity + '%'], ['WIND', w.windKmph + ' km/h'], ['RAIN CHANCE', w.rainChance + '%']], tool: 'weather' };
    }

    case 'DISTANCE': {
      if (!settings.online) return { text: 'Distance needs the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let from = a.from, to = a.to;
      if (!from || !to) {
        let m = p.original.match(/\bdistance\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bhow (?:many|much) (?:kms?|kilometers?|kilometres?)\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)[.?!]*$/i)
          || p.original.match(/^km\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bhow long\s+(?:to|does it take to)\s+drive\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\btravel time\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        if (!from) { m = p.original.match(/\bhow far\s+(?:is|are)\s+(?:it\s+)?from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i); if (m) { from = m[1].trim(); to = m[2].trim(); } }
        if (!from) {
          m = p.original.match(/\bhow far\s+(?:is|are)\s+(?:it\s+)?(.+?)\s+from\s+(.+?)[.?!]*$/i) || p.original.match(/\bis\s+(.+?)\s+far from\s+(.+?)[.?!]*$/i);
          if (m) { to = m[1].trim(); from = m[2].trim(); }
        }
      }
      if (!from || !to) return { text: 'Distance between which two places?' };
      toolStep('distance → ' + from + ' to ' + to);
      const r = await callTool('/tool/distance', { from, to, online: true });
      if (r.error) return { text: cap(r.error) + '.' };
      const dur = r.durationMin >= 60 ? Math.floor(r.durationMin / 60) + 'h ' + (r.durationMin % 60) + 'm' : r.durationMin + ' min';
      return { text: 'It’s **' + r.distanceKm + ' km** from **' + r.from.name + '** to **' + r.to.name + '** — about ' + dur + ' by road.', tool: 'distance',
        actions: [{ label: 'OPEN IN GOOGLE MAPS', fn: () => Agent.chatTool('open_directions', { from, to }, 0).then(res => deliver(res, { intent: 'AGENT_RUN', confidence: 1 })) }] };
    }
    case 'DIRECTIONS': {
      if (!settings.online) return { text: 'Directions need the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let from = a.from, to = a.to;
      if (!from && !to) {
        // "X ... from A to B" (origin mentioned before destination)
        let m = p.original.match(/\b(?:directions?|route)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\b(?:go|travel|drive)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\btake me\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bplan(?:ning)? a (?:road trip|trip)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        // "reach/travel to B from A" (destination mentioned before origin)
        if (!to) {
          m = p.original.match(/\b(?:how (?:can|do) i reach|(?:need|want|have) to reach)\s+(.+?)\s+from\s+(.+?)[.?!]*$/i) || p.original.match(/\btravel(?:l)?ing to\s+(.+?)\s+from\s+(.+?)[.?!]*$/i);
          if (m) { to = m[1].trim(); from = m[2].trim(); }
        }
        // destination only
        if (!to) {
          m = p.original.match(/\b(?:directions?|route)\s+to\s+(.+?)[.?!]*$/i) || p.original.match(/\bhow do i get to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bhow do i go to\s+(.+?)[.?!]*$/i) || p.original.match(/\bnavigate to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bgo to\s+(.+?)[.?!]*$/i) || p.original.match(/\btake me to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\b(?:how (?:to|do i) reach|(?:need|want|have) to reach)\s+(.+?)[.?!]*$/i) || p.original.match(/\bhow to get to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bguide me to\s+(.+?)[.?!]*$/i) || p.original.match(/\bwhich way to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\b(?:get|drive) me to\s+(.+?)[.?!]*$/i) || p.original.match(/\bfastest way to (?:reach|get to)\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bplan(?:ning)? a (?:road trip|trip) to\s+(.+?)[.?!]*$/i);
          if (m) to = m[1].trim();
        }
        // A "destination-only" pattern above is greedy to end-of-string, so "guide me to Mysore from Bangalore"
        // captures "Mysore from Bangalore" as one blob — split the origin back out if it's in there.
        if (to && !from) {
          const fm = to.match(/^(.+?)\s+from\s+(.+)$/i);
          if (fm) { to = fm[1].trim(); from = fm[2].trim(); }
        }
      }
      if (!to) return { text: 'Directions to where?' };
      if (!from) { ctx.pending = { intent: 'DIRECTIONS', to }; return { text: 'Where are you starting from?' }; }
      toolStep('directions → ' + from + ' to ' + to);
      const r = await callTool('/tool/directions', { from, to, online: true });
      if (r.error) return { text: cap(r.error) + '.' };
      const dur = r.durationMin >= 60 ? Math.floor(r.durationMin / 60) + 'h ' + (r.durationMin % 60) + 'm' : r.durationMin + ' min';
      const list = r.steps.map((st, i) => (i + 1) + '. ' + st.instruction).join('\n');
      return { text: '**' + r.distanceKm + ' km · about ' + dur + '** — **' + r.from.name + '** to **' + r.to.name + '**:\n' + list, tool: 'directions',
        actions: [{ label: 'OPEN IN GOOGLE MAPS', fn: () => Agent.chatTool('open_directions', { from, to }, 0).then(res => deliver(res, { intent: 'AGENT_RUN', confidence: 1 })) }] };
    }
    case 'DIRECTIONS_OPEN': {
      let from = a.from, to = a.to;
      if (!from && !to) {
        let m = p.original.match(/\bdirections?\s+from\s+(.+?)\s+to\s+(.+?)\s*(?:in|on)\s+maps?\b/i) || p.original.match(/\bdirections?\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        if (!to) { m = p.original.match(/\bdirections?\s+(?:to|for)\s+(.+?)\s*(?:in|on)\s+maps?\b/i) || p.original.match(/\bdirections?\s+(?:to|for)\s+(.+?)[.?!]*$/i); if (m) to = m[1].trim(); }
      }
      if (!to) return { text: 'Directions to where?' };
      if (!from) { ctx.pending = { intent: 'DIRECTIONS_OPEN', to }; return { text: 'Where are you starting from?' }; }
      const url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(from) + '&destination=' + encodeURIComponent(to);
      toolStep('openUrl → maps directions ' + from + ' → ' + to);
      const r = await callTool('/tool/openUrl', { url });
      if (r.error) return { text: 'Could not open the browser: ' + r.error };
      return { text: 'Opening directions from **' + from + '** to **' + to + '** in Google Maps.', tool: 'openUrl' };
    }

    case 'SET_CITY': {
      const m = (p.original || s).replace(/[.!]+$/, '').match(/(?:city is|live in|stay in|in|to|as)\s+([a-z][a-z .'-]{1,38})$/i);
      const city = m ? m[1].trim().replace(/\b[a-z]/g, x => x.toUpperCase()) : '';
      if (!city) return { text: 'Which city should I use for the weather?' };
      settings.city = city; saveSettings();
      const inp = $('#cityInput'); if (inp) inp.value = city;
      return { text: '✓ Home city set to **' + city + '**. Weather will be for ' + city + ' from now on (change it in Settings → Home city).', suggestions: ["What's the weather?"], tool: 'weather' };
    }

    /* ---- math & CS ---- */
    case 'CALCULATE': {
      const c = tryCalc(a.expression || s);
      if (!c) return { askLLM: true };
      toolStep('calculate → ' + c.expr);
      return { text: '`' + c.expr.replace(/\*\*/g, '^').replace(/\*/g, '×').replace(/\//g, '÷') + '` = **' + c.val.toLocaleString() + '**', speak: 'That is ' + c.val, tool: 'calculate' };
    }
    case 'BASE_CONVERT': { toolStep('baseConvert'); return baseConvert(s) || { askLLM: true }; }
    case 'DATA_SIZE': { toolStep('dataSize'); return dataSize(s) || { askLLM: true }; }
    case 'ASCII': { toolStep('ascii'); return asciiTool(p.original) || { askLLM: true }; }
    case 'BITWISE': { toolStep('bitwise'); return bitwise(s) || { askLLM: true }; }

    /* ---- timers & focus ---- */
    case 'SET_TIMER': {
      let sec = +a.seconds;
      if (!sec) {
        const m = s.match(/(\d+(?:\.\d+)?)\s*(seconds?|s|minutes?|m|hours?|h)\b/g);
        if (m) sec = m.reduce((acc, part) => { const [, n, u] = part.match(/(\d+(?:\.\d+)?)\s*(\w)/); return acc + +n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1); }, 0);
      }
      if (!sec) { ctx.pending = { intent: 'SET_TIMER' }; return { text: 'For how long?', suggestions: ['5 minutes', '10 minutes', '25 minutes'] }; }
      const label = a.label || (sec >= 3600 ? +(sec / 3600).toFixed(2) + ' h' : sec >= 60 ? +(sec / 60).toFixed(1) + ' min' : sec + ' s');
      const tmr = addTimer(label, sec * 1000); toolStep('setTimer → ' + label);
      return { text: 'Timer set for **' + label + '**.', tool: 'setTimer', op: { kind: 'timer', id: tmr.id } };
    }
    case 'CANCEL_TIMERS': {
      const n = timers.length; [...timers].forEach(cancelTimer);
      return { text: n ? 'Cancelled ' + plural(n, 'timer') + '.' : 'No timers are running.' };
    }
    case 'FOCUS_START': {
      const m = s.match(/(\d+)[\s-]*(minute|min|m)\b/);
      const want = +a.minutes || (m ? +m[1] : 0);
      // A session is already running: never restart it silently. Inside a plan/routine, keep it when the length
      // matches (or none was asked for) and replace it only for a different requested length; typed directly, ask.
      if (focus && focus.phase === 'focus' && !a.restart) {
        const left = Math.max(1, Math.round((focus.end - Date.now()) / 6e4)), running = focus.min;
        if (p.viaAgent && (!want || want === running)) return { text: 'A ' + running + '-minute session is already running — kept it.', op: { kind: 'focus_kept', min: running, left }, tool: 'focus' };
        if (!p.viaAgent) return { text: 'A **' + running + '-minute** focus session is already running (' + left + ' min left). Start a new ' + (want || settings.focusMin || 25) + '-minute one instead?',
          confirm: { yes: 'RESTART', no: 'KEEP IT', onConfirm: async () => deliver(await executeTool(Object.assign({}, p, { args: Object.assign({}, a, { restart: true }) }), raw), { intent: 'FOCUS_START', confidence: 1 }) } };
      }
      const min = startFocus(want);
      Undo.push('started a ' + min + '-minute focus session', () => stopFocus(true) ? 'Focus session stopped.' : 'That focus session had already ended.');
      // "focus on DBMS for 25 minutes" → the session is logged under DBMS (shown per subject in Progress)
      const sm = p.original.match(/\b(?:on|for)\s+(?!\d|a\b|an\b|the\b|my\b|me\b)([A-Za-z][\w+#. -]{1,28}?)(?=\s+(?:for|session|timer|mode|\d)|[.,!?]?$)/i);
      const subject = sm ? sm[1].trim().replace(/\s+/g, ' ') : '';
      if (subject && focus) focus.subject = subject;
      toolStep('focus → ' + min + 'm' + (subject ? ' · ' + subject : ''));
      const top = todos.find(t => !t.done);
      return { text: 'Focus session started: **' + min + ' minutes**' + (subject ? ' on **' + subject + '**' : '') + '. I will call a break after that. Phone away, notifications off.' + (top ? ' Suggested task: "' + top.text + '".' : ''), speak: 'Focus session started for ' + min + ' minutes. Good luck.', tool: 'focus' };
    }
    case 'FOCUS_STOP': return stopFocus() ? { text: 'Focus session stopped.' } : { text: 'No focus session is running.' };

    /* ---- to-dos ---- */
    case 'ADD_TODO': {
      let text = a.text;
      for (const src of [p.original, p.text]) {
        if (text || !src) break;
        const m = src.match(/^(.+?)\s+and\s+add\s+(?:it|that|this)\s+(?:to|on|in|into)\b/i)
          || src.match(/^(?:.*?\b)?(?:add|put|note down|jot down|write down|include)\s+(.+?)\s+(?:to|on|in|into)\s+(?:my\s+|the\s+)?(?:(?:to-?do|todo|task|shopping)\s*(?:list\b)?|list\b)/i)
          || src.match(/(?:add|new|create)(?: a)? (?:task|to-?do|todo|item):?\s+(.+)$/i) || src.match(/^(?:to-?do|todo|task):?\s+(.+)$/i);
        text = m ? m[1] : '';
        // Translations sometimes scramble the order: "Add completing my to-do list assignment".
        if (!text && /^(?:add|include)\b.*\bto-?do list\b/i.test(src)) text = src.replace(/^(?:add|include)\s+/i, '').replace(/\b(?:to |in |into |on )?(?:my |the )?to-?do list\b/i, '').replace(/\s+/g, ' ').trim();
      }
      text = addTodoText(text);
      if (!text) return { text: 'What should I add to your list?' };
      toolStep('addTodo');
      // op: the exact item created, so the agent can verify this operation (not just a count).
      return { text: 'Added "**' + text + '**" to your to-do list. You have ' + plural(todos.filter(t => !t.done).length, 'item') + ' pending.', tool: 'todo', op: { kind: 'todo', id: todos[todos.length - 1].id } };
    }
    case 'LIST_TODOS': {
      const pend = todos.filter(t => !t.done);
      switchTab('tasks');
      if (!pend.length) return { text: todos.length ? 'Everything on your list is done. 🎉' : 'Your to-do list is empty.' };
      return { text: 'You have ' + plural(pend.length, 'thing') + ' to do:\n' + todos.map((t, i) => t.done ? null : (i + 1) + '. ' + t.text).filter(Boolean).join('\n'), speak: 'You have ' + plural(pend.length, 'thing') + ' to do. ' + pend.slice(0, 3).map(t => t.text).join('. ') + '.', tool: 'todo' };
    }
    case 'DONE_TODO': {
      const m = s.match(/(\d+)/);
      let t = m ? todos[+m[1] - 1] : null;
      if (!t) {
        const q = s.replace(/^(mark|tick|check( off)?|complete|finish|finished|done with|cross off|strike)\s+(task |to-?do |item )?/, '').replace(/\s*(as )?(done|complete|completed|off)$/, '');
        t = todos.find(x => !x.done && x.text.toLowerCase().includes(q)) || todos.find(x => !x.done && NLU.lev(x.text.toLowerCase(), q) <= 3);
      }
      if (!t) return todos.length && m ? { text: 'There is no item ' + m[1] + ' on your list.' } : { askLLM: true };
      t.done = true; saveTasks(); sfx.ok(); bumpStat('todosDone');
      const left = todos.filter(x => !x.done).length;
      return { text: 'Marked "**' + t.text + '**" as done. ' + (left ? left + ' to go.' : 'List cleared — nice work!'), tool: 'todo' };
    }
    case 'CLEAR_TODOS': {
      const all = /\ball\b/.test(s) && !/\b(completed|done|finished)\b/.test(s);
      const n = all ? todos.length : todos.filter(t => t.done).length;
      if (!n) return { text: all ? 'Your to-do list is already empty.' : 'There are no completed items to clear.' };
      // Explicit tier: its own card every time (and Windows Hello when required — enforced in the page, since
      // to-dos are ordinary shared-state writes the server can't tell apart from a normal save).
      return { text: 'Remove ' + plural(n, all ? 'item' : 'completed item') + ' from your to-do list?', confirm: { yes: 'YES — CLEAR', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('cleared to-dos', () => todos, v => { todos = v; }, saveTasks, removedFrom(todos, t => !all && !t.done));
        todos = all ? [] : todos.filter(t => !t.done); saveTasks();
        jarvisSay({ text: 'Cleared ' + plural(n, all ? 'item' : 'completed item') + '.', intent: 'CLEAR_TODOS' });
      }) } };
    }

    /* ---- reminders ---- */
    case 'REMIND': {
      const whenText = a.when || s;
      const repeat = NLU.parseRepeat(whenText);
      let at = NLU.parseWhen(whenText);
      if (repeat) {
        if (repeat.type === 'interval') at = Date.now() + repeat.ms;
        else {
          if (!at) { const d = new Date(); d.setHours(9, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); at = d.getTime(); }
          if (repeat.type === 'weekdays') { const d = new Date(at); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); at = d.getTime(); }
          // "every month on the 5th": the first occurrence is the next such day (this month if still ahead).
          if (repeat.type === 'monthly' && repeat.day) {
            const d = new Date(at); d.setDate(1);
            d.setDate(Math.min(repeat.day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
            if (d <= new Date()) { d.setMonth(d.getMonth() + 1, 1); d.setDate(Math.min(repeat.day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
            at = d.getTime();
          }
          if (repeat.type === 'yearly') {
            const d = new Date(at);
            if (repeat.month !== undefined) d.setMonth(repeat.month, 1);
            d.setDate(Math.min(repeat.day || d.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
            if (d <= new Date()) d.setFullYear(d.getFullYear() + 1);
            at = d.getTime();
          }
        }
      }
      let text = a.text || cap(keepCase(p, NLU.stripWhen(s.replace(/^.*?\b(remind me|set (a |an )?reminder|don'?t let me forget|remember)\b\s*/, '')).replace(/^(to|about|that|for)\s+/, '').replace(/\s+(to|about)$/, '').trim()));
      if (!text) text = 'Reminder';
      if (!at) { ctx.pending = { intent: 'REMIND', text }; return { text: 'When should I remind you to ' + text.toLowerCase() + '?', suggestions: ['in 10 minutes', 'in 1 hour', 'tomorrow at 9am'] }; }
      if (at <= Date.now()) return { text: 'That time has already passed. When should I remind you?' };
      const remId = rid();
      reminders.push({ id: remId, text: cap(text), at, fired: false, repeat: repeat || undefined }); saveTasks(); askNotify();
      toolStep('remind → ' + new Date(at).toLocaleString() + (repeat ? ' ↻ ' + repeat.type : ''));
      const op = { kind: 'reminder', id: remId };
      if (repeat) return { text: 'Done — I will remind you to **' + text.toLowerCase() + '** ' + describeRepeat(repeat, at) + '. First one: ' + fmtDay(at) + ' at ' + fmtTime(at) + '.', tool: 'remind', op };
      return { text: 'Okay — I will remind you to **' + text.toLowerCase() + '** ' + fmtDay(at) + ' at **' + fmtTime(at) + '**.', tool: 'remind', op };
    }
    case 'LIST_REMINDERS': {
      const rs = reminders.filter(r => !r.fired && !r.routineId).sort((x, y) => x.at - y.at);
      switchTab('tasks');
      if (!rs.length) return { text: 'You have no pending reminders.' };
      return { text: 'Upcoming reminders:\n' + rs.map(r => '- ' + r.text + ' — ' + fmtDay(r.at) + ' ' + fmtTime(r.at)).join('\n') };
    }

    /* ---- rolling conversation memory ---- */
    case 'CHAT_MEMORY': return chatMemoryReply();

    /* ---- panic mode ---- */
    case 'PANIC_ON': {
      if (store.get('jarvis.panic', false)) return { text: 'Panic mode is already on, ' + Persona.sir() + '. Nothing is running.' };
      store.set('jarvis.panic', true); renderPanic();
      return { text: '⚠️ **Panic mode on.** All automation is paused — triggers, scheduled routines, deadline and smart alerts. Your reminders still fire, silently. Say "resume" (or click the ⚠ PANIC pill) when it is over.', tool: 'panic' };
    }
    case 'PANIC_OFF': {
      if (!store.get('jarvis.panic', false)) return { text: 'Nothing is paused, ' + Persona.sir() + ' — automation is already running normally.' };
      store.set('jarvis.panic', false); renderPanic();
      return { text: 'Resumed. Triggers, alerts and scheduled routines are live again, ' + Persona.sir() + '.', tool: 'panic' };
    }

    /* ---- attendance & marks ---- */
    case 'ATTENDANCE_MARK': {
      const subject = cap(String(a.subject || s.replace(/^.*?(mark|record|log)\s+(me\s+)?(as\s+)?(present|absent)\s*(for|in)?\s*/i, '').replace(/\s+(present|absent)\b.*$/i, '').trim())) || 'Class';
      const present = a.status ? a.status === 'present' : !/\babsent|missed|skipped|bunk(ed)?\b/i.test(s);
      const e = attendance[subject] || (attendance[subject] = { held: 0, attended: 0, log: [] });
      const ymd = Study.ymd(new Date());
      e.log.push({ d: ymd, s: present ? 'p' : 'a' }); if (e.log.length > 400) e.log.shift();
      e.held++; if (present) e.attended++;
      saveTasks(); sfx.ok();
      const pct = Study.attendancePct(e.held, e.attended);
      toolStep('attendance → ' + subject + ' ' + pct + '%');
      return { text: 'Marked **' + subject + '** ' + (present ? 'present' : 'absent') + ' — now at **' + pct + '%** (' + e.attended + '/' + e.held + ')' + (pct < 75 ? ', ⚠️ below the 75% line. Attend ' + plural(Study.neededToReach(e.held, e.attended, 75), 'class') + ' in a row to get back.' : ', ' + plural(Study.bunkable(e.held, e.attended, 75), 'bunk') + ' still safe.'), tool: 'attendance', op: { kind: 'attendance', subject } };
    }
    case 'ATTENDANCE_REPORT': {
      switchTab('tasks');
      const names = Object.keys(attendance);
      if (!names.length) return { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const rows = names.map(n => {
        const e = attendance[n], pct = Study.attendancePct(e.held, e.attended);
        return { n, pct, bunk: Study.bunkable(e.held, e.attended, 75), need: Study.neededToReach(e.held, e.attended, 75), e };
      }).sort((x, y) => x.pct - y.pct);
      const line = r => '- **' + r.n + '**: ' + r.pct + '% (' + r.e.attended + '/' + r.e.held + ')' + (r.pct < 75 ? ' ⚠️ attend ' + plural(r.need, 'class') + ' in a row to recover' : ' · ' + plural(r.bunk, 'bunk') + ' safe');
      const danger = rows.filter(r => r.pct < 75);
      return { text: (danger.length ? '⚠️ **' + danger[0].n + '** is below 75% (' + danger[0].pct + '%).\n\n' : '') + 'Attendance:\n' + rows.map(line).join('\n'), tool: 'attendance' };
    }
    case 'BUNK_CHECK': {
      const name = String(a.subject || s.replace(/^.*?\b(can i (miss|skip|bunk)|should i (go to|attend))\b\s*(the\s+|my\s+|tomorrow'?s?\s+|next\s+)?/i, '').replace(/\s+\b(class|classes|tomorrow|today|lecture)\b.*$/i, '').trim());
      const key = Object.keys(attendance).find(k => k.toLowerCase() === name.toLowerCase()) || (!name || name.length < 2 ? null : Object.keys(attendance).find(k => NLU.lev(k.toLowerCase(), name.toLowerCase()) <= 2));
      if (!key) return attendance && Object.keys(attendance).length ? { text: 'Which subject? You track: ' + Object.keys(attendance).join(', ') + '.' } : { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const e = attendance[key];
      if (Study.attendancePct(e.held, e.attended) >= 75) return { text: '**' + key + '** is at ' + Study.attendancePct(e.held, e.attended) + '% (' + e.attended + '/' + e.held + ') — you can still miss ' + plural(Study.bunkable(e.held, e.attended, 75), 'class') + ' and stay above 75%.', tool: 'attendance' };
      const need = Study.neededToReach(e.held, e.attended, 75);
      return { text: '**' + key + '** is at **' + Study.attendancePct(e.held, e.attended) + '%** (' + e.attended + '/' + e.held + ') — below 75%. No bunks: attend ' + plural(need, 'class') + ' in a row to get back.', tool: 'attendance' }; }    case 'ADD_MARKS': {
      // "add my S3 marks, 8.6 gpa, 24 credits" · "add S3: 430/500" · title can also come from the AI as a.title.
      let title = String(a.title || '').trim();
      if (!title) {
        const t = s.replace(/\b(add|save|log|record|i got|i scored)\b/g, ' ').replace(/\b(my |semester |sem |result|marks?|gpa|sgpa|cgpa|with|scored?|got)\b/g, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:\/|out of)\s*\d+(?:\.\d+)?\b/g, ' ').replace(/[\d.:]+\s*(?:gpa|sgpa|cgpa|credits?)\b/gi, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
        title = cap(t.split(' ').filter(Boolean).slice(0, 4).join(' '));
      }
      if (!title) return { text: 'What is the semester called — S3, 5th sem?' };
      const score = s.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/);
      const gpaWord = s.match(/(\d+(?:\.\d+)?)\s*(?:gpa|sgpa|cgpa|pointer|point|cg)\b/i);
      const gpa = a.gpa !== undefined ? +a.gpa : score ? Math.round(1000 * (+score[1] / +score[2]) * 10) / 100 : gpaWord ? +gpaWord[1] : NaN;
      if (!(gpa >= 0 && gpa <= 10)) return { text: 'What did you score in **' + title + '**? Say it like "8.6 gpa" or "430 out of 500".' };
      const crWord = s.match(/(\d{1,2})\s*(?:credits?|crd|cr)\b/i);
      const credits = a.credits !== undefined ? +a.credits : crWord ? +crWord[1] : 0;
      if (!(credits >= 1 && credits <= 60)) return { text: 'How many credits was **' + title + '**? Add it like "24 credits" so I can weight your CGPA correctly.' };
      const snapshot = marks.slice();
      marks.push({ id: rid(), title, gpa: Math.round(100 * gpa) / 100, credits, ts: Date.now() });
      saveTasks(); sfx.ok();
      if (typeof Undo !== 'undefined') Undo.push('added ' + title + ' marks', () => { marks = snapshot; saveTasks(); return 'Removed the ' + title + ' result.'; });
      const g = Study.cgpa(marks);
      toolStep('marks → ' + title + ' ' + gpa);
      return { text: 'Saved **' + title + '**: ' + gpa + ' GPA · ' + credits + ' credits.' + (marks.length > 1 ? ' Your CGPA is now **' + g + '** across ' + plural(marks.length, 'semester') + '.' : ' Your SGPA is **' + g + '**.'), tool: 'marks', op: { kind: 'marks', title } };
    }
    case 'ATTENDANCE_TARGET': {
      const target = Math.min(99, +((/(\d{2,3})\s*(?:%|percent)/.exec(s) || [])[1]) || 75);
      const names = Object.keys(attendance).filter(k => attendance[k].held);
      if (!names.length) return { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const one = names.find(k => s.includes(k.toLowerCase()));
      const rows = (one ? [one] : names).map(k => { const e = attendance[k], pct = Study.attendancePct(e.held, e.attended), need = Study.neededToReach(e.held, e.attended, target);
        return '- **' + k + '** ' + pct + '% (' + e.attended + '/' + e.held + ') — ' + (need ? 'attend ' + plural(need, 'class') + ' in a row to reach ' + target + '%' : 'already above ' + target + '%'); });
      switchTab('tasks');
      return { text: 'To reach **' + target + '%**:\n' + rows.join('\n'), tool: 'attendance' };
    }
    case 'GPA_TARGET': {
      const target = +((/(\d+(?:\.\d+)?)\s*(?:cgpa|pointer)/.exec(s) || /\bneed\b.*?(\d+(?:\.\d+)?)/.exec(s) || [])[1]);
      if (!(target > 0 && target <= 10)) return { text: 'Which CGPA are you aiming for — say it like "an 8.5 cgpa".' };
      if (!marks.length) return { text: 'No results saved yet — add a semester first, e.g. "add S1: 8.2 gpa, 24 credits".' };
      const done = marks.reduce((x, m) => x + m.credits, 0), pts = marks.reduce((x, m) => x + m.gpa * m.credits, 0);
      const cr = +((/(\d{1,2})\s*credits?/.exec(s) || [])[1]) || Math.round(done / marks.length);
      const now = Study.cgpa(marks), need = Study.gradeNeeded(done, pts, target, cr);
      const base = 'Your CGPA is **' + now + '** over ' + plural(done, 'credit') + '. ';
      if (now >= target && need !== null && need <= 0) return { text: base + 'You are already above ' + target + '.', tool: 'marks' };
      return { text: base + (need === null ? 'Reaching **' + target + '** in the next ' + cr + ' credits would need more than a 10 SGPA — it takes more than one semester.' : 'For **' + target + '**, score about **' + need + ' SGPA** in your next ' + cr + ' credits' + (/credits?/.test(s) ? '.' : ' (assuming a semester like your average — say "in 22 credits" to change that).')), tool: 'marks' };
    }
    case 'CGPA_REPORT': {
      switchTab('tasks');
      if (!marks.length) return { text: 'No results saved yet — try "add S3: 8.6 gpa, 24 credits".' };
      const g = Study.cgpa(marks);
      return { text: marks.map(m => '- **' + m.title + '**: ' + m.gpa + ' GPA · ' + m.credits + ' credits').join('\n') + '\n\n**CGPA: ' + g + '** over ' + plural(marks.reduce((x, m) => x + m.credits, 0), 'credit') + '.', tool: 'marks' };
    }

    /* ---- deadlines ---- */
    case 'ADD_DEADLINE': {
      const dueText = a.due || s;
      const date = NLU.parseDate(dueText);
      let title = a.title || cap(keepCase(p, NLU.stripWhen(s.replace(/^(add|new|save|note|i have|there'?s|got)( an?| my)?\s+/, '').replace(/\s*\b(is |which is |that is )?due\b.*$/, '')).replace(/\s+(on|by|for)$/, '')));
      if (!title) return { text: 'What is the assignment called?' };
      if (!date) { ctx.pending = { intent: 'ADD_DEADLINE', title }; return { text: 'When is **' + title + '** due?', suggestions: ['tomorrow', 'Friday', 'next Monday'] }; }
      const t = NLU.parseTimeOfDay(dueText);
      if (t) date.setHours(t.h, t.m, 0, 0); else date.setHours(23, 59, 0, 0);
      deadlines.push({ id: rid(), title, due: date.getTime(), done: false }); saveTasks();
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const due0 = new Date(date); due0.setHours(0, 0, 0, 0);
      const days = Math.round((due0 - today0) / 864e5);
      toolStep('addDeadline → ' + date.toDateString());
      return { text: 'Saved: **' + title + '** due ' + fmtDay(date) + (t ? ' at ' + fmtTime(date) : '') + ' (' + (days <= 1 ? 'that is soon!' : 'in ' + days + ' days') + ').' + (days <= 2 ? ' Want me to start a focus session?' : ''), tool: 'deadline', suggestions: days <= 2 ? ['Start a focus session'] : null };
    }
    case 'LIST_DEADLINES': {
      const ds = deadlines.filter(d => !d.done && d.due > Date.now() - 864e5).sort((x, y) => x.due - y.due);
      switchTab('tasks');
      if (!ds.length) return { text: 'Nothing due. Enjoy it while it lasts.' };
      const week = /\bweek\b/.test(s) ? ds.filter(d => d.due - Date.now() < 7 * 864e5) : ds;
      if (!week.length) return { text: 'Nothing due this week. Next up: **' + ds[0].title + '** ' + fmtDay(ds[0].due) + '.' };
      return { text: 'Coming up:\n' + week.map(d => '- **' + d.title + '** — ' + dueLabel(d.due) + (d.due < Date.now() ? ' ⚠' : '')).join('\n'), speak: week.slice(0, 3).map(d => d.title + ' is due ' + dueLabel(d.due)).join('. ') + '.', tool: 'deadline' };
    }

    /* ---- timetable ---- */
    case 'ADD_CLASS': {
      const dayRe = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|sday|nesday|rsday|urday)?s?\b/g;
      const days = a.day ? [NLU.dayIndex(String(a.day).toLowerCase())] : [...new Set((s.match(dayRe) || []).map(NLU.dayIndex))].filter(d => d >= 0);
      const t = NLU.parseTimeOfDay(a.time || s);
      let name = a.name || cap(keepCase(p, NLU.stripWhen(s.replace(/^(add|i have|there'?s|new)( an?| my)?\s+(class|lecture|lab|tutorial|period)\s*(called|named|for|of)?\s*/, '')).replace(/\b(every|and|at|on)\b/g, ' ').replace(/\s+/g, ' ').trim()));
      if (!name) return { text: 'Which class is it?' };
      if (!days.length || !t) return { text: 'Tell me the day and time, e.g. "add class ' + name + ' on Monday at 10am".' };
      let h = t.h; if (!t.explicit && h < 8) h += 12;
      days.forEach(d => classes.push({ id: rid(), name, day: d, h, m: t.m }));
      saveTasks(); toolStep('addClass');
      const tt = new Date(); tt.setHours(h, t.m);
      return { text: 'Added **' + name + '** to your timetable: ' + days.map(d => cap(NLU.DAYS[d])).join(', ') + ' at ' + fmtTime(tt) + '. I will ping you 10 minutes before.', tool: 'timetable' };
    }
    case 'NEXT_CLASS': {
      if (!classes.length) return { text: 'Your timetable is empty. Add one: "add class DBMS on Monday at 10am".' };
      const n = upcomingClasses(new Date())[0];
      const mins = Math.round((n.at - Date.now()) / 6e4);
      return { text: 'Next up: **' + n.c.name + '** ' + fmtDay(n.at) + ' at ' + fmtTime(n.at) + (mins < 180 ? ' — in ' + (mins < 60 ? plural(mins, 'minute') : Math.floor(mins / 60) + 'h ' + mins % 60 + 'm') : '') + '.', tool: 'timetable' };
    }
    case 'LIST_CLASSES': {
      if (!classes.length) return { askLLM: true };
      const d = new Date(); if (/tomorrow/.test(s)) d.setDate(d.getDate() + 1);
      const dm = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
      const day = dm ? NLU.dayIndex(dm[1]) : d.getDay();
      const list = classes.filter(c => c.day === day).sort((x, y) => x.h - y.h || x.m - y.m);
      const label = dm ? cap(NLU.DAYS[day]) : /tomorrow/.test(s) ? 'tomorrow' : 'today';
      switchTab('tasks');
      if (!list.length) return { text: 'No classes ' + (dm ? 'on ' : '') + label + '.' };
      return { text: 'Classes ' + (dm ? 'on ' : '') + label + ':\n' + list.map(c => { const t = new Date(); t.setHours(c.h, c.m); return '- ' + fmtTime(t) + ' — **' + c.name + '**'; }).join('\n'), tool: 'timetable' };
    }

    /* ---- clipboard & code helper ---- */
    case 'EXPLAIN_CLIPBOARD': {
      toolStep('readClipboard → llm');
      const r = await callTool('/tool/readClipboard', {});
      if (!r.content) return { text: 'Your clipboard is empty — copy the code or error first, then ask again.' };
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) for that. Here is what is on your clipboard:\n```\n' + r.content.slice(0, 3000) + '\n```' };
      return { askLLM: raw + '\n\nHere is the content from my clipboard:\n```\n' + r.content.slice(0, 8000) + '\n```' };
    }
    case 'READ_CLIPBOARD': {
      toolStep('readClipboard');
      const r = await callTool('/tool/readClipboard', {});
      if (!r.content) return { text: 'Your clipboard is empty.' };
      const code = r.content.includes('\n') || r.content.length > 120;
      return { text: code ? 'Your clipboard contains:\n```\n' + r.content.slice(0, 4000) + '\n```' : 'Your clipboard says: "' + r.content + '"', suggestions: code ? ['Explain the code in my clipboard'] : null, tool: 'readClipboard' };
    }
    case 'WRITE_CLIPBOARD': {
      const m = p.original.match(/(?:copy|put|write|save)\s+["']?(.+?)["']?\s+(?:to|in|into|on)\s+(?:the\s+|my\s+)?clipboard/i);
      if (!m) return { text: 'What should I copy?' };
      toolStep('writeClipboard');
      const r = await callTool('/tool/writeClipboard', { text: m[1] });
      return r.error ? { text: 'Clipboard write failed: ' + r.error } : { text: 'Copied "' + m[1] + '" to your clipboard.', tool: 'writeClipboard' };
    }

    /* ---- power ---- */
    case 'SYS_LOCK': toolStep('lockSystem'); await callTool('/tool/lockSystem'); return { text: 'Locking your screen.', tool: 'lockSystem' };
    case 'SYS_SLEEP':
      return confirmPower('Put the computer to sleep now?', 'YES — SLEEP', () => withHello('power', async tok => { toolStep('sleepSystem'); const r = await callTool('/tool/sleepSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_SLEEP' } : { text: 'Goodnight.', intent: 'SYS_SLEEP' }); }));
    case 'SYS_SHUTDOWN':
      log('warn', 'shutdown requested — awaiting confirmation');
      return confirmPower('Shut down the computer? Unsaved work in other apps will be lost.', 'YES — SHUT DOWN', () => withHello('power', async tok => { toolStep('shutdownSystem'); const r = await callTool('/tool/shutdownSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_SHUTDOWN' } : { text: 'Shutting down in ' + (r.seconds || 30) + ' seconds. Say "cancel shutdown" to abort.', intent: 'SYS_SHUTDOWN', suggestions: ['Cancel shutdown'] }); }));
    case 'SYS_RESTART':
      return confirmPower('Restart the computer?', 'YES — RESTART', () => withHello('power', async tok => { toolStep('restartSystem'); const r = await callTool('/tool/restartSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_RESTART' } : { text: 'Restarting in ' + (r.seconds || 30) + ' seconds. Say "cancel shutdown" to abort.', intent: 'SYS_RESTART', suggestions: ['Cancel shutdown'] }); }));
    case 'SYS_CANCEL_SHUTDOWN': toolStep('cancelShutdown'); await callTool('/tool/cancelShutdown'); return { text: 'Cancelled. Your system stays on.', tool: 'cancelShutdown' };

    /* ---- volume & media ---- */
    case 'VOLUME_MUTE': {
      const action = a.action || (/\bunmute\b|\b(sound|audio|volume) on\b/.test(s) ? 'unmute' : 'mute');
      toolStep('setVolume → ' + action); await callTool('/tool/setVolume', { action });
      Undo.push(action === 'mute' ? 'muted' : 'unmuted', async () => { await callTool('/tool/setVolume', { action: action === 'mute' ? 'unmute' : 'mute' }); return action === 'mute' ? 'Sound is back on.' : 'Muted again.'; });
      return { text: action === 'mute' ? 'Muted.' : 'Sound back on.', noTTS: action === 'mute', tool: 'setVolume' };
    }
    case 'VOLUME_UP':
    case 'VOLUME_DOWN': {
      const up = p.intent === 'VOLUME_UP';
      const steps = /\b(a lot|way|max|much|full)\b/.test(s) ? 20 : /\b(a (little|bit)|slightly|tad)\b/.test(s) ? 2 : 5;
      toolStep('setVolume → ' + (up ? 'up' : 'down')); await callTool('/tool/setVolume', { action: up ? 'up' : 'down', steps });
      Undo.push(up ? 'volume up' : 'volume down', async () => { await callTool('/tool/setVolume', { action: up ? 'down' : 'up', steps }); return 'Volume put back (' + (up ? 'down' : 'up') + ').'; });
      return { text: up ? 'Volume up.' : 'Volume down.', tool: 'setVolume' };
    }
    case 'MEDIA_PLAY': toolStep('mediaKey → play'); await callTool('/tool/mediaKey', { key: 'play' }); return { text: 'Toggled play/pause.', noTTS: true, tool: 'mediaKey' };
    case 'MEDIA_NEXT': toolStep('mediaKey → next'); await callTool('/tool/mediaKey', { key: 'next' }); return { text: 'Next track.', noTTS: true, tool: 'mediaKey' };
    case 'MEDIA_PREV': toolStep('mediaKey → prev'); await callTool('/tool/mediaKey', { key: 'prev' }); return { text: 'Previous track.', noTTS: true, tool: 'mediaKey' };
    case 'MEDIA_STOP': toolStep('mediaKey → stop'); await callTool('/tool/mediaKey', { key: 'stop' }); return { text: 'Stopped playback.', noTTS: true, tool: 'mediaKey' };

    /* ---- system info ---- */
    case 'SCREENSHOT': {
      toolStep('screenshot'); setState('EXECUTING', 'Capturing screen…');
      const r = await callTool('/tool/screenshot');
      return r.error ? { text: 'Screenshot failed: ' + r.error } : { text: 'Screenshot saved: `' + r.path + '`', speak: 'Screenshot saved to your desktop.', tool: 'screenshot' };
    }
    case 'SYS_BATTERY': {
      toolStep('batteryStatus');
      const r = await callTool('/tool/batteryStatus');
      if (r.level === null || r.level === undefined) return { text: 'No battery detected — looks like a desktop or it is not reporting.' };
      const low = r.level <= 20 && r.status !== 'Charging' ? ' That is low — plug in soon.' : '';
      return { text: 'Battery is at **' + r.level + '%** and ' + r.status.toLowerCase() + '.' + low, tool: 'batteryStatus' };
    }
    case 'SYS_PROCESSES': {
      toolStep('listProcesses');
      const r = await callTool('/tool/listProcesses');
      if (!r.processes || !r.processes.length) return { text: 'I could not read the process list.' };
      return { text: 'Top processes by memory:\n' + r.processes.slice(0, 6).map(x => '- **' + x.Name + '** — ' + x.RAM_MB + ' MB').join('\n'), speak: 'The biggest memory users are ' + r.processes.slice(0, 3).map(x => x.Name).join(', ') + '.', tool: 'listProcesses' };
    }
    case 'SYS_CPU': case 'SYS_RAM': case 'SYS_DISK': case 'SYS_OS': case 'SYS_ALL': {
      toolStep('getSystemInfo');
      if (!(await refreshSystem())) return { text: 'I cannot read system stats — the backend is offline.' };
      ctx.lastIntent = p.intent;
      if (p.intent === 'SYS_CPU') return { text: 'CPU usage is **' + sys.cpu + '%** across ' + sys.cpus + ' threads (' + sys.cpuModel.trim() + ').', speak: 'CPU usage is ' + sys.cpu + ' percent.' };
      if (p.intent === 'SYS_RAM') return { text: 'You are using **' + sys.ramUsed + ' GB of ' + sys.ramTotal + ' GB** RAM (' + sys.ram + '%).' + (sys.ram > 85 ? ' That is high — want to see the top processes?' : ''), suggestions: sys.ram > 85 ? ['What are the top processes?'] : null };
      if (p.intent === 'SYS_DISK') return { text: 'Your home drive has **' + sys.diskFree + ' GB free** (' + sys.diskUsed + '% used).' };
      if (p.intent === 'SYS_OS') return { text: 'You are running **' + sys.osName + '** on ' + sys.cpuModel.trim() + '.' };
      const verdict = sys.cpu > 85 || sys.ram > 90 ? 'Under heavy load.' : sys.cpu > 60 || sys.ram > 80 ? 'Working fairly hard.' : 'Running smoothly.';
      return { text: verdict + ' CPU **' + sys.cpu + '%**, RAM **' + sys.ram + '%** (' + sys.ramUsed + '/' + sys.ramTotal + ' GB), disk **' + sys.diskFree + ' GB** free.', card: [['OS', sys.osName], ['CPU', sys.cpuModel.trim()], ['UPTIME', Math.floor(sys.uptime / 60) + 'h ' + sys.uptime % 60 + 'm']] };
    }
    case 'SYS_NETWORK': {
      toolStep('networkInfo');
      const r = await callTool('/tool/networkInfo');
      return r.error ? { text: r.error } : { text: 'Local IP **' + r.ip + '** on ' + r.interface + '. Hostname: `' + r.hostname + '`.', speak: 'Your local IP is ' + r.ip, tool: 'networkInfo' };
    }

    /* ---- files (~/jarvis) ---- */
    case 'DESTRUCTIVE':
      log('warn', 'destructive request intercepted');
      return { text: 'That would move **everything** in ' + backend.sandbox + ' to the trash folder. Nothing outside the sandbox can be touched. Proceed?',
        confirm: { yes: 'YES — CLEAR SANDBOX', no: 'CANCEL', onConfirm: () => withHello('files', async tok => { toolStep('clearSandbox'); const r = await callTool('/tool/clearSandbox', {}, tok); if (!r.error && r.items && r.items.length) Undo.push('cleared the sandbox', async () => { let n = 0; for (const it of r.items) { const x = await callTool('/tool/restoreItem', it); if (!x.error) n++; } return 'Restored ' + plural(n, 'item') + ' from the trash.'; }); jarvisSay({ text: r.error ? 'Failed: ' + r.error : 'Moved ' + plural(r.count, 'item') + ' to ~/jarvis/.trash. Recoverable if you change your mind.', intent: 'DESTRUCTIVE' }); }) } };
    case 'DELETE_ITEM': {
      const m = p.original.match(/(folder|file|note|directory)\s+(?:called|named)?\s*["']?(.+?)["']?\s*$/i) || p.original.match(/^(?:delete|remove|trash)\s+()(.+\.\w+)$/i);
      const kindWord = m && m[1] ? m[1].toLowerCase() : 'file';
      let name = a.name || (m ? m[2].trim() : '');
      if (/^(it|that|this)$/i.test(name) || (!name && ctx.lastFile)) name = ctx.lastFile || '';
      if (!name) return { text: 'Which file or folder should I delete?' };
      const kind = /folder|directory/.test(kindWord) ? 'folder' : 'file';
      return { text: 'Move ' + kind + ' "**' + name + '**" to the sandbox trash?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('files', async tok => {
        toolStep('deleteItem → ' + name); const r = await callTool('/tool/deleteItem', { name, kind }, tok);
        if (!r.error && r.trashName) Undo.push('deleted ' + r.name, async () => { const x = await callTool('/tool/restoreItem', { trashName: r.trashName, original: r.original }); if (x.error) throw new Error(x.error); return 'Restored `' + x.name + '` from the trash.'; });
        jarvisSay({ text: r.error ? cap(r.error) + '.' : 'Deleted `' + r.name + '` (moved to .trash).', intent: 'DELETE_ITEM' });
      }) } };
    }
    case 'NOTE_APPEND': {
      const m = p.original.match(/(?:take|make|write|jot|add)\s+(?:a\s+)?note:?\s*(.+)$/i) || p.original.match(/note(?:\s+down)?:?\s*(.+)$/i);
      const content = a.content || (m ? m[1].trim() : '');
      if (!content) return { text: 'What should the note say?' };
      toolStep('writeFile → notes.md');
      const r = await callTool('/tool/writeFile', { name: 'Notes/notes.md', content: '- ' + new Date().toLocaleString() + ' — ' + content, append: true });
      if (r.error) return { text: 'Could not save the note: ' + r.error };
      if (r.backup) Undo.push('added a note', async () => { const x = await callTool('/tool/restoreVersion', { backup: r.backup, name: r.name }); if (x.error) throw new Error(x.error); return 'Removed that note from `' + x.name + '`.'; });
      else if (r.created) Undo.push('added a note', async () => { const x = await callTool('/tool/undoCreate', { name: r.name }); if (x.error) throw new Error(x.error); return 'Removed `' + r.name + '`.'; });
      ctx.lastFile = 'notes.md';
      return { text: 'Noted in `~/jarvis/' + r.name + '`: "' + content + '"', speak: 'Noted.', tool: 'writeFile' };
    }
    case 'WRITE_FILE': {
      const nm = p.original.match(/(?:called|named|titled)\s+["']?([\w\- .]+?)["']?(?=\s+(?:with|saying|containing|that says)\b|:|$)/i);
      const cm = p.original.match(/(?:with|saying|containing|that says|:)\s+["']?([\s\S]+?)["']?$/i);
      const name = a.name || (nm ? nm[1].trim() : '');
      const content = a.content || (cm ? cm[1] : '');
      if (!name) return { text: 'What should I call the file? e.g. "create a note called dsa-tips saying …"' };
      return saveToFile(name, content ? content + '\n' : '');
    }

    /* ---- code → file → run ---- */
    case 'WRITE_AND_SAVE': {
      const name = a.name || extractFileName(p.original);
      const run = /\b(and|then) (run|execute|compile)\b/i.test(p.original);
      const ask = p.original.replace(/[,\s]*\b(and|then)\s+(save|store|put)\b[\s\S]*$/i, '').trim();
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write code. Start Ollama and try again.' };
      return { askLLM: ask + '\n\nReply with the complete, runnable code in ONE fenced code block (with a language tag), then at most two short sentences.', after: { save: name, run } };
    }
    case 'SAVE_CODE': {
      const code = a.code || lastCode();
      if (!code) return { text: 'I do not see any code in our chat yet. Ask me to write some — or say "paste my clipboard into main.py".', suggestions: ['Paste my clipboard into main.py'] };
      let name = a.name || extractFileName(p.original);
      if (!name || /^(it|that|this)$/i.test(name)) name = ctx.lastFile && !a.name && /\b(it|that file|the file)\b/.test(s) && !/\bas\b/.test(s) ? ctx.lastFile : '';
      if (!name) { ctx.pending = { intent: 'SAVE_CODE', code }; const ext = LANG_EXT[code.lang] || '.txt'; return { text: 'What should I name the file?', suggestions: ['main' + ext, 'solution' + ext] }; }
      return saveToFile(withExt(name, code.lang), code.code + '\n', { what: code.lang || 'code', run: !!(a.run) });
    }
    case 'CLIPBOARD_TO_FILE': {
      toolStep('readClipboard');
      const content = await readClip();
      if (!content) return { text: 'Your clipboard is empty — copy something first.' };
      const name = a.name || extractFileName(p.original);
      if (!name) { ctx.pending = { intent: 'SAVE_CODE', code: { lang: guessLang(content), code: content } }; return { text: 'Which file should I put your clipboard into?' }; }
      const append = /\b(append|add)\b/.test(s);
      return saveToFile(withExt(name, guessLang(content) || 'text'), content + '\n', { append, what: 'clipboard' });
    }
    case 'COPY_CONTENT': {
      const file = (s.match(/([\w\-.\/\\:]+\.[a-z0-9+]{1,6})\b/i) || [])[1];
      if (file && !/^(e\.g|i\.e)$/i.test(file)) {
        toolStep('readFile → clipboard');
        const r = await callTool('/tool/readFile', { name: extractFileName(p.original) || file });
        if (r.error) return { text: 'I could not find "' + file + '".' };
        await copyText(r.content); ctx.lastFile = r.name;
        return { text: '✓ Copied `' + r.name + '` (' + plural(lines(r.content), 'line') + ') to your clipboard.', speak: 'Copied ' + r.name.split('/').pop(), tool: 'writeClipboard', suggestions: ['Paste that code into my editor'] };
      }
      const code = /\b(answer|reply|response)\b/.test(s) ? null : lastCode();
      const text = code ? code.code : lastAnswer();
      if (!text) return { text: 'There is nothing to copy yet.' };
      toolStep('copy → clipboard');
      await copyText(text);
      return { text: '✓ Copied ' + (code ? plural(lines(text), 'line') + ' of ' + (code.lang || 'code') : 'my last answer') + ' to your clipboard.', speak: 'Copied.', tool: 'writeClipboard', suggestions: code ? ['Paste that code into my editor', 'Save that code as main' + (LANG_EXT[code.lang] || '.txt')] : null };
    }
    case 'PASTE_TO_EDITOR': {
      const fromClip = /\bclipboard\b/.test(s);
      if (fromClip) { const r = await callTool('/tool/pasteKeys', { delayMs: 3000 }); [3, 2, 1].forEach((n, i) => setTimeout(() => toast('Click into your editor… pasting in ' + n, true), i * 1000)); return r.error ? { text: r.error } : { text: '**Click into your editor now** — pasting your clipboard in 3 seconds.' }; }
      const code = a.code || lastCode();
      if (!code) return { text: 'There is no code in our chat to paste. Ask me to write some first.' };
      toolStep('pasteToEditor');
      return pasteToActiveWindow(code.code, plural(lines(code.code), 'line') + ' of ' + (code.lang || 'code'));
    }
    case 'OPEN_IN_EDITOR': {
      const m = p.original.match(/(?:open|edit|show|load)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:in|with|using|on)\s+(?:vs ?code|vscode|visual studio code|code editor|my editor|the editor|editor)\b/i) || p.original.match(/^edit\s+(.+)$/i);
      let name = a.name || (m ? m[1].trim() : '');
      if (!name || /^(it|that|this|that file|the file)$/i.test(name)) name = ctx.lastFile || '';
      if (/^(project|projects|my project|code)$/i.test(name)) name = projectRoots[0] || '';
      if (/^(sandbox|jarvis sandbox|files)$/i.test(name)) name = '';
      // "open agriloop folder in vs code" → "agriloop": the kind of thing isn't part of its name.
      name = name.replace(/^(?:the|my)\s+/i, '').replace(/\s+(?:folder|directory|project|workspace|repo)$/i, '').trim();
      toolStep('openInEditor → ' + (name || '~/jarvis'));
      // Anywhere on the laptop (no setup). Several places match (AGRILOOP-1, AGRILOOP61): ask which one.
      const r = await callTool('/tool/openInEditor', { name });
      const pick = pickPlace(r, name, async x => { const o = await callTool('/tool/openInEditor', { name: x }); return o.error ? { text: cap(o.error) + '.' } : { text: 'Opening `' + o.path + '` in **VS Code**.', tool: 'openInEditor' }; });
      if (pick) return pick;
      if (r.error) return { text: cap(r.error) + '.', suggestions: ['List my files'] };
      if (/\.[a-z0-9]+$/i.test(r.name)) ctx.lastFile = r.name;
      return { text: 'Opening `' + (r.path || r.name) + '` in **VS Code**.', speak: 'Opening it in VS Code.', tool: 'openInEditor' };
    }
    case 'CODE_ASK': {
      const parsed = NLU.parseCodeAsk(p.original) || {};
      const tool = a.tool || parsed.tool;
      const prompt = (a.prompt || parsed.prompt || '').trim();
      let folder = (a.folder || parsed.folder || '').trim();
      if (!tool) return { text: 'Which coding tool — VS Code/Copilot, Kiro, Trae, Antigravity, Devin, OpenCode, Claude, Gemini, Codex, Qwen or Codebuff?' };
      if (!prompt) return { text: 'What should I ask it to do?' };
      if (!folder) folder = ctx.lastProject || '';
      // A folder JARVIS isn't allowed to use yet (e.g. on the Desktop): find it and offer to allow it, then carry on.
      if (folder && (await callTool('/tool/locateProject', { name: folder })).error) {
        const f = await callTool('/tool/findFolderAnywhere', { name: folder });
        const paths = (f.paths || []);
        if (!paths.length) return { text: 'I can’t find a folder called **' + folder + '**. Add it in **Settings → Project folders** (paste its full path, e.g. `C:\\Users\\you\\Desktop\\' + folder + '`), then ask again.' };
        return { text: 'I found **' + folder + '** at `' + paths[0] + '`' + (paths.length > 1 ? ' (and ' + (paths.length - 1) + ' other place' + (paths.length > 2 ? 's' : '') + ')' : '') + ', but JARVIS isn’t allowed to use that folder yet. Allow it? (It’s added to Settings → Project folders; you can remove it there any time.)', intent: 'CODE_ASK',
          actions: paths.slice(0, 3).map((pth, i) => ({ label: paths.length > 1 ? 'ALLOW ' + (i + 1) + ': …' + pth.slice(-38) : 'ALLOW & CONTINUE', fn: async () => {
            const r = await callTool('/config', { action: 'add', path: pth });
            if (r.error) return jarvisSay({ text: 'Couldn’t add it: ' + r.error, intent: 'CODE_ASK' });
            if (r.roots) renderRoots(r.roots);
            log('ok', 'project folder added: ' + pth);
            await deliver(await executeTool({ ...p, args: { tool, folder: pth.split(/[\\/]/).pop(), prompt } }, raw), p);
          } })) };
      }
      const label = CODE_TOOL_LABELS[tool] || tool;
      const folderLabel = folder || '~/jarvis';
      return { text: 'Ask **' + label + '** in `' + folderLabel + '` to: ' + prompt + '?', confirm: { yes: 'SEND', no: 'CANCEL', onConfirm: async () => {
        toolStep('codeAsk → ' + tool + ' ' + folderLabel);
        const r = await callTool('/tool/codeAsk', { tool, folder, prompt });
        if (r.error) { jarvisSay({ text: 'Could not reach ' + label + ': ' + r.error + '.', intent: 'CODE_ASK' }); return; }
        ctx.lastProject = r.folder;
        const how = r.kind !== 'open' ? '.' : r.pasted ? ' — pasted your request into its chat and pressed Enter.'
          : r.pasteNote === 'front' ? '. Your request is copied — **click OpenCode’s chat box, press Ctrl+V, then Enter.** (If it opened a different project, pick **' + r.folder.split('/').pop() + '** in OpenCode first.)'
          : ' — I couldn’t type into its window' + (r.pasteNote === 'skipped:not-in-front' ? ' (another window was in front)' : r.pasteNote === 'skipped:no-window' ? ' (it took too long to open)' : '') + ', so your request is on the clipboard: click in its chat box and press **Ctrl+V**, then Enter.';
        jarvisSay({ text: 'Sent to **' + r.tool + '** in `' + r.folder + '`' + how, intent: 'CODE_ASK', tool: 'codeAsk' });
      } } };
    }
    case 'RUN_FILE': {
      let name = a.name || (p.original.match(/([\w\-.\/\\:]+\.(?:py|js|mjs|c|cpp|cc))\b/i) || [])[1] || '';
      if (!name) {
        if (/\b(the|that|this) (code|program|script)\b/.test(s) && lastCode() && RUNNABLE.test(LANG_EXT[lastCode().lang] || '')) {
          const c = lastCode();
          const r0 = await callTool('/tool/writeFile', { name: 'Code/scratch' + LANG_EXT[c.lang], content: c.code + '\n', overwrite: true });
          if (r0.error) return { text: 'Could not prepare the code: ' + r0.error };
          name = r0.name;
        } else name = ctx.lastFile || '';
      }
      if (!name) return { text: 'Which file should I run? e.g. "run bfs.py".', suggestions: ['List my files'] };
      if (!RUNNABLE.test(name)) return { text: 'I can run .py, .js, .c and .cpp files — `' + name + '` is not one of those.' };
      const im = p.original.match(/\b(?:with|using) input\s+["']?(.+?)["']?$/i);
      const stdin = im ? im[1].split(/\s*(?:;|\\n|\|)\s*/).join('\n') + '\n' : '';
      setState('EXECUTING', 'Running ' + name.split('/').pop() + '…'); toolStep('runFile → ' + name);
      let r = await callTool('/tool/runFile', { name, stdin });
      if (r.choices) return { text: 'I found ' + r.choices.length + ' files called **' + name + '** — say which one, e.g. “run ' + r.choices[0] + '”:\n\n' + r.choices.map((x, i) => (i + 1) + '. `' + x + '`').join('\n'), noPersona: true };
      if (r.error) return { text: cap(r.error) + '.' };
      ctx.lastFile = r.name; bumpStat('codeRuns');
      const meta = 'RUN_FILE · ' + r.lang + ' · exit ' + r.exitCode + ' · ' + r.ms + 'ms';
      const fixAct = llmReady() ? [{ label: '🛠 EXPLAIN & FIX', fn: () => fixCode(r, im ? im[1] : '') }] : undefined;
      if (r.compileError) return { actions: fixAct, text: '❌ **Compilation failed** for `' + r.name + '`:\n```text\n' + (r.stderr || r.stdout).trim() + '\n```', speak: 'Compilation failed. The errors are on screen.', meta, suggestions: llmReady() ? ['Explain this error and fix the code'] : null };
      let out = '**Ran `' + r.name + '`** ' + (r.timedOut ? '⏱ stopped after 10s' : r.exitCode === 0 ? '✓' : '✗ exit ' + r.exitCode) + '\n';
      if (r.stdout.trim()) out += '```text\n' + r.stdout.replace(/\s+$/, '') + '\n```\n';
      if (r.stderr.trim()) out += 'stderr:\n```text\n' + r.stderr.replace(/\s+$/, '') + '\n```';
      if (!r.stdout.trim() && !r.stderr.trim()) out += '_(no output)_';
      const needsInput = /EOFError|input\(\)|Scanner|NoSuchElement/.test(r.stderr) || r.timedOut;
      const sugg = [];
      if (r.exitCode !== 0 && llmReady()) sugg.push('Explain this error and fix the code');
      if (needsInput) sugg.push('Run it with input 5');
      sugg.push('Open it in VS Code');
      const short = r.stdout.trim().split('\n');
      return { text: out, meta, suggestions: sugg, actions: r.exitCode !== 0 && !r.timedOut ? fixAct : undefined, speak: r.exitCode !== 0 ? 'It exited with an error. Details are on screen.' : short.length === 1 && short[0].length < 80 ? 'Output: ' + short[0] : 'Done. The output is on screen.' };
    }
    case 'LOCATE_PROJECT': {
      const m = p.original.match(/^(?:locate|find|where'?s|where is)\s+(?:my\s+|the\s+)?(.+?)\s+(?:project|folder)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      if (!name) return { text: 'Which project?' };
      toolStep('locateProject → ' + name);
      const r = await callTool('/tool/locateProject', { name });
      if (r.error) return { text: cap(r.error) + '.' };
      ctx.lastProject = r.name;
      return { text: '✓ Found `' + r.name + '`.', op: { kind: 'project', name: r.name }, tool: 'locateProject' };
    }
    case 'START_PROCESS': {
      const m = p.original.match(/^start\s+(?:the\s+|my\s+)?(.+?)(?:'s)?\s+(backend|frontend|server|app)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      const which = a.which || (m ? ({ server: 'backend' }[m[2].toLowerCase()] || m[2].toLowerCase()) : '');
      if (!name || !which) return { text: 'Which project, and backend or frontend?' };
      toolStep('startProcess → ' + name + ' ' + which);
      const r = await callTool('/tool/startProcess', { name, which });
      if (!r.success) {
        // The project simply has no backend/frontend: not a failure, just nothing to start.
        if (/^No (backend|frontend|app) found/.test(r.error || '')) return { text: 'no ' + which + ' in this project', absent: true, tool: 'startProcess' };
        if (r.portInUse) return { text: 'Port ' + (r.port || '?') + ' is already in use, so the ' + which + ' for "' + name + '" did not start.', portInUse: true, port: r.port, project: name, which, tool: 'startProcess' };
        return { text: 'Could not start the ' + which + ' for "' + name + '"' + (r.error ? ': ' + r.error : (r.tail ? ':\n```text\n' + r.tail.trim().slice(-400) + '\n```' : '.')),
          // project/which/tail let a multi-step plan diagnose the crash (and, for missing dependencies, offer to install them).
          startFailed: !r.error, missingDeps: r.missingDeps || null, project: name, which, tail: r.tail || '', tool: 'startProcess' };
      }
      ctx.lastProject = name;
      // A server JARVIS just started can be stopped again ("undo", or ROLLBACK on a failed plan); one that was already running is left alone.
      if (!r.existed) Undo.push('started the ' + which + ' for ' + name, async () => { const x = await callTool('/tool/stopProcess', { name, which }); if (x.error) throw new Error(x.error); return 'Stopped the ' + which + ' for `' + name + '`.'; });
      return { text: (r.existed ? '✓ The ' + which + ' for `' + name + '` is already running' : '✓ Started the ' + which + ' for `' + name + '`') + (r.port ? ' on port ' + r.port : '') + '.', op: { kind: 'process', name, which, id: r.id, port: r.port }, tool: 'startProcess' };
    }
    case 'STOP_PROCESS': {
      const m = p.original.match(/^stop\s+(?:the\s+|my\s+)?(.+?)(?:'s)?\s+(backend|frontend|server|app)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      const which = a.which || (m ? ({ server: 'backend' }[m[2].toLowerCase()] || m[2].toLowerCase()) : '');
      if (!name || !which) return { text: 'Which project, and backend or frontend?' };
      toolStep('stopProcess → ' + name + ' ' + which);
      const r = await callTool('/tool/stopProcess', { name, which });
      if (r.error) return { text: cap(r.error) + '.' };
      return { text: '✓ Stopped the ' + which + ' for `' + name + '`.', op: { kind: 'process_stopped', name, which }, tool: 'stopProcess' };
    }
    case 'CHECK_COMPILER': {
      const r = await callTool('/tool/checkCompiler', { language: a.language });
      if (r.error) return { text: cap(r.error) + '.' };
      return { text: r.found ? '✓ ' + r.label + ' is installed' + (r.path ? ' (`' + r.path + '`)' : '') + '.' : '✗ ' + r.label + ' was not found on your PATH.', op: { kind: 'toolchain_check', found: r.found, label: r.label }, tool: 'checkCompiler' };
    }
    case 'CHECK_EXTENSION': {
      const r = await callTool('/tool/checkExtension', { language: a.language });
      if (r.error) return { text: cap(r.error) + '.' };
      if (!r.applicable) return { text: 'No specific VS Code extension needed for this.', tool: 'checkExtension' };
      return { text: r.found ? '✓ The recommended VS Code extension (`' + r.extension + '`) is installed.' : '○ The recommended VS Code extension (`' + r.extension + '`) is not installed — you can add it from the Extensions panel.', op: { kind: 'extension_check', found: r.found }, tool: 'checkExtension' };
    }
    case 'CHECK_EXISTS': {
      const m = p.original.match(/\bcheck\s+(?:if|whether)\s+(.+?)\s+exists?\b/i) || p.original.match(/\bdoes\s+(.+?)\s+exist\b/i)
        || p.original.match(/^is there (?:a |an )?(?:file|folder|note|document)\s+(?:called|named)\s+(.+?)[.?!]*$/i)
        || p.original.match(/^do i have (?:a |an )?(?:file|folder|note)\s+(?:called|named)\s+(.+?)[.?!]*$/i);
      const name = (a.name || (m ? m[1] : '')).trim().replace(/^(?:a|an|the|my)\s+/i, '').replace(/\s+(?:folder|file|note|document)$/i, '').trim();
      if (!name) return { text: 'Check whether what exists?' };
      toolStep('exists → ' + name);
      // Where it looks, in order: ~/jarvis (exact), your project folders (forgiving: "dsa sprint" and even a misheard
      // "dss print" find dsa_sprint), then — for folders — the rest of the laptop (Desktop, Documents, Downloads, drives).
      const r = await callTool('/agent/exists', { name });
      if (r.exists) return { text: '✓ Yes — `' + name + '` exists' + (r.dir ? ' (a folder)' : ' (a file)') + ' in `~/jarvis`.', tool: 'checkExists' };
      const wantsFile = /\.[a-z0-9]{1,5}$/i.test(name) || /\b(file|note|document)\b/i.test(p.original);
      const shown = x => x.split(/[\\/]/).pop();
      const tookAs = x => shown(x).toLowerCase().replace(/[\s_-]+/g, ' ') !== name.toLowerCase().replace(/[\s_-]+/g, ' ') ? ' (I took “' + name + '” to mean that)' : '';
      if (!wantsFile) {
        const l = await callTool('/tool/locateProject', { name });
        if (l.success) return { text: '✓ Yes — the folder **' + shown(l.path) + '** is at `' + l.path + '`' + tookAs(l.path) + '.', tool: 'checkExists',
          suggestions: ['Open vs code in ' + shown(l.path), 'Open the ' + shown(l.path) + ' folder'] };
        toolStep('findFolderAnywhere → ' + name);
        const f = await callTool('/tool/findFolderAnywhere', { name });
        const paths = f.paths || [];
        if (paths.length) return { text: '✓ Yes — found **' + shown(paths[0]) + '** at `' + paths[0] + '`' + tookAs(paths[0]) + (paths.length > 1 ? ' (and ' + plural(paths.length - 1, 'other place') + ')' : '') +
          (paths.length > 1 ? ':\n' + paths.map((x, i) => (i + 1) + '. `' + x + '`').join('\n') : '.'), tool: 'checkExists',
          actions: paths.slice(0, 3).flatMap((pth, i) => {
            const n = paths.length > 1 ? ' ' + (i + 1) : '';
            return [{ label: 'OPEN IN VS CODE' + n, fn: async () => { const o = await callTool('/tool/openInEditor', { name: pth }); jarvisSay({ text: o.error ? cap(o.error) + '.' : 'Opening `' + pth + '` in **VS Code**.', intent: 'CHECK_EXISTS' }); } },
                    { label: 'OPEN FOLDER' + n, fn: async () => { const o = await callTool('/tool/openFolder', { name: pth }); jarvisSay({ text: o.error ? cap(o.error) + '.' : 'Opening `' + pth + '` in your file explorer.', intent: 'CHECK_EXISTS' }); } }];
          }) };
      } else {
        const sf = await callTool('/tool/searchFiles', { query: name.replace(/\.[a-z0-9]{1,5}$/i, '') });
        const hits = (sf.results || []).filter(x => !String(x).endsWith('/'));   // paths; folders end in "/"
        if (hits.length) return { text: '✓ Yes — ' + hits.slice(0, 3).map(x => '`' + x + '`').join(', ') + '.', tool: 'checkExists' };
      }
      return { text: '✗ No, I can’t find `' + name + '` in `~/jarvis`, your project folders, or the usual places on this laptop (Desktop, Documents, Downloads, other drives).', tool: 'checkExists' };
    }
    case 'WHY_ACTION': return Agent.explainLastAction(p.original);
    case 'LEARN_LIST': return Agent.learnedSummary();
    case 'MISSES_LIST': {
      const list = Agent.missList().slice(0, 6);
      if (!list.length) return { text: 'Nothing lately — every recent request matched a command, ' + Persona.sir() + '.', noPersona: true };
      const how = { planner: 'guessed by the AI', corrected: 'you corrected me', 'not understood': 'not understood (AI offline)' };
      const teachAsk = m => () => { ctx.pending = { intent: 'TEACH', phrase: m.original }; jarvisSay({ text: 'What should I do when you say **“' + m.original + '”**? Type the command, e.g. "set volume to 30" or "open vs code and start a focus session". ("cancel" to skip.)', intent: 'LEARN_TEACH', noPersona: true }); };
      return { text: 'Phrases I didn’t understand recently:\n' + list.map((m, i) => (i + 1) + '. “' + m.original + '” — ' + (how[m.how] || m.how)).join('\n') + '\n\nTap **TEACH** to tell me what one should do.',
        noPersona: true, actions: list.slice(0, 4).map((m, i) => ({ label: 'TEACH ' + (i + 1), fn: teachAsk(m) })).concat([{ label: 'CLEAR LIST', fn: () => { Agent.missList().forEach(m => Agent.forgetMiss(m.phrase)); toast('Cleared'); } }]) };
    }
    case 'LEARN_FORGET_ALL': {
      const n = Agent.learnedCount();
      if (!n) return { text: 'I hadn’t learned anything yet.', tool: 'forgetLearned' };
      return { text: 'Forget all ' + plural(n, 'learned phrase') + '?', confirm: { yes: 'FORGET', no: 'KEEP', onConfirm: () => {
        Agent.forgetAllLearned(); jarvisSay({ text: '✓ Forgot ' + plural(n, 'learned phrase') + '.', intent: 'LEARN_FORGET_ALL' });
      } } };
    }
    case 'OPEN_PROJECT_URL': {
      const name = a.name; const which = a.which || 'frontend';
      if (!name) return { text: 'Which project?' };
      const st = await callTool('/tool/processStatus', { name, which });
      const port = st.found && st.port ? st.port : (which === 'frontend' ? 3000 : 8000);
      const guessed = !(st.found && st.port);
      toolStep('openUrl → localhost:' + port);
      const r = await callTool('/tool/openUrl', { url: 'http://localhost:' + port });
      if (r.error) return { text: 'Could not open the browser: ' + r.error };
      return { text: '✓ Opening `http://localhost:' + port + '`' + (guessed ? ' (its port wasn’t detected yet, so this is a guess)' : '') + '.', op: { kind: 'browser_url', url: 'http://localhost:' + port, guessed }, tool: 'openUrl' };
    }

    /* ---- snippets ---- */
    case 'SNIPPET_SAVE': {
      const m = p.original.match(/as (?:a |my )?snippet(?:\s+(?:called|named))?\s+["']?(.+?)["']?\s*$/i) || p.original.match(/snippet\s+(?:called|named)\s+["']?(.+?)["']?(?:\s+from.*)?$/i) || p.original.match(/^(?:save|add|new) (?:a )?snippet\s+["']?(.+?)["']?(?:\s+from.*)?$/i);
      const name = a.name || (m ? m[1].trim() : '');
      let code = null;
      if (/\b(clipboard|copied)\b/.test(s)) { const c = await readClip(); if (c) code = { lang: guessLang(c), code: c }; }
      else code = lastCode();
      if (!code) return { text: /clipboard/.test(s) ? 'Your clipboard is empty.' : 'There is no code in our chat to save. Copy some code and say "save my clipboard as snippet …".' };
      if (!name) return { text: 'What should I call this snippet? e.g. "save that code as snippet binary search".' };
      snippets = snippets.filter(x => x.name.toLowerCase() !== name.toLowerCase());
      snippets.unshift({ id: rid(), name, lang: code.lang || '', code: code.code, ts: Date.now() }); saveSnippets();
      toolStep('saveSnippet → ' + name);
      return { text: '✓ Saved snippet **' + name + '** (' + plural(lines(code.code), 'line') + (code.lang ? ' of ' + code.lang : '') + '). Say "copy snippet ' + name + '" anytime.', speak: 'Snippet saved.', tool: 'snippets' };
    }
    case 'SNIPPET_COPY': {
      const m = p.original.match(/snippet\s+(?:called\s+|named\s+)?["']?(.+?)["']?(?:\s+(?:to|into|in|on)\s+(?:my\s+|the\s+)?(?:clipboard|editor|vs ?code|window|active window))?\s*$/i);
      const sn = findSnippet(a.name || (m ? m[1] : ''));
      if (!sn) return { text: snippets.length ? 'I could not find that snippet. You have: ' + snippets.map(x => '**' + x.name + '**').join(', ') + '.' : 'You have no snippets yet.' };
      if (/\b(paste|insert)\b|\b(editor|vs ?code|window)\b/.test(s)) return pasteToActiveWindow(sn.code, 'snippet **' + sn.name + '**');
      await copyText(sn.code);
      return { text: '✓ Copied snippet **' + sn.name + '** to your clipboard.\n```' + (sn.lang || '') + '\n' + sn.code.slice(0, 1500) + '\n```', speak: 'Copied ' + sn.name + '.', tool: 'snippets' };
    }
    case 'SNIPPET_LIST': {
      switchTab('memory');
      if (!snippets.length) return { text: 'No snippets yet. Copy some code and say "save my clipboard as snippet binary search".' };
      return { text: 'Your snippets:\n' + snippets.map(x => '- **' + x.name + '**' + (x.lang ? ' · ' + x.lang : '') + ' · ' + plural(lines(x.code), 'line')).join('\n'), speak: 'You have ' + plural(snippets.length, 'snippet') + '.' };
    }
    case 'SNIPPET_DELETE': {
      const m = p.original.match(/snippet\s+(?:called\s+|named\s+)?["']?(.+?)["']?\s*$/i);
      const sn = findSnippet(m ? m[1] : '');
      if (!sn) return { text: 'I could not find that snippet.' };
      return { text: 'Delete snippet **' + sn.name + '**?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('deleted snippet ' + sn.name, () => snippets, v => { snippets = v; }, saveSnippets, removedFrom(snippets, x => x !== sn));
        snippets = snippets.filter(x => x !== sn); saveSnippets();
        jarvisSay({ text: 'Deleted snippet **' + sn.name + '**.', intent: 'SNIPPET_DELETE' });
      }) } };
    }

    /* ---- clipboard power tools ---- */
    case 'CLIP_TOOL': {
      toolStep('clipTool');
      const c = await readClip();
      if (!c) return { text: 'Your clipboard is empty.' };
      let out = null, label = '';
      try {
        if (/json/.test(s)) {
          const v = JSON.parse(c);
          if (/\bvalidate\b/.test(s)) return { text: '✓ Valid JSON (' + (Array.isArray(v) ? 'array of ' + v.length : typeof v === 'object' && v ? Object.keys(v).length + ' keys' : typeof v) + ').' };
          out = /\bminify\b/.test(s) ? JSON.stringify(v) : JSON.stringify(v, null, 2); label = /\bminify\b/.test(s) ? 'minified JSON' : 'formatted JSON';
        } else if (/\b(count|how many)\b/.test(s)) {
          const words = (c.match(/\S+/g) || []).length;
          return { text: 'Your clipboard has **' + words.toLocaleString() + ' words**, ' + c.length.toLocaleString() + ' characters and ' + plural(lines(c), 'line') + '.' };
        } else if (/upper ?case/.test(s)) { out = c.toUpperCase(); label = 'UPPERCASE text'; }
        else if (/lower ?case/.test(s)) { out = c.toLowerCase(); label = 'lowercase text'; }
        else if (/title ?case|capitali[sz]e/.test(s)) { out = c.toLowerCase().replace(/\b\w/g, x => x.toUpperCase()); label = 'Title Case text'; }
        else if (/base ?64/.test(s) && /decode/.test(s)) { out = decodeURIComponent(escape(atob(c.trim()))); label = 'decoded text'; }
        else if (/base ?64/.test(s) || (/encode/.test(s) && !/url/.test(s))) { out = btoa(unescape(encodeURIComponent(c))); label = 'Base64'; }
        else if (/url/.test(s) && /decode/.test(s)) { out = decodeURIComponent(c); label = 'URL-decoded text'; }
        else if (/url/.test(s)) { out = encodeURIComponent(c); label = 'URL-encoded text'; }
        else if (/\bsort\b/.test(s)) { out = c.split('\n').sort((x, y) => x.localeCompare(y)).join('\n'); label = 'sorted lines'; }
        else if (/dedupe|duplicate/.test(s)) { out = [...new Set(c.split('\n'))].join('\n'); label = 'unique lines'; }
        else if (/reverse/.test(s)) { out = c.split('\n').reverse().join('\n'); label = 'reversed lines'; }
        else if (/trim|clean|whitespace|spaces/.test(s)) { out = c.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim(); label = 'cleaned text'; }
      } catch (e) { return { text: '❌ That did not work: ' + e.message + '.' }; }
      if (out === null) return { askLLM: true };
      await copyText(out);
      return { text: '✓ Your clipboard now holds the **' + label + '**.\n```' + (/json/i.test(label) ? 'json' : 'text') + '\n' + out.slice(0, 2000) + (out.length > 2000 ? '\n…' : '') + '\n```', speak: 'Done. Your clipboard now holds the ' + label + '.', tool: 'clipTool' };
    }
    case 'CLIP_TRANSFORM': {
      toolStep('readClipboard → llm');
      const c = await readClip();
      if (!c) return { text: 'Your clipboard is empty — copy the code first.' };
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) for that.' };
      return { askLLM: raw + '\n\nHere is the code from my clipboard:\n```\n' + c.slice(0, 8000) + '\n```\n\nReply with ONLY the complete resulting code in one fenced code block, then at most two short sentences on what changed.', after: { copyBack: true } };
    }
    case 'SUMMARISE_LINK': {
      if (!settings.online) return { text: 'Reading web pages needs Online tools, which are off. Enable them?', actions: enableOnlineAction() };
      let url = (p.original.match(/https?:\/\/\S+/) || [])[0];
      if (!url) { const c = await readClip(); url = (c.match(/https?:\/\/\S+/) || [])[0]; }
      if (!url) return { text: 'I could not find a link — copy a URL first, then ask again.' };
      toolStep('fetchPage → ' + url);
      const r = await callTool('/tool/fetchPage', { url, online: true });
      if (r.error) return { text: r.error + '.' };
      if (!llmReady()) return { text: '**' + (r.title || url) + '**\n\n' + r.text.slice(0, 700) + '…' };
      return { askLLM: 'Summarise this web page for me in 4-6 bullet points, then one line on why it matters.\nTitle: ' + r.title + '\nURL: ' + r.url + '\n\n' + r.text };
    }

    /* ---- productivity ---- */
    case 'BLOCK_DISTRACTIONS': {
      const DISTRACTORS = Agent.DISTRACTORS;
      toolStep('runningApps');
      const r = await callTool('/tool/runningApps', { apps: DISTRACTORS });
      const running = r.running || [];
      const min = settings.focusMin || 25;
      // Inside a plan that has its own focus-session step, this step only closes the apps (no second session).
      const withFocus = !a.noFocus;
      if (!running.length) {
        if (withFocus) startFocus(min);
        return { text: withFocus ? 'No distracting apps are open — nice. Started a **' + min + '-minute** focus session. Put your phone on Do Not Disturb.' : 'No distracting apps are open — nice.', tool: 'focus', op: { kind: 'distractions', closed: [], all: DISTRACTORS } };
      }
      const names = running.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n);
      return { text: 'Deep work mode: I will close **' + names.join(', ') + '**' + (withFocus ? ' and start a ' + min + '-minute focus session' : '') + '. Unsaved chats/music will stop.', op: { kind: 'distractions', closed: running, all: DISTRACTORS }, confirm: { yes: withFocus ? 'CLOSE & FOCUS' : 'CLOSE THEM', no: 'CANCEL', onConfirm: async () => {
        const shut = [];
        for (const k of running) { toolStep('closeApplication → ' + k); const c = await callTool('/tool/closeApplication', { app: k }); if (c && c.success) shut.push(k); }
        if (shut.length) Undo.push('closed ' + shut.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n).join(', '), async () => {
          for (const k of shut) { const x = await callTool('/tool/openApplication', { app: k }); if (x.error) throw new Error(x.error); }
          return 'Opened ' + shut.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n).join(', ') + ' again (unsaved work in them can’t come back).';
        });
        if (withFocus) { startFocus(min); Undo.push('started a ' + min + '-minute focus session', () => stopFocus(true) ? 'Focus session stopped.' : 'That focus session had already ended.'); }
        jarvisSay({ text: 'Closed ' + names.join(', ') + '.' + (withFocus ? ' Focus session running for **' + min + ' minutes** — you have got this.' : ''), intent: 'BLOCK_DISTRACTIONS' });
      } } };
    }
    case 'SHOW_DESKTOP': toolStep('showDesktop'); await callTool('/tool/showDesktop'); return { text: 'Minimised everything.', noTTS: true, tool: 'showDesktop' };
    case 'OPEN_KNOWN_FOLDER': {
      const m = s.match(/\b(downloads|desktop|pictures|photos|music|videos)\b/);
      toolStep('openKnownFolder → ' + (m ? m[1] : '?'));
      const r = await callTool('/tool/openKnownFolder', { name: m ? m[1] : '' });
      return r.error ? { text: r.error } : { text: 'Opening your **' + r.name + '** folder.', tool: 'openKnownFolder' };
    }
    case 'BACKUP': {
      if (/\b(restore|import)\b/i.test(p.original)) return { text: 'To restore a backup: **Settings → Backup & restore → IMPORT…**, choose the file, and pick Merge or Replace. Windows Hello approves it if you turned that on.', tool: 'backup', actions: [{ label: 'OPEN SETTINGS', fn: () => { $('#settingsBtn').click(); } }] };
      return { text: 'I can save your chat, to-dos, flashcards, routines, study plans and settings to one file (no API keys). To include your API keys or to restore, use **Settings → Backup & restore**.', tool: 'backup', intent: 'BACKUP',
        actions: [{ label: 'EXPORT NOW', fn: async () => { const r = await bkExport(false, ''); jarvisSay({ text: r.error ? 'Could not export: ' + r.error : '✓ Saved **' + r.filename + '** to your Downloads. Keep it somewhere safe.', intent: 'BACKUP' }); } }] };
    }
    case 'UNDO': return { text: await runUndo(false), tool: 'undo' };
    case 'UNDO_TASK': { const m = String(p.original || '').match(/agt-\d{8}-\d{3}/i); return { text: await runUndoTask(m ? m[0].toUpperCase() : '', false), tool: 'undo', noPersona: true }; }
    case 'AGENT_INSPECT': { const m = String(p.original || '').match(/agt-\d{8}-\d{3}/i); return Agent.inspect(m ? m[0] : ''); }
    case 'REGENERATE': {
      let me = -1; for (let k = chatLog.length - 1; k >= 0; k--) if (chatLog[k].role === 'user') { me = k; break; }
      let prev = -1; for (let k = me - 1; k >= 0; k--) if (chatLog[k].role === 'user') { prev = k; break; }
      if (prev < 0) return { text: 'There’s no earlier question to answer again.' };
      const q = chatLog[prev].text;
      chatLog.splice(me, 1); deleteExchange(prev, true);
      setTimeout(() => handleUser(q, 'text'), 50);
      return { text: '🔄 Asking again: “' + (q.length > 60 ? q.slice(0, 60) + '…' : q) + '”', tool: 'regenerate', noTTS: true, noLog: true };
    }
    case 'DELETE_LAST_MSG': {
      // chatLog ends with this very command; delete the exchange before it, then this command too.
      let me = -1; for (let k = chatLog.length - 1; k >= 0; k--) if (chatLog[k].role === 'user') { me = k; break; }
      let prev = -1; for (let k = me - 1; k >= 0; k--) if (chatLog[k].role === 'user') { prev = k; break; }
      if (prev < 0) return { text: 'There’s no earlier message of yours to delete.' };
      const gone = chatLog[prev].text;
      if (me >= 0) chatLog.splice(me, 1);
      deleteExchange(prev, true);
      return { text: 'Deleted your message “' + (gone.length > 60 ? gone.slice(0, 60) + '…' : gone) + '” and my reply. Say **undo** to bring it back.', tool: 'deleteMessage', noTTS: true };
    }
    case 'TRIGGER_CREATE': {
      const t = Triggers.parseTriggerText(p.original, q => NLU.findApp(q.toLowerCase()));
      const eg = 'e.g. "when I plug in my charger, start study mode", "when I open VS Code, block distractions", "when the battery drops below 20%, run leaving" or "when I connect to Wi-Fi HomeNet, start study mode"';
      if (!t) return { text: 'I couldn’t tell what should start it, ' + Persona.sir() + ' — ' + eg + '.' };
      const nm = Triggers.routineNameFrom(t.action);
      const existing = Routines.find(nm) || Routines.find(nm + ' mode') || Routines.find(t.action);
      const steps = existing ? null : expandSteps(Routines.parseSteps(t.action));
      const known = steps && steps.length && steps.every(st => { const q = NLU.classify(NLU.normalize(st, settings.wakeWord), {}); return !(q.intent === 'CONVERSATION' || q.confidence < 0.85); });
      if (!existing && !known) return { text: 'I don’t know how to "' + t.action + '" yet. Name one of your routines (' + Routines.list().map(r => '**' + r.name + '**').join(', ') + ') or a command I understand.' };
      const app = t.when.app ? NLU.appByKey(t.when.app) : null;
      const when = Triggers.describeWhen(t.when, app && app.n);
      const doText = existing ? 'run **' + existing.name + '**' : 'do: ' + steps.join(' → ');
      return { text: 'When ' + when + ', I will ' + doText + '. Only steps that need no permission run on their own. Create this trigger?', intent: 'TRIGGER_CREATE',
        confirm: { yes: 'CREATE TRIGGER', no: 'CANCEL', onConfirm: () => {
          const r = existing || Routines.create(cap(t.action).slice(0, 40), steps);
          if (!r) return jarvisSay({ text: 'Couldn’t save that routine.', intent: 'TRIGGER_CREATE' });
          triggers.push({ id: rid(), routineId: r.id, routineName: r.name, when: t.when, label: cap(when), cooldownMin: 10, enabled: true }); saveTriggers();
          jarvisSay({ text: '✓ Trigger saved: when ' + when + ' → **' + r.name + '**. It works while JARVIS is running; if no tab is open you get a notification to open it.', intent: 'TRIGGER_CREATE', suggestions: ['List my triggers'] });
        } } };
    }
    case 'TRIGGER_LIST': {
      if (!triggers.length) return { text: 'No triggers yet. Try "when I plug in my charger, start study mode".' };
      return { text: '**Your triggers**\n' + triggers.map((t, i) => (i + 1) + '. ' + t.label + ' → **' + t.routineName + '**' + (t.enabled === false ? ' _(off)_' : '')).join('\n'), tool: 'triggers' };
    }
    case 'TRIGGER_DELETE': {
      const low = p.original.toLowerCase();
      if (!triggers.length) return { text: 'You have no triggers.' };
      if (/\ball\b|\bevery\b/.test(low)) return { text: 'Delete all ' + plural(triggers.length, 'trigger') + '?', confirm: { yes: 'DELETE ALL', no: 'KEEP', onConfirm: () => { const n = triggers.length; triggers = []; saveTriggers(); jarvisSay({ text: 'Deleted ' + plural(n, 'trigger') + '.', intent: 'TRIGGER_DELETE' }); } } };
      const num = low.match(/\b(\d{1,2})\b/);
      let hits = num ? [triggers[+num[1] - 1]].filter(Boolean) : triggers.filter(t => (t.label + ' ' + t.routineName).toLowerCase().split(/\W+/).some(w => w.length > 3 && low.includes(w)));
      if (hits.length !== 1) return { text: (hits.length ? 'Which one? ' : 'Which trigger should I delete? ') + '\n' + triggers.map((t, i) => (i + 1) + '. ' + t.label + ' → ' + t.routineName).join('\n') + '\nSay "delete trigger 2".' };
      undoRemoved('deleted trigger', () => triggers, v => { triggers = v; }, saveTriggers, removedFrom(triggers, t => t !== hits[0]));
      triggers = triggers.filter(t => t !== hits[0]); saveTriggers();
      return { text: 'Deleted the trigger: ' + hits[0].label + ' → ' + hits[0].routineName + '.', tool: 'triggers' };
    }
    case 'STUDY_PLAN': {
      const raw = p.original;
      const low = raw.toLowerCase();
      const head = low.split(/topics?\b|:/)[0];
      const when = NLU.parseDate(head.replace(/\bexam\b|\btest\b/g, ' '));
      const tm = raw.match(/topics?\s*(?:are|is|:|-)?\s*(.+)$/i) || raw.match(/:\s*(.+)$/);
      const topics = Study.parseTopics(tm ? tm[1] : '');
      const nm = (raw.match(/\b(?:for|my)\s+(?:the\s+|my\s+)?([A-Za-z][\w+#. -]{1,30}?)\s+(?:exam|test|prep|preparation|revision)\b/i) || raw.match(/\bplan\s+(?:my\s+|the\s+)?([A-Za-z][\w+#. -]{1,30}?)\s+(?:prep|preparation|exam|revision)\b/i) || [])[1];
      const name = cap((nm || 'Exam').replace(/^(a|an|the|my)\s+/i, '').trim());
      const eg = 'e.g. "plan my GATE prep, exam on 12 Feb, topics: OS, DBMS, CN" (add ":3" after a topic that needs 3× the time)';
      if (!when) return { text: 'When is the exam? Tell me the date and your topics — ' + eg + '.' };
      if (!topics.length) return { text: 'Which topics should I plan for? ' + eg + '.' };
      const plan = Study.buildStudyPlan({ topics, examDate: when });
      if (!plan.days.length) return { text: cap(plan.warnings[0] || 'I couldn’t build a plan from that') + '. ' + eg + '.' };
      toolStep('studyPlan → ' + name + ' · ' + plan.days.length + ' days');
      const rec = { id: rid(), name, examDate: Study.ymd(when), days: plan.days.map(d => ({ ...d, done: false })) };
      studyPlans = studyPlans.filter(x => x.name.toLowerCase() !== name.toLowerCase()); studyPlans.push(rec); saveStudyPlans();
      const dl = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const shown = plan.days.slice(0, 10).map(d => '- **' + dl(d.date) + '** — ' + d.topic).join('\n');
      const more = plan.days.length > 10 ? '\n- …and ' + (plan.days.length - 10) + ' more days (see **Tasks → Progress**)' : '';
      const future = plan.days.filter(d => new Date(d.date + 'T08:00:00').getTime() > Date.now() + 6e4);
      return { text: '**Study plan — ' + name + '** · exam ' + dl(rec.examDate) + ' · ' + plural(plan.days.length, 'day') + ' to prepare\n' + shown + more + (plan.warnings.length ? '\n\n⚠ ' + plan.warnings.join(' ') : '') + '\n\nSaved. Want a reminder each morning at 8?',
        speak: 'I planned ' + plural(plan.days.length, 'day') + ' of study for ' + name + '.', tool: 'studyPlan', intent: 'STUDY_PLAN',
        suggestions: ['Make flashcards on ' + topics[0].name, 'What should I study today?'],
        actions: future.length ? [{ label: 'ADD ' + Math.min(future.length, 90) + ' REMINDERS', fn: () => {
          let n = 0; for (const d of future.slice(0, 90)) { reminders.push({ id: rid(), text: '📚 Study: ' + d.topic + ' (' + name + ')', at: new Date(d.date + 'T08:00:00').getTime(), fired: false }); n++; }
          saveTasks(); askNotify();
          jarvisSay({ text: '✓ Added ' + plural(n, 'reminder') + ' — one each morning at 8. They reach your phone too if Phone alerts are on.', intent: 'STUDY_PLAN' });
        } }] : undefined };
    }
    case 'STUDY_TODAY': {
      const plan = studyPlans.filter(x => x.examDate >= Study.ymd(new Date())).sort((x, y) => x.examDate < y.examDate ? -1 : 1)[0];
      if (!plan) return executeTool({ ...p, intent: 'PLAN_DAY' }, raw);
      const t = Study.ymd(new Date()), day = plan.days.find(d => d.date === t);
      const done = plan.days.filter(d => d.done).length, dleft = Study.daysBetween(new Date(), new Date(plan.examDate + 'T00:00:00'));
      const next = plan.days.find(d => d.date > t);
      return { text: '**' + plan.name + '** — exam in ' + plural(dleft, 'day') + ' · ' + done + '/' + plan.days.length + ' days done\n' + (day ? '- **Today:** ' + day.topic + (day.done ? ' ✓' : '') : '- Nothing planned for today.') + (next ? '\n- **Next:** ' + next.topic : ''),
        speak: day ? 'Today: ' + day.topic + '. Your exam is in ' + plural(dleft, 'day') + '.' : 'Nothing is planned for today.', tool: 'studyToday', intent: 'STUDY_TODAY',
        suggestions: day && !day.done ? ['Start a focus session on ' + day.topic.replace(/ \(\d+\/\d+\)$/, '').split(/[:+,]/)[0].trim()] : undefined,
        actions: day && !day.done ? [{ label: 'MARK TODAY DONE', fn: () => { day.done = true; saveStudyPlans(); sfx.ok(); jarvisSay({ text: '✓ Marked today done. ' + (done + 1) + '/' + plan.days.length + ' days complete.', intent: 'STUDY_TODAY' }); } }] : undefined };
    }
    case 'WEEK_REPORT': {
      const w = Study.weekSummary(stats, sessions, todayKey());
      if (!w.any) return { text: 'Nothing logged in the last 7 days yet. Start a focus session or tick off a to-do, and I’ll track it here.', suggestions: ['Start a focus session'] };
      return { text: '**Your week**\n' + w.lines.map(l => '- ' + l).join('\n') + '\n\nThe chart is under **Tasks → Progress**.', card: [['STREAK', w.totals.streak + ' days'], ['FOCUS', Study.fmtMin(w.totals.focusMin)]], tool: 'weekReport', intent: 'WEEK_REPORT',
        speak: 'This week you focused for ' + Study.fmtMin(w.totals.focusMin) + ' and finished ' + plural(w.totals.todos, 'task') + '. Your streak is ' + plural(w.totals.streak, 'day') + '.' };
    }
    case 'PRODUCTIVITY_REPORT': {
      const st = stats[todayKey()] || {};
      const pend = todos.filter(t => !t.done).length;
      const due = deadlines.filter(d => !d.done && d.due > Date.now() && d.due - Date.now() < 3 * 864e5);
      const fm = st.focusMin || 0;
      const score = Math.min(100, Math.round(fm * 0.8 + (st.todosDone || 0) * 8 + (st.deadlinesDone || 0) * 15 + (st.codeRuns || 0) * 2 + (st.filesSaved || 0) * 2));
      const verdict = score >= 70 ? 'Excellent day. 🔥' : score >= 35 ? 'Solid progress.' : score > 0 ? 'A start — one focus session would make a big difference.' : 'Nothing logged yet today. Want to start a focus session?';
      return {
        text: '**Today so far** — ' + verdict + '\n- Focused for **' + (fm >= 60 ? Math.floor(fm / 60) + 'h ' + fm % 60 + 'm' : fm + ' min') + '** (' + plural(st.focusSessions || 0, 'session') + ')\n- Completed **' + plural(st.todosDone || 0, 'to-do') + '** and **' + plural(st.deadlinesDone || 0, 'deadline') + '**\n- Asked the AI **' + plural(st.aiQuestions || 0, 'question') + '**, saved **' + plural(st.filesSaved || 0, 'file') + '**, ran code **' + plural(st.codeRuns || 0, 'time') + '**\n' + (pend ? '- Still on your list: ' + pend + '\n' : '') + (due.length ? '- ⚠ Due soon: ' + due.map(d => d.title + ' (' + dueLabel(d.due) + ')').join(', ') : ''),
        card: [['SCORE', score + ' / 100']], suggestions: score < 35 ? ['Block distractions', 'Start a focus session'] : null, tool: 'report',
        speak: verdict.replace('🔥', '') + ' You focused for ' + fm + ' minutes and finished ' + plural(st.todosDone || 0, 'task') + '.'
      };
    }
    case 'UNIT_CONVERT': {
      const r = NLU.convertUnits(s);
      if (!r) return { askLLM: true };
      if (r.error) return { text: r.error };
      toolStep('convert');
      const U = { c: '°C', '°c': '°C', celsius: '°C', 'degrees celsius': '°C', centigrade: '°C', f: '°F', '°f': '°F', fahrenheit: '°F', 'degrees fahrenheit': '°F', k: 'K', kelvin: 'K' };
      const from = U[r.from] || r.from, to = U[r.to] || r.to;
      return { text: '**' + r.value + ' ' + from + ' = ' + r.result.toLocaleString() + ' ' + to + '**', speak: r.value + ' ' + r.from + ' is ' + r.result + ' ' + r.to, tool: 'convert' };
    }
    case 'CREATE_FOLDER': {
      const m = p.original.match(/(?:called|named)\s+["']?([\w\- .\/]+?)["']?\s*$/i) || p.original.match(/(?:folder|directory)\s+["']?([\w\- .\/]+?)["']?\s*$/i);
      const name = a.name || (m ? m[1].trim() : '');
      if (!name) return { text: 'What should I name the folder?' };
      toolStep('createFolder → ' + name);
      const r = await callTool('/tool/createFolder', { name });
      if (r.error) return { text: 'Could not create it: ' + r.error };
      if (!r.existed) Undo.push('created folder ' + r.name, async () => { const x = await callTool('/tool/undoCreate', { name: r.name }); if (x.error) throw new Error(x.error); return 'Removed the folder `' + r.name + '` (it’s in the trash).'; });
      return { text: r.existed ? 'The folder `' + r.name + '` already exists.' : 'Created folder `~/jarvis/' + r.name + '`.', suggestions: ['Open my ' + r.name + ' folder'], tool: 'createFolder', op: { kind: 'file', name: r.name, existed: !!r.existed } };
    }
    case 'RENAME_FILE': {
      const m = p.original.match(/rename\s+(?:the\s+)?(?:file\s+|folder\s+)?["']?(.+?)["']?\s+(?:to|as)\s+["']?(.+?)["']?$/i);
      if (!m) return { text: 'Say it like: "rename notes.md to dsa-notes.md".' };
      toolStep('renameFile');
      const r = await callTool('/tool/renameFile', { oldName: m[1], newName: m[2] });
      if (!r.error) Undo.push('renamed ' + r.from, async () => { const x = await callTool('/tool/undoMove', { from: r.from, to: r.to }); if (x.error) throw new Error(x.error); return 'Renamed it back to `' + x.name + '`.'; });
      return r.error ? { text: 'Rename failed: ' + r.error } : { text: 'Renamed `' + r.from + '` → `' + r.to + '`.', tool: 'renameFile' };
    }
    case 'COPY_FILE':
    case 'MOVE_FILE': {
      const verb = p.intent === 'COPY_FILE' ? 'copy' : 'move';
      const m = p.original.match(/(?:copy|duplicate|move)\s+(?:the\s+)?(?:file\s+)?["']?(.+?)["']?\s+(?:to|into)\s+(?:the\s+|my\s+)?["']?(.+?)["']?(?:\s+folder)?$/i);
      if (!m) return { text: 'Say it like: "' + verb + ' notes.md to Projects".' };
      toolStep(verb + 'File');
      const r = await callTool('/tool/' + verb + 'File', { src: m[1], dest: m[2] });
      if (!r.error) Undo.push((verb === 'copy' ? 'copied ' : 'moved ') + r.from, async () => {
        const x = verb === 'copy' ? await callTool('/tool/undoCreate', { name: r.to }) : await callTool('/tool/undoMove', { from: r.from, to: r.to });
        if (x.error) throw new Error(x.error);
        return verb === 'copy' ? 'Removed the copy `' + r.to + '` (it’s in the trash).' : 'Moved it back to `' + x.name + '`.';
      });
      return r.error ? { text: cap(verb) + ' failed: ' + r.error } : { text: (verb === 'copy' ? 'Copied' : 'Moved') + ' `' + r.from + '` → `' + r.to + '`.', tool: verb + 'File' };
    }
    case 'ASK_FILES': {
      const q = (a.query || p.original || s).trim();
      setState('PROCESSING', 'Searching your files…'); toolStep('ragSearch → ' + q.slice(0, 60));
      // the file being asked about: a quoted name ("10. Numpy.pdf") or a name without spaces (numpy-notes.pdf)
      const fileM = q.match(/["“']([^"”']+?\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))["”']/i) || q.match(/(?:^|[\s(])([\w().-]+\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))\b/i);
      const oneFile = fileM ? fileM[1].trim() : '';
      const r = await callTool('/rag/search', { query: q, k: 5, file: oneFile || undefined });
      if (r.error) return { text: cap(r.error) + '.' };
      if (!r.results.length && oneFile) return { text: 'I couldn’t find **' + oneFile + '** in ~/jarvis or your project folders. Drop it into JARVIS (or 📎) and ask again.', tool: 'ragSearch' };
      if (!r.results.length) return { text: 'I couldn’t find anything about that in your files (I searched ' + plural(r.files, 'file') + ' in ~/jarvis and your project folders). Try different words, or add the folder in Settings → Project folders.', tool: 'ragSearch' };
      ctx.lastFile = r.results[0].file; // so "open it in VS Code" follows up
      const where = x => x.page ? 'page ' + x.page : 'lines ' + x.start + '–' + x.end;
      const ref = r.results.map((x, i) => (i + 1) + '. ' + x.file + ' (' + where(x) + ')');
      const sources = '\n\n**Sources**\n' + ref.join('\n');
      if (!llmReady()) return { text: 'The best matches in your files for **' + q.slice(0, 80) + '**:\n\n' + r.results.map((x, i) => '**' + ref[i] + '**\n```\n' + x.text.slice(0, 500) + '\n```').join('\n\n'), tool: 'ragSearch' };
      const snippets = r.results.map((x, i) => '[' + (i + 1) + '] ' + x.file + ' (' + where(x) + ')\n' + x.text).join('\n\n---\n\n');
      const cloudNote = isCloudModel(llm.model) ? '\n\n⚠ These snippets from your files were sent to ' + modelInfo(llm.model).providerLabel + ' to write this answer.' : '';
      return { askLLM: 'Question: ' + q + '\n\nAnswer using ONLY these excerpts from the user’s own files. List EVERY relevant item the excerpts contain, with its specific detail (e.g. each method with what it does, each definition, each step) — if several excerpts are relevant, use all of them; never answer with just one item or a vague one-line summary. Cite them inline like [1] or [2]. If they do not contain the answer, say so plainly. Use short bullet points.' + (Lang.aiInEnglish() ? '' : { te: ' Write the answer in Telugu (keep technical terms, names and numbers in English).', kn: ' Write the answer in Kannada (keep technical terms, names and numbers in English).' }[Lang.replyLang()] || '') + '\n\n' + snippets,
        noHistory: true,
        after: { sources: sources + cloudNote, suggestions: /.pdf$/i.test(r.results[0].file) ? ['Open ' + r.results[0].file.split('/').pop(), 'Make flashcards from ' + r.results[0].file.split('/').pop()] : ['Open it in VS Code'] } };
    }
    case 'SEARCH_FILES': {
      const q = s.replace(/\b(find|search( for)?|locate|where is|the|my|file|files|folder|document|note|named|called|in|sandbox)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (!q) return { text: 'What file name should I look for?' };
      toolStep('searchFiles → ' + q);
      const r = await callTool('/tool/searchFiles', { query: q });
      if (r.error) return { text: r.error };
      if (!r.results.length) return { text: 'No files matching "' + q + '" in ~/jarvis.' };
      return { text: 'Found ' + r.results.length + (r.results.length === 1 ? ' match' : ' matches') + ':\n' + r.results.slice(0, 10).map(x => '- `' + x + '`').join('\n'), speak: 'I found ' + r.results.length + ' matches.', tool: 'searchFiles' };
    }
    case 'LIST_FILES': {
      const m = s.match(/\bin (?:the |my )?([\w\- ]+?)(?: folder)?$/);
      toolStep('listFiles');
      const r = await callTool('/tool/listFiles', { dir: m && !/sandbox|jarvis/.test(m[1]) ? m[1] : '' });
      const shown = r => r.error ? { text: r.error } : { text: '**' + (r.dir === '~/jarvis' ? backend.sandbox : r.dir) + '**\n' + (r.folders.map(f => '- 📁 ' + f).concat(r.files.map(f => '- 📄 ' + f)).join('\n') || '_(empty)_') + (r.projects && r.projects.length ? '\n\n**Project folders:** ' + r.projects.map(x => '`' + x + '`').join(', ') + ' — say "list files in ' + r.projects[0] + '"' : ''), speak: plural(r.folders.length, 'folder') + ' and ' + plural(r.files.length, 'file') + '.', tool: 'listFiles' };
      return pickPlace(r, m && m[1], async x => shown(await callTool('/tool/listFiles', { dir: x }))) || shown(r);
    }
    case 'READ_FILE': {
      const m = s.match(/(?:read|open|show|display|what'?s in)(?: me)?(?: the| my)?\s+(.+?)(?:\s+(?:file|note|notes|document))?$/);
      let name = a.name || (m ? m[1].trim() : '');
      if (/^(it|that|this)$/.test(name) || !name) name = ctx.lastFile || 'notes';
      if (/^(notes?|my notes)$/.test(name)) name = 'notes.md';
      // "open lecture3.pdf" opens the PDF itself (in your PDF viewer); "read …" shows its text
      if (/\.pdf$/i.test(name) && /^(?:open|show)\b/.test(s)) {
        toolStep('openFile → ' + name);
        const opened = o => {
          if (o.error) return { text: cap(o.error) + '.', suggestions: ['List my files'] };
          ctx.lastFile = o.name;
          return { text: 'Opening **' + o.name + '**.', suggestions: ['Summarise ' + o.name.split(/[\\/]/).pop(), 'Make flashcards from ' + o.name.split(/[\\/]/).pop()], tool: 'openFile' };
        };
        const o = await callTool('/tool/openFile', { name });
        return pickPlace(o, name, async x => opened(await callTool('/tool/openFile', { name: x }))) || opened(o);
      }
      toolStep('readFile → ' + name);
      const shown = r => {
        if (r.error) return { text: /not found|can.t find|couldn.t find/i.test(r.error) ? 'I could not find "' + name + '" in ~/jarvis, your project folders or the usual places on this laptop.' : cap(r.error) + '.', suggestions: ['List my files'] };
        ctx.lastFile = r.name;
        const ext = (r.name.split('.').pop() || '').toLowerCase();
        const body = ext === 'md' ? r.content : '```' + ext + '\n' + r.content + '\n```';
        return { op: { kind: 'file', name: r.name }, text: '**' + r.name + '**\n\n' + (r.content.trim() ? body.slice(0, 6000) : '_(empty file)_'), speak: 'Here is ' + r.name.split(/[\\/]/).pop() + '.', suggestions: llmReady() && r.content.length > 200 ? ['Summarise that file'] : null, tool: 'readFile' };
      };
      const r = await callTool('/tool/readFile', { name });
      return pickPlace(r, name, async x => shown(await callTool('/tool/readFile', { name: x }))) || shown(r);
    }
    case 'OPEN_FOLDER': {
      const m = s.match(/open\s+(?:up\s+)?(?:my\s+|the\s+)?(.+?)\s*(?:folder|directory)?$/);
      let name = a.name || (m ? m[1].replace(/\b(folder|directory)\b/g, '').trim() : '');
      if (/^(sandbox|jarvis|jarvis sandbox|files)$/.test(name)) name = '';
      toolStep('openFolder → ' + (name || '~/jarvis'));
      const shown = r => r.error ? { text: cap(r.error) + '.', suggestions: ['Create a folder called ' + name] } : { text: 'Opening `' + r.name + '` in your file explorer.', tool: 'openFolder' };
      const r = await callTool('/tool/openFolder', { name });
      return pickPlace(r, name, async x => shown(await callTool('/tool/openFolder', { name: x }))) || shown(r);
    }

    /* ---- git / dev ---- */
    case 'GIT_STATUS': { toolStep('gitStatus'); const r = await callTool('/tool/gitStatus'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: '```text\n' + r.output + '\n```', speak: r.output === 'Working tree clean' ? 'Working tree is clean.' : 'Here is the git status.', tool: 'gitStatus' }; }
    case 'GIT_LOG': { toolStep('gitLog'); const r = await callTool('/tool/gitLog'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: 'Recent commits:\n```text\n' + r.output + '\n```', speak: 'Here are the recent commits.', tool: 'gitLog' }; }
    case 'GIT_DIFF': { toolStep('gitDiff'); const r = await callTool('/tool/gitDiff'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: '```text\n' + r.output + '\n```', speak: 'Here is what changed.', tool: 'gitDiff' }; }
    case 'GIT_COMMIT': {
      const m = p.original.match(/(?:message|saying|with|:)\s+["']?(.+?)["']?$/i);
      if (!m) { ctx.pending = { intent: 'GIT_COMMIT' }; return { text: 'What commit message should I use?' }; }
      return { text: 'Commit **all** changes with message "' + m[1] + '"?', confirm: { yes: 'COMMIT', no: 'CANCEL', onConfirm: async () => {
        toolStep('gitCommit'); const r = await callTool('/tool/gitCommit', { message: m[1] });
        jarvisSay({ text: r.error ? 'Commit failed: ' + r.error : 'Committed.\n```text\n' + r.output + '\n```', intent: 'GIT_COMMIT' });
      } } };
    }
    case 'CHECK_PORT': {
      const m = s.match(/\b(\d{2,5})\b/);
      if (!m) return { text: 'Which port should I check?' };
      toolStep('checkPort → ' + m[1]);
      const r = await callTool('/tool/checkPort', { port: +m[1] });
      return r.error ? { text: r.error } : { text: 'Port **' + m[1] + '** is ' + (r.inUse ? 'in use.' : 'free.'), tool: 'checkPort' };
    }

    /* ---- briefing ---- */
    case 'BRIEFING': {
      toolStep('dailyBriefing');
      const d = new Date(), nm = memGet('name');
      const parts = [Persona.greeting(d.getHours()).replace(/[.?!]$/, '') + '. It is **' + fmtTime(d) + '** on ' + d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '. Here is where things stand:'];
      if (settings.online) { const w = await fetchWeather(''); if (!w.error) parts.push('**Weather** — ' + w.tempC + '°C, ' + w.desc.toLowerCase() + ' in ' + w.place + '.' + (w.rainChance >= 50 ? ' Take an umbrella.' : '')); }
      const today = classes.filter(c => c.day === d.getDay()).map(c => ({ c, at: new Date(new Date().setHours(c.h, c.m, 0, 0)) })).filter(x => x.at > d).sort((x, y) => x.at - y.at);
      if (classes.length) parts.push('**Classes** — ' + (today.length ? today.map(x => x.c.name + ' at ' + fmtTime(x.at)).join(', ') : 'none left today') + '.');
      const due = deadlines.filter(x => !x.done && x.due > Date.now() && x.due - Date.now() < 7 * 864e5).sort((x, y) => x.due - y.due);
      if (due.length) parts.push('**Due soon** — ' + due.map(x => x.title + ' (' + dueLabel(x.due) + ')').join(', ') + '.');
      const pend = todos.filter(t => !t.done);
      parts.push(pend.length ? '**To-do** — ' + plural(pend.length, 'item') + '; first up: "' + pend[0].text + '".' : '**To-do** — list is clear.');
      const rs = reminders.filter(r => !r.fired && r.at - Date.now() < 864e5);
      if (rs.length) parts.push('**Reminders** — ' + rs.map(r => r.text + ' at ' + fmtTime(r.at)).join(', ') + '.');
      await refreshSystem();
      parts.push('**System** — CPU ' + sys.cpu + '%, RAM ' + sys.ram + '%, ' + sys.diskFree + ' GB free.');
      return { text: parts.join('\n'), tool: 'dailyBriefing' };
    }

    /* ---- web: open best page / research ---- */
    case 'OPEN_WEB': {
      let q = keepCase(p, a.query || s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me)\s+(up\s+)?(the\s+|my\s+)?/, ''));
      if (q === q.toUpperCase()) q = q.toLowerCase();
      // A site JARVIS already knows ("smart india hackathon website" → sih.gov.in) opens directly — no search.
      const bare = NLU.bareSiteName(q), known = NLU.findSite(bare);
      if (known && known.names.includes(bare)) return openSite(known);
      setState('EXECUTING', 'Finding the best page…'); toolStep('webSearch → ' + q);
      let r = await callTool('/tool/webSearch', { q });
      if (!r.results || !r.results[0]) return openSite(NLU.SITES[1], q);
      // Open the result that best matches what you asked for (NLU.bestResult) — "atria university" is Atria University,
      // not the first page that merely says "Atria". If nothing mentions the name, search once more for just the name
      // ("reva university website" → "reva university"), then ask rather than open a wrong page.
      let top = NLU.bestResult(r.results, q);
      if (!top && bare && bare !== q.toLowerCase()) {
        toolStep('webSearch → ' + bare);
        const r2 = await callTool('/tool/webSearch', { q: bare });
        const t2 = r2.results && NLU.bestResult(r2.results, bare);
        if (t2) { r = r2; top = t2; }
      }
      if (!top) return { text: 'I searched for **' + q + '**, but none of the top results look like it. Which one did you mean?\n\n' + r.results.slice(0, 3).map((x, i) => (i + 1) + '. [' + x.title + '](' + x.url + ')').join('\n'),
        actions: r.results.slice(0, 3).map((x, i) => ({ label: 'OPEN ' + (i + 1), fn: () => callTool('/tool/openUrl', { url: x.url }) })), suggestions: ['Search Google for ' + q], tool: 'openWeb' };
      toolStep('openUrl → ' + top.url);
      const o = await callTool('/tool/openUrl', { url: top.url });
      if (o.error) return { text: 'I found it but could not open the browser: ' + o.error };
      const host = new URL(top.url).hostname.replace(/^www\./, '');
      const others = r.results.filter(x => x !== top).slice(0, 3);
      return { text: 'Opening **' + top.title + '** (' + host + ')' + (others.length ? '\n\nOther matches:\n' + others.map(x => '- [' + x.title + '](' + x.url + ')').join('\n') : ''),
        speak: 'Opening ' + top.title.split(/\s[|\-–:]\s/)[0].trim() + '.', suggestions: ['Search Google for ' + q, 'Search the web for ' + q], tool: 'openWeb' };
    }
    case 'HACKATHONS':
    case 'RESEARCH': {
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const q = a.query || (p.intent === 'HACKATHONS' ? 'upcoming hackathons India ' + month + ' students'
        : keepCase(p, s.replace(/^(search|look up|check|google) (the )?(web|internet|online)( for| about)?\s+|^(research|investigate)\s+(about\s+|on\s+)?|^.*?\bwhat does the (web|internet) say about\s+|\s*(and )?(tell me|summari[sz]e it|explain it)$/g, '').trim()) || s);
      const extra = p.intent === 'HACKATHONS' ? ['Open Unstop', 'Open Devfolio', 'Open Devpost', 'Open SIH'] : null;
      if (!settings.online) return { text: 'Searching the web and reading pages needs **Online tools**, which are off.', actions: enableOnlineAction(), suggestions: ['Search Google for ' + q].concat(extra || []) };
      return doResearch(q, extra);
    }

    /* ---- contests ---- */
    case 'CONTESTS':
    case 'CONTEST_REMIND': {
      if (!settings.online) return { text: 'Contest schedules come from Codeforces, LeetCode and CodeChef, so I need **Online tools** on.', actions: enableOnlineAction() };
      setState('EXECUTING', 'Checking contest calendars…'); toolStep('contests');
      const r = await callTool('/tool/contests', { online: true });
      if (r.error) return { text: r.error };
      let list = r.contests || [];
      const plat = a.platform && a.platform !== 'all' ? String(a.platform).toLowerCase() : (s.match(/\b(codeforces|leetcode|codechef)\b/) || [])[1];
      if (plat) list = list.filter(c => c.platform.toLowerCase() === plat);
      const day = d => new Date(d).toDateString();
      if (/\btoday\b|\btonight\b/.test(s)) list = list.filter(c => day(c.start) === day(Date.now()));
      else if (/\btomorrow\b/.test(s)) list = list.filter(c => day(c.start) === day(Date.now() + 864e5));
      else if (/\bthis week\b/.test(s)) list = list.filter(c => c.start - Date.now() < 7 * 864e5);
      const name = plat ? cap(plat === 'leetcode' ? 'LeetCode' : plat === 'codechef' ? 'CodeChef' : plat) + ' ' : '';
      if (!list.length) return { text: 'No upcoming ' + name + 'contests found for that time.' + (r.failed && r.failed.length ? ' (Could not reach ' + r.failed.join(', ') + '.)' : '') };
      if (p.intent === 'CONTEST_REMIND') {
        const c = list[0];
        if (reminders.some(x => x.contestUrl === c.url && !x.fired)) return { text: 'You already have a reminder for **' + c.name + '**.' };
        const at = Math.max(c.start - 15 * 6e4, Date.now() + 6e4);
        reminders.push({ id: rid(), text: c.name + ' (' + c.platform + ') starts at ' + fmtTime(c.start) + ' — ' + c.url, at, fired: false, contestUrl: c.url }); saveTasks(); askNotify();
        return { text: '✓ I will remind you 15 minutes before **[' + c.name + '](' + c.url + ')** — ' + c.platform + ', ' + fmtDay(c.start) + ' at ' + fmtTime(c.start) + '.', speak: 'Reminder set for ' + c.name + ', ' + fmtDay(c.start) + ' at ' + fmtTime(c.start) + '.', tool: 'contests' };
      }
      const dur = m => m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0) + 'h' : m + 'm';
      const rows = list.slice(0, 8).map(c => '- **' + c.platform + '** · [' + c.name + '](' + c.url + ') — ' + fmtDay(c.start) + ' ' + fmtTime(c.start) + ' · ' + dur(c.durationMin));
      const next = list[0];
      return { text: 'Upcoming ' + name + 'contests:\n' + rows.join('\n'), speak: 'Next up is ' + next.name + ' on ' + next.platform + ', ' + fmtDay(next.start) + ' at ' + fmtTime(next.start) + '.',
        suggestions: ['Remind me about the next ' + next.platform + ' contest'], tool: 'contests' };
    }

    /* ---- study from notes ---- */
    case 'SUMMARISE_FILE': {
      let name = a.name || extractFileName(p.original);
      if (!name || /^(it|that|this|file|notes)$/i.test(name)) name = /\b(that file|it|this file)\b/.test(s) && ctx.lastFile ? ctx.lastFile : /\bnotes\b/.test(s) ? 'notes.md' : '';
      if (!name) return { text: 'Which file should I summarise?', suggestions: ['List my files'] };
      toolStep('readFile → ' + name);
      const r = await callTool('/tool/readFile', { name });
      if (r.error) return { text: /not found/i.test(r.error) ? 'I could not find "' + name + '" in ~/jarvis or your project folders.' : cap(r.error) + '.', suggestions: ['List my files'] };
      ctx.lastFile = r.name;
      if (!r.content.trim()) return { text: '`' + r.name + '` is empty.' };
      if (!llmReady()) return { text: 'Summaries need my AI brain. Here is the start of `' + r.name + '`:\n```\n' + r.content.slice(0, 800) + '\n```' };
      return { noHistory: true, askLLM: 'Summarise my file "' + r.name + '" for a student: one-line overview, then the key points as bullets, then "Remember for exams:" with 2-4 items if relevant. Only use what is in the file.\n\n```\n' + r.content.slice(0, 12000) + '\n```',
        after: { suggestions: ['Make flashcards from ' + r.name.split('/').pop()] } };
    }
    case 'FLASH_MAKE': {
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write flashcards.' };
      // Only treat it as a file when it looks like one ("x.md") or follows "from" ("from os-notes").
      const fname = a.name || (p.original.match(/([\w\-.\/\\:]+\.[a-z0-9]{1,5})\b/i) || [])[1]
        || ((p.original.match(/\bfrom\s+(?:my\s+|the\s+)?["']?([\w\-]+)["']?\s*$/i) || [])[1] || '').replace(/^(that|this|it|answer)$/i, '');
      let source = '', deck = '';
      if (fname && !/^(that|this|it|flashcards?)$/i.test(fname)) {
        toolStep('readFile → ' + fname);
        const r = await callTool('/tool/readFile', { name: fname });
        if (r.error) return { text: 'I could not find "' + fname + '".', suggestions: ['List my files'] };
        source = r.content; deck = r.name.split('/').pop().replace(/\.[^.]+$/, '');
      } else if (/\b(from|of) (that|this|it|the (last )?answer)\b/.test(s)) {
        source = lastAnswer(); deck = 'Chat ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      } else {
        const t = (s.match(/flash ?cards? (?:on|about|for|of) (.+)$/) || s.match(/(?:make|create|generate|build) (?:me )?(?:some )?(.+?) flash ?cards?/) || [])[1];
        if (t && !/^(some|a set of|my)$/.test(t)) deck = cap(keepCase(p, t));
      }
      if (!source && !deck) return { text: 'What should the flashcards cover? e.g. "make flashcards from os-notes.md" or "make flashcards on deadlocks".' };
      if (source && !source.trim()) return { text: 'That file is empty.' };
      return { askLLM: (source ? 'Create 8-12 study flashcards from the material below.' : 'Create 10 study flashcards on: ' + deck + '.')
        + ' Output ONLY lines in exactly this format, one card per line, and nothing else:\nQ: <question> || A: <short answer>' + (source ? '\n\nMaterial:\n' + source.slice(0, 10000) : ''), after: { flashDeck: deck } };
    }
    case 'FLASH_REVIEW': {
      const m = s.match(/\b(?:review|quiz me(?: on)?|test me(?: on)?|practice|study|revise|drill)(?: my| the)?\s+([\w-]+(?:\s[\w-]+){0,2}?)\s+flash ?cards?/);
      return startFlashReview(a.deck || (m ? m[1] : ''));
    }
    case 'FLASH_ANSWER': return flashAnswer(a.id, a.answer || '');
    case 'FLASH_LIST': {
      switchTab('memory');
      const decks = flashDecks();
      if (!decks.length) return { text: 'You have no flashcards yet. Try "make flashcards from os-notes.md" or "make flashcards on normalization".' };
      return { text: 'Your decks:\n' + decks.map(d => '- **' + d.name + '** — ' + plural(d.count, 'card') + (d.due ? ', **' + d.due + ' due**' : '')).join('\n'), suggestions: decks.some(d => d.due) ? ['Review my flashcards'] : null };
    }
    case 'FLASH_DELETE': {
      const m = s.match(/(?:delete|remove|clear)(?: the| my| all)?\s+([\w-]+(?:\s[\w-]+){0,2}?)\s+(?:flash ?cards?|deck)/);
      const q = m && !/^(my|all|the)$/.test(m[1]) ? m[1] : '';
      const decks = flashDecks();
      const d = q ? decks.find(x => x.name.toLowerCase().includes(q)) : null;
      if (!d && q) return { text: 'No deck matches "' + q + '".' };
      const target = d ? d.name : null;
      const n = target ? flashcards.filter(c => c.deck === target).length : flashcards.length;
      if (!n) return { text: 'There are no flashcards to delete.' };
      return { text: 'Delete ' + plural(n, 'flashcard') + (target ? ' in **' + target + '**' : ' (all decks)') + '?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('deleted flashcards', () => flashcards, v => { flashcards = v; }, saveFlash, removedFrom(flashcards, c => target && c.deck !== target));
        flashcards = target ? flashcards.filter(c => c.deck !== target) : []; saveFlash();
        jarvisSay({ text: 'Deleted.', intent: 'FLASH_DELETE' });
      }) } };
    }

    /* ---- planning ---- */
    case 'PLAN_DAY': return planDay();

    /* ---- git clone / drafting ---- */
    case 'GIT_CLONE': {
      let url = a.url || (p.original.match(/https?:\/\/\S+/) || [])[0];
      if (!url) { const m = p.original.match(/\b([\w.-]+)\/([\w.-]+)\b/); if (m && /github/i.test(p.original)) url = 'https://github.com/' + m[1] + '/' + m[2]; }
      if (!url) return { text: 'Give me the repo URL, e.g. "clone https://github.com/user/repo".' };
      setState('EXECUTING', 'Cloning repository…'); toolStep('gitClone → ' + url);
      const r = await callTool('/tool/gitClone', { url: url.replace(/[.,)]+$/, '') });
      if (r.error) return { text: 'Clone failed: ' + r.error + '.', suggestions: r.name ? ['Open ' + r.name.split('/').pop() + ' in VS Code'] : null };
      ctx.lastFile = r.name;
      return { text: '✓ Cloned into `' + r.name + '` (' + plural(r.files, 'item') + ').', speak: 'Cloned the repository.', suggestions: ['Open it in VS Code', 'List files in ' + r.name.split('/').pop()], tool: 'gitClone' };
    }
    case 'DRAFT_COPY': {
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write that.' };
      return { askLLM: (a.prompt || p.original) + '\n\n(Reply with just the requested text, ready to paste — no preamble.)', after: { copyAnswer: true } };
    }

    /* ---- routines ---- */
    case 'ROUTINE_LIST': {
      const list = Routines.list();
      switchTab('tasks');
      if (!list.length) return { text: 'You have no routines yet, ' + Persona.sir() + '.' };
      return { text: 'Your routines:\n' + list.map(r => '- **' + r.name + '** — ' + r.steps.join(' → ')).join('\n'), speak: 'You have ' + plural(list.length, 'routine') + ': ' + list.map(r => r.name).join(', ') + '.' };
    }
    case 'ROUTINE_CREATE': {
      const m = p.original.match(/routine\s+(?:called|named)\s+["']?(.+?)["']?\s*(?::|—|–|\s-\s|\bthat\b|\bwhich\b|\bto\b|\bwith\b)\s*([\s\S]+)$/i)
        || p.original.match(/^(?:create|make|save|build)(?:\s+a)?\s+(.+?)\s+routine\s*(?::|—|–|\bthat\b|\bwhich\b|\bto\b|\bwith\b)\s*([\s\S]+)$/i);
      if (!m) return { text: 'Tell me the name and the steps, ' + Persona.sir() + ' — e.g. "create a routine called exam prep: open VS Code, open LeetCode, start a focus session".' };
      const steps = expandSteps(Routines.parseSteps(m[2]));
      const known = [], unknown = [];
      for (const st of steps) {
        const q = NLU.classify(NLU.normalize(st, settings.wakeWord), {});
        (q.intent === 'CONVERSATION' || q.confidence < 0.85 ? unknown : known).push(st);
      }
      if (!known.length) return { text: 'I could not recognise any of those steps as commands: ' + unknown.join('; ') + '.' };
      const r = Routines.create(m[1], known);
      switchTab('tasks');
      return { text: '✓ Routine **' + r.name + '** saved: ' + known.join(' → ') + '.' + (unknown.length ? '\n\nSkipped (not commands I know): ' + unknown.join('; ') + '.' : ''), speak: 'Routine ' + r.name + ' saved with ' + plural(known.length, 'step') + '.', suggestions: ['Run ' + r.name, 'Run ' + r.name + ' every day at 7am'] };
    }
    case 'ROUTINE_RUN': {
      const m = s.match(/^(?:run|start|activate|execute|launch|engage|initiate)\s+(?:my\s+|the\s+)?(.+?)\s+(?:routine|protocol)$/);
      const r = Routines.find(a.name || (m ? m[1] : ''));
      if (!r) return { text: 'I have no routine called "' + (a.name || (m ? m[1] : '')) + '". Your routines: ' + Routines.list().map(x => '**' + x.name + '**').join(', ') + '.' };
      return Routines.run(r);
    }
    case 'ROUTINE_SCHEDULE': {
      const m = s.match(/^(?:run|start|schedule|do)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:routine|protocol))?\s+((?:every|each|daily|on weekdays|weekdays)\b.+)$/);
      const r = m && (Routines.find(m[1]) || Routines.find(m[1] + ' mode'));
      if (!r) return { text: 'Which routine should I schedule? Your routines: ' + Routines.list().map(x => '**' + x.name + '**').join(', ') + '.' };
      const repeat = NLU.parseRepeat(m[2]);
      if (!repeat) return { text: 'How often? e.g. "every day at 7am" or "every weekday at 8am".' };
      const at = repeatStart(repeat, m[2]);
      reminders = reminders.filter(x => x.routineId !== r.id);
      reminders.push({ id: rid(), text: 'routine: ' + r.name, at, fired: false, repeat, routineId: r.id }); saveTasks();
      return { text: '✓ I will run **' + r.name + '** ' + describeRepeat(repeat, at) + '. First run: ' + fmtDay(at) + ' at ' + fmtTime(at) + '. (JARVIS needs to be open in a browser at that time.)', tool: 'routine' };
    }
    case 'ROUTINE_DELETE': {
      const m = s.match(/(?:delete|remove|forget)\s+(?:the\s+|my\s+)?(?:routine\s+(?:called|named)\s+)?(.+?)(?:\s+routine)?$/);
      const r = Routines.find(m ? m[1] : '');
      if (!r) return { text: 'I could not find that routine.' };
      return { text: 'Delete the routine **' + r.name + '**?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => { Routines.remove(r); jarvisSay({ text: 'Deleted the ' + r.name + ' routine.', intent: 'ROUTINE_DELETE' }); } } };
    }

    /* ---- themes, persona, diagnostics ---- */
    case 'THEME_SET': {
      if (/\b(stand down|cancel)\b/.test(s)) { await switchTheme(settings.prevTheme && settings.prevTheme !== 'crimson' ? settings.prevTheme : 'arc'); return { text: 'Standing down, ' + Persona.sir() + '. Back to normal.', tool: 'theme' }; }
      const t = a.theme || (/\bred alert\b|\b(red|crimson)\b/.test(s) ? 'crimson' : /\b(gold|golden|mark ?85)\b/.test(s) ? 'gold' : /\b(violet|purple)\b/.test(s) ? 'violet' : /\b(arc|blue|cyan|default|normal)\b/.test(s) ? 'arc' : null);
      if (!THEMES[t]) return { text: 'Which theme, ' + Persona.sir() + '? Arc reactor blue, Mark 85 gold, crimson or violet.', suggestions: ['Gold theme', 'Crimson theme', 'Violet theme', 'Arc reactor blue theme'] };
      if (t === 'crimson' && settings.theme !== 'crimson') settings.prevTheme = settings.theme;
      await switchTheme(t);
      // The alarm/block-distractions action itself is now generic (THEME_ACTIONS.crimson, fires for "crimson
      // theme" and the dropdown too) — this branch only controls the distinct spoken wording for the literal phrase.
      if (/\bred alert\b/.test(s)) { return { text: 'Red alert, ' + Persona.sir() + '. All systems on standby.', speak: 'Red alert. All systems on standby.', suggestions: ['Stand down alert'], tool: 'theme' }; }
      return { text: THEMES[t].label + ' theme engaged, ' + Persona.sir() + '.', tool: 'theme' };
    }
    case 'PERSONA_SET': {
      const who = a.persona || (/\bfriday\b/.test(s) ? 'friday' : 'jarvis');
      if (settings.persona === who) return { text: (who === 'friday' ? 'FRIDAY' : 'JARVIS') + ' is already at your service, ' + Persona.sir() + '.' };
      applyPersona(who);
      return who === 'friday'
        ? { text: 'FRIDAY here, ' + Persona.sir() + '. JARVIS is taking five — what do you need?', tool: 'persona', noPersona: true }
        : { text: 'JARVIS back online, ' + Persona.sir() + '. I trust FRIDAY kept things tidy.', tool: 'persona', noPersona: true };
    }
    case 'DIAGNOSTICS': return runDiagnostics();
    case 'SYSTEM_STATE': return systemState();
    case 'AGENT_HISTORY': return Agent.history();

    /* ---- read my screen ---- */
    case 'SCREEN_READ':
    case 'SCREEN_EXPLAIN':
    case 'CLIPBOARD_IMAGE_READ': {
      const clip = p.intent === 'CLIPBOARD_IMAGE_READ';
      const explain = p.intent === 'SCREEN_EXPLAIN' || a.explain === true || a.explain === 'true' || (clip && /\b(explain|describe|fix|solve|summari[sz]e|debug|translate|what does|what'?s wrong|what'?s in|what is in)\b/.test(s));
      const whole = /\b(whole|entire|full|all of (my|the)) screen\b/.test(s);
      // "analyse my second tab": JARVIS can't switch browser tabs itself — you switch, it captures the window. A tab
      // gets a longer countdown (bring the browser forward, then pick the tab) and the shortcut for a numbered tab.
      const tab = /\b(tab|browser|web ?page)\b/.test(s);
      const nth = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 }[(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b(?: browser)? tab\b/.exec(s) || [])[1]];
      const wait = tab ? 5 : 3;
      if (!clip) {
        jarvisSay({ text: (tab ? 'Bring your browser forward and open that tab' + (nth ? ' (**Ctrl+' + nth + '** jumps to tab ' + nth + ')' : '') : 'Switch to the window you want me to read') + ', ' + Persona.sir() + ' — capturing in ' + wait + ' seconds.',
          speak: 'Capturing in ' + wait + ' seconds.', intent: 'SCREEN_READ', noLog: true });
        Array.from({ length: wait }, (_, i) => wait - i).forEach((n, i) => setTimeout(() => toast('Reading your screen in ' + n + '…', true), i * 1000));
      }
      toolStep('screenRead');
      const wantVision = explain && llmReady();
      const r = await callTool('/sys/screenRead', { source: clip ? 'clipboard' : whole ? 'screen' : 'window', delay: clip ? 0 : wait, vision: wantVision });
      if (r.error) return { text: cap(r.error) + '.' };
      const text = (r.text || '').trim();
      const where = clip ? 'copied image' : 'screen';
      // With vision, the local model sees the screenshot itself (charts, UI, images), and the OCR text is added
      // as a hint for exact wording. Without vision (or text-only models), it's the OCR text alone, as before.
      if (wantVision && r.imageToken) return { askLLM: raw + '\n\nThe attached image is a screenshot of my ' + where + '.' +
        (text ? ' Text read from it by OCR (may contain small errors):\n```\n' + text.slice(0, 6000) + '\n```' : '') + '\nAnswer my request about it.', imageToken: r.imageToken };
      if (!text) return { text: 'I could not find any readable text there, ' + Persona.sir() + '. (I read English text only.)' };
      ctx.lastOcr = text;
      if (wantVision) return { askLLM: raw + '\n\nHere is the text captured from my ' + where + ' (via OCR, so it may contain small errors):\n```\n' + text.slice(0, 8000) + '\n```\nAnswer my request about it.' };
      return { text: 'Read ' + plural(r.lines, 'line') + ' from your ' + (clip ? 'copied image' : whole ? 'screen' : 'window') + ':\n```text\n' + text.slice(0, 4000) + (text.length > 4000 ? '\n…' : '') + '\n```\n_Read locally with Windows OCR — the capture was deleted straight away._',
        speak: 'I read ' + plural(r.lines, 'line') + ' of text. It is on screen.', tool: 'screenRead',
        actions: [{ label: 'COPY TEXT', fn: async () => { await copyText(text); toast('Copied'); } }, { label: 'EXPLAIN IT', fn: () => handleUser('explain the text you just read from my screen', 'chip') }] };
    }

    /* ---- laptop controls ---- */
    case 'BRIGHTNESS': {
      const num = s.match(/\b(\d{1,3})\s*(%|percent)?\b/);
      let body = {};
      if (a.level !== undefined) body.level = +a.level;
      else if (num) body.level = +num[1];
      else if (/\b(max|maximum|full|highest)\b/.test(s)) body.level = 100;
      else if (/\b(min|minimum|lowest)\b/.test(s)) body.level = 10;
      else if (/\b(brighter|brighten|up|increase|raise|more|too dark)\b/.test(s)) body.delta = 20;
      else if (/\b(dim|dimmer|darker|down|decrease|lower|less|too bright)\b/.test(s)) body.delta = -20;
      toolStep('brightness');
      const r = await callTool('/sys/brightness', body);
      if (r.error) return { text: cap(r.error) + '.' };
      if (typeof r.previous === 'number' && r.previous !== r.level) Undo.push('brightness ' + r.level + '%', async () => { const x = await callTool('/sys/brightness', { level: r.previous }); if (x.error) throw new Error(x.error); return 'Brightness is back to ' + x.level + '%.'; });
      return body.level === undefined && body.delta === undefined
        ? { text: 'Screen brightness is at **' + r.level + '%**.' }
        : { text: 'Brightness set to **' + r.level + '%**.', tool: 'brightness' };
    }
    case 'DARK_MODE': {
      const mode = a.on === false || a.on === 'false' || /\blight\b/.test(s) ? 'light' : 'dark';
      toolStep('theme → ' + mode);
      const was = await callTool('/sys/theme', {});
      const r = await callTool('/sys/theme', { mode });
      if (r.error) return { text: 'Could not change the Windows theme: ' + r.error };
      if (was && was.mode && was.mode !== r.mode) Undo.push(r.mode + ' mode', async () => { const x = await callTool('/sys/theme', { mode: was.mode }); if (x.error) throw new Error(x.error); return 'Windows is back in ' + x.mode + ' mode.'; });
      return { text: 'Windows is now in **' + r.mode + ' mode**.', tool: 'darkMode' };
    }
    case 'RADIO': {
      const kind = /\bbluetooth\b/.test(s) ? 'bluetooth' : 'wifi';
      const label = kind === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
      const state = /\b(off|disable|disabled)\b/.test(s) ? 'off' : /\b(on|enable|enabled)\b/.test(s) && !/^is\b/.test(s) ? 'on' : '';
      const doIt = async () => { toolStep('radio → ' + kind + ' ' + (state || 'status')); return callTool('/sys/radio', { kind, state }); };
      if (kind === 'wifi' && state === 'off') {
        return { text: 'Turn **Wi-Fi off**? Online tools, weather and web search will stop until it is back on.', confirm: { yes: 'TURN OFF', no: 'CANCEL', onConfirm: async () => { const r = await doIt(); jarvisSay({ text: r.error ? 'Could not: ' + r.error : 'Wi-Fi is off. Say "turn on wifi" to reconnect.', intent: 'RADIO' }); } } };
      }
      const r = await doIt();
      if (r.error) return { text: 'Could not control ' + label + ': ' + r.error };
      return { text: label + ' is **' + r.state + '**.', tool: 'radio' };
    }
    case 'POWER_PLAN': {
      const want = /\b(saver|battery|eco|optimi[sz]er)\b/.test(s) ? 'saver' : /\bbalanced\b/.test(s) ? 'balanced' : /\b(performance|high|turbo|ultimate)\b/.test(s) ? 'performance' : '';
      toolStep('powerPlan ' + (want || 'list'));
      const r = await callTool('/sys/powerPlan', { plan: want });
      if (r.error) return { text: r.error + '.' };
      const names = [...new Set((r.plans || []).map(x => x.name))];
      return want ? { text: 'Power plan switched to **' + r.active + '**.', tool: 'powerPlan' }
        : { text: 'You are on the **' + r.active + '** power plan. Available: ' + names.join(', ') + '.', suggestions: names.filter(n => n !== r.active).map(n => 'Switch to ' + n.toLowerCase() + ' power plan') };
    }
    case 'VOLUME_SET': {
      const num = s.match(/\b(\d{1,3})\b/);
      const WORD_LEVEL = { max: 100, maximum: 100, full: 100, half: 50, min: 0, minimum: 0, zero: 0 };
      const wordMatch = !num && s.match(/\b(max(?:imum)?|full|half|min(?:imum)?|zero)\b/);
      const level = a.level !== undefined ? +a.level : num ? +num[1] : wordMatch ? WORD_LEVEL[wordMatch[1]] : undefined;
      toolStep('volume ' + (level === undefined ? 'read' : level));
      const before = level === undefined ? null : await callTool('/sys/volume', {});
      const r = await callTool('/sys/volume', level === undefined ? {} : { level });
      if (!r.error && before && typeof before.level === 'number') Undo.push('set volume to ' + r.level + '%', async () => { const x = await callTool('/sys/volume', { level: before.level }); if (x.error) throw new Error(x.error); return 'Volume is back to ' + x.level + '%.'; });
      if (r.error) return { text: 'Could not reach the audio device: ' + r.error };
      return level === undefined ? { text: 'Volume is at **' + r.level + '%**.' } : { text: 'Volume set to **' + r.level + '%**.', noTTS: r.level === 0, tool: 'volume' };
    }
    case 'DISPLAY_OFF':
      return { text: 'Turn the display off? Move the mouse or press a key to wake it.', confirm: { yes: 'TURN OFF', no: 'CANCEL', onConfirm: () => {
        toolStep('displayOff'); setTimeout(() => callTool('/sys/displayOff', {}), 1500);
        jarvisSay({ text: 'Display off.', intent: 'DISPLAY_OFF', tool: 'display' });
      } } };
    case 'WINDOW_LAYOUT': return arrangeWindows(s, a);
    case 'CLIP_HISTORY': return clipHistory(s);

    default: return conversationReply(p) || { askLLM: true };
  }
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
  list_files: () => ({ intent: 'LIST_FILES' }),
  create_folder: (a) => ({ intent: 'CREATE_FOLDER', args: { name: a.name } }),
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
  // setTimeout rather than rAF so streaming still renders when the window is in the background.
  const paint = () => { raf = 0; if (!/^\s*</.test(acc)) { node.bodyEl.innerHTML = renderMD(acc); node.bodyEl.classList.add('typing'); messages.scrollTop = messages.scrollHeight; } };
  try {
    const res = await fetch(API + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: llmAbort.signal,
      body: JSON.stringify({ messages: history, context: Object.assign(llmContext(), limit ? { limit } : {}, earlier ? { earlier } : {}), model: llm.model, imageToken: opts.imageToken })
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
        try { const j = JSON.parse(line); if (j.error) throw new Error(j.error); if (j.message && j.message.content) { acc += j.message.content; if (acc.length === j.message.content.length) setState('SPEAKING', 'Answering…'); if (!raf) raf = setTimeout(paint, 50); } } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
      }
    }
    llm.warm = true; bumpStat('aiQuestions');
  } catch (e) {
    node.bodyEl.classList.remove('typing');
    engine('llm', false); llmAbort = null;
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
  return { node, text: answer, limit, meta: 'LOCAL AI · ' + llm.model + ' · ' + secs + 's' + (opts.web ? ' · +' + opts.web.source : '') };
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
  if (pd.intent === 'FLASH_ANSWER') {
    if (/^(stop|quit|end|exit|cancel)( (the )?(flash ?cards?|review|session|quiz))?$/.test(s)) { if (flashSession) flashSession.i = flashSession.queue.length; return { intent: 'FLASH_END' }; }
    return { intent: 'FLASH_ANSWER', args: { id: pd.id, answer: norm.original }, text: s };
  }
  if (/^(cancel|never ?mind|forget it|no|stop)$/.test(s)) return { intent: 'CANCELLED' };
  if (pd.intent === 'REMIND' && NLU.parseWhen(s)) return { intent: 'REMIND', args: { text: pd.text, when: s }, text: s };
  if (pd.intent === 'ADD_DEADLINE' && NLU.parseDate(s)) return { intent: 'ADD_DEADLINE', args: { title: pd.title, due: s }, text: s };
  if (pd.intent === 'SET_TIMER' && /\d/.test(s)) return { intent: 'SET_TIMER', args: {}, text: 'timer ' + s };
  if (pd.intent === 'GIT_COMMIT') return { intent: 'GIT_COMMIT', args: {}, text: s, original: 'commit with message ' + norm.original };
  if (pd.intent === 'SAVE_CODE' && /^[\w\-.\/\\: ]{1,80}$/.test(norm.original.trim())) return { intent: 'SAVE_CODE', args: { code: pd.code, name: extractFileName('as ' + norm.original.trim()) || norm.original.trim() }, text: s };
  if ((pd.intent === 'DIRECTIONS' || pd.intent === 'DIRECTIONS_OPEN' || pd.intent === 'DISTANCE') && norm.original.trim().length >= 2) return { intent: pd.intent, args: { from: norm.original.trim(), to: pd.to }, text: s };
  return null;
}
// Shows an AI answer (plus sources / suggestion chips) and then runs any follow-up work.
async function finishAIAnswer(ai, after, p) {
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
  await deliver({ node: ai.node, text: ai.text, meta: ai.meta, suggestions: after && after.suggestions }, p);
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
    const res = await executeTool({ intent: 'SAVE_CODE', args: { name: after.save, code, run: after.run }, text: 'save', original: 'save' }, 'save');
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
async function handleUser(text, source) {
  text = (text || '').trim(); if (!text) return;
  if (busy) { inputQueue.push([text, source]); toast('Queued: "' + text.slice(0, 40) + '"'); return; }
  busy = true; const t0 = performance.now();
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
    // Website generator, DSA coach and viva practice (skills-page.js): active sessions and their trigger phrases.
    if (!ctx.pending && typeof Skills !== 'undefined') {
      const sk = await Skills.intercept(cmdText);
      if (sk) { await deliver(sk, { intent: sk.intent || 'SKILL', confidence: 1 }); return; }
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
        await askOrFinishGuidedFlow(gf.id, step, answers);
        return;
      }
      const route = Agent.route(cmdText);
      if (route.kind === 'multi') {
        const res = await Agent.handleMulti(cmdText, route, performance.now() - tr0);
        if (res) { await deliver(res, { intent: 'AGENT_RUN', confidence: 1 }); return; }
      }
    }

    const norm = NLU.normalize(cmdText, settings.wakeWord);
    let p = resolvePending(norm);
    if (p && p.intent === 'CANCELLED') { await deliver({ text: 'Okay, never mind.' }, p); return; }
    if (p && p.intent === 'FLASH_END') { await deliver(nextFlashCard(), { intent: 'FLASH_REVIEW', confidence: 1 }); return; }
    if (p) { p = { confidence: .95, original: norm.original, ...p }; }
    else { p = NLU.classify(norm, ctx); p.original = norm.original; }
    log('ok', 'intent: ' + p.intent + ' · conf ' + p.confidence.toFixed(2) + (norm.text !== text.toLowerCase() ? ' · heard "' + norm.text + '"' : '') + (p.corrected ? ' · typo-corrected to "' + p.corrected + '"' : ''));
    if (p.corrected) p.text = p.corrected;

    const wantsLLM = p.intent === 'CONVERSATION' || p.confidence < 0.85;
    let result = null;
    const tUnderstood = performance.now();

    if (!wantsLLM) {
      if (p.tool) { setState('EXECUTING', 'Running ' + p.tool + '…'); engine('core', true); }
      const pre = Agent.preSingle(p);          // before-state for the open/close check, requested in parallel
      result = await executeTool(p, cmdText);
      engine('core', false);
      if (result && !result.askLLM) { ctx.lastIntent = p.intent; ctx.lastCmd = result.confirm || ctx.pending || /\?\s*$/.test(String(result.text || '')) ? null : { text: cmdText, t: Date.now() }; Agent.watchSingle(p, pre); }
      log('agent', '⏱ understand ' + Math.round(tUnderstood - t0) + 'ms · run ' + Math.round(performance.now() - tUnderstood) + 'ms');
    }

    // An action the rules don't know ("set up my coding space: …"): plan it with the model, or fail safely.
    // It never goes to the chat model, which could claim it did something it didn't.
    // A request no rule understood — log it even when the AI is offline, so it can be taught later.
    if (wantsLLM && !answerOnly && !result && Agent.wantsAction(norm.text)) Agent.recordMiss(cmdText, llmReady() ? 'planner' : 'not understood');
    if (wantsLLM && !answerOnly && !result && llmReady() && Agent.wantsAction(norm.text)) {
      const res = await Agent.plan(cmdText, performance.now() - tUnderstood);
      if (res) { await deliver(res, { intent: res.intent || 'AGENT_RUN', confidence: 1 }); return; }
    }

    // Current-events questions: read the web first (Online tools on), so the AI answers from sources instead of guessing.
    if (wantsLLM && !result && settings.online && backend.online && llmReady() && (FACTUAL.test(norm.text) || TIME_SENSITIVE.test(norm.text)) && !LEARNING.test(norm.text) && !/\bmy\b/.test(norm.text)) {
      result = await doResearch(norm.text.replace(/[?!.]+$/, ''));
    }

    if (result && !result.askLLM && wantsLLM) {
      await deliver(result, p);
    } else if (wantsLLM || (result && result.askLLM)) {
      const toolPrompt = result && typeof result.askLLM === 'string';
      // Telugu/Kannada: include our English reading too — speech recognition often mangles English technical words.
      const userAsk = srcLang !== 'en' && cmdText !== text
        ? (Lang.aiInEnglish() ? cmdText : text + '\n\n(Meaning, in English: "' + cmdText + '". Answer that, in ' + ({ te: 'Telugu', kn: 'Kannada' }[Lang.replyLang()] || 'English') + '.)')
        : text;
      const ai = llmReady() ? await askLLM(toolPrompt ? result.askLLM : userAsk, { noTools: toolPrompt || answerOnly, imageToken: toolPrompt ? result.imageToken : undefined, noHistory: toolPrompt && !!result.noHistory, limitText: toolPrompt ? cmdText : undefined }) : null;
      // The chat model chose a tool: the server validates the name and arguments and sets the permission tier.
      let checked = null;
      if (ai && ai.tool) {
        checked = await callTool('/agent/validate', { tool: ai.tool.tool, args: ai.tool.rawArgs || {} });
        if (!checked.ok) {
          log('warn', 'AI tool call rejected: ' + (checked.reason || checked.error));
          await deliver({ text: 'The AI suggested an action I can’t run safely — ' + (checked.reason || checked.error) + '. Nothing was changed.', intent: 'AGENT_FAILED', noPersona: true }, p);
          return;
        }
        if (checked.step.tier !== 'safe') {
          await deliver(await Agent.chatTool(ai.tool.tool, ai.tool.rawArgs || {}, performance.now() - tUnderstood), { intent: 'AGENT_RUN', confidence: 1 });
          return;
        }
        const mapped = LLM_TOOLS[checked.step.tool](checked.step.args);
        ai.tool = { ...ai.tool, intent: checked.step.intent, args: Object.assign({}, mapped.args || {}, checked.step.args) };
      }
      if (ai && ai.tool) {
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
const piecesOf = ev => Array.from(ev.results, r => ({ text: (r[0] && r[0].transcript) || '', isFinal: r.isFinal }));
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
    stopSpeaking();
    if (llmAbort) llmAbort.abort();
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
$('#settingsBtn').addEventListener('click', () => renderProviders());

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
bindSwitch('#ttsToggle', 'tts', v => { if (!v) stopSpeaking(); loadVoices(); });
bindSwitch('#soundToggle', 'sound');
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
      escHtml(key) + '</code>, time-based. Then send <code>unlock 123456</code> (your current code) in ntfy, and commands work for 15 minutes. Keep this key secret. <button class="linkbtn" id="phoneAuthHide" type="button">HIDE KEY</button>';
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
$('#wipeBtn').addEventListener('click', () => {
  if (!confirm('Erase all JARVIS data (settings, chat, memory, tasks)? This is shared, so it clears it for every browser. Files in ~/jarvis are kept.')) return;
  withHello('wipe', async tok => {
    // Local copies go first, so the reload doesn't re-upload them as "first browser" data.
    Object.keys(localStorage).filter(k => k.startsWith('jarvis.')).forEach(k => localStorage.removeItem(k));
    try { await store.clear(tok); location.reload(); }
    catch (e) { toast('Nothing was erased — ' + (/403/.test(e.message) ? 'Windows Hello approval is required.' : e.message), true); Hello.refresh(); }
  });
});

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
