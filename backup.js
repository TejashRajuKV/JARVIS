'use strict';
/* Backup / export / import of JARVIS's data, plus automatic local snapshots.
   A backup is one JSON file: your data (to-dos, chat, notes-in-memory, flashcards, routines, study plans, triggers,
   settings, project-folder list). Secrets (API keys, the phone unlock key) are left out unless you tick "include" and
   choose a password — then they're sealed with AES-256-GCM (key from the password via scrypt). The Windows Hello key
   is never exported: it belongs to this device. Pure helpers are exported for tests. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'jarvis-backup', VERSION = 1;
const STATE_KEY = /^jarvis\.[\w.-]{1,40}$/;
const MAX_BYTES = 6 * 1024 * 1024;
const AREAS = { 'jarvis.todos': 'to-dos', 'jarvis.reminders': 'reminders', 'jarvis.deadlines': 'deadlines', 'jarvis.classes': 'classes', 'jarvis.chat': 'chat messages',
  'jarvis.memory': 'memories', 'jarvis.flashcards': 'flashcards', 'jarvis.snippets': 'snippets', 'jarvis.routines': 'routines', 'jarvis.triggers': 'triggers',
  'jarvis.studyPlans': 'study plans', 'jarvis.sessions': 'focus sessions', 'jarvis.learned': 'learned phrases', 'jarvis.attendance': 'attendance', 'jarvis.marks': 'semester results', 'jarvis.exams': 'exam results' };

/* ---------- sealing secrets ---------- */
function seal(obj, password) {
  if (!password || String(password).length < 8) throw new Error('Choose a password of at least 8 characters');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { enc: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(env, password) {
  try {
    if (!env || env.enc !== 'aes-256-gcm' || env.kdf !== 'scrypt') throw new Error('unsupported');
    const key = crypto.scryptSync(String(password || ''), Buffer.from(env.salt, 'base64'), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
    d.setAuthTag(Buffer.from(env.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Wrong password, or the backup file is damaged'); }
}

/* ---------- build / read ---------- */
function buildBackup({ state, roots, secrets, password, appVersion, now = Date.now() }) {
  const out = { format: FORMAT, version: VERSION, createdAt: now, app: appVersion || '', state: {}, roots: (roots || []).slice(0, 50) };
  for (const [k, v] of Object.entries(state || {})) if (STATE_KEY.test(k)) out.state[k] = v;
  if (secrets) out.secrets = seal(secrets, password);
  return out;
}
// Text → { ok, backup } or { ok:false, error }. Never trusts the file: only allowlisted keys survive.
function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'That file is empty' };
  if (text.length > MAX_BYTES) return { ok: false, error: 'That file is too big to be a JARVIS backup' };
  let j; try { j = JSON.parse(text); } catch { return { ok: false, error: 'That isn’t a JARVIS backup file (not valid JSON)' }; }
  if (!j || j.format !== FORMAT) return { ok: false, error: 'That isn’t a JARVIS backup file' };
  if (j.version > VERSION) return { ok: false, error: 'This backup is from a newer JARVIS — update JARVIS first' };
  const state = {}, rejected = [];
  if (!j.state || typeof j.state !== 'object' || Array.isArray(j.state)) return { ok: false, error: 'The backup has no data in it' };
  for (const [k, v] of Object.entries(j.state)) { if (STATE_KEY.test(k) && v !== undefined) state[k] = v; else rejected.push(k); }
  const roots = Array.isArray(j.roots) ? j.roots.filter(r => typeof r === 'string' && r.length < 400).slice(0, 50) : [];
  return { ok: true, backup: { createdAt: +j.createdAt || 0, app: String(j.app || ''), state, roots, secrets: j.secrets && j.secrets.enc ? j.secrets : null, rejected } };
}
function summarize(backup) {
  const areas = {};
  for (const [k, label] of Object.entries(AREAS)) { const v = backup.state[k]; if (Array.isArray(v) && v.length) areas[label] = v.length; }
  return { areas, roots: backup.roots.length, hasSecrets: !!backup.secrets, createdAt: backup.createdAt, app: backup.app };
}

/* ---------- merge (import without replacing) ---------- */
const hasIds = a => Array.isArray(a) && a.length && a.every(x => x && typeof x === 'object' && x.id !== undefined);
function mergeState(current, incoming, mergeReminders) {
  const out = { ...current };
  for (const [k, inc] of Object.entries(incoming)) {
    const cur = current[k];
    if (cur === undefined) { out[k] = inc; continue; }
    if (k === 'jarvis.reminders' && mergeReminders) { out[k] = mergeReminders(cur, inc); continue; }
    if (k === 'jarvis.stats' && cur && inc && typeof cur === 'object' && typeof inc === 'object') { // per day, per counter: the larger number
      const m = { ...cur };
      for (const [d, s] of Object.entries(inc)) { const c = m[d] || {}; m[d] = { ...s, ...c }; for (const [f, n] of Object.entries(s)) if (typeof n === 'number') m[d][f] = Math.max(+c[f] || 0, n); }
      out[k] = m; continue;
    }
    if (k === 'jarvis.settings') { out[k] = { ...inc, ...cur }; continue; } // this laptop's settings win
    if (Array.isArray(cur) && Array.isArray(inc)) {
      if (hasIds(cur) || hasIds(inc)) { const seen = new Set(cur.map(x => x && x.id)); out[k] = [...cur, ...inc.filter(x => !(x && seen.has(x.id)))]; }
      else { const seen = new Set(cur.map(x => JSON.stringify(x))); out[k] = [...cur, ...inc.filter(x => !seen.has(JSON.stringify(x)))]; }
      if (k === 'jarvis.chat') out[k] = out[k].sort((a, b) => (a && a.t || 0) - (b && b.t || 0)).slice(-80);
      continue;
    }
    // anything else (single values, other objects): keep what's here
  }
  return out;
}

/* ---------- server wiring ---------- */
module.exports = function setupBackup(app, { getState, setState, getConfig, saveConfig, mergeReminders, addRoot, dir, appVersion }) {
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const deny = res => res.status(403).json({ error: 'Back up and restore from JARVIS on the laptop.' });
  const stamp = d => new Date(d).toISOString().slice(0, 10);
  const log = (...a) => console.log('[backup]', ...a);
  fs.mkdirSync(dir, { recursive: true });

  /* snapshots: a plain copy of the shared state (no secrets), kept in ~/jarvis/.backups */
  function snapshot(reason) {
    try {
      const name = (reason ? reason + '-' : 'daily-') + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23) + '.json'; // to the millisecond, so two snapshots never share a name
      fs.writeFileSync(path.join(dir, name), JSON.stringify(getState()));
      prune();
      return name;
    } catch (e) { log('snapshot failed:', e.message); return null; }
  }
  const listSnaps = () => { try { return fs.readdirSync(dir).filter(n => /^[\w-]+\.json$/.test(n)).map(n => { const st = fs.statSync(path.join(dir, n)); return { name: n, at: st.mtimeMs, size: st.size }; }).sort((a, b) => b.at - a.at); } catch { return []; } };
  function prune() { // keep the newest 7 daily snapshots and the newest 10 safety copies taken before erase/import/restore
    const all = listSnaps();
    for (const group of [all.filter(s => s.name.startsWith('daily-')).slice(7), all.filter(s => !s.name.startsWith('daily-')).slice(10)]) for (const s of group) { try { fs.unlinkSync(path.join(dir, s.name)); } catch {} }
  }
  function dailyCheck() { const s = getState(); if (!Object.keys(s).length) return; if (!listSnaps().some(x => x.name.startsWith('daily-') && stamp(x.at) === stamp(Date.now()))) { const n = snapshot(); if (n) log('daily snapshot', n); } }
  setTimeout(dailyCheck, 20000).unref(); setInterval(dailyCheck, 6 * 36e5).unref(); // (unref: never keeps the process alive)

  app.post('/api/backup/export', (req, res) => {
    if (!fromLaptopPage(req)) return deny(res);
    const cfg = getConfig();
    let secrets = null;
    if (req.body && req.body.includeSecrets) secrets = { providers: cfg.providers || [], phoneAuth: cfg.phoneAuth || null };
    let b;
    try { b = buildBackup({ state: getState(), roots: cfg.roots, secrets, password: req.body && req.body.password, appVersion }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ success: true, filename: 'jarvis-backup-' + stamp(Date.now()) + '.jarvis-backup', content: JSON.stringify(b), secrets: !!secrets });
  });
  app.post('/api/backup/preview', (req, res) => {
    if (!fromLaptopPage(req)) return deny(res);
    const r = parseBackup(String(req.body && req.body.content || ''));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ success: true, ...summarize(r.backup), ignored: r.backup.rejected.length });
  });
  // Guarded by Windows Hello when it is on (hello.js GUARDED): it can overwrite everything.
  app.post('/api/backup/import', (req, res) => {
    if (!fromLaptopPage(req)) return deny(res);
    const r = parseBackup(String(req.body && req.body.content || ''));
    if (!r.ok) return res.status(400).json({ error: r.error });
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace';
    let secrets = null;
    if (req.body.withSecrets) {
      if (!r.backup.secrets) return res.status(400).json({ error: 'This backup has no API keys in it' });
      try { secrets = unseal(r.backup.secrets, req.body.password); } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    const safety = snapshot('before-import');
    const cur = getState();
    const next = mode === 'merge' ? mergeState(cur, r.backup.state, mergeReminders) : { ...r.backup.state };
    if (cur['jarvis.migrated']) next['jarvis.migrated'] = cur['jarvis.migrated']; // another browser's old copy must never come back
    setState(next);
    let roots = 0;
    for (const p of r.backup.roots) if (addRoot(p)) roots++;
    let keys = 0;
    if (secrets) {
      const cfg = getConfig();
      if (Array.isArray(secrets.providers)) { const have = new Set((cfg.providers || []).map(p => p.id)); cfg.providers = [...(cfg.providers || []), ...secrets.providers.filter(p => p && p.id && !have.has(p.id))]; keys = secrets.providers.length; }
      if (secrets.phoneAuth && secrets.phoneAuth.secret && (mode === 'replace' || !cfg.phoneAuth)) cfg.phoneAuth = secrets.phoneAuth;
      saveConfig();
    }
    log('imported (' + mode + ')', Object.keys(r.backup.state).length + ' areas,', roots + ' folders,', keys + ' keys');
    res.json({ success: true, mode, areas: Object.keys(r.backup.state).length, folders: roots, keys, safetyCopy: safety });
  });
  app.get('/api/backup/snapshots', (req, res) => { if (!fromLaptopPage(req)) return deny(res); res.json({ success: true, snapshots: listSnaps() }); });
  app.post('/api/backup/restore', (req, res) => {
    if (!fromLaptopPage(req)) return deny(res);
    const name = String(req.body && req.body.name || '');
    if (!/^[\w-]+\.json$/.test(name) || !listSnaps().some(s => s.name === name)) return res.status(404).json({ error: 'No such snapshot' });
    let st; try { st = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return res.status(400).json({ error: 'That snapshot is damaged' }); }
    const clean = {}; for (const [k, v] of Object.entries(st || {})) if (STATE_KEY.test(k)) clean[k] = v;
    snapshot('before-restore');
    setState(clean);
    res.json({ success: true, areas: Object.keys(clean).length });
  });

  return { snapshot, listSnaps };
};
Object.assign(module.exports, { seal, unseal, buildBackup, parseBackup, summarize, mergeState, STATE_KEY, FORMAT, VERSION });
