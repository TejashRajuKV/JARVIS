'use strict';
// Cross-phase local agent platform: workflow graph validation, research notebook, and privacy-safe audit trail.
// This module validates plans only; it never executes tools or silently grants permissions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_STEPS = 32;
const MAX_RESEARCH = 100;
const MAX_AUDIT = 500;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SECRET_PARAM = /^(?:token|access_token|refresh_token|api[_-]?key|key|auth|authorization|code|password|passwd|session|sid|secret|signature|sig|email|text|message|body|caption)$/i;
const ALLOWED_CATEGORIES = new Set(['workflow', 'research', 'skill', 'agent', 'security', 'system']);
const ALLOWED_OUTCOMES = new Set(['success', 'failure', 'blocked', 'cancelled', 'review']);
const ALLOWED_AUDIT_ACTIONS = new Set(['validate-workflow', 'save-research-session', 'delete-research-session', 'run-task', 'skill-run', 'approval', 'permission-denied', 'cancel-task', 'recover-task', 'export-data', 'other']);

function safeSourceUrl(input) {
  let u;
  try { u = new URL(String(input || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  for (const key of [...u.searchParams.keys()]) if (SECRET_PARAM.test(key)) u.searchParams.delete(key);
  u.hash = '';
  return u.href.slice(0, 1800);
}
function cleanText(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function validateWorkflow(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const raw = Array.isArray(source.steps) ? source.steps : [];
  if (!raw.length) return { ok: false, error: 'WORKFLOW_EMPTY', message: 'Add at least one workflow step.' };
  if (raw.length > MAX_STEPS) return { ok: false, error: 'WORKFLOW_TOO_LARGE', message: 'A workflow can contain at most ' + MAX_STEPS + ' steps.' };
  const steps = [], byId = new Map();
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] && typeof raw[i] === 'object' && !Array.isArray(raw[i]) ? raw[i] : {};
    const id = String(row.id || '').trim();
    if (!ID_RE.test(id)) return { ok: false, error: 'INVALID_STEP_ID', message: 'Step ' + (i + 1) + ' needs a simple id (letters, numbers, dot, underscore or hyphen).' };
    if (byId.has(id)) return { ok: false, error: 'DUPLICATE_STEP_ID', message: 'Duplicate step id: ' + id };
    const deps = Array.isArray(row.dependsOn) ? [...new Set(row.dependsOn.map(String))] : [];
    if (deps.includes(id)) return { ok: false, error: 'WORKFLOW_CYCLE', message: 'A step cannot depend on itself: ' + id };
    const tier = ['safe','confirm','high','critical','unknown'].includes(row.tier) ? row.tier : 'unknown';
    const step = { id, label: cleanText(row.label || id, 120), kind: cleanText(row.kind || 'tool', 40),
      dependsOn: deps, tier, readOnly: row.readOnly === true, requiresApproval: tier !== 'safe',
      canRunInParallel: row.readOnly === true && tier === 'safe' };
    steps.push(step); byId.set(id, step);
  }
  for (const step of steps) for (const dep of step.dependsOn) {
    if (!byId.has(dep)) return { ok: false, error: 'UNKNOWN_DEPENDENCY', message: 'Step ' + step.id + ' depends on missing step ' + dep };
  }
  const pending = new Set(steps.map(s => s.id)), completed = new Set(), waves = [];
  while (pending.size) {
    const ready = steps.filter(s => pending.has(s.id) && s.dependsOn.every(d => completed.has(d)));
    if (!ready.length) return { ok: false, error: 'WORKFLOW_CYCLE', message: 'Workflow dependencies contain a cycle.' };
    // Only explicitly read-only safe steps may share a wave. All other work is serialized.
    const parallel = ready.filter(s => s.canRunInParallel);
    const nextWave = parallel.length ? parallel : [ready[0]];
    waves.push(nextWave.map(s => s.id));
    for (const s of nextWave) { pending.delete(s.id); completed.add(s.id); }
  }
  return { ok: true, plan: { version: 1, steps, waves, stepCount: steps.length,
    parallelSafeGroups: waves.filter(w => w.length > 1).length,
    approvalRequired: steps.filter(s => s.requiresApproval).map(s => s.id),
    policy: 'validation-only; execution must use the normal tool registry, permission checks and verification' } };
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}
function readArray(file, max) {
  try { const x = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(x) ? x.slice(0, max) : []; }
  catch (e) { if (e.code !== 'ENOENT') return []; return []; }
}
function createResearchNotebook({ file }) {
  let rows = readArray(file, MAX_RESEARCH).filter(x => x && ID_RE.test(String(x.id || ''))).map(x => ({
    id: String(x.id), question: cleanText(x.question, 1200), title: cleanText(x.title || x.question, 180), summary: cleanText(x.summary, 5000),
    sources: (Array.isArray(x.sources) ? x.sources : []).slice(0, 30).map(s => {
      const url = safeSourceUrl(s && s.url); if (!url) return null;
      return { url, title: cleanText(s.title || new URL(url).hostname, 180), note: cleanText(s.note, 400) };
    }).filter(Boolean), createdAt: Number(x.createdAt) || Date.now(), updatedAt: Number(x.updatedAt) || Number(x.createdAt) || Date.now()
  })).filter(x => x.question);
  const persist = () => atomicWrite(file, rows);
  function list() { return rows.map(x => ({ ...x, sources: x.sources.map(s => ({ ...s })) })); }
  function add(input) {
    const b = input && typeof input === 'object' ? input : {};
    const question = cleanText(b.question, 1200);
    if (!question) return { error: 'QUESTION_REQUIRED' };
    const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 30).map(s => {
      const v = s && typeof s === 'object' ? s : { url: s };
      const url = safeSourceUrl(v.url);
      if (!url) return null;
      return { url, title: cleanText(v.title || new URL(url).hostname, 180), note: cleanText(v.note, 400) };
    }).filter(Boolean);
    const row = { id: crypto.randomBytes(8).toString('hex'), question, title: cleanText(b.title || question, 180),
      summary: cleanText(b.summary, 5000), sources, createdAt: Date.now(), updatedAt: Date.now() };
    rows = [row, ...rows].slice(0, MAX_RESEARCH);
    try { persist(); } catch { rows = rows.filter(x => x.id !== row.id); return { error: 'PERSIST_FAILED' }; }
    return { item: { ...row, sources: row.sources.map(s => ({ ...s })) } };
  }
  function get(id) { const row = rows.find(x => x.id === String(id)); return row ? { ...row, sources: row.sources.map(s => ({ ...s })) } : null; }
  function remove(id) { const old = rows; rows = rows.filter(x => x.id !== String(id)); if (rows.length === old.length) return false; try { persist(); return true; } catch { rows = old; return false; } }
  return { list, add, get, remove, clear: () => { const old = rows; rows = []; try { persist(); return true; } catch { rows = old; return false; } } };
}
function createAuditLog({ file }) {
  let rows = readArray(file, MAX_AUDIT).filter(x => x && Number.isFinite(Number(x.at)) && ALLOWED_CATEGORIES.has(x.category) && ALLOWED_OUTCOMES.has(x.outcome)).map(x => ({
    id: ID_RE.test(String(x.id || '')) ? String(x.id) : crypto.randomBytes(8).toString('hex'), at: Number(x.at),
    category: x.category, action: ALLOWED_AUDIT_ACTIONS.has(String(x.action || '')) ? String(x.action) : 'other',
    outcome: x.outcome, runId: /^[a-zA-Z0-9._-]{1,80}$/.test(String(x.runId || '')) ? String(x.runId) : null
  }));
  const persist = () => atomicWrite(file, rows);
  function append(input) {
    const b = input && typeof input === 'object' ? input : {};
    const category = String(b.category || '');
    const outcome = String(b.outcome || 'review');
    if (!ALLOWED_CATEGORIES.has(category)) return { error: 'INVALID_CATEGORY' };
    if (!ALLOWED_OUTCOMES.has(outcome)) return { error: 'INVALID_OUTCOME' };
    // Intentionally exclude prompts, file paths, URLs, arguments, credentials and arbitrary payloads.
    const row = { id: crypto.randomBytes(8).toString('hex'), at: Date.now(), category,
      action: ALLOWED_AUDIT_ACTIONS.has(String(b.action || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80)) ? String(b.action || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80) : 'other',
      outcome, runId: /^[a-zA-Z0-9._-]{1,80}$/.test(String(b.runId || '')) ? String(b.runId) : null };
    rows = [row, ...rows].slice(0, MAX_AUDIT);
    try { persist(); } catch { rows = rows.filter(x => x.id !== row.id); return { error: 'PERSIST_FAILED' }; }
    return { item: { ...row } };
  }
  function list(limit = 100) { const n = Math.max(1, Math.min(100, Number(limit) || 100)); return rows.slice(0, n).map(x => ({ ...x })); }
  return { append, list, clear: () => { const old = rows; rows = []; try { persist(); return true; } catch { rows = old; return false; } } };
}

module.exports = function setupAgentPlatform(app, { SANDBOX }) {
  const notebook = createResearchNotebook({ file: path.join(SANDBOX, '.research-notebook.json') });
  const audit = createAuditLog({ file: path.join(SANDBOX, '.audit-events.json') });
  app.locals.jarvisResearchNotebook = notebook;
  app.locals.jarvisAuditLog = audit;
  app.get('/api/platform/status', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({
    success: true, phases: {
      skills: { available: true, source: 'skillpack.js' },
      researchNotebook: { available: true, savedItems: notebook.list().length },
      workflowValidation: { available: true, validationOnly: true },
      scheduling: { available: true, source: 'scheduler.js' },
      taskRecovery: { available: true, source: 'agent.js' },
      auditTrail: { available: true, events: audit.list(1).length ? 'active' : 'ready' },
      phoneHub: { available: true, source: 'phonehub-gateway.js' }
    }
  }); });
  app.post('/api/workflows/validate', (req, res) => {
    const result = validateWorkflow(req.body);
    if (!result.ok) return res.status(400).json(result);
    audit.append({ category: 'workflow', action: 'validate-workflow', outcome: 'success' });
    res.json(result);
  });
  app.get('/api/research/sessions', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, sessions: notebook.list() }); });
  app.post('/api/research/sessions', (req, res) => {
    const result = notebook.add(req.body);
    if (result.error) return res.status(result.error === 'QUESTION_REQUIRED' ? 400 : 500).json(result);
    audit.append({ category: 'research', action: 'save-research-session', outcome: 'success' });
    res.status(201).json({ success: true, session: result.item });
  });
  app.get('/api/research/sessions/:id', (req, res) => {
    const session = notebook.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'RESEARCH_SESSION_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, session });
  });
  app.delete('/api/research/sessions/:id', (req, res) => {
    if (!notebook.remove(req.params.id)) return res.status(404).json({ error: 'RESEARCH_SESSION_NOT_FOUND' });
    audit.append({ category: 'research', action: 'delete-research-session', outcome: 'success' });
    res.json({ success: true });
  });
  app.get('/api/audit/events', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, events: audit.list(req.query.limit) }); });
};
module.exports.validateWorkflow = validateWorkflow;
module.exports.safeSourceUrl = safeSourceUrl;
module.exports.createResearchNotebook = createResearchNotebook;
module.exports.createAuditLog = createAuditLog;
module.exports.MAX_STEPS = MAX_STEPS;
module.exports.MAX_RESEARCH = MAX_RESEARCH;
module.exports.MAX_AUDIT = MAX_AUDIT;
