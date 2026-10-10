'use strict';
/* "Is my AI working?": a history of every AI call JARVIS itself makes (from the one hook in llm.js), and a plain report built
   from it plus a live look at Ollama, the disks and memory. Only the outcome of each call is kept (model, how long, what
   kind of error). Never the question, the answer or an API key. Pure helpers are exported for tests. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_CALLS = 300;
const DAY = 24 * 3600 * 1000;
const GB = 1024 ** 3;

/* ---------- pure helpers ---------- */
// What kind of failure an error message describes (the messages come from llm.js, so this matches their wording).
function classifyError(msg) {
  const m = String(msg || '');
  if (/timed out|timeout|aborted/i.test(m)) return 'timeout';
  if (/rejected the API key|\((401|403)\)/.test(m)) return 'auth';
  if (/rate-limiting|\(429\)/.test(m)) return 'rate_limit';
  if (/isn't set up any more/.test(m)) return 'config';
  if (/is unreachable|Local LLM unavailable|ECONNREFUSED|fetch failed/i.test(m)) return 'unreachable';
  if (/not found \(404\)/.test(m)) return 'not_found';
  if (/error 5\d\d|\(5\d\d\)/.test(m)) return 'server';
  if (/gave no answer|no answer/i.test(m)) return 'empty';
  return 'other';
}
const KIND_LABEL = { timeout: 'timeouts', unreachable: 'unreachable', auth: 'key rejected', rate_limit: 'rate limits', server: 'server errors', not_found: 'model not found', empty: 'empty replies', config: 'provider missing', other: 'other errors' };

function cleanRecord(r) {
  const ok = !!(r && r.ok);
  const out = {
    t: Number(r && r.t) || Date.now(),
    provider: String((r && r.provider) || 'ollama').slice(0, 40),
    model: String((r && r.model) || '').slice(0, 80),
    ok,
    ms: Math.max(0, Math.round(Number(r && r.ms) || 0)),
    stream: !!(r && r.stream),
    kind: ok ? 'ok' : classifyError(r && r.error),
  };
  if (!ok) out.error = String((r && r.error) || '').replace(/\s+/g, ' ').slice(0, 160);
  return out;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);

// Per model over a time window: calls, success rate, typical and slow latency, error kinds, the last error.
function summarize(records, { now = Date.now(), sinceMs = DAY } = {}) {
  const rows = (records || []).filter(r => r && r.t >= now - sinceMs);
  const by = new Map();
  for (const r of rows) {
    const key = r.provider + '::' + r.model;
    const m = by.get(key) || { provider: r.provider, model: r.model, calls: 0, ok: 0, failed: 0, okMs: [], errors: {}, lastError: null, lastOkAt: 0 };
    m.calls++;
    if (r.ok) { m.ok++; m.okMs.push(r.ms); m.lastOkAt = Math.max(m.lastOkAt, r.t); }
    else { m.failed++; m.errors[r.kind] = (m.errors[r.kind] || 0) + 1; if (!m.lastError || r.t >= m.lastError.t) m.lastError = { t: r.t, kind: r.kind, error: r.error || '' }; }
    by.set(key, m);
  }
  const models = [...by.values()].map(m => {
    const s = m.okMs.slice().sort((a, b) => a - b);
    return { provider: m.provider, model: m.model, calls: m.calls, ok: m.ok, failed: m.failed, okRate: m.calls ? m.ok / m.calls : 1, p50: pct(s, 0.5), p95: pct(s, 0.95), errors: m.errors, lastError: m.lastError, lastOkAt: m.lastOkAt };
  }).sort((a, b) => b.calls - a.calls);
  const errors = {};
  for (const m of models) for (const [k, n] of Object.entries(m.errors)) errors[k] = (errors[k] || 0) + n;
  return { sinceMs, total: rows.length, ok: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length, models, errors };
}

const secs = ms => (ms >= 10000 ? Math.round(ms / 1000) : Math.round(ms / 100) / 10) + ' s';
const gb = n => (Math.round(n / GB * 10) / 10) + ' GB';

// Plain-English findings, each with the fix. level: bad (needs action) · warn · ok · info
function verdicts(summary, ctx = {}) {
  const v = [];
  const add = (level, text, fix) => v.push(fix ? { level, text, fix } : { level, text });
  const o = ctx.ollama;
  if (o) {
    if (!o.reachable) add('bad', 'Ollama (the local AI) is not answering.', 'Open the Ollama app (or restart it), then say “check my AI” again.');
    else {
      add('ok', 'Ollama is running with ' + (o.models.length ? o.models.length + ' model' + (o.models.length === 1 ? '' : 's') + ' installed.' : 'no models installed.'));
      if (!o.models.length) add('bad', 'No model is installed in Ollama.', 'Run “ollama pull ' + (ctx.defaultModel || 'qwen3.5:4b') + '” in a terminal.');
      else if (ctx.defaultModel && !/::/.test(ctx.defaultModel) && !o.models.some(n => n === ctx.defaultModel || (!ctx.defaultModel.includes(':') && n.split(':')[0] === ctx.defaultModel)))
        add('warn', 'The default model ' + ctx.defaultModel + ' is not installed.', 'Run “ollama pull ' + ctx.defaultModel + '” or pick an installed model in Settings.');
      for (const m of o.loaded || []) {
        const share = m.size ? Math.round(100 * (m.sizeVram || 0) / m.size) : 0;
        add(share >= 95 ? 'ok' : 'warn', m.name + ' is loaded (' + gb(m.size) + ', ' + share + '% on the GPU).', share >= 95 ? undefined : 'Part of it runs on the CPU, so replies are slower. Close other GPU programs or use a smaller model.');
      }
      if (!(o.loaded || []).length) add('info', 'No model is loaded in memory right now, so the next reply will be slow while it loads.');
    }
  }
  for (const m of summary.models) {
    const who = (m.provider === 'ollama' ? '' : m.provider + ' · ') + m.model;
    const e = m.errors;
    if (e.auth) add('bad', who + ': the API key was rejected ' + e.auth + (e.auth === 1 ? ' time' : ' times') + '.', 'Open Settings → AI BRAIN and paste the key again.');
    if (e.rate_limit >= 1) add(e.rate_limit >= 2 ? 'warn' : 'info', who + ': rate limit or out of credit ' + e.rate_limit + (e.rate_limit === 1 ? ' time' : ' times') + '.', 'Wait a minute, check the account’s credit, or switch to another model.');
    if (e.timeout >= 2) add('warn', who + ': ' + e.timeout + ' timeouts.', m.provider === 'ollama' ? 'The local model is slow. Close other programs, or pick a smaller model.' : 'The service is slow right now. Try again later or switch model.');
    if (e.unreachable >= 2) add('bad', who + ': unreachable ' + e.unreachable + ' times.', m.provider === 'ollama' ? 'Is Ollama running?' : 'Check your internet connection.');
    if (e.server >= 1) add('warn', who + ': the service reported a server error ' + e.server + (e.server === 1 ? ' time' : ' times') + '.', 'Usually temporary. Try again in a few minutes.');
    if (e.not_found) add('warn', who + ': model or endpoint not found.', 'Pick a model that exists in Settings → AI BRAIN.');
    if (e.empty) add('warn', who + ': ' + e.empty + ' empty ' + (e.empty === 1 ? 'reply' : 'replies') + ' (the model used its whole budget thinking).', 'Pick a non-reasoning model or set Response length to Detailed.');
    if (m.calls >= 5 && m.okRate < 0.8 && !e.auth) add('bad', who + ': only ' + Math.round(m.okRate * 100) + '% of the last ' + m.calls + ' calls worked.');
    if (m.ok >= 3 && m.p95 > 60000) add('warn', who + ': the slowest replies took about ' + secs(m.p95) + '.', 'Shorter questions, a smaller model, or closing other programs helps.');
  }
  if (!summary.total) add('info', 'No AI calls recorded in the last ' + (summary.sinceMs >= DAY ? 'day' : Math.round(summary.sinceMs / 3600000) + ' hours') + ' yet.');
  if (ctx.deep) {
    if (ctx.deep.ok) add('ok', 'A test question was answered in ' + secs(ctx.deep.ms) + '.');
    else add('bad', 'The test question failed: ' + ctx.deep.error, undefined);
  }
  for (const d of ctx.disks || []) {
    const free = d.freeBytes / GB;
    if (free < 2) add('bad', 'Drive ' + d.drive + ' has only ' + gb(d.freeBytes) + ' free.', 'Windows and Ollama slow down on a nearly full drive. Say “what is using my C: drive” to see where the space went.');
    else if (free < 5) add('warn', 'Drive ' + d.drive + ' has ' + gb(d.freeBytes) + ' free.', 'Getting low. Free some space soon.');
  }
  if (ctx.memFreeBytes !== undefined && ctx.memFreeBytes / GB < 1) add('warn', 'Only ' + gb(ctx.memFreeBytes) + ' of memory is free.', 'Close some programs.');
  return v;
}

function headlineOf(summary, vs) {
  const bad = vs.filter(x => x.level === 'bad'), warn = vs.filter(x => x.level === 'warn');
  const calls = summary.total ? ' ' + summary.total + ' AI call' + (summary.total === 1 ? '' : 's') + ' in the last day, ' + (summary.failed ? summary.failed + ' failed.' : 'none failed.') : '';
  if (bad.length) return 'Something needs attention: ' + bad[0].text;
  if (warn.length) return 'Your AI works, with ' + warn.length + ' warning' + (warn.length === 1 ? '' : 's') + '.' + calls;
  return 'Your AI is working.' + calls;
}

const ICON = { ok: '✓', info: '•', warn: '⚠', bad: '✗' };
function formatReport(r) {
  const lines = ['**AI health** — ' + r.headline, ''];
  for (const x of r.verdicts) lines.push('- ' + ICON[x.level] + ' ' + x.text + (x.fix ? ' *' + x.fix + '*' : ''));
  const ms = r.summary.models;
  if (ms.length) {
    lines.push('', '**Last 24 hours**');
    for (const m of ms) {
      const errs = Object.entries(m.errors).map(([k, n]) => n + ' ' + (KIND_LABEL[k] || k)).join(', ');
      lines.push('- `' + (m.provider === 'ollama' ? '' : m.provider + ' · ') + m.model + '` — ' + m.calls + ' call' + (m.calls === 1 ? '' : 's') + ', ' + Math.round(m.okRate * 100) + '% worked' + (m.ok ? ', typically ' + secs(m.p50) + ' (slowest ' + secs(m.p95) + ')' : '') + (errs ? ' · ' + errs : ''));
    }
  }
  if ((r.disks || []).length) lines.push('', '**Disk:** ' + r.disks.map(d => d.drive + ' ' + gb(d.freeBytes) + ' free of ' + gb(d.totalBytes)).join(' · '));
  return lines.join('\n');
}

/* ---------- live probes (fetch / statfs injectable for tests) ---------- */
async function probeOllama(base, f = fetch) {
  const get = async p => { const r = await f(base + p, { signal: AbortSignal.timeout(2500) }); return r.json(); };
  try {
    const tags = await get('/api/tags');
    let loaded = [];
    try { loaded = ((await get('/api/ps')).models || []).map(m => ({ name: m.name, size: m.size || 0, sizeVram: m.size_vram || 0 })); } catch {}
    return { reachable: true, models: (tags.models || []).map(m => m.name), loaded };
  } catch { return { reachable: false, models: [], loaded: [] }; }
}
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t)); };
async function diskInfo(paths, statfs = fs.promises.statfs) {
  const roots = [...new Set(paths.filter(Boolean).map(p => path.parse(path.resolve(p)).root))];
  const out = [];
  for (const root of roots) {
    try {
      const s = await withTimeout(statfs(root), 1500);
      out.push({ drive: root.replace(/[\\/]+$/, '') || root, freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) });
    } catch {}
  }
  return out;
}

/* ---------- the history: a small ring buffer saved to disk ---------- */
function createRecorder({ file, max = MAX_CALLS, saveDelayMs = 3000 } = {}) {
  let calls = [], timer = null;
  if (file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) calls = j.map(cleanRecord).slice(-max); } catch {} }
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!file) return;
    try { const tmp = file + '.tmp'; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(calls)); fs.renameSync(tmp, file); } catch {}
  };
  const record = r => {
    calls.push(cleanRecord(r));
    if (calls.length > max) calls = calls.slice(-max);
    if (file && !timer) { timer = setTimeout(flush, saveDelayMs); if (timer.unref) timer.unref(); }
  };
  return { record, all: () => calls.slice(), clear: () => { calls = []; flush(); }, flush };
}

/* ---------- routes ---------- */
module.exports = function setupAiHealth(app, { llm, recorder, OLLAMA, DEFAULT_MODEL, SANDBOX, fetchImpl, statfsImpl }) {
  app.get('/api/ai/health', async (req, res) => {
    const modelWanted = String(req.query.model || '');
    const model = /^[\w.:\/@+-]{1,120}$/.test(modelWanted) ? modelWanted : DEFAULT_MODEL;
    const [ollama, disks] = await Promise.all([probeOllama(OLLAMA, fetchImpl), diskInfo([process.env.SystemDrive ? process.env.SystemDrive + '\\' : os.homedir(), SANDBOX, __dirname], statfsImpl)]);
    let deep = null;
    if (req.query.deep === '1' || req.query.deep === 'true') {
      const t0 = Date.now();
      try { await llm.complete({ model, messages: [{ role: 'user', content: 'Reply with just the word OK.' }], maxTokens: 16, temperature: 0, timeoutMs: 60000 }); deep = { ok: true, ms: Date.now() - t0, model }; }
      catch (e) { deep = { ok: false, error: String((e && e.message) || e).slice(0, 160), model }; }
    }
    const summary = summarize(recorder.all(), { now: Date.now(), sinceMs: DAY });
    const vs = verdicts(summary, { ollama, disks, memFreeBytes: os.freemem(), defaultModel: DEFAULT_MODEL, deep });
    const out = { success: true, summary, verdicts: vs, ollama, disks, deep };
    out.headline = headlineOf(summary, vs);
    out.text = formatReport(out);
    res.json(out);
  });
  app.post('/api/ai/health/clear', (req, res) => { recorder.clear(); res.json({ success: true }); });
};
Object.assign(module.exports, { classifyError, cleanRecord, summarize, verdicts, headlineOf, formatReport, probeOllama, diskInfo, createRecorder, KIND_LABEL, MAX_CALLS });
