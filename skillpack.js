'use strict';
/* Skill packs: a folder with a SKILL.md becomes a JARVIS skill, with no code change.
   The format is the one Hermes Agent, Codex and others use (agentskills.io): a header with `name` and `description`,
   then plain instructions. Packs are read from ~/jarvis/Skills (yours, wins) and ./skills-bundled (shipped with JARVIS).
   A pack is only ever prompt text: scripts/ and other files in the folder are never run or loaded.
   The parse/scan helpers are pure and exported for tests. */
const fs = require('fs');
const path = require('path');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_BODY = 6000;          // the local model has a small context: one skill, kept short
const MAX_FILE = 64 * 1024;     // a SKILL.md bigger than this is not a skill
const MAX_INPUT = 14000;        // what the user (plus any search results or file excerpts) may hand a skill
const USES = ['research', 'files', 'plan'];

const unquote = s => { s = s.trim(); const m = s.match(/^(["'])([\s\S]*)\1$/); return m ? m[2] : s; };

// "---\nname: x\ntriggers: [a, b]\n---\nbody" → { meta, body }. A small YAML subset: key: value, [a, b] lists, "- item" lists.
function parseFrontMatter(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = t.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/);
  if (!m) return { meta: null, body: t.trim() };
  const meta = {}; let listKey = null;
  const lines = m[1].split('\n');
  const indented = l => l !== undefined && /^\s+\S/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) { listKey = null; continue; }
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    listKey = null;
    if (val === '') { meta[key] = []; listKey = key; }
    else if (/^\[.*\]$/.test(val)) meta[key] = val.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else if (/^[>|][+-]?$/.test(val)) {            // "description: >-" then indented lines (folded into one line, or kept with | )
      const parts = [];
      while (i + 1 < lines.length && (indented(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim());
      meta[key] = (val[0] === '>' ? parts.join(' ') : parts.join('\n')).replace(/\s+/g, val[0] === '>' ? ' ' : '$&').trim();
    } else {                                       // a plain value, which YAML lets continue on indented lines
      const parts = [val];
      while (indented(lines[i + 1]) && !/^\s+-\s/.test(lines[i + 1])) parts.push(lines[++i].trim());
      meta[key] = unquote(parts.join(' '));
    }
  }
  return { meta, body: (m[2] || '').trim() };
}

// One SKILL.md → { skill } or { error }. `folder` is the directory name (used when the header has no name).
function parseSkill(text, folder) {
  if (Buffer.byteLength(String(text || '')) > MAX_FILE) return { error: 'file is too big (over ' + MAX_FILE / 1024 + ' KB)' };
  const { meta, body } = parseFrontMatter(text);
  if (!meta) return { error: 'no header: the file must start with --- name: … description: … ---' };
  const name = String(meta.name || folder || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) return { error: 'name "' + name + '" must be lowercase letters, digits and dashes (max 40)' };
  const description = String(meta.description || '').replace(/\s+/g, ' ').trim();
  if (!description) return { error: 'no description' };
  if (!body) return { error: 'no instructions after the header' };
  const triggers = (Array.isArray(meta.triggers) ? meta.triggers : meta.triggers ? [meta.triggers] : [])
    .map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 3 && x.length <= 60).slice(0, 12);
  const keywords = (Array.isArray(meta.keywords) ? meta.keywords : meta.keywords ? [meta.keywords] : [])
    .map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 2 && x.length <= 30).slice(0, 24);
  const bool = (v, dflt) => (v === undefined ? dflt : /^(?:true|yes|on|1)$/i.test(String(v).trim()));
  const auto = bool(meta.auto, false), suggest = bool(meta.suggest, true);       // auto: use it without asking · suggest: false keeps it out of the "use this skill?" chips
  const uses = USES.includes(String(meta.uses || '').toLowerCase()) ? String(meta.uses).toLowerCase() : '';
  const maxTokens = Math.max(64, Math.min(2000, parseInt(meta.max_tokens, 10) || 700));
  const cut = body.length > MAX_BODY;
  return { skill: { name, description: description.slice(0, 240), triggers, keywords, auto, suggest, uses, maxTokens, body: cut ? body.slice(0, MAX_BODY) + '\n[…instructions cut to fit]' : body, truncated: cut } };
}

// Reads every <dir>/<name>/SKILL.md. Symlinks and anything unreadable are skipped and reported, never fatal.
function scanDir(dir, source) {
  const skills = [], skipped = [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return { skills, skipped }; }
  for (const n of names.sort()) {
    const folder = path.join(dir, n);
    let st;
    try { st = fs.lstatSync(folder); } catch { continue; }
    if (st.isSymbolicLink()) { skipped.push({ folder: n, source, reason: 'symbolic links are not followed' }); continue; }
    if (!st.isDirectory()) continue;
    const file = path.join(folder, 'SKILL.md');
    let fst;
    try { fst = fs.lstatSync(file); } catch { continue; }          // a folder without SKILL.md is just a folder
    if (fst.isSymbolicLink() || !fst.isFile()) { skipped.push({ folder: n, source, reason: 'SKILL.md is not a plain file' }); continue; }
    if (fst.size > MAX_FILE) { skipped.push({ folder: n, source, reason: 'file is too big (over ' + MAX_FILE / 1024 + ' KB)' }); continue; }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { skipped.push({ folder: n, source, reason: 'cannot read it' }); continue; }
    const r = parseSkill(text, n);
    if (r.error) skipped.push({ folder: n, source, reason: r.error });
    else skills.push(Object.assign(r.skill, { source }));
  }
  return { skills, skipped };
}

// Bundled first, then yours: a skill of yours with the same name replaces the shipped one.
function loadAll(bundledDir, userDir) {
  const b = scanDir(bundledDir, 'bundled'), u = scanDir(userDir, 'yours');
  const by = new Map();
  for (const s of b.skills) by.set(s.name, s);
  for (const s of u.skills) by.set(s.name, s);
  return { skills: [...by.values()].sort((x, y) => x.name.localeCompare(y.name)), skipped: b.skipped.concat(u.skipped) };
}

// The part of a skill the page needs (never the instructions themselves).
const publicView = s => ({ name: s.name, label: s.name, hint: s.description, triggers: s.triggers, keywords: s.keywords, auto: !!s.auto, suggest: s.suggest !== false, uses: s.uses, source: s.source, truncated: s.truncated });

/* ---------- routes ---------- */
module.exports = function setupSkillPacks(app, { llm, DEFAULT_MODEL, SANDBOX, bundledDir }) {
  const userDir = path.join(SANDBOX, 'Skills');
  const bundled = bundledDir || path.join(__dirname, 'skills-bundled');
  let cache = loadAll(bundled, userDir);
  const reload = () => (cache = loadAll(bundled, userDir));
  const model = req => String((req.body && req.body.model) || DEFAULT_MODEL);

  app.get('/api/skills', (req, res) => res.json({ success: true, skills: cache.skills.map(publicView), skipped: cache.skipped, folder: userDir }));
  app.post('/api/skills/reload', (req, res) => { reload(); res.json({ success: true, count: cache.skills.length, skipped: cache.skipped }); });

  // Runs one skill: its instructions are the system prompt, the user's words (plus anything the page fetched) are the input.
  app.post('/api/skill/run', async (req, res) => {
    const b = req.body || {};
    const skill = cache.skills.find(s => s.name === String(b.skill || '').toLowerCase());
    if (!skill) return res.status(404).json({ error: 'I don’t have a skill called "' + String(b.skill || '').slice(0, 40) + '".' });
    const input = String(b.input || '').trim().slice(0, MAX_INPUT);
    if (!input) return res.status(400).json({ error: 'What should the ' + skill.name + ' skill work on?' });
    try {
      const text = (await llm.complete({ model: model(req), system: skill.body, messages: [{ role: 'user', content: input }], temperature: 0.3, maxTokens: skill.maxTokens, numCtx: 8192, timeoutMs: 180000 })).trim();
      res.json({ success: true, skill: skill.name, text });
    } catch (e) { res.status(502).json({ error: (e && e.message) || String(e) }); }
  });
};
Object.assign(module.exports, { parseFrontMatter, parseSkill, scanDir, loadAll, publicView, NAME_RE, MAX_BODY, MAX_FILE, MAX_INPUT, USES });
