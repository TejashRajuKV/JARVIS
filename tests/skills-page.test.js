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

  // no AI
  global.llmReady = () => false;
  r = await Skills.intercept('take my OS viva');
  check('no AI → a clear message, nothing started', /AI brain/.test(r.text) && Skills.state.viva === null);

  console.log(`skills-page: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
