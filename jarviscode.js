'use strict';
/* JARVIS Code: a coding panel in the chat. You pick a project folder, a mode and a model, and describe what you want.
     Build — JARVIS's AI writes the files. Two steps: /api/code/generate returns the files WITHOUT writing anything,
             the page shows them, then /api/code/apply writes them (outside ~/jarvis it asks your permission first,
             like every other change). Existing files are backed up to JARVIS's trash so "undo" can restore them.
     Plan  — the steps and files it would create or change; nothing is written.
     Ask   — an answer about the project (it sees the file list and the small text files).
   The model never touches the disk: it only returns text, which is parsed and checked here. */
const fs = require('fs');
const path = require('path');

const TEXT_EXT = /\.(html?|css|js|mjs|cjs|ts|tsx|jsx|json|md|txt|py|c|cpp|cc|h|hpp|java|cs|go|rs|rb|php|sql|sh|yml|yaml|toml|ini|svg|xml|vue|svelte|kt|swift)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'target', 'out', '.idea', '.vscode']);

/* ---------- pure helpers (tests/jarviscode.test.js) ---------- */
// The model's Build answer → [{ path, content }]. Files are written between markers:
//   === FILE: src/app.js ===
//   …content…
//   === END ===
// A fenced block inside a file section is unwrapped. Paths must stay inside the project folder.
function parseFiles(text) {
  const out = [], re = /^[ \t]*={3,}\s*FILE:\s*(.+?)\s*={3,}[ \t]*\r?\n([\s\S]*?)^[ \t]*={3,}\s*END\s*={3,}[ \t]*$/gim;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const p = cleanRelPath(m[1]);
    if (!p) continue;
    let body = m[2];
    const fence = body.match(/^\s*```[\w+-]*\s*\r?\n([\s\S]*?)\r?\n\s*```\s*$/);
    if (fence) body = fence[1];
    out.push({ path: p, content: body.replace(/\s+$/, '') + '\n' });
  }
  return out;
}
// When the model ignores the FILE markers and just writes ```html / ```css / ```js blocks (small models do):
// one block per kind becomes index.html / style.css / script.js (or the file name written just above the block).
function parseFencedFallback(text) {
  const out = [], seen = new Set(), re = /(?:^|\n)([^\n]*)\n?```([\w+-]*)[^\n]*\n([\s\S]*?)\n```/g;
  const KIND = { html: 'index.html', htm: 'index.html', css: 'style.css', js: 'script.js', javascript: 'script.js', py: 'main.py', python: 'main.py' };
  let m;
  while ((m = re.exec(String(text || '')))) {
    const named = (m[1].match(/([\w\-./]+\.(?:html?|css|js|py|json|md))\b/i) || [])[1];
    const lang = (m[2] || '').toLowerCase() || (/<!doctype html|<html[\s>]/i.test(m[3]) ? 'html' : '');
    const p = cleanRelPath(named || KIND[lang]);
    if (!p || seen.has(p) || m[3].trim().length < 20) continue;
    seen.add(p); out.push({ path: p, content: m[3].replace(/\s+$/, '') + '\n' });
  }
  return out;
}
// "src/app.js" stays; absolute paths, drives, "..", odd characters → null.
function cleanRelPath(p) {
  const s = String(p || '').trim().replace(/^[`"']|[`"']$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.length > 160 || /^[a-z]:/i.test(s) || s.startsWith('/') || /[<>:"|?*\x00-\x1f]/.test(s)) return null;
  const parts = s.split('/').filter(Boolean);
  if (!parts.length || parts.length > 6 || parts.some(x => x === '..' || x === '.' || SKIP.has(x))) return null;
  return parts.join('/');
}
// What the model is told about the project: the file tree and the small text files (most relevant first).
function projectContext(dir, prompt, { maxFiles = 8, maxBytes = 40000 } = {}) {
  const tree = [], files = [];
  const walk = (d, depth) => {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (tree.length >= 200 || it.name.startsWith('.') || SKIP.has(it.name)) continue;
      const full = path.join(d, it.name), relp = path.relative(dir, full).split(path.sep).join('/');
      if (it.isDirectory()) { tree.push(relp + '/'); if (depth < 3) walk(full, depth + 1); }
      else { tree.push(relp); if (TEXT_EXT.test(it.name)) { try { const st = fs.statSync(full); if (st.size <= 40000) files.push({ relp, size: st.size, full }); } catch {} } }
    }
  };
  walk(dir, 0);
  const words = String(prompt || '').toLowerCase().split(/[^a-z0-9.]+/).filter(w => w.length > 2);
  const score = f => words.filter(w => f.relp.toLowerCase().includes(w)).length * 10 + (/(^|\/)(index\.html|main\.\w+|app\.\w+|script\.js|style\.css|readme\.md)$/i.test(f.relp) ? 3 : 0) - f.relp.split('/').length;
  files.sort((a, b) => score(b) - score(a));
  let used = 0; const shown = [];
  for (const f of files) {
    if (shown.length >= maxFiles || used + f.size > maxBytes) continue;
    try { shown.push({ path: f.relp, content: fs.readFileSync(f.full, 'utf8') }); used += f.size; } catch {}
  }
  return { tree, files: shown };
}

const SYSTEM = {
  build: `You are JARVIS Code, a careful senior developer working inside ONE project folder on the user's laptop.
Do exactly what the user asks. Write complete, working code — never placeholders, never "..." or "rest of the code here".
Output every file you create or change IN FULL, each one exactly like this (path relative to the project folder):
=== FILE: path/to/file.ext ===
<the whole file>
=== END ===
Before the files, write at most 3 short lines saying what you are doing. After the files, one short line on how to run or open it.
Rules: plain HTML/CSS/JavaScript for websites unless the project already uses something else; no external CDNs unless asked;
keep existing files' style; only output files that need to change; never output files outside the project folder.`,
  plan: `You are JARVIS Code, a senior developer. The user describes a change to the project below.
Reply with a short, concrete plan: a numbered list of steps, then the files you would create or change (one line each, with what changes).
Do NOT write the code yet. Keep it under 20 lines.`,
  ask: `You are JARVIS Code, a senior developer. Answer the user's question about the project below — clearly and briefly, with small code snippets only where they help.
Use only what you can see in the files; if something isn't there, say so.`,
};

module.exports = function setupJarvisCode(app, { llm, DEFAULT_MODEL, SANDBOX, anyPath, approvedChange, whereDir, rel, TRASH }) {
  const model = req => String((req.body && req.body.model) || DEFAULT_MODEL);
  const slug = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-project';
  // The project folder: one you chose (a path, "desktop", "D drive"…), or a new ~/jarvis/Projects/<name>.
  function folderOf(b, { create } = {}) {
    if (b.folder) {
      const w = whereDir ? whereDir(String(b.folder)) : null;
      const p = w && w.path ? w.path : anyPath(String(b.folder));
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return { error: `I can't find the folder "${b.folder}"` };
      return { path: p };
    }
    const p = path.join(SANDBOX, 'Projects', slug(b.name || String(b.prompt || '').split(/\s+/).slice(0, 5).join(' ')));
    if (create) fs.mkdirSync(p, { recursive: true });
    return { path: p, fresh: !fs.existsSync(p) || !fs.readdirSync(p).length };
  }

  app.post('/api/code/generate', async (req, res) => {
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) return res.status(400).json({ error: 'What should I build or change?' });
    const mode = ['build', 'plan', 'ask'].includes(b.mode) ? b.mode : 'build';
    const f = folderOf(b);
    if (f.error) return res.status(404).json({ error: f.error });
    const ctxt = fs.existsSync(f.path) ? projectContext(f.path, prompt) : { tree: [], files: [] };
    const context = 'Project folder: ' + f.path + '\n\nFiles:\n' + (ctxt.tree.join('\n') || '(empty — a new project)')
      + (ctxt.files.length ? '\n\nCurrent contents:\n' + ctxt.files.map(x => '=== FILE: ' + x.path + ' ===\n' + x.content.replace(/\s+$/, '') + '\n=== END ===').join('\n\n') : '');
    // The JARVIS Code conversation so far (earlier requests, plans, answers): "okay build it" means the plan above.
    const history = (Array.isArray(b.history) ? b.history : []).slice(-8)
      .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
      .map(h => ({ role: h.role, content: h.text.slice(0, 3000) }));
    const ask = (extra) => llm.complete({ model: model(req), system: SYSTEM[mode],
      messages: [...history, { role: 'user', content: context + '\n\nRequest: ' + prompt + (extra || '') }],
      temperature: mode === 'build' ? 0.2 : 0.4, maxTokens: mode === 'build' ? 8000 : 1500, numCtx: mode === 'build' ? 24576 : 16384, timeoutMs: 600000 });
    let out;
    try { out = await ask(); } catch (e) { return res.status(502).json({ error: (e && e.message) || String(e) }); }
    if (mode !== 'build') return res.json({ success: true, mode, folder: f.path, text: String(out || '').trim() });
    let files = parseFiles(out);
    if (!files.length) files = parseFencedFallback(out);
    if (!files.length) {   // one more try, saying exactly what's missing
      try { out = await ask('\n\nIMPORTANT: write the actual code now. Output each file in full between "=== FILE: name ===" and "=== END ===" lines — nothing else is saved.'); } catch (e) {}
      files = parseFiles(out); if (!files.length) files = parseFencedFallback(out);
    }
    if (!files.length) return res.status(502).json({ error: 'The AI didn’t return any files. Try again, describe it more simply, or pick a stronger model.', raw: String(out || '').slice(0, 2000) });
    const note = String(out).replace(/^[ \t]*={3,}\s*FILE:[\s\S]*?^[ \t]*={3,}\s*END\s*={3,}[ \t]*$/gim, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 800);
    res.json({ success: true, mode, folder: f.path, fresh: !!f.fresh, note,
      files: files.map(x => ({ path: x.path, content: x.content, lines: x.content.split('\n').length - 1, exists: fs.existsSync(path.join(f.path, ...x.path.split('/'))) })) });
  });

  // Writes the files /api/code/generate returned (the page sends them back after you've seen the list).
  app.post('/api/code/apply', (req, res) => {
    const b = req.body || {};
    const f = folderOf(b, { create: !b.folder });
    if (f.error) return res.status(404).json({ error: f.error });
    const list = (Array.isArray(b.files) ? b.files : []).slice(0, 30).map(x => ({ path: cleanRelPath(x && x.path), content: String((x && x.content) || '') })).filter(x => x.path);
    if (!list.length) return res.status(400).json({ error: 'No files to write' });
    if (list.some(x => x.content.length > 1024 * 1024)) return res.status(413).json({ error: 'A file is too large' });
    const targets = list.map(x => anyPath(path.join(f.path, ...x.path.split('/')), { forWrite: true }));
    if (targets.some(t => !t)) return res.status(400).json({ error: 'One of the files would land somewhere off-limits' });
    if (!approvedChange(req, res, 'write ' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' in', ...targets)) return;
    const written = [];
    try {
      list.forEach((x, i) => {
        const t = targets[i], existed = fs.existsSync(t);
        let backup = null;
        if (existed && TRASH) { try { backup = Date.now() + '_' + i + '_' + path.basename(t); fs.copyFileSync(t, path.join(TRASH, backup)); } catch { backup = null; } }
        fs.mkdirSync(path.dirname(t), { recursive: true });
        fs.writeFileSync(t, x.content);
        written.push({ path: x.path, full: t, name: rel(t), created: !existed, backup, lines: x.content.split('\n').length - 1 });
      });
    } catch (e) { return res.status(500).json({ error: e.message, written }); }
    res.json({ success: true, folder: f.path, written });
  });
};
module.exports.parseFiles = parseFiles;
module.exports.parseFencedFallback = parseFencedFallback;
module.exports.cleanRelPath = cleanRelPath;
module.exports.projectContext = projectContext;
