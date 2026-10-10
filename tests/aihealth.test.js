// AI health (aihealth.js + the one hook in llm.js): error classes, the history, the summary, the verdicts, the route.
// Run: node tests/aihealth.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const H = require(path.join(__dirname, '..', 'aihealth.js'));
const createLLM = require(path.join(__dirname, '..', 'llm.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const GB = 1024 ** 3;

/* ---------- classifyError, with the real messages llm.js produces ---------- */
{
  const E = createLLM.friendlyError;
  const k = m => H.classifyError(typeof m === 'string' ? m : m.message);
  check('classify: 401 and 403 → auth', k(E(401, 'OpenAI', '', 'sk-x')) === 'auth' && k(E(403, 'Groq', '', '')) === 'auth');
  check('classify: 429 → rate_limit', k(E(429, 'Gemini', '{"error":{"message":"quota"}}', '')) === 'rate_limit');
  check('classify: 404 → not_found', k(E(404, 'OpenAI', 'no such model', '')) === 'not_found');
  check('classify: 500 and 503 → server', k(E(500, 'OpenAI', 'oops', '')) === 'server' && k(E(503, 'Groq', '', '')) === 'server');
  check('classify: Ollama down → unreachable', k('Local LLM unavailable — is Ollama running? (fetch failed)') === 'unreachable' && k('OpenAI is unreachable (getaddrinfo ENOTFOUND)') === 'unreachable');
  check('classify: a timeout beats "unreachable" (the wrapper text contains both)', k('Local LLM unavailable — is Ollama running? (The operation was aborted due to timeout)') === 'timeout' && k('OpenAI is unreachable (The operation timed out)') === 'timeout');
  check('classify: empty reply, missing provider, anything else', k('The model gave no answer — it probably spent its whole reply budget "thinking".') === 'empty' && k('The AI provider "x" isn\'t set up any more — pick another model in Settings') === 'config' && k('something odd') === 'other' && k('') === 'other');
}

/* ---------- records hold the outcome only ---------- */
{
  const r = H.cleanRecord({ provider: 'openai', model: 'gpt-4o-mini', ok: false, ms: 1234.7, error: 'OpenAI rejected the API key (401)', prompt: 'my secret question', apiKey: 'sk-abc', messages: [1] });
  check('record: only the outcome fields are kept', JSON.stringify(Object.keys(r).sort()) === '["error","kind","model","ms","ok","provider","stream","t"]' && !JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('sk-abc'), r);
  check('record: kind is worked out, ms rounded', r.kind === 'auth' && r.ms === 1235);
  const ok = H.cleanRecord({ provider: 'ollama', model: 'q', ok: true, ms: 50, error: 'ignored' });
  check('record: a good call has kind ok and no error text', ok.kind === 'ok' && !('error' in ok));
  check('record: error text is shortened to one line', H.cleanRecord({ ok: false, error: 'a\n\n b '.repeat(200) }).error.length <= 160 && !/\n/.test(H.cleanRecord({ ok: false, error: 'x\ny' }).error));
  check('record: junk input does not throw', H.cleanRecord(null).ok === false && H.cleanRecord({ ms: 'abc' }).ms === 0);
}

/* ---------- the history: ring buffer, saving, loading ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aih-'));
{
  const f = path.join(tmp, 'sub', '.ai-calls.json');
  const rec = H.createRecorder({ file: f, max: 5, saveDelayMs: 10 });
  for (let i = 0; i < 8; i++) rec.record({ provider: 'ollama', model: 'm' + i, ok: true, ms: i });
  check('history: keeps only the newest max calls', rec.all().length === 5 && rec.all()[0].model === 'm3' && rec.all()[4].model === 'm7');
  rec.flush();
  check('history: saved to disk (folder created, no leftover temp file)', fs.existsSync(f) && !fs.existsSync(f + '.tmp') && JSON.parse(fs.readFileSync(f, 'utf8')).length === 5);
  const again = H.createRecorder({ file: f, max: 5 });
  check('history: loaded again after a restart', again.all().length === 5 && again.all()[4].model === 'm7');
  fs.writeFileSync(f, '{ not json');
  check('history: a damaged file is ignored, not fatal', H.createRecorder({ file: f }).all().length === 0);
  fs.writeFileSync(f, JSON.stringify([{ model: 'x', ok: true, ms: 1, prompt: 'leak', apiKey: 'sk-leak' }, 'junk', 5]));
  const loaded = H.createRecorder({ file: f }).all();
  check('history: a hand-edited file is cleaned on load (no extra fields)', loaded.length === 3 && !JSON.stringify(loaded).includes('leak'));
  rec.clear();
  check('history: clear empties memory and disk', rec.all().length === 0 && JSON.parse(fs.readFileSync(f, 'utf8')).length === 0);
  const nofile = H.createRecorder({}); nofile.record({ ok: true }); nofile.flush();
  check('history: works with no file at all', nofile.all().length === 1);
  // the delayed save really happens
  const rec2 = H.createRecorder({ file: path.join(tmp, 'late.json'), saveDelayMs: 20 });
  rec2.record({ ok: true, model: 'z' });
  check('history: not written on every call', !fs.existsSync(path.join(tmp, 'late.json')));
}

/* ---------- summarize ---------- */
const NOW = 1_700_000_000_000;
const mk = (model, ok, ms, ageMin, error, provider = 'ollama') => H.cleanRecord({ t: NOW - ageMin * 60000, provider, model, ok, ms, error });
{
  const recs = [mk('q', true, 1000, 5), mk('q', true, 2000, 6), mk('q', true, 3000, 7), mk('q', true, 9000, 8), mk('q', false, 0, 9, 'Local LLM unavailable — is Ollama running? (fetch failed)'),
    mk('gpt', false, 0, 30, 'OpenAI is rate-limiting you or the account is out of credit (429)', 'openai'), mk('old', true, 5, 60 * 30)];
  const s = H.summarize(recs, { now: NOW, sinceMs: 24 * 3600000 });
  check('summary: counts only the window (a 30-hour-old call is out)', s.total === 6 && s.ok === 4 && s.failed === 2 && !s.models.some(m => m.model === 'old'), s);
  const q = s.models.find(m => m.model === 'q');
  check('summary: per model calls, rate, median and slow latency', q.calls === 5 && q.ok === 4 && q.okRate === 0.8 && q.p50 === 3000 && q.p95 === 9000, q);
  check('summary: error kinds and the last error', q.errors.unreachable === 1 && q.lastError.kind === 'unreachable' && s.errors.rate_limit === 1);
  check('summary: busiest model first', s.models[0].model === 'q');
  check('summary: a short window', H.summarize(recs, { now: NOW, sinceMs: 10 * 60000 }).total === 5);
  check('summary: empty history is fine', H.summarize([], {}).total === 0 && H.summarize(null).models.length === 0);
}

/* ---------- verdicts ---------- */
const lvl = (vs, re) => (vs.find(v => re.test(v.text)) || {}).level;
const base = { ollama: { reachable: true, models: ['qwen3.5:4b'], loaded: [{ name: 'qwen3.5:4b', size: 3 * GB, sizeVram: 3 * GB }] }, disks: [{ drive: 'D:', freeBytes: 27 * GB, totalBytes: 100 * GB }], memFreeBytes: 6 * GB, defaultModel: 'qwen3.5:4b' };
{
  const empty = H.summarize([], { now: NOW });
  let vs = H.verdicts(empty, base);
  check('verdicts: a healthy setup has no warnings', !vs.some(v => v.level === 'bad' || v.level === 'warn') && lvl(vs, /Ollama is running/) === 'ok' && lvl(vs, /qwen3.5:4b is loaded/) === 'ok', vs);
  check('verdicts: says when nothing was recorded', lvl(vs, /No AI calls recorded/) === 'info');
  vs = H.verdicts(empty, { ...base, ollama: { reachable: false, models: [], loaded: [] } });
  check('verdicts: Ollama down is bad, with the fix', lvl(vs, /not answering/) === 'bad' && /Open the Ollama app/.test(vs.find(v => /not answering/.test(v.text)).fix));
  vs = H.verdicts(empty, { ...base, defaultModel: 'llama3:8b' });
  check('verdicts: the default model not installed', lvl(vs, /not installed/) === 'warn');
  check('verdicts: a model name without a tag still matches the installed one', !H.verdicts(empty, { ...base, defaultModel: 'qwen3.5' }).some(v => /not installed/.test(v.text)));
  check('verdicts: a cloud default model is not checked against Ollama', !H.verdicts(empty, { ...base, defaultModel: 'openai::gpt-4o' }).some(v => /not installed/.test(v.text)));
  vs = H.verdicts(empty, { ...base, ollama: { ...base.ollama, loaded: [{ name: 'big', size: 6 * GB, sizeVram: 3 * GB }] } });
  check('verdicts: a model partly on the CPU is a warning', lvl(vs, /big is loaded.*50% on the GPU/) === 'warn');
  check('verdicts: nothing loaded is information, not a problem', lvl(H.verdicts(empty, { ...base, ollama: { ...base.ollama, loaded: [] } }), /No model is loaded/) === 'info');
  check('verdicts: no models installed is bad', lvl(H.verdicts(empty, { ...base, ollama: { reachable: true, models: [], loaded: [] } }), /No model is installed/) === 'bad');
  vs = H.verdicts(empty, { ...base, disks: [{ drive: 'C:', freeBytes: 1.8 * GB, totalBytes: 200 * GB }, { drive: 'D:', freeBytes: 4 * GB, totalBytes: 100 * GB }] });
  check('verdicts: a nearly full drive is bad, a low one a warning', lvl(vs, /Drive C: has only 1.8 GB/) === 'bad' && lvl(vs, /Drive D: has 4 GB/) === 'warn');
  check('verdicts: low memory', lvl(H.verdicts(empty, { ...base, memFreeBytes: 0.4 * GB }), /memory is free/) === 'warn');
  const bad = H.summarize([mk('gpt', false, 0, 1, 'OpenAI rejected the API key (401)', 'openai'), mk('gpt', false, 0, 2, 'OpenAI is rate-limiting you or the account is out of credit (429)', 'openai'), mk('gpt', false, 0, 3, 'OpenAI is rate-limiting you or the account is out of credit (429)', 'openai'),
    mk('q', false, 0, 4, 'The operation was aborted due to timeout'), mk('q', false, 0, 5, 'The operation was aborted due to timeout')], { now: NOW });
  vs = H.verdicts(bad, base);
  check('verdicts: key rejected → bad, says where to fix it', lvl(vs, /API key was rejected/) === 'bad' && /Settings/.test(vs.find(v => /API key was rejected/.test(v.text)).fix));
  check('verdicts: repeated rate limits and timeouts are warnings', lvl(vs, /rate limit or out of credit 2 times/) === 'warn' && lvl(vs, /2 timeouts/) === 'warn');
  const flaky = H.summarize(Array.from({ length: 10 }, (_, i) => mk('q', i < 5, 100, i + 1, i < 5 ? undefined : 'Local LLM unavailable — is Ollama running? (fetch failed)')), { now: NOW });
  check('verdicts: a low success rate is bad', lvl(H.verdicts(flaky, base), /only 50% of the last 10 calls worked/) === 'bad');
  const slow = H.summarize([mk('q', true, 70000, 1), mk('q', true, 71000, 2), mk('q', true, 72000, 3)], { now: NOW });
  check('verdicts: very slow replies are a warning', lvl(H.verdicts(slow, base), /slowest replies took about 72 s/) === 'warn');
  check('verdicts: the deep test result is reported', lvl(H.verdicts(empty, { ...base, deep: { ok: true, ms: 1500 } }), /answered in 1.5 s/) === 'ok' && lvl(H.verdicts(empty, { ...base, deep: { ok: false, error: 'boom' } }), /test question failed: boom/) === 'bad');
  const s1 = H.summarize([mk('q', true, 1000, 1)], { now: NOW });
  check('headline: all good', /^Your AI is working\. 1 AI call in the last day, none failed\./.test(H.headlineOf(s1, H.verdicts(s1, base))));
  check('headline: a problem comes first', /^Something needs attention: Ollama/.test(H.headlineOf(empty, H.verdicts(empty, { ...base, ollama: { reachable: false, models: [], loaded: [] } }))));
  check('headline: warnings are counted', /with 1 warning\./.test(H.headlineOf(s1, H.verdicts(s1, { ...base, memFreeBytes: 0.2 * GB }))));
  const rep = { headline: 'h', verdicts: H.verdicts(bad, base), summary: bad, disks: base.disks };
  const txt = H.formatReport(rep);
  check('report: readable markdown with the fix in italics, the models and the disk', /^\*\*AI health\*\* — h/.test(txt) && /✗ .*API key was rejected.* \*Open Settings/.test(txt) && /\*\*Last 24 hours\*\*/.test(txt) && /`openai · gpt` — 3 calls, 0% worked/.test(txt) && /\*\*Disk:\*\* D: 27 GB free of 100 GB/.test(txt), txt);
}

/* ---------- probes with fakes ---------- */
const keepAlive = setInterval(() => {}, 1000);   // AbortSignal.timeout() timers don't keep a bare script alive (a server is)
(async () => {
  const jsonRes = body => ({ json: async () => body });
  let p = await H.probeOllama('http://x', async url => jsonRes(url.endsWith('/api/tags') ? { models: [{ name: 'a:1' }, { name: 'b:2' }] } : { models: [{ name: 'a:1', size: 100, size_vram: 90 }] }));
  check('probe: models and what is loaded', p.reachable && p.models.join() === 'a:1,b:2' && p.loaded[0].name === 'a:1' && p.loaded[0].sizeVram === 90, p);
  p = await H.probeOllama('http://x', async url => { if (url.endsWith('/api/ps')) throw new Error('x'); return jsonRes({ models: [{ name: 'a:1' }] }); });
  check('probe: /api/ps failing still counts as running', p.reachable && p.loaded.length === 0);
  p = await H.probeOllama('http://x', async () => { throw new Error('refused'); });
  check('probe: Ollama down', !p.reachable && !p.models.length);

  const stat = async root => { if (/Z:/.test(root)) throw new Error('no drive'); if (/H:/.test(root)) return new Promise(() => {}); return { bavail: 10, bsize: GB / 10, blocks: 100 }; };
  const d = await H.diskInfo(['C:\\Users\\x', 'C:\\other\\place', 'D:\\jarvis', 'Z:\\gone', null], stat);
  check('disks: one entry per drive, free and total in bytes, missing drives skipped', d.length === 2 && d[0].drive === 'C:' && d[0].freeBytes === GB && d[0].totalBytes === 10 * GB && d[1].drive === 'D:', d);
  const t0 = Date.now(); const hung = await H.diskInfo(['H:\\net'], stat);
  check('disks: a hanging drive cannot hang the report', hung.length === 0 && Date.now() - t0 < 4000);

  /* ---------- the hook in llm.js, with a faked network ---------- */
  const calls = [];
  const realFetch = global.fetch;
  const cfg = { providers: [{ id: 'openai', preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-key-123456' }] };
  const llm = createLLM({ getConfig: () => cfg, saveConfig() {}, OLLAMA: 'http://ollama.test', DEFAULT_MODEL: 'qwen3.5:4b', onCall: r => calls.push(r) });
  let mode = 'ok';
  global.fetch = async (url, init) => {
    if (mode === 'down') throw new Error('fetch failed');
    if (mode === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('The operation was aborted due to timeout'))));
    if (mode === '401') return { ok: false, status: 401, text: async () => '{"error":{"message":"bad key sk-test-key-123456"}}' };
    if (mode === 'empty') return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) };
    if (/embed/.test(url)) return { ok: true, status: 200, text: async () => JSON.stringify({ embeddings: [[0.1, 0.2]] }) };
    return { ok: true, status: 200, json: async () => ({ message: { content: 'hello' }, choices: [{ message: { content: 'hello' } }] }), body: (async function* () { yield new TextEncoder().encode('{"message":{"content":"a"},"done":true}\n'); })() };
  };
  try {
    calls.length = 0;
    await llm.complete({ model: 'qwen3.5:4b', messages: [{ role: 'user', content: 'my private question' }] });
    check('hook: a good local call is reported with provider, model and time', calls.length === 1 && calls[0].ok && calls[0].provider === 'ollama' && calls[0].model === 'qwen3.5:4b' && calls[0].ms >= 0 && !calls[0].stream, calls);
    calls.length = 0; mode = 'down';
    await llm.complete({ model: 'qwen3.5:4b', messages: [] }).catch(() => {});
    check('hook: Ollama down is reported as a failure of the right kind', calls.length === 1 && !calls[0].ok && H.classifyError(calls[0].error) === 'unreachable', calls);
    calls.length = 0; mode = '401';
    const e401 = await llm.complete({ model: 'openai::gpt-4o-mini', messages: [] }).catch(e => e);
    check('hook: a rejected key is reported (provider id, model, kind auth)', calls.length === 1 && calls[0].provider === 'openai' && calls[0].model === 'gpt-4o-mini' && H.classifyError(calls[0].error) === 'auth', calls);
    check('hook: nothing secret reaches the history (key, prompt)', !JSON.stringify(calls).includes('sk-test-key') && !JSON.stringify(calls).includes('private'), calls);
    calls.length = 0; mode = 'empty';
    await llm.complete({ model: 'openai::gpt-4o-mini', messages: [] }).catch(() => {});
    check('hook: an empty reply counts as a failed call, once', calls.length === 1 && !calls[0].ok && H.classifyError(calls[0].error) === 'empty', calls);
    calls.length = 0; mode = 'hang';
    await llm.complete({ model: 'qwen3.5:4b', messages: [], timeoutMs: 30 }).catch(() => {});
    check('hook: a timeout is reported as one', calls.length === 1 && H.classifyError(calls[0].error) === 'timeout', calls);
    calls.length = 0;
    const ac = new AbortController(); setTimeout(() => ac.abort(), 20);
    await llm.complete({ model: 'qwen3.5:4b', messages: [], signal: ac.signal }).catch(() => {});
    check('hook: a call you cancelled yourself is not a failure', calls.length === 0, calls);
    calls.length = 0; mode = 'ok';
    await llm.openStream({ model: 'qwen3.5:4b', messages: [] });
    check('hook: a streamed call is reported once it starts answering', calls.length === 1 && calls[0].ok && calls[0].stream, calls);
    calls.length = 0;
    await llm.embed('nomic-embed-text', ['a']).catch(() => {});
    check('hook: embeddings are reported too', calls.length === 1 && calls[0].model === 'nomic-embed-text', calls);
    const llm2 = createLLM({ getConfig: () => cfg, saveConfig() {}, OLLAMA: 'http://ollama.test', DEFAULT_MODEL: 'q', onCall: () => { throw new Error('listener bug'); } });
    check('hook: a broken listener never breaks the call', (await llm2.complete({ model: 'q', messages: [] })) === 'hello');
    const llm3 = createLLM({ getConfig: () => cfg, saveConfig() {}, OLLAMA: 'http://ollama.test', DEFAULT_MODEL: 'q' });
    check('hook: no listener at all is fine', (await llm3.complete({ model: 'q', messages: [] })) === 'hello');
  } finally { global.fetch = realFetch; }

  /* ---------- the route ---------- */
  const routes = {}; const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const recorder = H.createRecorder({});
  recorder.record({ provider: 'ollama', model: 'qwen3.5:4b', ok: true, ms: 1200 });
  let deepModel = null, deepFails = false;
  const fakeLlm = { complete: async o => { deepModel = o.model; if (deepFails) throw new Error('Local LLM unavailable — is Ollama running? (fetch failed)'); return 'OK'; } };
  H(app, { llm: fakeLlm, recorder, OLLAMA: 'http://x', DEFAULT_MODEL: 'qwen3.5:4b', SANDBOX: tmp,
    fetchImpl: async url => jsonRes(url.endsWith('/api/tags') ? { models: [{ name: 'qwen3.5:4b' }] } : { models: [] }), statfsImpl: async () => ({ bavail: 200, bsize: GB / 10, blocks: 1000 }) });
  const call = async (key, req) => { let out, code = 200; await routes[key](req || {}, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
  let r = await call('GET /api/ai/health', { query: {} });
  check('route: a full report (headline, text, summary, verdicts, Ollama, disks)', r.success && /^Your AI is working/.test(r.headline) && /\*\*AI health\*\*/.test(r.text) && r.summary.total === 1 && r.verdicts.length && r.ollama.reachable && r.disks.length >= 1 && r.deep === null, r);
  check('route: no test question unless asked', deepModel === null);
  r = await call('GET /api/ai/health', { query: { deep: '1', model: 'openai::gpt-4o-mini' } });
  check('route: ?deep=1 asks the chosen model one tiny question and reports the time', deepModel === 'openai::gpt-4o-mini' && r.deep.ok && r.deep.model === 'openai::gpt-4o-mini' && /test question was answered/.test(r.text), r.deep);
  r = await call('GET /api/ai/health', { query: { deep: '1', model: 'bad model!!;' } });
  check('route: an odd model name falls back to the default', deepModel === 'qwen3.5:4b');
  deepFails = true;
  r = await call('GET /api/ai/health', { query: { deep: '1' } });
  check('route: a failing test question is reported, not thrown', r.success && r.deep.ok === false && /^Something needs attention: The test question failed/.test(r.headline), r.headline);
  r = await call('POST /api/ai/health/clear', {});
  check('route: clear empties the history', r.success && recorder.all().length === 0);

  clearInterval(keepAlive);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`aihealth: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
