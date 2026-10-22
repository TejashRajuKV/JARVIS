'use strict';
/* Explicitly saved workflow notes. These are inert prompt templates, never executable commands.
   Reuse is user-triggered; the module does not run tools or create a permanent mood/profile record. */
const fs = require('fs');
const path = require('path');
const MAX_ITEMS = 50, MAX_NAME = 60, MAX_PROMPT = 1800;

function cleanItem(x) {
  return { id: String(x.id || '').slice(0, 40), name: String(x.name || '').slice(0, MAX_NAME),
    prompt: String(x.prompt || '').slice(0, MAX_PROMPT), updatedAt: Number(x.updatedAt) || 0 };
}
function validate(input) {
  const name = String(input && input.name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  const prompt = String(input && input.prompt || '').trim().slice(0, MAX_PROMPT);
  if (!name) return { error: 'A workflow name is required.' };
  if (!prompt) return { error: 'A workflow prompt is required.' };
  if (prompt.length < String(input.prompt || '').trim().length) return { error: 'Workflow prompt is too long (maximum 1800 characters).' };
  return { item: { name, prompt } };
}
function createWorkflowMemory({ file }) {
  let items = [];
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(x)) throw new Error('invalid workflow memory');
    items = x.filter(v => v && typeof v === 'object' && /^[a-z0-9-]{1,40}$/i.test(String(v.id || '')) && typeof v.name === 'string' && typeof v.prompt === 'string').map(cleanItem).slice(0, MAX_ITEMS);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function list() { return items.slice().sort((a,b) => b.updatedAt-a.updatedAt).map(cleanItem); }
  function save(input) {
    const v = validate(input); if (v.error) return v;
    const existing = items.find(x => x.name.toLowerCase() === v.item.name.toLowerCase());
    const item = { id: existing ? existing.id : 'wf-' + require('crypto').randomBytes(6).toString('hex'), ...v.item, updatedAt: Date.now() };
    const next = existing ? items.map(x => x.id === existing.id ? item : x) : [item, ...items].slice(0, MAX_ITEMS);
    const previous = items; items = next;
    try { persist(); } catch (e) { items = previous; return { error: 'Could not save workflow memory.' }; }
    return { item: cleanItem(item) };
  }
  function remove(id) {
    const previous = items; items = items.filter(x => x.id !== id);
    if (previous.length === items.length) return false;
    try { persist(); return true; } catch (e) { items = previous; return false; }
  }
  function clear() { const previous = items; items = []; try { persist(); return true; } catch (e) { items = previous; return false; } }
  return { list, save, remove, clear };
}
module.exports = function setupWorkflowMemory(app, { SANDBOX }) {
  const memory = createWorkflowMemory({ file: path.join(SANDBOX, '.workflow-memory.json') });
  app.get('/api/workflows', (req,res) => { res.setHeader('Cache-Control','no-store'); res.json({ success:true, workflows:memory.list() }); });
  app.post('/api/workflows', (req,res) => {
    const result = memory.save(req.body || {});
    if (result.error) return res.status(400).json({ error:result.error });
    res.status(201).json({ success:true, workflow:result.item });
  });
  app.delete('/api/workflows/:id', (req,res) => {
    if (!/^[a-z0-9-]{1,40}$/i.test(String(req.params.id || '')) || !memory.remove(req.params.id)) return res.status(404).json({ error:'WORKFLOW_NOT_FOUND_OR_NOT_SAVED' });
    res.json({ success:true });
  });
  app.delete('/api/workflows', (req,res) => {
    if (!memory.clear()) return res.status(500).json({ error:'Could not clear workflow memory.' });
    res.json({ success:true });
  });
};
Object.assign(module.exports, { createWorkflowMemory, validate, cleanItem, MAX_ITEMS, MAX_NAME, MAX_PROMPT });
