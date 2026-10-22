'use strict';
// Exercise the actual browser-side doResearch implementation in an isolated VM with mocked I/O.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('const TIME_SENSITIVE =');
const fn = source.indexOf('async function doResearch', start);
const end = source.indexOf('/* ============ flashcards', fn);
if (start < 0 || fn < 0 || end < 0) throw new Error('Could not locate doResearch in script.js');
const snippet = source.slice(start, end) + '\\nglobalThis.runResearch = doResearch;';
let modelChecks = 0;
const sample = {
  results: [
    { title: 'Official documentation', url: 'https://example.test/docs', snippet: 'A short official result.' },
    { title: 'Research paper', url: 'https://example.test/paper', snippet: 'A paper abstract.' }
  ],
  pages: [
    { title: 'Official documentation', url: 'https://example.test/docs', text: 'Retrieved evidence from the official documentation.' },
    { title: 'Research paper', url: 'https://example.test/paper', text: 'Retrieved evidence from a research paper.' }
  ]
};
const sandbox = {
  TIME_SENSITIVE: /\\b(latest|current|today|news|price)\\b/i,
  settings: { researchMode: 'search' },
  llm: { model: 'qwen3.5:4b' },
  llmReady: () => { modelChecks++; return true; },
  isCloudModel: () => false,
  callTool: async (endpoint, payload) => ({ ...sample, endpoint, payload }),
  setState() {}, toolStep() {},
  Lang: { aiInEnglish: () => true, replyLang: () => 'en' },
  Date, String, Math, RegExp, Promise
};
vm.createContext(sandbox);
vm.runInContext(snippet, sandbox);
const check = (name, ok, detail) => {
  if (!ok) { console.error('FAIL ' + name + (detail ? ': ' + detail : '')); process.exitCode = 1; }
  else console.log('PASS ' + name);
};
(async () => {
  const direct = await sandbox.runResearch('compare search systems');
  check('Search Mode returns retrieved evidence and source links', !direct.askLLM && direct.text.includes('Retrieved evidence from the official documentation.') && direct.text.includes('https://example.test/docs'));
  check('Search Mode never checks or invokes an LLM', modelChecks === 0, 'llmReady checks=' + modelChecks);
  sandbox.settings.researchMode = 'ai';
  const synthesized = await sandbox.runResearch('compare search systems');
  check('AI Research Mode builds a grounded synthesis prompt with citations', !!synthesized.askLLM && synthesized.askLLM.includes('[1] Official documentation') && synthesized.askLLM.includes('Retrieved evidence from a research paper.'));
  sandbox.isCloudModel = () => true;
  const cloudBlocked = await sandbox.runResearch('compare search systems');
  check('AI Research Mode blocks cloud-model synthesis', !cloudBlocked.askLLM && cloudBlocked.text.includes('requires a local model'));
  if (process.exitCode) process.exit(process.exitCode);
  console.log('3/3 research mode checks passed');
})().catch(e => { console.error(e.stack || e); process.exit(1); });
