// What the AI is actually sent (server.js buildSystemPrompt → /api/chat), against a fake Ollama that records each request. Run: node tests/chatprompt.test.js
'use strict';
const http = require('http');
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('chatprompt');

const seen = [];
let mode = 'ok', fails = 0;
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    if (req.url === '/api/chat') {
      let j = {}; try { j = JSON.parse(body); } catch { /* ignore */ }
      seen.push(j);
      if (mode === 'flaky' && fails++ < 2) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"model is loading"}'); }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Certainly. ' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: { role: 'assistant', content: 'Done.' }, done: true }) + '\n');
    } else if (req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] })); }
    else { res.writeHead(404); res.end('{}'); }
  });
});

(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const S = await startServer({ env: { OLLAMA_URL: 'http://127.0.0.1:' + fake.address().port } });
  const chat = async (context, text = 'explain what a mutex is') => {
    const before = seen.length;
    const r = await fetch(S.base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S.base, 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }], context, model: 'qwen3.5:4b' }) });
    const out = await r.text();
    return { status: r.status, out, req: seen[before] || null, system: ((seen[before] || {}).messages || []).find(m => m.role === 'system') };
  };
  try {
    /* ---------- the tools section ---------- */
    const full = await chat({});
    const sys = full.system && full.system.content || '';
    check('Chat prompt', 'an ordinary chat reaches the AI with the persona, the rules, the ACTIONS and TOOLS sections and what it knows about you', full.status === 200 && /J\.A\.R\.V\.I\.S\./.test(sys) && /\nACTIONS\n/.test(sys) && /\nTOOLS\n/.test(sys) && /<<tool_name/.test(sys) && /WHAT YOU KNOW ABOUT THE USER/.test(sys), [full.status, sys.slice(0, 120)]);
    const bare = await chat({ noTools: true });
    const sys2 = bare.system && bare.system.content || '';
    check('Chat prompt', 'with noTools the ACTIONS and TOOLS sections are left out (a tool already did the work; the AI only phrases the answer)', bare.status === 200 && !/\nACTIONS\n/.test(sys2) && !/\nTOOLS\n/.test(sys2) && !/<<tool_name/.test(sys2) && !/<<read_screen/.test(sys2) && /WHAT YOU KNOW ABOUT THE USER/.test(sys2), sys2.slice(0, 200));
    check('Chat prompt', '…and that really saves a lot of the small model\'s context (at least 1,000 characters shorter)', sys.length - sys2.length > 1000, [sys.length, sys2.length]);
    check('Chat prompt', '…while the persona, the style rules, the memory and the length rule are all still there', /PERSONALITY/.test(sys2) && /HOW TO BEHAVE/.test(sys2) && /THEIR CURRENT TASKS/.test(sys2) && /Use Markdown/.test(sys2));
    const withMem = await chat({ noTools: true, memory: ['likes tea'], tasks: ['To-do: revise DBMS'], limit: { n: 2, unit: 'line' } });
    check('Chat prompt', 'noTools keeps the facts about you and your tasks, and a "2 lines" limit', /likes tea/.test(withMem.system.content) && /revise DBMS/.test(withMem.system.content) && /2/.test(withMem.system.content.split('\n').slice(-6).join(' ')), withMem.system.content.slice(-300));
    const odd = await chat({ noTools: 'false' }); const oddZero = await chat({ noTools: 0 }); check('Chat prompt', 'noTools is read as a real true only: the strings "false" / "true" and 0 leave the tools in', /\nTOOLS\n/.test(odd.system.content) && /\nTOOLS\n/.test(oddZero.system.content));

    /* ---------- the reply is streamed through ---------- */
    check('Chat prompt', 'the reply is streamed back as NDJSON with the full text and a done marker', /Certainly\./.test(full.out) && /"done":true/.test(full.out), full.out.slice(0, 200));
  } finally {
    await S.stop(); fake.close();
  }
  process.exitCode = done() ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
