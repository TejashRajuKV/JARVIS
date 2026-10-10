// Developer helpers, chat side (dev-page.js): git summary, standup, commit message, error explainer. Page globals and the server's answers are fakes.
// Run: node tests/dev-page.test.js
'use strict';
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);

const calls = [], said = [], copied = [];
let replies = {}, yes = true;
global.callTool = async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
global.jarvisSay = o => { said.push(o); };
global.Extras = { confirmCard: (text, y) => new Promise(r => { said.push({ text, confirmCard: true, yes: y }); setTimeout(() => r(yes), 0); }) };
global.llm = { model: 'qwen3.5:4b' }; global.llmReady = () => true; global.isCloudModel = m => String(m).includes('::'); global.modelInfo = () => ({ providerLabel: 'SomeCloud' });
global.copyText = async t => { copied.push(t); }; global.toast = () => {}; global.setState = () => {}; global.deadlines = [];
global.TraceParse = require(root('traceparse.js'));
eval(fs.readFileSync(root('dev-page.js'), 'utf8') + ';global.Dev = Dev;');
const S = (t, src) => Dev.intercept(t, src || 'text');
const reset = () => { calls.length = 0; said.length = 0; copied.length = 0; replies = {}; yes = true; global.llm.model = 'qwen3.5:4b'; global.llmReady = () => true; global.deadlines = []; };
const k = t => { const m = Dev.match(t); return m && m.kind; };

(async () => {
  /* ---------- wording ---------- */
  for (const t of ['git summary', 'git summary today', 'daily git summary', 'git summary for yesterday', 'git recap this week', 'summary of my commits', 'summary of my commits yesterday', 'what did I commit today', 'what did I code yesterday', 'what have I pushed this week', 'show my commits', 'show me my commits today', 'my commits this week', 'what did I build today?']) check('wording: summary: "' + t + '"', k(t) === 'summary', Dev.match(t));
  check('wording: summary: the window is read; the default is today', Dev.match('git summary').window === 'today' && Dev.match('what did I commit yesterday').window === 'yesterday' && Dev.match('my commits this week').window === 'week' && Dev.match('git summary for last week').window === 'last week' && Dev.match('git summary in jarvis').repo === 'jarvis');
  for (const t of ['write my standup', 'standup', 'my standup update', 'draft a standup', 'give me a daily standup', 'generate standup notes', 'standup notes']) check('wording: standup: "' + t + '"', k(t) === 'standup', Dev.match(t));
  for (const t of ['write a commit message', 'suggest a commit message', 'generate a commit message for my changes', 'give me a commit message', 'write a commit message for my changes in jarvis', 'what should my commit message be?', 'draft a good commit message']) check('wording: commit message: "' + t + '"', k(t) === 'message', Dev.match(t));
  check('wording: commit message: the project is read', Dev.match('write a commit message for my changes in jarvis').repo === 'jarvis' && Dev.match('write a commit message for jarvis project').repo === 'jarvis' && Dev.match('write a commit message').repo === '');
  for (const t of ['why did my build fail', 'why is my code failing', 'why did the build break?', 'explain this error', 'explain the error on my screen', 'explain the stack trace', 'what does this error mean', 'debug this exception', 'explain the error from my clipboard', 'fix this error', 'help me fix the error', 'read the error on my terminal']) check('wording: explain: "' + t + '"', k(t) === 'explain', Dev.match(t));
  check('wording: explain: the source is read', Dev.match('explain the error on my screen').from === 'screen' && Dev.match('explain this error from my clipboard').from === 'clipboard' && Dev.match('why did my build fail').from === '');
  for (const t of ['git status', 'git log', 'git diff', 'git commit', 'commit my changes', 'recent commits', 'commit message', 'what is a commit message', 'what is a standup', 'standup meeting at 10', 'summary of this page', 'why did the chicken cross the road', 'why is the sky blue', 'explain recursion', 'explain this code', 'what is an error', 'what did I eat today', 'what did I do yesterday', 'my commits']) check('wording: not taken: "' + t + '"', Dev.match(t) === null, Dev.match(t));

  /* ---------- git summary ---------- */
  const R = (name, commits, extra) => ({ repo: 'D:\\code\\' + name, name, commits: commits.map((s, i) => ({ h: 'a1b2c3' + i, who: 'Me', d: 'Fri 1' + i + ':00', s })), uncommitted: 0, stat: '', ...(extra || {}) });
  reset(); replies['/dev/git/summary'] = { success: true, label: 'today', searched: 3, total: 3, repos: [R('alpha', ['Add search page', 'Fix login bug'], { uncommitted: 2, stat: '1 file changed, 4 insertions(+)' }), R('beta', ['Init'])] };
  let r = await S('git summary today');
  check('summary: asks the server for that window, lists projects with commits, hashes, times, and uncommitted files', calls[0][0] === '/dev/git/summary' && calls[0][1].window === 'today' && /3 commits in 2 projects/.test(r.text) && /\*\*alpha\*\* — 2 commits/.test(r.text) && /a1b2c30/.test(r.text) && /Add search page/.test(r.text) && /2 files not committed yet \(1 file changed/.test(r.text), r.text);
  check('summary: offers COPY and follow-up chips', r.actions[0].label === 'COPY' && r.suggestions.includes('Write my standup'));
  await r.actions[0].fn(); check('summary: COPY copies plain text without markdown', copied.length === 1 && !/\*\*/.test(copied[0]) && /Add search page/.test(copied[0]));
  reset(); replies['/dev/git/summary'] = { success: true, label: 'yesterday', searched: 2, total: 0, repos: [] }; r = await S('what did I commit yesterday'); check('summary: no commits says so, with the number of projects', /No commits yesterday in your 2 projects/.test(r.text));
  reset(); replies['/dev/git/summary'] = { success: true, label: 'today', searched: 0, total: 0, repos: [] }; r = await S('git summary'); check('summary: no projects at all → how to add one', /no git projects/.test(r.text) && /Projects/.test(r.text));
  reset(); replies['/dev/git/summary'] = { error: 'Git is not installed (or not on the PATH), so I cannot read your commits.' }; r = await S('git summary'); check('summary: a server error is shown', /Git is not installed/.test(r.text));
  reset(); r = await S('git summary', 'phone'); check('summary: refused from the phone, nothing called', !calls.length && /laptop/.test(r.text));
  reset(); replies['/dev/git/summary'] = { success: true, label: 'today', searched: 1, total: 1, repos: [R('jarvis', ['x'])] }; await S('git summary in jarvis'); check('summary: a named project is passed on', calls[0][1].repo === 'jarvis');

  /* ---------- standup ---------- */
  reset(); global.deadlines = [{ id: 'd1', title: 'DBMS assignment', due: Date.now() + 864e5, done: false }, { id: 'd2', title: 'Far away', due: Date.now() + 20 * 864e5, done: false }, { id: 'd3', title: 'Done one', due: Date.now() + 864e5, done: true }];
  replies['/dev/git/summary'] = b => (b.window === 'prevday' ? { success: true, label: 'yesterday', searched: 2, total: 2, repos: [R('alpha', ['Fix login bug.', 'Add tests'])] } : { success: true, label: 'today', searched: 2, total: 1, repos: [R('alpha', ['Add search page'], { uncommitted: 3 }), R('beta', [], { uncommitted: 1 })] });
  r = await S('write my standup');
  check('standup: Yesterday from the last working day, Today from today\'s commits + uncommitted work + deadlines in 3 days, Blockers none', /Yesterday:/.test(r.text) && /alpha: Fix login bug; Add tests/.test(r.text) && /Done so far — alpha: Add search page/.test(r.text) && /alpha: 3 files in progress/.test(r.text) && /beta: 1 file in progress/.test(r.text) && /Deadline: DBMS assignment/.test(r.text) && !/Far away/.test(r.text) && !/Done one/.test(r.text) && /Blockers:\*\*\n- None/.test(r.text), r.text);
  check('standup: asked for prevday and today, and says it is built from git (edit before sending)', calls.map(c => c[1].window).sort().join() === 'prevday,today' && /Edit it before you send/.test(r.text));
  await r.actions[0].fn(); check('standup: COPY gives plain lines', copied.length === 1 && /Yesterday:/.test(copied[0]) && !/\*\*/.test(copied[0]) && /\n- alpha: Fix login bug/.test(copied[0]), copied[0]);
  reset(); replies['/dev/git/summary'] = b => ({ success: true, label: b.window === 'prevday' ? 'on Friday' : 'today', searched: 1, total: 0, repos: [] }); r = await S('standup'); check('standup: nothing committed anywhere still gives a usable skeleton; a Monday says "On Friday:"', /On friday:|On Friday:/i.test(r.text) && /No commits/.test(r.text) && /Nothing committed yet/.test(r.text));
  reset(); replies['/dev/git/summary'] = { success: true, label: 'today', searched: 0, total: 0, repos: [] }; r = await S('write my standup'); check('standup: no projects → how to add', /no git projects/.test(r.text));
  reset(); r = await S('write my standup', 'phone'); check('standup: refused from the phone', !calls.length);

  /* ---------- commit message ---------- */
  reset(); replies['/dev/git/message'] = { success: true, name: 'alpha', message: 'Add login validation\n\n- Check the email', subject: 'Add login validation', files: 3, staged: true, truncated: false };
  r = await S('write a commit message');
  check('message: asks the server with the model; shows the message in a code block; says nothing was staged or committed; COPY button', calls[0][0] === '/dev/git/message' && calls[0][1].model === 'qwen3.5:4b' && /```text\nAdd login validation/.test(r.text) && /nothing was staged or committed/.test(r.text) && r.actions[0].label === 'COPY MESSAGE' && !/COMMIT/.test(r.actions.map(a => a.label).join()), [calls[0], r.text]);
  await r.actions[0].fn(); check('message: COPY MESSAGE copies the exact message', copied[0] === 'Add login validation\n\n- Check the email');
  reset(); replies['/dev/git/message'] = { success: true, name: 'alpha', message: 'Update stuff', subject: 'Update stuff', files: 2, staged: false, truncated: true }; r = await S('write a commit message'); check('message: unstaged changes → says to stage first; a cut diff is mentioned', /git add/.test(r.text) && /diff shortened/.test(r.text));
  reset(); replies['/dev/git/message'] = b => (b.repo ? { success: true, name: b.repo, message: 'Fix ' + b.repo, subject: 'Fix', files: 1, staged: true } : { choices: [{ repo: 'D:\\a', name: 'alpha' }, { repo: 'D:\\b', name: 'beta' }] });
  r = await S('write a commit message'); check('message: several projects with changes → buttons, one per project', r.actions.length === 2 && r.actions[0].label === 'ALPHA', r); said.length = 0; await r.actions[1].fn(); check('message: choosing one asks again for that project', calls[calls.length - 1][1].repo === 'beta' && said.some(x => /Fix beta/.test(x.text)));
  reset(); replies['/dev/git/message'] = { error: 'None of your projects has uncommitted changes.' }; r = await S('write a commit message'); check('message: server error shown', /None of your projects/.test(r.text));
  reset(); global.llmReady = () => false; r = await S('write a commit message'); check('message: AI off → says so, nothing called', /needs the AI brain/.test(r.text) && !calls.length);
  reset(); global.llm.model = 'openai::gpt-x'; yes = false; r = await S('write a commit message'); check('message: with an online AI it asks first (the code goes to them); "no" sends nothing', said[0].confirmCard && /code changes/.test(said[0].text) && /SomeCloud/.test(said[0].text) && !calls.length);
  reset(); r = await S('write a commit message', 'phone'); check('message: refused from the phone', !calls.length);

  /* ---------- explain ---------- */
  const ERR = 'TypeError: Cannot read properties of undefined (reading \'length\')\n    at getName (C:\\proj\\app.js:14:24)';
  reset(); replies['/tool/readClipboard'] = { content: ERR }; replies['/dev/explain'] = { success: true, answer: '**What happened:** x is undefined.\n**Why:** line 14.\n**Fix:** check it.', type: 'TypeError', files: [{ name: 'app.js', line: 14 }], foundFrames: 1 };
  r = await S('why did my build fail');
  check('explain: reads the clipboard first and sends the text with the model', calls[0][0] === '/tool/readClipboard' && calls[1][0] === '/dev/explain' && calls[1][1].text.includes('Cannot read properties') && calls[1][1].model === 'qwen3.5:4b', calls);
  check('explain: the answer names the error type, where it came from, the file and line read, and warns it can be wrong', /TypeError/.test(r.text) && /your clipboard/.test(r.text) && /app\.js:14/.test(r.text) && /What happened/.test(r.text) && /can be wrong/.test(r.text), r.text);
  reset(); replies['/tool/readClipboard'] = { content: 'just some copied words about lunch' }; replies['/sys/screenRead'] = { text: ERR + '\nnpm ERR! code ELIFECYCLE', lines: 3 }; replies['/dev/explain'] = { success: true, answer: 'ok', type: 'TypeError', files: [], foundFrames: 0 };
  r = await S('explain this error');
  check('explain: a clipboard without an error falls back to reading the whole screen (after a countdown)', calls[1][0] === '/sys/screenRead' && calls[1][1].source === 'screen' && calls[1][1].delay === 3 && calls[2][0] === '/dev/explain' && /your screen/.test(r.text) && /message alone/.test(r.text) && said.some(x => /Looking for the error/.test(x.text || '')), [calls.map(c => c[0]), r.text]);
  reset(); replies['/tool/readClipboard'] = { content: 'no error here' }; r = await S('explain this error from my clipboard'); check('explain: "from my clipboard" never reads the screen and says what to do', !calls.some(c => c[0] === '/sys/screenRead') && /no error message/.test(r.text));
  reset(); replies['/sys/screenRead'] = { text: ERR }; replies['/dev/explain'] = { success: true, answer: 'ok', files: [], foundFrames: 1 }; r = await S('explain the error on my screen'); check('explain: "on my screen" skips the clipboard', !calls.some(c => c[0] === '/tool/readClipboard') && calls[0][0] === '/sys/screenRead');
  reset(); replies['/sys/screenRead'] = { text: 'a desktop with some icons and no problems at all' }; r = await S('explain the error on my screen'); check('explain: a screen without an error says so, no AI call', /could not find an error/.test(r.text) && !calls.some(c => c[0] === '/dev/explain'));
  reset(); replies['/sys/screenRead'] = { error: 'screen capture failed' }; r = await S('explain the error on my screen'); check('explain: a failed screen read is reported', /could not read the screen/.test(r.text));
  reset(); replies['/tool/readClipboard'] = { content: ERR }; replies['/dev/explain'] = { error: 'The AI could not explain it: timeout', files: [{ file: 'x', line: 1 }] }; r = await S('why did my build fail'); check('explain: an AI failure is shown', /could not explain it/.test(r.text));
  reset(); global.llm.model = 'openai::gpt-x'; yes = false; replies['/tool/readClipboard'] = { content: ERR }; r = await S('why did my build fail'); check('explain: with an online AI it asks before sending the error and code lines; "no" sends nothing', said.find(x => x.confirmCard) && /few lines of your own code/.test(said.find(x => x.confirmCard).text) && !calls.some(c => c[0] === '/dev/explain'));
  reset(); global.llmReady = () => false; r = await S('why did my build fail'); check('explain: AI off → says so, nothing read', /needs the AI brain/.test(r.text) && !calls.length);
  reset(); r = await S('why did my build fail', 'phone'); check('explain: refused from the phone, nothing read', !calls.length && /laptop/.test(r.text));

  console.log(`dev-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0; process.exit();
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
