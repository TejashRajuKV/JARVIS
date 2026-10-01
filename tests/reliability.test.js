// Reliability: the ways people actually say things (from the presentation review) → the same intent, misheard speech
// repaired, and the "frontend for my project" flow. Run: node tests/reliability.test.js
'use strict';
const fs = require('fs'), path = require('path');
const { suite } = require('./lib/server');
const { check, done } = suite('reliability');

eval(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
const SpeechFix = require('../speechfix.js');
const intent = t => NLU.classify(NLU.normalize(t, 'jarvis'), {}).intent;

/* ---------- different words → same intent ---------- */
const SAME = {
  CREATE_FOLDER: ['make a folder', 'create a folder called test', 'create directory called test', 'make me a directory called notes', 'can you create a folder called dsa',
    'create folder in that directory', 'new folder called reports', 'create a folder called test in d drive', 'create a folder called test there'],
  COUNT_FOLDERS: ['list number of folders in my laptop', 'how many folders are on my laptop', 'count my folders', 'tell me the number of folders',
    'count directories in d drive', 'how many files are in my downloads', 'total number of folders in desktop'],
  LIST_FILES: ['list folders in d drive', 'show folders on my desktop', 'list the folders in my laptop', 'show me the files in downloads', 'list files there', 'list directories in documents'],
};
for (const [want, phrases] of Object.entries(SAME)) for (const t of phrases) {
  const got = intent(t);
  check('Intents', '"' + t + '" → ' + want, got === want, got);
}
// …and things that must NOT be caught by them
for (const [t, not] of [['how many people live in india', 'COUNT_FOLDERS'], ['what is a folder', 'CREATE_FOLDER'], ['open calculator', 'COUNT_FOLDERS']]) {
  const got = intent(t);
  check('Intents', '"' + t + '" is not ' + not, got !== not, got);
}

/* ---------- speech: what the recogniser hears → what was meant ---------- */
const HEARD = [
  ['creative front and for calculator app', 'create frontend for calculator app'],
  ['create a front end for my calculator', 'create a frontend for my calculator'],
  ['make the front and design', 'make the frontend design'],
  ['build the back end for my app', 'build the backend for my app'],
  ['open v s code', 'open vs code'],
  ['write java script code', 'write javascript code'],
  ['create a fold her called test', 'create a folder called test'],
  ['calculate her project', 'calculator project'],
  ['set bright ness to 50', 'set brightness to 50'],
  ['open crome', 'open chrome'],
  ['take a screen shot', 'take a screenshot'],
  // left alone: ordinary sentences that only look similar
  ['front and back of the page', 'front and back of the page'],
  ['go back and open chrome', 'go back and open chrome'],
  ['creative writing tips', 'creative writing tips'],
  ['bring it back and forth', 'bring it back and forth'],
];
for (const [heard, meant] of HEARD) { const got = SpeechFix.fix(heard); check('Speech', '"' + heard + '" → "' + meant + '"', got === meant, got); }
check('Speech', 'of the recogniser’s guesses, the one with JARVIS words wins', SpeechFix.pickAlternative(['create a front', 'create a frontend', 'create a front and']) === 'create a frontend');
check('Speech', 'the first guess is kept when no other is clearly better', SpeechFix.pickAlternative(['open chrome', 'open crow']) === 'open chrome');
// after repair, the misheard request reaches the right place
check('Speech', 'repaired "creative front and for calculator app" is a frontend request', /frontend/.test(SpeechFix.fix('creative front and for calculator app')));

/* ---------- "create a frontend for my calculator project" ---------- */
const calls = []; const replies = {};
Object.assign(global, {
  llmReady: () => true, llm: { model: 'm' }, setState: () => {}, jarvisSay: () => {}, cap: s => s.charAt(0).toUpperCase() + s.slice(1),
  plural: (n, w) => n + ' ' + w + (n === 1 ? '' : 's'), rid: () => 'x', Undo: { push: () => {} }, projectRoots: [], flashcards: [], saveFlash: () => {},
  saveToFile: async () => ({}), callTool: async (ep, body) => { calls.push([ep, body]); const r = replies[ep]; return typeof r === 'function' ? r(body) : (r || { error: 'no stub for ' + ep }); },
});
eval(fs.readFileSync(path.join(__dirname, '..', 'skills-page.js'), 'utf8') + ';global.Skills=Skills;');
(async () => {
  replies['/tool/findFolderAnywhere'] = b => ({ success: true, paths: /calculator/i.test(b.name) ? ['D:\\Projects\\Calculator'] : [] });
  replies['/skill/site'] = b => ({ success: true, name: 'calculator', file: 'x', folder: 'x', dir: (b.folder || 'C:\\jarvis\\Projects') + '\\frontend', path: (b.folder || 'C:\\jarvis\\Projects') + '\\frontend\\index.html', lines: 90 });
  for (const t of ['create a frontend design for project calculator', 'create a frontend for my calculator project', 'build the frontend for calculator app', 'make a ui for calculator', 'design the front end for calculator']) {
    Skills.state.site = null;
    const r = await Skills.intercept(t);
    check('Frontend', '"' + t + '" finds the Calculator project and asks to use it', r && /I found \*\*calculator\*\* at `D:\\Projects\\Calculator`/i.test(r.text), r && r.text);
  }
  let r = await Skills.intercept('yes');
  check('Frontend', 'yes → one short question (not three)', /Anything specific/.test(r.text), r.text);
  r = await Skills.intercept('go ahead');
  const last = calls.filter(c => c[0] === '/skill/site').pop();
  check('Frontend', 'go ahead → built inside that project folder', last && last[1].folder === 'D:\\Projects\\Calculator' && /Built the frontend for \*\*calculator\*\*/.test(r.text), [last, r.text]);
  Skills.state.site = null;
  r = await Skills.intercept('create a frontend for my zzweather project');
  check('Frontend', 'no such project → offers to build it in ~/jarvis/Projects, one question', /in ~\/jarvis\/Projects/.test(r.text) && Skills.state.site && Skills.state.site.stage === 'brief', r.text);
  r = await Skills.intercept('dark theme with big buttons');
  const last2 = calls.filter(c => c[0] === '/skill/site').pop();
  check('Frontend', 'the answer becomes the brief', last2 && last2[1].sections === 'dark theme with big buttons' && !last2[1].folder, last2);
  Skills.state.site = null;
  r = await Skills.intercept('build a website for my college fest');
  check('Frontend', 'a normal website request still asks its usual questions', /What should be on it/.test(r.text), r.text);
  done();
})();
