'use strict';
/* One model layer for every AI call in JARVIS: local Ollama (default), any OpenAI-compatible API (OpenAI, Gemini,
   Groq, OpenRouter, DeepSeek, Mistral, Together, or a custom URL such as LM Studio), and Anthropic.
   Cloud models are named "<providerId>::<model>"; a name without "::" is an Ollama model, so saved settings keep working.
   API keys live only in ~/jarvis/.config.json on the server — the page only ever sees them masked. */

const SEP = '::';
const PRESETS = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', keyUrl: '' },
];
const PRESET_BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

// Which provider a pasted key belongs to, from its well-known prefix — so a beginner never has to choose.
function detectPreset(key) {
  const k = String(key || '').trim();
  if (/^sk-ant-/.test(k)) return 'anthropic';
  if (/^sk-or-/.test(k)) return 'openrouter';
  if (/^AIza[\w-]{20,}$/.test(k)) return 'gemini';
  if (/^gsk_/.test(k)) return 'groq';
  if (/^sk-/.test(k)) return /^sk-[a-f0-9]{32}$/.test(k) ? 'deepseek' : 'openai';
  return null;
}
// A good, cheap, fast default per provider (first pattern that matches a model the account really has).
const DEFAULT_PICKS = {
  openai: [/^gpt-5-mini$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/, /^gpt-4o$/],
  anthropic: [/haiku/, /sonnet/],
  gemini: [/^gemini-2\.5-flash$/, /^gemini-2\.0-flash$/, /flash/],
  groq: [/^llama-3\.3-70b-versatile$/, /llama.*70b/, /llama/],
  openrouter: [/^openai\/gpt-4o-mini$/, /^google\/gemini.*flash/, /.*/],
  deepseek: [/^deepseek-chat$/],
  mistral: [/mistral-small/, /mistral-medium/, /mistral-large/],
  together: [/llama.*70b.*turbo/i, /llama.*70b/i, /.*/],
};
function pickDefaultModel(presetId, ids) {
  for (const re of DEFAULT_PICKS[presetId] || []) { const hit = (ids || []).find(x => re.test(x)); if (hit) return hit; }
  return (ids || [])[0] || null;
}

/* ---------- pure helpers (unit tested) ---------- */
function parseModelId(id) {
  const s = String(id || '');
  const i = s.indexOf(SEP);
  return i < 0 ? { provider: 'ollama', model: s } : { provider: s.slice(0, i), model: s.slice(i + SEP.length) };
}
function maskKey(k) {
  k = String(k || '');
  if (!k) return '';
  return k.length <= 10 ? '••••' : k.slice(0, 3) + '…' + k.slice(-4);
}
const scrub = (s, key) => (key && key.length >= 6 ? String(s).split(key).join('***') : String(s));
const imgType = b64 => /^\/9j\//.test(b64) ? 'image/jpeg' : /^iVBOR/.test(b64) ? 'image/png' : /^R0lG/.test(b64) ? 'image/gif' : /^UklG/.test(b64) ? 'image/webp' : 'image/jpeg';
// The first JSON object in a reply — some providers wrap it in prose or ``` fences.
function extractJSON(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
const NON_CHAT = /embed|tts|whisper|dall-e|imagen|image-gen|gpt-image|audio|moderation|realtime|transcribe|search|computer-use|guard|rerank|ocr|aqa|veo/i;
function filterModels(ids) {
  return [...new Set((ids || []).map(x => String(x).replace(/^models\//, '').trim()).filter(x => x && !NON_CHAT.test(x)))].sort().slice(0, 80);
}
// OpenAI's reasoning models take max_completion_tokens and only the default temperature.
const initialAdapt = (preset, model) => (preset === 'openai' && /^(o\d|gpt-5)/i.test(model) ? { maxCompletion: true, noTemperature: true } : {});
// A 400/422 that names the offending parameter → the same request without it (at most once per parameter).
function adaptFor(errText, adapt, hadImages) {
  const t = String(errText || '').toLowerCase();
  if (!adapt.noReasoningEffort && /reasoning/.test(t)) return { ...adapt, noReasoningEffort: true };
  if (!adapt.maxCompletion && /max_tokens/.test(t) && /max_completion_tokens/.test(t)) return { ...adapt, maxCompletion: true };
  if (!adapt.noTemperature && /temperature/.test(t)) return { ...adapt, noTemperature: true };
  if (!adapt.noJsonMode && /response_format|json_object|json mode/.test(t)) return { ...adapt, noJsonMode: true };
  if (!adapt.noImages && hadImages && /image|vision|multimodal|image_url|content type/.test(t)) return { ...adapt, noImages: true };
  return null;
}

// o: { model, system, messages:[{role,content}], json, temperature, maxTokens, images:[base64], stream, numCtx }
function buildRequest(kind, prov, o, adapt = {}) {
  const msgs = (o.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: String(m.content) }));
  const imgs = adapt.noImages ? [] : (o.images || []);
  const lastUser = i => imgs.length && i === msgs.length - 1 && msgs[i].role === 'user';
  const maxTokens = o.maxTokens || 700;
  const base = String(prov.baseUrl || '').replace(/\/+$/, '');
  if (kind === 'ollama') {
    const m2 = msgs.map((m, i) => (lastUser(i) ? { ...m, images: imgs } : m));
    const body = { model: o.model, stream: !!o.stream, think: false, keep_alive: '30m',
      options: { temperature: o.temperature == null ? 0.5 : o.temperature, num_predict: maxTokens, ...(o.numCtx ? { num_ctx: o.numCtx } : {}) },
      messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), ...m2] };
    if (o.json) body.format = 'json';
    return { url: base + '/api/chat', headers: { 'Content-Type': 'application/json' }, body };
  }
  if (kind === 'anthropic') {
    const m2 = msgs.map((m, i) => (lastUser(i) ? { role: 'user', content: [...imgs.map(d => ({ type: 'image', source: { type: 'base64', media_type: imgType(d), data: d } })), { type: 'text', text: m.content }] } : m));
    const body = { model: o.model, max_tokens: maxTokens, stream: !!o.stream, messages: m2 };
    const sys = ((o.system || '') + (o.json ? '\n\nRespond with ONLY a JSON object — no prose, no code fences.' : '')).trim();
    if (sys) body.system = sys;
    if (!adapt.noTemperature && o.temperature != null) body.temperature = o.temperature;
    return { url: base + '/v1/messages', headers: { 'Content-Type': 'application/json', 'x-api-key': prov.apiKey || '', 'anthropic-version': '2023-06-01' }, body };
  }
  // OpenAI-compatible
  const m2 = msgs.map((m, i) => (lastUser(i) ? { role: 'user', content: [{ type: 'text', text: m.content }, ...imgs.map(d => ({ type: 'image_url', image_url: { url: 'data:' + imgType(d) + ';base64,' + d } }))] } : m));
  const sys = ((o.system || '') + (o.json ? '\n\nRespond with ONLY a JSON object.' : '')).trim();
  const body = { model: o.model, stream: !!o.stream, messages: [...(sys ? [{ role: 'system', content: sys }] : []), ...m2] };
  // Reasoning models spend part of max_completion_tokens thinking, so a short limit would leave no visible answer.
  if (adapt.maxCompletion) body.max_completion_tokens = Math.max(maxTokens, 4000); else body.max_tokens = maxTokens;
  if (!adapt.noTemperature && o.temperature != null) body.temperature = o.temperature;
  if (o.json && !adapt.noJsonMode) body.response_format = { type: 'json_object' };
  // Local OpenAI-style servers often run thinking models (qwen3, deepseek-r1) that would spend the whole budget
  // reasoning; turn that off like the Ollama path does (think:false). Dropped automatically if the server objects.
  if (prov.preset === 'custom' && !adapt.noReasoningEffort) body.reasoning_effort = 'none';
  const headers = { 'Content-Type': 'application/json' };
  if (prov.apiKey) headers.Authorization = 'Bearer ' + prov.apiKey;
  if (prov.preset === 'openrouter') { headers['HTTP-Referer'] = 'http://localhost'; headers['X-Title'] = 'JARVIS'; }
  return { url: base + '/chat/completions', headers, body };
}

// One line of a streamed reply → { delta, done } | null. Ollama streams NDJSON; the others stream SSE "data:" lines.
function parseStreamLine(kind, line) {
  const l = String(line || '').trim();
  if (!l) return null;
  if (kind === 'ollama') {
    let j; try { j = JSON.parse(l); } catch { return null; }
    if (j.error) throw new Error(String(j.error));
    return { delta: (j.message && j.message.content) || '', done: !!j.done };
  }
  if (!l.startsWith('data:')) return null;
  const d = l.slice(5).trim();
  if (d === '[DONE]') return { delta: '', done: true };
  let j; try { j = JSON.parse(d); } catch { return null; }
  if (j.error) throw new Error(typeof j.error === 'string' ? j.error : (j.error.message || 'provider error'));
  if (kind === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') return { delta: j.delta.text || '', done: false };
    if (j.type === 'message_stop') return { delta: '', done: true };
    return null;
  }
  const c = j.choices && j.choices[0];
  if (!c) return null;
  const d2 = c.delta || {};
  return { delta: typeof d2.content === 'string' ? d2.content : '', done: false, reasoning: !!(d2.reasoning || d2.reasoning_content) };
}
const EMPTY_REPLY = 'The model gave no answer — it probably spent its whole reply budget "thinking". Pick a non-reasoning model, or set Response length to Detailed.';
function replyText(kind, j) {
  if (kind === 'ollama') return (j.message && j.message.content) || '';
  if (kind === 'anthropic') return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const c = j.choices && j.choices[0] && j.choices[0].message;
  const content = c && c.content;
  return Array.isArray(content) ? content.map(p => p.text || '').join('') : String(content || '');
}
function friendlyError(status, label, text, key) {
  let msg = String(text || '');
  try { const j = JSON.parse(msg); const e = Array.isArray(j) ? j[0] && j[0].error : j.error; msg = (e && (e.message || (typeof e === 'string' ? e : ''))) || j.message || msg; } catch {}
  msg = scrub(msg, key).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 401 || status === 403) return new Error(`${label} rejected the API key (${status})`);
  if (status === 429) return new Error(`${label} is rate-limiting you or the account is out of credit (429)` + (msg ? ': ' + msg : ''));
  if (status === 404) return new Error(`${label}: model or endpoint not found (404)` + (msg ? ' — ' + msg : ''));
  return new Error(`${label} error ${status}` + (msg ? ': ' + msg : ''));
}

// Reads a fetch() body as lines.
async function* lines(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i); buf = buf.slice(i + 1); }
  }
  buf += dec.decode();
  if (buf) yield buf;
}

/* ---------- embeddings (semantic search) ---------- */
// Anthropic has no embeddings endpoint; Ollama and every OpenAI-compatible provider does.
const EMBED_UNSUPPORTED = kind => kind === 'anthropic' ? new Error('Anthropic has no embeddings API — pick an Ollama model like nomic-embed-text') : null;
// o: { model, inputs:[string] } → { url, headers, body }
function buildEmbedRequest(kind, prov, o) {
  const base = String(prov.baseUrl || '').replace(/\/+$/, '');
  if (kind === 'ollama') return { url: base + '/api/embed', headers: { 'Content-Type': 'application/json' }, body: { model: o.model, input: o.inputs } };
  const headers = { 'Content-Type': 'application/json' };
  if (prov.apiKey) headers.Authorization = 'Bearer ' + prov.apiKey;
  return { url: base + '/embeddings', headers, body: { model: o.model, input: o.inputs } };
}
// → [number[]] in the order of the inputs.
function parseEmbedReply(kind, j) {
  if (kind === 'ollama') return Array.isArray(j && j.embeddings) ? j.embeddings : null;
  const data = j && Array.isArray(j.data) ? j.data : null;
  if (!data) return null;
  const out = [];
  for (const d of data) out[d.index === undefined ? out.length : d.index] = d.embedding;
  return out.some(v => !Array.isArray(v)) ? null : out;
}

/* ---------- the model layer ---------- */
function createLLM({ getConfig, saveConfig, OLLAMA, DEFAULT_MODEL }) {
  const providers = () => (Array.isArray(getConfig().providers) ? getConfig().providers : []);
  const labelOf = p => p.label || (PRESET_BY_ID[p.preset] || {}).label || p.id;

  function resolve(modelId) {
    const { provider, model } = parseModelId(modelId || DEFAULT_MODEL);
    if (provider === 'ollama') return { kind: 'ollama', prov: { id: 'ollama', label: 'Ollama', baseUrl: OLLAMA }, model };
    const p = providers().find(x => x.id === provider);
    const preset = p && PRESET_BY_ID[p.preset];
    if (!p || !preset) throw new Error(`The AI provider "${provider}" isn't set up any more — pick another model in Settings`);
    return { kind: preset.kind, prov: { ...p, label: labelOf(p) }, model };
  }
  const isCloud = modelId => parseModelId(modelId).provider !== 'ollama';

  // embed('nomic-embed-text', ['text one', 'text two']) → [[floats], [floats]] (or throws with a friendly message)
  async function embed(model, inputs, { timeoutMs = 60000 } = {}) {
    const ins = (Array.isArray(inputs) ? inputs : [inputs]).map(s => String(s || '').slice(0, 8000));
    if (!ins.length) return [];
    const r = resolve(model);
    const bad = EMBED_UNSUPPORTED(r.kind);
    if (bad) throw bad;
    const req = buildEmbedRequest(r.kind, r.prov, { model: r.model, inputs: ins });
    let res;
    try { res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new Error((r.kind === 'ollama' ? 'Local LLM unavailable — is Ollama running?' : r.prov.label + ' is unreachable') + ' (' + scrub(e.message, r.prov.apiKey) + ')'); }
    const text = await res.text().catch(() => '');
    if (!res.ok) throw friendlyError(res.status, r.prov.label, text, r.prov.apiKey);
    let j; try { j = JSON.parse(text); } catch { throw new Error(r.prov.label + ' sent a malformed embedding reply'); }
    const vecs = parseEmbedReply(r.kind, j);
    if (!vecs || vecs.length !== ins.length) throw new Error(r.prov.label + ' returned the wrong number of embeddings');
    return vecs;
  }

  async function send(o, stream) {
    const r = resolve(o.model);
    const hadImages = !!(o.images && o.images.length);
    let adapt = initialAdapt(r.prov.preset, r.model);
    const ms = o.timeoutMs || (stream ? 300000 : 120000);
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
    for (let attempt = 0; attempt < 5; attempt++) {
      const req = buildRequest(r.kind, r.prov, { ...o, model: r.model, stream }, adapt);
      let res;
      try {
        res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw e;
        throw new Error((r.kind === 'ollama' ? 'Local LLM unavailable — is Ollama running?' : r.prov.label + ' is unreachable') + ' (' + scrub(e.message, r.prov.apiKey) + ')');
      }
      if (res.ok) return { res, kind: r.kind, prov: r.prov, droppedImages: hadImages && !!adapt.noImages };
      const text = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 422) {
        const next = adaptFor(text, adapt, hadImages);
        if (next) { adapt = next; continue; }
      }
      throw friendlyError(res.status, r.prov.label, text, r.prov.apiKey);
    }
    throw new Error(r.prov.label + ' kept rejecting the request');
  }

  // → the full reply text
  async function complete(o) {
    const { res, kind } = await send(o, false);
    const j = await res.json();
    const text = replyText(kind, j).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!text && kind !== 'ollama') throw new Error(EMPTY_REPLY);
    return text;
  }
  // → { droppedImages, deltas: async iterable of text pieces }
  async function openStream(o) {
    const { res, kind, droppedImages } = await send(o, true);
    async function* deltas() {
      let any = false;
      for await (const line of lines(res.body)) {
        const p = parseStreamLine(kind, line);
        if (!p) continue;
        if (p.delta) { any = true; yield p.delta; }
        if (p.done) break;
      }
      if (!any && kind !== 'ollama') yield '_(' + EMPTY_REPLY + ')_';
    }
    return { droppedImages, deltas: deltas() };
  }

  const visionCaps = new Map();
  async function hasVision(modelId) {
    if (isCloud(modelId)) return true; // modern cloud models take images; a 400 retries without (see adaptFor)
    const model = parseModelId(modelId).model;
    if (visionCaps.has(model)) return visionCaps.get(model);
    try {
      const r = await fetch(`${OLLAMA}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      const j = await r.json();
      const ok = Array.isArray(j.capabilities) && j.capabilities.includes('vision');
      visionCaps.set(model, ok);
      return ok;
    } catch { return false; }
  }

  // A provider's chat models, from its own /models list (cached 10 minutes), plus any the user typed in.
  const modelCache = new Map();
  async function providerModels(p, force) {
    const hit = modelCache.get(p.id);
    if (!force && hit && Date.now() - hit.at < 10 * 6e4) return hit.ids;
    const preset = PRESET_BY_ID[p.preset];
    const base = String(p.baseUrl || '').replace(/\/+$/, '');
    let ids = [];
    try {
      const anth = preset.kind === 'anthropic';
      const r = await fetch(anth ? base + '/v1/models?limit=100' : base + '/models', {
        headers: anth ? { 'x-api-key': p.apiKey || '', 'anthropic-version': '2023-06-01' } : (p.apiKey ? { Authorization: 'Bearer ' + p.apiKey } : {}),
        signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw friendlyError(r.status, labelOf(p), await r.text().catch(() => ''), p.apiKey);
      const d = await r.json();
      ids = filterModels((d.data || d.models || []).map(m => (typeof m === 'string' ? m : m.id || m.name)));
    } catch (e) {
      if (!(p.models && p.models.length)) throw new Error(scrub(e.message, p.apiKey));
    }
    ids = [...new Set([...(p.models || []), ...ids])];
    modelCache.set(p.id, { at: Date.now(), ids });
    return ids;
  }

  async function listModels() {
    const models = [];
    let ollamaOnline = false;
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const d = await r.json();
      ollamaOnline = true;
      for (const m of d.models || []) models.push({ id: m.name, label: m.name, provider: 'ollama', providerLabel: 'Local (Ollama)' });
    } catch {}
    const errors = {};
    await Promise.all(providers().map(async p => {
      try { for (const id of await providerModels(p)) models.push({ id: p.id + SEP + id, label: id, provider: p.id, providerLabel: labelOf(p) }); }
      catch (e) { errors[p.id] = e.message; }
    }));
    return { ollamaOnline, models, errors };
  }

  /* ---------- provider settings routes (laptop page only) ---------- */
  // Ollama installed but not running still counts as "installed" — the wizard then asks them to open it.
  const findOllamaExe = () => {
    const fs = require('fs'), path = require('path');
    return [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe', '/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama']
      .some(p => { try { return fs.existsSync(p); } catch { return false; } });
  };
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  const publicView = p => ({ id: p.id, preset: p.preset, label: labelOf(p), baseUrl: p.preset === 'custom' ? p.baseUrl : undefined, key: maskKey(p.apiKey), models: p.models || [], addedAt: p.addedAt });

  function routes(app) {
    app.get('/api/llm/providers', (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Manage AI providers from JARVIS on the laptop.' });
      res.json({ success: true, presets: PRESETS.map(({ id, label, keyUrl }) => ({ id, label, keyUrl })), providers: providers().map(publicView) });
    });
    app.post('/api/llm/providers', async (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Manage AI providers from JARVIS on the laptop.' });
      const apiKey = String(req.body.apiKey || '').trim().replace(/^["']|["']$/g, '');
      // "auto" (the default): work out the provider from the key itself, so nobody has to know which one they have.
      const wanted = String(req.body.preset || 'auto');
      const preset = PRESET_BY_ID[wanted === 'auto' ? detectPreset(apiKey) : wanted];
      if (!preset) return res.status(400).json({ error: apiKey ? 'I don’t recognise that key. Check you copied all of it — or choose the provider yourself under "Other provider".' : 'Paste your API key first.' });
      if (apiKey.length > 400 || /[\s\x00-\x1f]/.test(apiKey)) return res.status(400).json({ error: 'That doesn’t look like an API key' });
      if (!apiKey && preset.id !== 'custom') return res.status(400).json({ error: preset.label + ' needs an API key' });
      let baseUrl = preset.baseUrl;
      if (preset.id === 'custom') {
        let u; try { u = new URL(String(req.body.baseUrl || '').trim()); } catch { return res.status(400).json({ error: 'Enter the server’s base URL, e.g. http://127.0.0.1:1234/v1' }); }
        if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: 'Only http/https URLs' });
        baseUrl = u.href.replace(/\/+$/, '');
      }
      const manual = String(req.body.model || '').split(',').map(s => s.trim()).filter(s => /^[\w.:\/@+-]{1,120}$/.test(s)).slice(0, 10);
      const list = providers();
      let id = preset.id;
      if (preset.id === 'custom') { let n = 1; while (list.some(p => p.id === id && p.baseUrl !== baseUrl)) id = 'custom-' + (++n); }
      const label = preset.id === 'custom' ? 'Custom (' + new URL(baseUrl).host + ')' : undefined;
      const entry = { id, preset: preset.id, baseUrl, apiKey, models: manual, addedAt: Date.now(), ...(label ? { label } : {}) };
      let ids;
      try { ids = await providerModels(entry, true); }
      catch (e) { return res.status(400).json({ error: 'Couldn’t connect: ' + e.message }); }
      const cfg = getConfig();
      cfg.providers = [...list.filter(p => p.id !== id), entry];
      saveConfig();
      console.log('[llm] provider added:', id, '(' + ids.length + ' models)');
      const pick = pickDefaultModel(preset.id, ids);
      res.json({ success: true, provider: publicView(entry), models: ids.length, defaultModel: pick ? id + SEP + pick : null, detected: wanted === 'auto' });
    });
    // Beginner setup: what's already on this laptop, so the wizard can say the one thing left to do.
    app.get('/api/setup/status', async (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Set up JARVIS from the laptop.' });
      const { ollamaOnline, models } = await listModels();
      const installed = ollamaOnline || findOllamaExe();
      res.json({ success: true, ollamaInstalled: !!installed, ollamaRunning: ollamaOnline, localModels: models.filter(m => m.provider === 'ollama').map(m => m.id),
        cloudModels: models.filter(m => m.provider !== 'ollama').length, recommended: DEFAULT_MODEL });
    });
    // Downloads a local model through Ollama and streams progress ({status, pct}) as NDJSON for a progress bar.
    app.post('/api/setup/pull', async (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Set up JARVIS from the laptop.' });
      const model = String(req.body.model || DEFAULT_MODEL);
      if (!/^[\w.:\/-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Invalid model name' });
      let up;
      try { up = await fetch(`${OLLAMA}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) }); }
      catch { return res.status(502).json({ error: 'Ollama isn’t running. Open the Ollama app (or restart your computer after installing it), then try again.' }); }
      if (!up.ok) return res.status(502).json({ error: 'Ollama couldn’t download "' + model + '": ' + (await up.text().catch(() => '')).slice(0, 150) });
      res.setHeader('Content-Type', 'application/x-ndjson');
      try {
        for await (const line of lines(up.body)) {
          let j; try { j = JSON.parse(line); } catch { continue; }
          if (j.error) { res.write(JSON.stringify({ error: String(j.error) }) + '\n'); break; }
          res.write(JSON.stringify({ status: j.status, pct: j.total ? Math.round(100 * (j.completed || 0) / j.total) : null, done: j.status === 'success' }) + '\n');
        }
      } catch (e) { res.write(JSON.stringify({ error: e.message }) + '\n'); }
      res.end();
    });
    app.delete('/api/llm/providers/:id', (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Manage AI providers from JARVIS on the laptop.' });
      const cfg = getConfig();
      const before = providers().length;
      cfg.providers = providers().filter(p => p.id !== req.params.id);
      modelCache.delete(req.params.id);
      saveConfig();
      res.json({ success: true, removed: before !== cfg.providers.length });
    });
    app.post('/api/llm/providers/:id/test', async (req, res) => {
      if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Manage AI providers from JARVIS on the laptop.' });
      const p = providers().find(x => x.id === req.params.id);
      if (!p) return res.status(404).json({ error: 'No such provider' });
      const t0 = Date.now();
      try {
        const ids = await providerModels(p, true);
        const model = String(req.body.model || '').startsWith(p.id + SEP) ? String(req.body.model) : p.id + SEP + ids[0];
        const text = await complete({ model, messages: [{ role: 'user', content: 'Reply with just the word OK.' }], maxTokens: 64, temperature: 0, timeoutMs: 30000 });
        res.json({ success: true, model: parseModelId(model).model, reply: text.slice(0, 60), ms: Date.now() - t0 });
      } catch (e) { res.json({ success: false, error: e.message }); }
    });
  }

  return { complete, openStream, embed, hasVision, listModels, isCloud, resolve, routes, providerLabel: m => (isCloud(m) ? resolve(m).prov.label : 'Ollama') };
}

module.exports = createLLM;
Object.assign(module.exports, { detectPreset, pickDefaultModel, PRESETS, SEP, parseModelId, maskKey, extractJSON, filterModels, buildRequest, parseStreamLine, replyText, friendlyError, adaptFor, initialAdapt, buildEmbedRequest, parseEmbedReply });
