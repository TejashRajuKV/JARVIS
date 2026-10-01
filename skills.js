'use strict';
/* Skills that need the AI with fixed instructions: the website generator, the DSA coach and viva practice.
   The prompts live here (server side), so the page only sends the user's own words. Pure helpers are exported for tests. */
const fs = require('fs');
const path = require('path');

/* ---------- pure helpers ---------- */
const slugify = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-website';
// The model's reply → a full HTML document (strips ``` fences and chatter before/after the page).
function extractHtml(text) {
  let t = String(text || '');
  const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  if (fence && /<(html|body|!doctype)/i.test(fence[1])) t = fence[1];
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.search(/<\/html>/i);
  if (end >= 0) t = t.slice(0, end + 7);
  t = t.trim();
  if (!/<body[\s>]/i.test(t) && !/<html[\s>]/i.test(t)) return null;
  if (!/^<!doctype/i.test(t)) t = '<!DOCTYPE html>\n' + t;
  return t;
}
// Removes things a generated page must not do: load remote scripts or send data anywhere.
function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^>]*\bsrc\s*=\s*["']?https?:[^>]*>\s*<\/script>/gi, '<!-- external script removed by JARVIS -->')
    .replace(/<form\b([^>]*)\baction\s*=\s*["'][^"']*["']/gi, '<form$1')
    .replace(/\bfetch\s*\(\s*["']https?:/gi, 'void (')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');
}
function parseJsonLoose(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  for (const [a, b] of [['{', '}'], ['[', ']']]) {
    const i = t.indexOf(a), j = t.lastIndexOf(b);
    if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch {} }
  }
  return null;
}
const clampScore = n => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

const SITE_SYSTEM = `You are an expert front-end developer. Build ONE complete, self-contained web page.
Rules:
- Output ONLY the HTML document, starting with <!DOCTYPE html>. No explanations before or after.
- Put all CSS in one <style> tag and any JavaScript in one <script> tag. No external files, frameworks, CDNs or web fonts.
- Responsive (looks good on phones), semantic HTML, accessible (labels, alt text, good contrast).
- Use realistic placeholder content that matches the brief, never "Lorem ipsum".
- Forms must not send data anywhere: on submit, prevent default and show a friendly confirmation message on the page.
- Keep it under about 400 lines.`;
const SITE_EDIT_SYSTEM = `You are an expert front-end developer editing an existing single-file web page.
Apply ONLY the requested change, keep everything else the same, and output the COMPLETE updated HTML document starting with <!DOCTYPE html>. No explanations.
Keep the same rules: inline CSS/JS only, no external files, forms never send data anywhere.`;
const COACH_SYSTEM = {
  hint: n => `You are a patient DSA (data structures & algorithms) coach for a CS student. Give hint number ${n} of 3 for the problem.
Never give the full solution or any code in a real programming language. End with one short question that nudges them to try.
${[
  'THIS IS HINT 1 — THE SMALLEST NUDGE: in at most 2 short sentences, only say which data structure or pattern to think about and why it helps. Do NOT describe the steps of the algorithm, do NOT say what to store or look up, do NOT mention complements, pointers moves or recurrences.',
  'THIS IS HINT 2: in at most 4 short sentences, explain the key idea of the approach in plain words (what to track and when), but not a full step-by-step algorithm and no code.',
  'THIS IS HINT 3: give a short pseudocode-level outline (numbered steps in plain English, max 6 steps) plus the time complexity. Still no code in a real language.',
][n - 1]}`,
  check: `You are a DSA coach. The student describes their approach to a problem. Say whether it is correct and efficient.
Point out bugs, missed edge cases and its time/space complexity. If there is a better approach, name the idea but do NOT write code or the full solution. Be encouraging and brief (max 8 short sentences).`,
  solution: lang => `You are a DSA coach. Give the clean, optimal solution to the problem in ${lang}.
Format: one short paragraph explaining the idea, then ONE code block with the complete solution (with a short comment on tricky lines), then "Time: O(...), Space: O(...)", then 2 edge cases to test. Nothing else.`,
  explain: `You are a DSA coach. Explain the problem statement simply: what the input and output are, one small worked example, and the constraints that matter. Do not give the approach or any code. Max 6 sentences.`,
};
const FIX_SYSTEM = lang => `You fix a student's ${lang} program that failed. Reply in exactly this format and nothing else:
WHAT WENT WRONG: <2-4 short sentences in simple English: what the error means, which line, why it happened>
FIX: <one sentence: what you changed>
\`\`\`
<the COMPLETE corrected file — keep their structure, names and comments; change only what is needed>
\`\`\`
If the program waits for input that wasn't given, say so and keep the input code (don't remove it).`;
// "WHAT WENT WRONG: … FIX: … ```code```" → { explanation, code }
function parseFix(text) {
  const t = String(text || '');
  const blocks = [...t.matchAll(/```[\w+#-]*\s*\n([\s\S]*?)```/g)];
  const code = blocks.length ? blocks.sort((a, b) => b[1].length - a[1].length)[0][1].replace(/\s+$/, '') + '\n' : '';
  const before = (blocks.length ? t.slice(0, t.indexOf('```')) : t).trim();
  const explanation = before.replace(/^\s*WHAT WENT WRONG:\s*/i, '').replace(/\n\s*FIX:\s*/i, '\n\n**Fix:** ').trim().slice(0, 1200);
  return { explanation, code };
}
const VIVA_Q_SYSTEM = (n, level) => `You are an examiner taking a ${level} viva / technical interview. Write exactly ${n} questions on the topic, starting easy and getting harder.
Each question must be answerable out loud in 2-4 sentences (no code writing). Output ONLY JSON: {"questions":["...", "..."]}`;
const VIVA_GRADE_SYSTEM = `You are a fair but strict viva examiner. Grade the student's spoken answer to the question.
Output ONLY JSON: {"score": <0-10>, "feedback": "<one or two short sentences>", "missed": ["<key point they missed>", ...], "model_answer": "<a strong 2-3 sentence answer>"}
If the answer is empty, "I don't know" or off-topic, score 0-2. Spelling/grammar from speech recognition must not lower the score.`;

/* ---------- routes ---------- */
module.exports = function setupSkills(app, { llm, DEFAULT_MODEL, SANDBOX, openPath, rel, findAllowed, anyPath, approvedChange }) {
  const model = req => String((req.body && req.body.model) || DEFAULT_MODEL);
  const fail = (res, e) => res.status(502).json({ error: (e && e.message) || String(e) });
  const SITES = path.join(SANDBOX, 'Projects');
  const siteDir = name => path.join(SITES, slugify(name));
  // A frontend for one of YOUR projects ("frontend for my calculator project"): <project>/frontend/index.html.
  // folder must be an existing folder JARVIS may use; writing outside ~/jarvis still needs your OK (approvedChange).
  const projectDir = folder => { const p = anyPath ? anyPath(String(folder || '')) : null; return p && fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'frontend') : null; };
  const dirOf = b => b && b.folder ? projectDir(b.folder) : siteDir(b && b.name);

  // Website generator: brief → ~/jarvis/Projects/<name>/index.html, opened in the browser.
  app.post('/api/skill/site', async (req, res) => {
    const b = req.body || {};
    const what = String(b.what || '').trim().slice(0, 300);
    if (!what) return res.status(400).json({ error: 'What is the website for?' });
    const brief = 'Website: ' + what + '\nSections / content: ' + String(b.sections || 'choose sensible sections').slice(0, 600)
      + '\nStyle: ' + String(b.style || 'clean, modern, professional').slice(0, 300) + '\nAudience: ' + String(b.audience || 'general visitors').slice(0, 200);
    const name = slugify(b.name || what);
    const target = b.folder ? projectDir(b.folder) : siteDir(name);
    if (!target) return res.status(404).json({ error: 'I can’t find that project folder any more.' });
    if (b.folder && approvedChange && !approvedChange(req, res, 'create the frontend in', path.join(target, 'index.html'))) return;
    let html;
    try {
      const out = await llm.complete({ model: model(req), system: SITE_SYSTEM, messages: [{ role: 'user', content: brief }], temperature: 0.4, maxTokens: 7000, numCtx: 12288, timeoutMs: 600000 });
      html = extractHtml(out);
    } catch (e) { return fail(res, e); }
    if (!html) return res.status(502).json({ error: 'The AI didn’t return a web page. Try again, or pick a stronger model in Settings (small local models sometimes struggle with long pages).' });
    const dir = target; fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'index.html');
    let backup = null;
    if (fs.existsSync(file)) { backup = file.replace(/index\.html$/, 'index.previous.html'); try { fs.copyFileSync(file, backup); } catch { backup = null; } }
    fs.writeFileSync(file, sanitizeHtml(html));
    if (b.open !== false) openPath(file);
    res.json({ success: true, name, file: rel(file), folder: rel(dir), dir, path: file, lines: html.split('\n').length, replaced: !!backup });
  });
  // "make the header red": edits the last site in place (the previous version is kept as index.previous.html).
  app.post('/api/skill/siteEdit', async (req, res) => {
    const b = req.body || {};
    const file = path.join(dirOf(b) || siteDir(b.name), 'index.html');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'I can’t find that website any more.' });
    if (b.folder && approvedChange && !approvedChange(req, res, 'change the frontend in', file)) return;
    const change = String(b.change || '').trim().slice(0, 500);
    if (!change) return res.status(400).json({ error: 'What should I change?' });
    const cur = fs.readFileSync(file, 'utf8');
    if (cur.length > 60000) return res.status(413).json({ error: 'That page is too big for me to edit in one go.' });
    let html;
    try {
      const out = await llm.complete({ model: model(req), system: SITE_EDIT_SYSTEM, messages: [{ role: 'user', content: 'Change requested: ' + change + '\n\nCurrent page:\n' + cur }], temperature: 0.2, maxTokens: 8000, numCtx: 16384, timeoutMs: 600000 });
      html = extractHtml(out);
    } catch (e) { return fail(res, e); }
    if (!html || html.length < cur.length * 0.4) return res.status(502).json({ error: 'The AI’s edit looked incomplete, so I kept the page as it was. Try describing the change more simply.' });
    fs.copyFileSync(file, file.replace(/index\.html$/, 'index.previous.html'));
    fs.writeFileSync(file, sanitizeHtml(html));
    if (b.open !== false) openPath(file);
    res.json({ success: true, file: rel(file) });
  });
  app.post('/api/skill/siteOpen', (req, res) => {
    const file = path.join(dirOf(req.body || {}) || siteDir((req.body || {}).name), 'index.html');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'I can’t find that website any more.' });
    openPath(file); res.json({ success: true, file: rel(file) });
  });
  app.post('/api/skill/siteRevert', (req, res) => {
    const dir = dirOf(req.body || {}) || siteDir((req.body || {}).name), file = path.join(dir, 'index.html'), prev = path.join(dir, 'index.previous.html');
    if ((req.body || {}).folder && approvedChange && !approvedChange(req, res, 'change the frontend in', file)) return;
    if (!fs.existsSync(prev)) return res.status(404).json({ error: 'There’s no earlier version to go back to.' });
    const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
    fs.copyFileSync(prev, file); if (cur) fs.writeFileSync(prev, cur);
    openPath(file);
    res.json({ success: true, file: rel(file) });
  });

  // Error fixer: a file that failed to compile/run + its error → a plain-English explanation and the fixed file.
  app.post('/api/skill/fix', async (req, res) => {
    const b = req.body || {};
    const p = findAllowed ? findAllowed(String(b.name || ''), { kind: 'file' }) : null;
    if (!p) return res.status(404).json({ error: 'I can’t find that file any more.' });
    const code = fs.readFileSync(p, 'utf8');
    if (code.length > 40000) return res.status(413).json({ error: 'That file is too long for me to fix in one go.' });
    const lang = { '.py': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.c': 'C', '.cpp': 'C++', '.cc': 'C++' }[path.extname(p).toLowerCase()] || 'the same language';
    const err = String(b.stderr || '').slice(-4000), out = String(b.stdout || '').slice(-1500);
    try {
      const reply = await llm.complete({ model: model(req), system: FIX_SYSTEM(lang), temperature: 0.1, maxTokens: 3500, numCtx: 12288, timeoutMs: 300000,
        messages: [{ role: 'user', content: 'File: ' + path.basename(p) + '\n\n```\n' + code + '\n```\n\nWhat happened when it ran' + (b.compile ? ' (compile error)' : '') + ':\n```\n' + (err || out || '(no output)') + '\n```' + (b.stdin ? '\n\nInput given: ' + String(b.stdin).slice(0, 500) : '') }] });
      const parsed = parseFix(reply);
      if (!parsed.code) return res.status(502).json({ error: 'The AI didn’t return fixed code. Try again, or pick a stronger model in Settings.', explanation: parsed.explanation });
      res.json({ success: true, name: rel(p), lang, explanation: parsed.explanation, code: parsed.code, same: parsed.code.trim() === code.trim() });
    } catch (e) { fail(res, e); }
  });

  // DSA coach: hints (1-3) → check my approach → solution, one call each.
  app.post('/api/skill/coach', async (req, res) => {
    const b = req.body || {};
    const problem = String(b.problem || '').trim().slice(0, 1500);
    if (!problem) return res.status(400).json({ error: 'Which problem?' });
    const mode = ['hint', 'check', 'solution', 'explain'].includes(b.mode) ? b.mode : 'hint';
    const level = Math.max(1, Math.min(3, +b.level || 1));
    const lang = ['Python', 'C++', 'Java', 'JavaScript', 'C'].find(l => l.toLowerCase() === String(b.lang || '').toLowerCase()) || 'Python';
    const system = mode === 'hint' ? COACH_SYSTEM.hint(level) : mode === 'solution' ? COACH_SYSTEM.solution(lang) : COACH_SYSTEM[mode];
    // earlier hints go along, so hint 2 builds on hint 1 instead of switching to a different approach
    const prev = (Array.isArray(b.previous) ? b.previous : []).map(h => String(h || '').slice(0, 600)).filter(Boolean).slice(-3);
    const user = 'Problem: ' + problem
      + (prev.length ? '\n\nHints already given (continue the SAME approach, go one step further, do not repeat them):\n' + prev.map((h, i) => (i + 1) + '. ' + h).join('\n') : '')
      + (mode === 'check' ? '\n\nMy approach: ' + String(b.approach || '').slice(0, 1500) : '');
    try { res.json({ success: true, mode, level, lang, text: (await llm.complete({ model: model(req), system, messages: [{ role: 'user', content: user }], temperature: 0.3, maxTokens: mode === 'solution' ? 1500 : mode === 'hint' ? [0, 110, 220, 380][level] : 500, timeoutMs: 180000 })).trim() }); }
    catch (e) { fail(res, e); }
  });

  // UI design prompt: turns the student's own answers into one ready-to-paste prompt (no code, no invented project).
  app.post('/api/skill/uiprompt', async (req, res) => {
    const b = req.body || {}, f = k => String(b[k] || '').trim().slice(0, 600);
    if (!f('task') || !f('context')) return res.status(400).json({ error: 'I need the task and the project context.' });
    const system = `You write prompts for AI UI generators (v0, Lovable, Claude, Figma AI) using the TCREI framework. Write ONE prompt the student can paste.
Use ONLY the details given. Never invent a different project, never use placeholders like [Insert ...]. If a detail is missing, choose a sensible default and say it is a default.
Format it exactly with these five headings, in this order, each followed by its content:
**Task** — one or two sentences: what to design and the exact output wanted (e.g. a single responsive page as code, or screens).
**Context** — the project, who uses it, their goal, and the pages/sections and key components the UI needs.
**References** — look and feel, colours, fonts, example sites, tech stack.
**Evaluate** — a checklist the AI must check its design against before answering (the student's must-haves plus responsive, accessible, consistent).
**Iterate** — an instruction to the AI, not your own answer: "After the design, list 2-3 assumptions you made and suggest 2 variations I can ask for next."
Output ONLY the prompt. No code, no intro sentence, no closing remarks.`;
    const user = 'Task: ' + f('task') + '\nContext: ' + f('context') + '\nReferences: ' + (f('refs') || 'not given') + '\nMust get right: ' + (f('must') || 'not given');
    try { res.json({ success: true, text: (await llm.complete({ model: model(req), system, messages: [{ role: 'user', content: user }], temperature: 0.5, maxTokens: 900, timeoutMs: 180000 })).trim() }); }
    catch (e) { fail(res, e); }
  });

  // Viva / interview practice.
  app.post('/api/skill/viva/questions', async (req, res) => {
    const b = req.body || {};
    const topic = String(b.topic || '').trim().slice(0, 120);
    if (!topic) return res.status(400).json({ error: 'Which subject?' });
    const n = Math.max(3, Math.min(10, +b.n || 5));
    const level = /interview|placement|job|sde|company/i.test(topic + ' ' + (b.level || '')) ? 'placement interview' : 'college (B.Tech)';
    try {
      const out = await llm.complete({ model: model(req), system: VIVA_Q_SYSTEM(n, level), messages: [{ role: 'user', content: 'Topic: ' + topic }], json: true, temperature: 0.6, maxTokens: 900, timeoutMs: 180000 });
      const j = parseJsonLoose(out);
      const qs = (Array.isArray(j) ? j : j && j.questions || []).map(q => String(q || '').trim()).filter(q => q.length > 8).slice(0, n);
      if (qs.length < 3) return res.status(502).json({ error: 'The AI didn’t give me proper questions. Try again or pick another model.' });
      res.json({ success: true, topic, level, questions: qs });
    } catch (e) { fail(res, e); }
  });
  app.post('/api/skill/viva/grade', async (req, res) => {
    const b = req.body || {};
    const q = String(b.question || '').slice(0, 500), a = String(b.answer || '').slice(0, 2500);
    if (!q) return res.status(400).json({ error: 'No question' });
    try {
      const out = await llm.complete({ model: model(req), system: VIVA_GRADE_SYSTEM, messages: [{ role: 'user', content: 'Topic: ' + String(b.topic || '').slice(0, 120) + '\nQuestion: ' + q + '\nStudent answer: ' + (a || '(no answer)') }], json: true, temperature: 0.1, maxTokens: 500, timeoutMs: 180000 });
      const j = parseJsonLoose(out) || {};
      res.json({ success: true, score: clampScore(j.score), feedback: String(j.feedback || '').slice(0, 400), missed: (Array.isArray(j.missed) ? j.missed : []).map(String).slice(0, 4), model: String(j.model_answer || '').slice(0, 600) });
    } catch (e) { fail(res, e); }
  });
};
Object.assign(module.exports, { parseFix, slugify, extractHtml, sanitizeHtml, parseJsonLoose, clampScore });
