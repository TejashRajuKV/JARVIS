// Model-layer tests (llm.js): model IDs, request building per provider, stream parsing, key handling, and a real
// round trip against a fake OpenAI-compatible server. Run: node tests/llm.test.js
const path = require('path');
const http = require('http');
const L = require(path.join(__dirname, '..', 'llm.js'));

let fail = 0, total = 0;
const check = (name, ok, extra) => { total++; if (!ok) { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); } };

(async () => {
  /* ---------- model IDs ---------- */
  check('cloud id', JSON.stringify(L.parseModelId('openai::gpt-5-mini')) === JSON.stringify({ provider: 'openai', model: 'gpt-5-mini' }));
  check('ollama id with a tag stays local', L.parseModelId('qwen3.5:4b').provider === 'ollama' && L.parseModelId('qwen3.5:4b').model === 'qwen3.5:4b');
  check('ollama id with a namespace stays local', L.parseModelId('library/x:tag').provider === 'ollama');
  check('openrouter model with a slash', L.parseModelId('openrouter::meta-llama/llama-3.3-70b').model === 'meta-llama/llama-3.3-70b');

  /* ---------- beginner setup: provider auto-detect + default model ---------- */
  check('detect Claude key', L.detectPreset('sk-ant-api03-abcdefghijklmnop') === 'anthropic');
  check('detect OpenRouter key', L.detectPreset('sk-or-v1-abcdef') === 'openrouter');
  check('detect OpenAI key', L.detectPreset('sk-proj-abcdefghijklmnop') === 'openai');
  check('detect Gemini key', L.detectPreset('AIzaSyA1234567890abcdefghijklmnop') === 'gemini');
  check('detect Groq key', L.detectPreset('gsk_abcdefghijklmnopqrstuvwx') === 'groq');
  check('detect DeepSeek key', L.detectPreset('sk-0123456789abcdef0123456789abcdef') === 'deepseek');
  check('unknown key → null', L.detectPreset('hello world') === null && L.detectPreset('') === null);
  check('picks gemini flash', L.pickDefaultModel('gemini', ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash']) === 'gemini-2.5-flash');
  check('picks openai mini', L.pickDefaultModel('openai', ['gpt-4o', 'gpt-4o-mini']) === 'gpt-4o-mini');
  check('picks a haiku for anthropic', /haiku/.test(L.pickDefaultModel('anthropic', ['claude-opus-x', 'claude-haiku-y'])));
  check('falls back to the first model', L.pickDefaultModel('groq', ['zzz']) === 'zzz');

  /* ---------- keys ---------- */
  check('mask shows only the ends', L.maskKey('sk-proj-abcdefghijklmnop1234') === 'sk-…1234');
  check('short key fully hidden', L.maskKey('abc123') === '••••');
  const e401 = L.friendlyError(401, 'OpenAI', '{"error":{"message":"Incorrect API key provided: sk-secret-KEY-123456"}}', 'sk-secret-KEY-123456');
  check('401 → friendly message', /rejected the API key/.test(e401.message), e401.message);
  const e400 = L.friendlyError(400, 'Groq', 'bad request for key sk-secret-KEY-123456', 'sk-secret-KEY-123456');
  check('key never appears in an error', !e400.message.includes('sk-secret-KEY-123456') && e400.message.includes('***'), e400.message);
  check('429 → credit/rate message', /rate-limiting|credit/.test(L.friendlyError(429, 'X', '', '').message));

  /* ---------- request building ---------- */
  const o = { model: 'm', system: 'SYS', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'look' }], images: ['/9j/AAAA'], temperature: 0.2, maxTokens: 50, json: true };
  {
    const r = L.buildRequest('openai', { baseUrl: 'https://api.x.com/v1/', apiKey: 'K', preset: 'groq' }, o);
    check('openai url', r.url === 'https://api.x.com/v1/chat/completions', r.url);
    check('openai bearer', r.headers.Authorization === 'Bearer K');
    check('openai system first', r.body.messages[0].role === 'system' && r.body.messages[0].content.startsWith('SYS'));
    const last = r.body.messages[r.body.messages.length - 1];
    check('openai image on last user msg', Array.isArray(last.content) && last.content[1].image_url.url === 'data:image/jpeg;base64,/9j/AAAA');
    check('openai json mode', r.body.response_format && r.body.response_format.type === 'json_object');
    check('openai max_tokens', r.body.max_tokens === 50 && r.body.temperature === 0.2);
    const a = L.buildRequest('openai', { baseUrl: 'u', apiKey: 'K' }, o, { maxCompletion: true, noTemperature: true, noJsonMode: true, noImages: true });
    check('adapt: max_completion_tokens (with headroom), no temperature/json/images', a.body.max_completion_tokens >= 50 && !('max_tokens' in a.body) && !('temperature' in a.body) && !a.body.response_format && typeof a.body.messages[a.body.messages.length - 1].content === 'string');
    const noKey = L.buildRequest('openai', { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '' }, o);
    check('custom server without a key sends no auth header', !('Authorization' in noKey.headers));
    check('custom server: thinking turned off', L.buildRequest('openai', { baseUrl: 'u', preset: 'custom' }, o).body.reasoning_effort === 'none');
    check('named providers: reasoning_effort not sent', !('reasoning_effort' in L.buildRequest('openai', { baseUrl: 'u', preset: 'groq' }, o).body));
    check('adaptFor: server rejects reasoning_effort → dropped', L.adaptFor('unknown parameter reasoning_effort', {}, false).noReasoningEffort === true);
  }
  {
    const r = L.buildRequest('anthropic', { baseUrl: 'https://api.anthropic.com', apiKey: 'AK' }, o);
    check('anthropic url + headers', r.url === 'https://api.anthropic.com/v1/messages' && r.headers['x-api-key'] === 'AK' && r.headers['anthropic-version']);
    check('anthropic system is top-level with a JSON instruction', /^SYS[\s\S]*JSON/.test(r.body.system) && r.body.messages.every(m => m.role !== 'system'));
    const last = r.body.messages[r.body.messages.length - 1];
    check('anthropic image block', last.content[0].type === 'image' && last.content[0].source.media_type === 'image/jpeg' && last.content[1].text === 'look');
    check('anthropic max_tokens set', r.body.max_tokens === 50);
  }
  {
    const r = L.buildRequest('ollama', { baseUrl: 'http://127.0.0.1:11434' }, { ...o, numCtx: 8192 });
    check('ollama url + format json', r.url === 'http://127.0.0.1:11434/api/chat' && r.body.format === 'json');
    check('ollama images on last user msg', JSON.stringify(r.body.messages[r.body.messages.length - 1].images) === '["/9j/AAAA"]');
    check('ollama options', r.body.options.num_predict === 50 && r.body.options.num_ctx === 8192 && r.body.think === false);
  }
  check('reasoning OpenAI models start adapted', L.initialAdapt('openai', 'gpt-5-mini').maxCompletion === true && !L.initialAdapt('groq', 'gpt-5').maxCompletion);
  check('adaptFor: temperature complaint', L.adaptFor('Unsupported value: temperature', {}, false).noTemperature === true);
  check('adaptFor: image complaint only when images were sent', L.adaptFor('model does not support image input', {}, true).noImages === true && L.adaptFor('model does not support image input', {}, false) === null);
  check('adaptFor: unrelated 400 → give up', L.adaptFor('something else', {}, false) === null);

  /* ---------- stream parsing ---------- */
  check('openai delta', L.parseStreamLine('openai', 'data: {"choices":[{"delta":{"content":"Hel"}}]}').delta === 'Hel');
  check('openai done', L.parseStreamLine('openai', 'data: [DONE]').done === true);
  check('openai keep-alive comment ignored', L.parseStreamLine('openai', ': OPENROUTER PROCESSING') === null);
  check('anthropic delta', L.parseStreamLine('anthropic', 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}').delta === 'lo');
  check('anthropic event line ignored', L.parseStreamLine('anthropic', 'event: content_block_delta') === null);
  check('anthropic stop', L.parseStreamLine('anthropic', 'data: {"type":"message_stop"}').done === true);
  check('ollama ndjson', L.parseStreamLine('ollama', '{"message":{"content":"x"},"done":false}').delta === 'x');
  let threw = false; try { L.parseStreamLine('openai', 'data: {"error":{"message":"boom"}}'); } catch (e) { threw = /boom/.test(e.message); }
  check('stream error surfaces', threw);
  check('replyText anthropic', L.replyText('anthropic', { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }) === 'AB');
  check('extractJSON from prose + fences', JSON.stringify(L.extractJSON('Sure!\n```json\n{"goal":"x","steps":[]}\n```')) === '{"goal":"x","steps":[]}');
  check('filterModels drops embeddings/tts, strips models/', JSON.stringify(L.filterModels(['models/gemini-2.5-flash', 'text-embedding-3-small', 'tts-1', 'gpt-4o'])) === '["gemini-2.5-flash","gpt-4o"]');

  /* ---------- end-to-end against a fake OpenAI-compatible server ---------- */
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.headers.authorization !== 'Bearer good-key-123456') { res.writeHead(401); return res.end('{"error":{"message":"bad key good? no"}}'); }
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"fake-chat"},{"id":"fake-embed-embedding"}]}'); }
      const b = JSON.parse(body);
      if (b.model === 'limited') { res.writeHead(429); return res.end('{"error":{"message":"quota"}}'); }
      if ('temperature' in b && b.model === 'no-temp') { res.writeHead(400); return res.end('{"error":{"message":"Unsupported parameter: temperature"}}'); }
      if (b.model === 'thinker' && b.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '', reasoning: 'hmm' } }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      if (b.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const w of ['Hello', ' from', ' fake']) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: b.response_format ? '{"ok":true}' : 'pong' } }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/v1';
  const config = { providers: [{ id: 'custom', preset: 'custom', baseUrl: base, apiKey: 'good-key-123456', models: [] },
    { id: 'custom-2', preset: 'custom', baseUrl: base, apiKey: 'wrong-key-999999', models: [] }] };
  const llm = L({ getConfig: () => config, saveConfig: () => {}, OLLAMA: 'http://127.0.0.1:1', DEFAULT_MODEL: 'qwen3.5:4b' });

  check('complete()', await llm.complete({ model: 'custom::fake-chat', messages: [{ role: 'user', content: 'ping' }] }) === 'pong');
  check('complete(json)', JSON.stringify(L.extractJSON(await llm.complete({ model: 'custom::fake-chat', json: true, messages: [{ role: 'user', content: 'x' }] }))) === '{"ok":true}');
  const s = await llm.openStream({ model: 'custom::fake-chat', messages: [{ role: 'user', content: 'hi' }] });
  let acc = ''; for await (const d of s.deltas) acc += d;
  check('stream()', acc === 'Hello from fake', acc);
  const th = await llm.openStream({ model: 'custom::thinker', messages: [{ role: 'user', content: 'hi' }] });
  let thAcc = ''; for await (const d of th.deltas) thAcc += d;
  check('reasoning-only stream → explains the empty answer', /no answer/.test(thAcc), thAcc);
  check('400 naming a parameter → retried without it', await llm.complete({ model: 'custom::no-temp', temperature: 0.5, messages: [{ role: 'user', content: 'x' }] }) === 'pong');
  let err = ''; try { await llm.complete({ model: 'custom::limited', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e.message; }
  check('429 → friendly error', /rate-limiting|credit/.test(err), err);
  err = ''; try { await llm.complete({ model: 'custom-2::fake-chat', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e.message; }
  check('401 → key rejected, key not echoed', /rejected the API key/.test(err) && !err.includes('wrong-key-999999'), err);
  err = ''; try { await llm.complete({ model: 'gone::x', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e.message; }
  check('removed provider → clear message', /isn't set up any more/.test(err), err);
  const lm = await llm.listModels();
  check('listModels: provider models namespaced, embeddings filtered', lm.models.some(m => m.id === 'custom::fake-chat') && !lm.models.some(m => /embed/.test(m.id)), lm.models.map(m => m.id));
  check('listModels: a bad key is reported, not thrown', /rejected/.test(lm.errors['custom-2'] || ''), lm.errors);
  check('listModels: Ollama offline is fine', lm.ollamaOnline === false);
  check('isCloud', llm.isCloud('custom::fake-chat') && !llm.isCloud('qwen3.5:4b'));
  check('cloud models count as vision-capable', await llm.hasVision('custom::fake-chat') === true);
  srv.close();

  console.log(`llm: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('CRASH', e); process.exitCode = 1; });
