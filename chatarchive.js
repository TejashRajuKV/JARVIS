'use strict';
/* Your old chats, searchable. The page keeps only the last 80 messages (about a day), so "what did I decide about the project last week?" had
   no answer. From now on every message is also appended to ~/jarvis/.chat-archive/YYYY-MM.jsonl: one small file per month, in a dot-folder so
   file search and the knowledge index never read it. Nothing leaves the laptop. At most 20 MB are kept (the oldest month goes first).
   Search is plain keyword matching with a date window read from the question ("last week", "in September", "3 days ago"); an AI summary is only
   made when the page asks for it (and the page asks first when the AI is an online one). "Forget my chat archive" erases the folder.
   Pure helpers (parseWindow, queryTerms, buildExchanges, rankExchanges) are exported for tests. */
const fs = require('fs');
const path = require('path');
const SkillRouter = require('./skillrouter');

const MAX_TOTAL = 20 * 1024 * 1024, MAX_TEXT = 4000, MAX_BATCH = 300, MAX_RESULTS = 8;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])\.jsonl$/;
const DAY = 864e5;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14 };
const num = s => (/^\d+$/.test(s) ? parseInt(s, 10) : NUM[s] || 0);

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const weekStart = t => { const d = new Date(startOfDay(new Date(t))); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); };       // Monday
const monthStart = (y, m) => new Date(y, m, 1).getTime();
const fmtDay = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// Reads a date phrase out of a question. → { from, to, label, rest } (from/to in ms, null when the question names no time; rest = the text without the phrase)
function parseWindow(text, now = Date.now()) {
  let t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  const today = startOfDay(new Date(now)), tomorrow = addDays(today, 1), nd = new Date(now);
  const take = (re) => { const m = t.match(re); if (!m) return null; t = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' '); return m; };
  const out = (from, to, label) => ({ from, to, label, rest: t.replace(/\b(?:in|on|during|from|of|at|around)\s*$/i, ' ').replace(/\s+/g, ' ').trim() });
  let m;
  if ((m = take(/\blast night\b/))) return out(addDays(today, -1) + 18 * 3600e3, today + 6 * 3600e3, 'last night');
  if ((m = take(/\b(?:the )?day before yesterday\b/))) return out(addDays(today, -2), addDays(today, -1), fmtDay(addDays(today, -2)));
  if ((m = take(/\byesterday\b/))) return out(addDays(today, -1), today, 'yesterday (' + fmtDay(addDays(today, -1)) + ')');
  if ((m = take(/\b(?:today|this morning|this afternoon|this evening|tonight)\b/))) return out(today, tomorrow, 'today');
  if ((m = take(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen) (day|week|month)s? ago\b/))) {
    const n = num(m[1]), unit = m[2];
    if (unit === 'day') return out(addDays(today, -n), addDays(today, -n + 1), fmtDay(addDays(today, -n)));
    if (unit === 'week') { const s = weekStart(addDays(today, -7 * n)); return out(s, addDays(s, 7), 'the week of ' + fmtDay(s)); }
    const d = new Date(nd.getFullYear(), nd.getMonth() - n, 1); return out(d.getTime(), monthStart(d.getFullYear(), d.getMonth() + 1), MONTHS[d.getMonth()] + ' ' + d.getFullYear());
  }
  if ((m = take(/\b(?:in |over |during )?(?:the )?(?:last|past) (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen) (day|week|month)s?\b/))) {
    const n = Math.max(1, num(m[1])), unit = m[2];
    const from = unit === 'day' ? addDays(today, -n) : unit === 'week' ? addDays(today, -7 * n) : new Date(nd.getFullYear(), nd.getMonth() - n, nd.getDate()).getTime();
    return out(from, tomorrow, 'the last ' + (n === 1 ? unit : n + ' ' + unit + 's'));
  }
  if ((m = take(/\b(?:in |during )?(?:the )?(?:last|past|previous) week\b/))) { const s = addDays(weekStart(today), -7); return out(s, addDays(s, 7), 'last week (' + fmtDay(s) + ' – ' + fmtDay(addDays(s, 6)) + ')'); }
  if ((m = take(/\bthis week\b/))) return out(weekStart(today), tomorrow, 'this week');
  if ((m = take(/\b(?:in |during )?(?:the )?(?:last|previous) month\b/))) { const d = new Date(nd.getFullYear(), nd.getMonth() - 1, 1); return out(d.getTime(), monthStart(d.getFullYear(), d.getMonth() + 1), 'last month (' + MONTHS[d.getMonth()] + ')'); }
  if ((m = take(/\bthis month\b/))) return out(monthStart(nd.getFullYear(), nd.getMonth()), tomorrow, 'this month');
  if ((m = take(/\b(?:in |during )?(?:the )?(?:last|previous) year\b/))) return out(monthStart(nd.getFullYear() - 1, 0), monthStart(nd.getFullYear(), 0), String(nd.getFullYear() - 1));
  if ((m = take(/\bthis year\b/))) return out(monthStart(nd.getFullYear(), 0), tomorrow, 'this year');
  // a day: "on 5 october", "on october 5th", "5th of october 2025"
  const monthRe = '(' + MONTHS.join('|') + '|' + Object.keys(MON_ABBR).join('|') + ')';
  const monthIdx = s => (MONTHS.includes(s) ? MONTHS.indexOf(s) : MON_ABBR[s]);
  if ((m = take(new RegExp('\\b(?:on )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ' + monthRe + '(?: (\\d{4}))?\\b')))) {
    const mi = monthIdx(m[2]); let y = m[3] ? +m[3] : nd.getFullYear(); let d = new Date(y, mi, +m[1]);
    if (!m[3] && d.getTime() > now + DAY) d = new Date(y - 1, mi, +m[1]);
    return out(startOfDay(d), addDays(startOfDay(d), 1), fmtDay(startOfDay(d)) + ' ' + d.getFullYear());
  }
  if ((m = take(new RegExp('\\b(?:on )?' + monthRe + ' (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b')))) {
    const mi = monthIdx(m[1]); let y = m[3] ? +m[3] : nd.getFullYear(); let d = new Date(y, mi, +m[2]);
    if (!m[3] && d.getTime() > now + DAY) d = new Date(y - 1, mi, +m[2]);
    return out(startOfDay(d), addDays(startOfDay(d), 1), fmtDay(startOfDay(d)) + ' ' + d.getFullYear());
  }
  // a whole month: "in september", "in sept 2025", "september"  ("may" only after in/during/of: it is also a verb)
  if ((m = take(new RegExp('\\b(?:in|during|of|from) ' + monthRe + '(?: (\\d{4}))?\\b'))) || (m = take(new RegExp('\\b(?!may\\b)' + monthRe + '(?: (\\d{4}))?\\b')))) {
    const mi = monthIdx(m[1]); let y = m[2] ? +m[2] : nd.getFullYear();
    if (!m[2] && monthStart(y, mi) > now) y--;
    return out(monthStart(y, mi), monthStart(y, mi + 1), MONTHS[mi] + ' ' + y);
  }
  if ((m = take(/\b(?:in|during|of) (20\d\d)\b/))) return out(monthStart(+m[1], 0), monthStart(+m[1] + 1, 0), m[1]);
  if ((m = take(new RegExp('\\b(?:on |last )?(' + WEEKDAYS.join('|') + ')\\b')))) {
    const wd = WEEKDAYS.indexOf(m[1]); let d = today; while (new Date(d).getDay() !== wd) d = addDays(d, -1);
    return out(d, addDays(d, 1), fmtDay(d));
  }
  return { from: null, to: null, label: '', rest: t.trim() };
}

// The words to look for: what is left after the date phrase and the question wrapper ("what did I decide about …")
function queryTerms(rest) {
  let s = String(rest || '').toLowerCase()
    .replace(/\b(?:what|when|did|have|do|does|i|we|you|ever|decide[d]?|say|said|ask(?:ed)?|discuss(?:ed)?|talk(?:ed)?|tell|told|mention(?:ed)?|plan(?:ned)?|conclude[d]?|about|regarding|search|find|look|through|my|our|old|past|previous|chats?|chat history|chat archive|conversations?|messages|history|for|the|in|on|with)\b/g, ' ');
  return SkillRouter.content(s);
}

// Lines of {t, role, text} (any order) → exchanges: a user message and the replies that followed it, up to the next user message
function buildExchanges(msgs) {
  const sorted = msgs.slice().sort((a, b) => a.t - b.t);
  const ex = []; let cur = null;
  for (const m of sorted) {
    if (m.role === 'user') { cur = { t: m.t, user: m.text, assistant: '' }; ex.push(cur); }
    else if (m.role === 'assistant') { if (!cur) { cur = { t: m.t, user: '', assistant: '' }; ex.push(cur); } cur.assistant += (cur.assistant ? '\n' : '') + m.text; }
  }
  return ex;
}
// Best matches first. With no search words, everything in the window (newest first).
function rankExchanges(exchanges, terms) {
  if (!terms.length) return exchanges.slice().sort((a, b) => b.t - a.t).map(e => ({ ...e, score: 0 }));
  const out = [];
  for (const e of exchanges) {
    const u = new Set(SkillRouter.content(e.user)), a = new Set(SkillRouter.content(e.assistant));
    let score = 0, hit = 0;
    for (const w of terms) { const su = u.has(w), sa = a.has(w); if (su || sa) hit++; score += (su ? 2 : 0) + (sa ? 1 : 0); }
    if (!hit) continue;
    if (terms.length > 1 && hit === terms.length) score += 2;                       // every word is there
    out.push({ ...e, score });
  }
  return out.sort((a, b) => b.score - a.score || b.t - a.t);
}

function createArchive({ dir, now = Date.now, cap = MAX_TOTAL }) {
  const monthName = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '.jsonl'; };
  const files = () => { try { return fs.readdirSync(dir).filter(f => MONTH_RE.test(f)).sort(); } catch { return []; } };
  const sizeOf = f => { try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; } };
  const totalBytes = () => files().reduce((n, f) => n + sizeOf(f), 0);
  const clean = items => {
    const out = [];
    for (const it of (Array.isArray(items) ? items : []).slice(0, MAX_BATCH)) {
      if (!it || (it.role !== 'user' && it.role !== 'assistant')) continue;
      const text = String(it.text == null ? '' : it.text).replace(/\u0000/g, '').trim().slice(0, MAX_TEXT);
      if (!text) continue;
      let t = Number(it.t); if (!Number.isFinite(t) || t < 946684800000 || t > now() + DAY) t = now();
      out.push({ t, role: it.role, text, src: String(it.source || it.src || '').replace(/[^\w-]/g, '').slice(0, 12) || undefined });
    }
    return out;
  };
  function enforceCap() {
    const cur = monthName(now());
    for (;;) {
      if (totalBytes() <= cap) return;
      const old = files().filter(f => f !== cur)[0];
      if (old) { try { fs.rmSync(path.join(dir, old), { force: true }); } catch { return; } continue; }
      // only this month is left and it is too big: keep the newest 70% of its lines
      const f = path.join(dir, cur); let lines = [];
      try { lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return; }
      fs.writeFileSync(f, lines.slice(Math.floor(lines.length * 0.3)).join('\n') + '\n'); return;
    }
  }
  function append(items) {
    const list = clean(items);
    if (!list.length) return { stored: 0 };
    fs.mkdirSync(dir, { recursive: true });
    const byFile = new Map();
    for (const m of list) { const f = monthName(m.t); if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(JSON.stringify(m)); }
    for (const [f, lines] of byFile) fs.appendFileSync(path.join(dir, f), lines.join('\n') + '\n');
    enforceCap();
    return { stored: list.length };
  }
  const isEmpty = () => files().every(f => sizeOf(f) === 0);
  function backfill(items) { if (!isEmpty()) return { stored: 0, skipped: true }; return { ...append(items), skipped: false }; }
  function readRange(from, to) {
    const all = [];
    const lo = from == null ? -Infinity : from, hi = to == null ? Infinity : to;
    for (const f of files()) {
      const m = f.match(/^(\d{4})-(\d{2})/); const fs0 = monthStart(+m[1], +m[2] - 1), fe = monthStart(+m[1], +m[2]);
      if (fe <= lo - 1 || fs0 >= hi + 1) continue;                                   // this month cannot hold anything in the window
      let text = ''; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j && Number.isFinite(j.t) && j.t >= lo && j.t < hi && j.text) all.push(j);
      }
    }
    return all;
  }
  // text: the question as asked ("what did I decide about the demo last week"); from/to override the date phrase
  function search({ text, limit = MAX_RESULTS } = {}) {
    const w = parseWindow(text, now());
    const terms = queryTerms(w.rest);
    const msgs = readRange(w.from, w.to);
    const ranked = rankExchanges(buildExchanges(msgs), terms);
    return { window: { from: w.from, to: w.to, label: w.label }, terms, scanned: msgs.length, total: ranked.length, exchanges: ranked.slice(0, Math.max(1, Math.min(MAX_RESULTS, limit))) };
  }
  function status() {
    const fl = files().map(f => ({ month: f.replace('.jsonl', ''), bytes: sizeOf(f) }));
    let messages = 0, oldest = null, newest = null;
    for (const f of files()) {
      let text = ''; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) { if (!line) continue; messages++; }
      const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : undefined), last = text.trimEnd().split('\n').pop();
      try { const a = JSON.parse(first).t; if (oldest === null || a < oldest) oldest = a; } catch {}
      try { const b = JSON.parse(last).t; if (newest === null || b > newest) newest = b; } catch {}
    }
    return { files: fl, bytes: fl.reduce((n, f) => n + f.bytes, 0), messages, oldest, newest, capBytes: MAX_TOTAL };
  }
  function forget() {
    let removed = 0, bytes = 0;
    for (const f of files()) { bytes += sizeOf(f); try { fs.rmSync(path.join(dir, f), { force: true }); removed++; } catch { /* in use */ } }
    try { fs.rmdirSync(dir); } catch { /* not empty or gone */ }
    return { removed, bytes };
  }
  return { append, backfill, search, status, forget, files, totalBytes };
}

/* ---------- routes (JARVIS page on the laptop only: these are your private chats) ---------- */
module.exports = function setupChatArchive(app, { SANDBOX, llm, DEFAULT_MODEL, dir }) {
  const archive = createArchive({ dir: dir || path.join(SANDBOX, '.chat-archive') });
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const guard = (req, res) => (fromLaptopPage(req) ? true : (res.status(403).json({ error: 'Your chat archive can only be used from JARVIS on the laptop.' }), false));
  const wrap = fn => (req, res) => { if (!guard(req, res)) return; try { fn(req, res); } catch (e) { res.status(500).json({ error: 'The chat archive hit a problem: ' + String(e.message).slice(0, 80) }); } };

  app.post('/api/chatarchive/append', wrap((req, res) => res.json({ success: true, ...archive.append((req.body || {}).items) })));
  app.post('/api/chatarchive/backfill', wrap((req, res) => res.json({ success: true, ...archive.backfill((req.body || {}).items) })));
  app.get('/api/chatarchive/status', wrap((req, res) => res.json({ success: true, ...archive.status() })));
  app.post('/api/chatarchive/forget', wrap((req, res) => {
    if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'This erases every archived chat. Confirm it first.' });
    res.json({ success: true, ...archive.forget() });
  }));
  app.post('/api/chatarchive/search', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const b = req.body || {}, text = String(b.text || '').slice(0, 300);
      if (!text.trim()) return res.status(400).json({ error: 'What should I look for?' });
      const r = archive.search({ text });
      let summary = '', cloud = false, model = String(b.model || DEFAULT_MODEL);
      if (b.summarize && r.exchanges.length && llm) {
        cloud = !!(llm.isCloud && llm.isCloud(model));
        const fmt = e => '[' + new Date(e.t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '] You: ' + e.user.slice(0, 400) + '\nJARVIS: ' + e.assistant.slice(0, 500);
        try {
          summary = await llm.complete({ model, temperature: 0.2, maxTokens: 260, timeoutMs: 120000,
            system: 'You answer a question about a user’s own earlier chats with their assistant, using ONLY the dated excerpts given. Mention dates. If the excerpts do not answer the question, say so plainly. At most four short sentences. Never invent anything.',
            messages: [{ role: 'user', content: 'Question: ' + text + '\n\nExcerpts:\n' + r.exchanges.slice(0, 6).map(fmt).join('\n\n').slice(0, 4500) }] });
        } catch (e) { summary = ''; }
      }
      res.json({ success: true, ...r, summary: String(summary || '').slice(0, 1500), cloud, model });
    } catch (e) { res.status(500).json({ error: 'The chat archive hit a problem: ' + String(e.message).slice(0, 80) }); }
  });
};
Object.assign(module.exports, { createArchive, parseWindow, queryTerms, buildExchanges, rankExchanges, MAX_TOTAL, MAX_TEXT, MAX_BATCH });
