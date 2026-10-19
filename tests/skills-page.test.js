// Trigger phrases for the website generator, DSA coach and viva (skills-page.js), and the session flows with stubs.
// Run: node tests/skills-page.test.js
const fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// page globals the skills use, stubbed
const calls = [];
let replies = {};
global.llmReady = () => true; global.llm = { model: 'm' };
global.setState = () => {}; global.jarvisSay = () => {}; global.cap = s => s.charAt(0).toUpperCase() + s.slice(1);
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's'); global.rid = () => Math.random().toString(36).slice(2);
global.Undo = { push: () => {} }; global.projectRoots = ['dsa_sprint']; global.flashcards = []; global.saveFlash = () => {};
global.saveToFile = async (name, content) => ({ text: 'saved ' + name, saved: { name, content } });
global.callTool = async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); };
eval(fs.readFileSync(path.join(__dirname, '..', 'skills-page.js'), 'utf8') + ';global.Skills=Skills;');

const site = t => Skills.SITE_START.test(t);
const viva = t => Skills.VIVA_START.some(re => { const m = t.match(re); return m && m[1] && !/^(?:a|an|the|my)$/i.test(m[1].trim()); });
const coach = t => { const m = t.match(Skills.COACH_START); return !!(m && (/^(?:coach me|dsa coach|i(?:'m| am) stuck|give me (?:a\s+)?hints?|teach me (?:how )?to solve)/i.test(t) || Skills.DSA_WORDS.test(m[1]))); };

for (const t of ['create a website for my college fest', 'build me a landing page for my startup', 'make a portfolio website', 'build a website', 'generate a web page about climate change']) check('site starts: ' + t, site(t));
for (const t of ['design a prompt for a landing page', 'open the website', 'create a folder called site', 'what is a website']) check('not a site start: ' + t, !site(t));
for (const t of ['take my DBMS viva', 'start a java interview', 'viva on operating systems', 'mock interview for SDE placement', 'give me a viva on computer networks', 'interview me on python']) check('viva starts: ' + t, viva(t));
for (const t of ['take a screenshot', 'start a focus session', 'take my viva', 'take a break']) check('not a viva: ' + t, !viva(t));
for (const t of ['coach me on two sum', 'help me with leetcode 15 3sum', 'i am stuck on longest palindromic substring', 'give me hints for reverse a linked list', 'help me solve the sliding window maximum problem']) check('coach starts: ' + t, coach(t));
for (const t of ['help me with my resume', 'help me focus', 'help me with this email']) check('not coaching: ' + t, !coach(t));

(async () => {
  // website: three questions then a build
  replies['/skill/site'] = b => ({ success: true, name: 'college-fest', file: 'Projects/college-fest/index.html', folder: 'Projects/college-fest', lines: 120 });
  let r = await Skills.intercept('create a website for my college fest');
  check('site: skips Q1 when the purpose was given', /What should be on it/.test(r.text), r.text);
  r = await Skills.intercept('events, schedule, register');
  check('site: asks style next', /How should it look/.test(r.text));
  r = await Skills.intercept('skip');
  check('site: asks where to save before building', /Where should I save it/.test(r.text) && !calls.some(c => c[0] === '/skill/site'), r.text);
  r = await Skills.intercept('jarvis');
  check('site: builds with the answers', /Built your website/.test(r.text) && calls.at(-1)[0] === '/skill/site' && calls.at(-1)[1].sections === 'events, schedule, register' && calls.at(-1)[1].style === '', calls.at(-1));
  replies['/skill/siteEdit'] = { success: true };
  r = await Skills.intercept('make the header bigger');
  check('site edit after building', r && /Updated/.test(r.text) && calls.at(-1)[0] === '/skill/siteEdit' && calls.at(-1)[1].name === 'college-fest');
  check('normal commands are not website edits', (await Skills.intercept('add milk to my list')) === null && (await Skills.intercept('set volume to 30')) === null);
  r = await Skills.intercept('create a website'); await Skills.intercept('cancel');
  check('site: cancel mid-way', Skills.state.site === null);

  // coach
  replies['/skill/coach'] = b => ({ success: true, text: b.mode === 'solution' ? 'Idea.\n```python\ndef two_sum(a, t):\n    return []\n```\nTime: O(n)' : b.mode + ' text ' + (b.level || '') });
  r = await Skills.intercept('coach me on two sum');
  check('coach: starts with hint 1', /Hint 1:\*\* hint text 1/.test(r.text) && Skills.state.coach.problem === 'two sum', r.text);
  r = await Skills.intercept('next hint'); check('coach: hint 2, with hint 1 passed along', /Hint 2/.test(r.text) && calls.at(-1)[1].previous.length === 1);
  r = await Skills.intercept('another hint'); check('coach: hint 3', /Hint 3/.test(r.text));
  r = await Skills.intercept('next hint'); check('coach: no hint 4', /last hint/.test(r.text));
  r = await Skills.intercept('my approach is to use a hash map of seen values');
  check('coach: approach checked', /check text/.test(r.text) && calls.at(-1)[1].approach.includes('hash map'));
  check('coach: other commands pass through', (await Skills.intercept('what time is it')) === null);
  r = await Skills.intercept('show solution in c++');
  check('coach: solution in C++', calls.at(-1)[1].mode === 'solution' && calls.at(-1)[1].lang === 'C++' && /save it/i.test(r.text));
  r = await Skills.intercept('save it');
  check('coach: saved into dsa_sprint with the right extension', r.saved && r.saved.name === 'dsa_sprint/two_sum.cpp' && /def two_sum/.test(r.saved.content), r);
  r = await Skills.intercept('stop coaching');
  check('coach: ends', /ended/.test(r.text) && Skills.state.coach === null);

  // viva
  replies['/skill/viva/questions'] = { success: true, topic: 'DBMS', level: 'college (B.Tech)', questions: ['What is a key?', 'What is 3NF?', 'What is ACID?'] };
  replies['/skill/viva/grade'] = b => ({ success: true, score: b.answer ? 6 : 0, feedback: 'ok', missed: ['uniqueness'], model: 'A key uniquely identifies a row.' });
  r = await Skills.intercept('take my DBMS viva');
  check('viva: first question', /Q1 of 3\.\*\* What is a key\?/.test(r.text) && /Question 1/.test(r.speak), r.text);
  r = await Skills.intercept('repeat'); check('viva: repeat', /Q1 of 3/.test(r.text));
  check('viva: every answer is captured, even ones that look like commands', (await Skills.intercept('open the table')) && Skills.state.viva.results.length === 1);
  r = await Skills.intercept('skip'); check('viva: skip scores 0 and shows a model answer', Skills.state.viva.results[1].score === 0 && /\*\*A strong answer:\*\*/.test(r.text) && !/_Missed:_/.test(r.text), r.text);
  r = await Skills.intercept('atomicity consistency isolation durability');
  check('viva: finishes with a summary and flashcards', /score/.test(r.text) && Skills.state.viva === null && r.actions && /FLASHCARDS/.test(r.actions[0].label), r.text);
  r.actions[0].fn(); check('viva: flashcards made from weak answers', flashcards.length === 3 && flashcards[0].deck === 'Viva: DBMS');
  await Skills.intercept('take my DBMS viva'); r = await Skills.intercept('stop viva');
  check('viva: stop early with no answers', /no answers yet/.test(r.text) && Skills.state.viva === null);

  // skill packs (SKILL.md folders)
  const PACKS = [
    { name: 'quick', hint: 'Short answers.', triggers: ['quick answer', 'be brief'], uses: '', source: 'bundled' },
    { name: 'research', hint: 'Web answer with sources.', triggers: ['research', 'look into'], uses: 'research', source: 'bundled' },
    { name: 'code-review', hint: 'Review my code.', triggers: ['review my code'], uses: 'files', source: 'bundled' },
    { name: 'plan-then-act', hint: 'Plan, then do.', triggers: ['plan and do'], uses: 'plan', source: 'bundled' },
    { name: 'mine', hint: 'My own.', triggers: [], uses: '', source: 'yours' },
  ];
  global.API = '/api'; let packReply = { success: true, skills: PACKS, skipped: [], folder: 'C:\\Users\\x\\jarvis\\Skills' };
  global.fetch = async () => ({ json: async () => packReply });
  check('packs: none loaded before the list arrives', Skills.packs.length === 0 && (await Skills.intercept('/quick hello')) === null);
  await Skills.loadPacks();
  check('packs: loaded from /api/skills', Skills.packs.length === 5);
  const px = t => { const m = Skills.packExplicit(t); return m ? m.pack.name + '|' + m.input : null; };
  check('explicit: /name rest', px('/quick what is a mutex') === 'quick|what is a mutex' && px('/QUICK hi') === 'quick|hi' && px('/mine') === 'mine|');
  check('explicit: "use the X skill to …"', px('use the research skill to find the latest node version') === 'research|find the latest node version' && px('please use my quick skill on this') === 'quick|this' && px('use the quick skill') === 'quick|');
  check('explicit: unknown names are left alone', px('/nothing hello') === null && px('use the nothing skill to x') === null && px('/usr/bin/env') === null && px('/etc is a folder') === null);
  const pt = t => { const m = Skills.packByTrigger(t); return m ? m.pack.name + '|' + m.input : null; };
  check('trigger: only at the start, on a word boundary', pt('research the latest node version') === 'research|the latest node version' && pt('Look into: rust vs go') === 'research|rust vs go' && pt('quick answer what is dns') === 'quick|what is dns');
  check('trigger: not in the middle, not part of a longer word', pt('please research x') === null && pt('researching x') === null && pt('my research notes') === null);
  check('trigger: ordinary commands are not hijacked', pt('open chrome') === null && pt('set volume to 30') === null && pt('what is the weather') === null);

  calls.length = 0; replies['/skill/run'] = b => ({ success: true, skill: b.skill, text: 'Short. Second sentence. Third one.' });
  r = await Skills.intercept('/quick what is a mutex');
  check('run: plain skill goes to /skill/run with its name and the input', calls.at(-1)[0] === '/skill/run' && calls.at(-1)[1].skill === 'quick' && calls.at(-1)[1].input === 'what is a mutex' && calls.at(-1)[1].model === 'm', calls.at(-1));
  check('run: reply is shown as is, spoken as the first two sentences', r.text === 'Short. Second sentence. Third one.' && r.speak === 'Short. Second sentence.' && r.noPersona && r.intent === 'SKILL', r);
  r = await Skills.intercept('quick answer what is dns'); check('run: by trigger phrase', calls.at(-1)[1].skill === 'quick' && calls.at(-1)[1].input === 'what is dns');
  r = await Skills.intercept('/quick'); check('run: no input → asks what to work on, no model call', /What should the \*\*quick\*\* skill work on/.test(r.text) && calls.at(-1)[1].input === 'what is dns');
  replies['/skill/run'] = { error: 'Local LLM unavailable' };
  r = await Skills.intercept('/quick hi'); check('run: errors are explained', /couldn’t run the \*\*quick\*\* skill: Local LLM unavailable/.test(r.text));
  replies['/skill/run'] = b => ({ success: true, text: 'Answer from ' + b.skill });

  // research: the page's own web search builds the prompt; the skill writes the answer; sources are appended
  global.settings = { online: false }; global.enableOnlineAction = () => [{ label: 'ENABLE ONLINE TOOLS' }];
  calls.length = 0; r = await Skills.intercept('/research latest node version');
  check('research: Online tools off → asks, offers ENABLE, does not search', /Online tools\*\* is off/.test(r.text) && r.actions && r.actions[0].label === 'ENABLE ONLINE TOOLS' && !calls.length, r);
  global.settings.online = true; let researched = null;
  global.doResearch = async q => { researched = q; return { askLLM: 'Question: ' + q + '\n\n[1] Node (https://nodejs.org)\nv24', after: { sources: '\n\n**Sources**\n1. [Node](https://nodejs.org)', suggestions: ['Search Google for x'] } }; };
  r = await Skills.intercept('research latest node version');
  check('research: asks the web search, sends its prompt to the skill, keeps the sources', researched === 'latest node version' && calls.at(-1)[1].skill === 'research' && /\[1\] Node/.test(calls.at(-1)[1].input) && /Answer from research/.test(r.text) && /\*\*Sources\*\*/.test(r.text) && r.suggestions[0] === 'Search Google for x', r);
  global.doResearch = async () => ({ text: 'I could not search the web right now.', suggestions: ['Search Google for x'] });
  calls.length = 0; r = await Skills.intercept('/research anything');
  check('research: a failed search is reported as it is, no model call', /could not search/.test(r.text) && r.noPersona && !calls.length, r);

  // files: the page's own file search finds the excerpts
  let rag = null;
  replies['/rag/search'] = b => { rag = b; return { results: [{ file: 'calc.py', start: 3, end: 9, text: 'def add(a,b): return a-b' }], files: 12 }; };
  global.isCloudModel = () => false; calls.length = 0;
  r = await Skills.intercept('/code-review check calc.py for bugs');
  check('files: searches with the file name, sends the excerpts to the skill', rag.file === 'calc.py' && rag.k === 5 && /calc\.py \(lines 3–9\)/.test(calls.at(-1)[1].input) && /def add/.test(calls.at(-1)[1].input) && /^Question: check calc\.py for bugs/.test(calls.at(-1)[1].input), { rag, input: calls.at(-1)[1].input });
  check('files: sources listed under the answer', /\*\*Sources\*\*\n1\. calc\.py \(lines 3–9\)/.test(r.text), r.text);
  replies['/rag/search'] = { results: [], files: 12 };
  r = await Skills.intercept('review my code in zzz.py'); calls.length = 0;
  check('files: nothing found → says so, no model call', /couldn’t find anything/.test(r.text) && !calls.length, r.text);
  global.isCloudModel = () => true; global.modelInfo = () => ({ providerLabel: 'Gemini' }); replies['/rag/search'] = { results: [{ file: 'a.py', start: 1, end: 2, text: 'x' }], files: 1 };
  r = await Skills.intercept('/code-review a.py'); check('files: warns when a cloud model got your file excerpts', /sent to Gemini/.test(r.text));
  global.isCloudModel = () => false;

  // plan: the existing planner and its confirmations do the work
  let planned = null;
  global.Agent = { plan: async (text, ms) => { planned = text; return text.includes('nonsense') ? null : { text: 'Plan done', intent: 'AGENT_RUN' }; } };
  r = await Skills.intercept('/plan-then-act open vs code then start a focus session');
  check('plan: hands the request to the planner and returns its result', planned === 'open vs code then start a focus session' && r.text === 'Plan done' && r.intent === 'AGENT_RUN', r);
  r = await Skills.intercept('/plan-then-act nonsense'); check('plan: not an action → explained, nothing run', /didn’t make a plan/.test(r.text));

  // list / reload
  r = await Skills.intercept('list my skills');
  check('list: shows every skill with how to call it', /`\/quick` — Short answers\./.test(r.text) && /`\/mine` — My own\. \*\(yours\)\*/.test(r.text) && /`\/research`/.test(r.text) && r.text.includes('C:\\Users\\x\\jarvis\\Skills'), r.text);
  r = await Skills.intercept('what skills do you have?'); check('list: natural phrasing', /`\/code-review`/.test(r.text));
  replies['/skills/reload'] = { success: true, count: 6, skipped: [] };
  packReply = { success: true, skills: PACKS.concat([{ name: 'extra', hint: 'New.', triggers: [], uses: '', source: 'yours' }]), skipped: [{ folder: 'oops', source: 'yours', reason: 'no description' }], folder: 'F' };
  r = await Skills.intercept('reload skills');
  check('reload: refetches the list and reports skipped folders', Skills.packs.length === 6 && /Reloaded: \*\*6\*\* skills/.test(r.text) && /`oops` \(no description\)/.test(r.text), r.text);

  // existing skills still win where they should
  check('built-in skills unaffected: website start, coach, other commands', (await Skills.intercept('add milk to my list')) === null && (await Skills.intercept('set volume to 30')) === null);
  r = await Skills.intercept('create a website for my fest'); check('built-in: website still starts', /What should be on it/.test(r.text)); await Skills.intercept('cancel');

  // no AI
  global.llmReady = () => false;
  r = await Skills.intercept('/quick hello'); check('packs: no AI → a clear message, no model call', /AI brain/.test(r.text));
  r = await Skills.intercept('take my OS viva');
  check('no AI → a clear message, nothing started', /AI brain/.test(r.text) && Skills.state.viva === null);

  console.log(`skills-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
