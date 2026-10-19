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
for (const t of ['okay save this file by creating new folder called calculator_website', 'save it on my desktop', 'save this page in a new folder named calc', 'save this file', 'save the code in a folder called site on desktop']) {
  const got = intent(t);
  check('Intents', '"' + t + '" → SAVE_CODE (writes the code JARVIS just gave, not a note)', got === 'SAVE_CODE', got);
}
for (const [t, not] of [['how many people live in india', 'COUNT_FOLDERS'], ['what is a folder', 'CREATE_FOLDER'], ['open calculator', 'COUNT_FOLDERS']]) {
  const got = intent(t);
  check('Intents', '"' + t + '" is not ' + not, got !== not, got);
}

/* ---------- an obvious file name is used, not asked for (NLU.inferFileNames) ---------- */
for (const [said, ext, folder, want] of [
  ['continue in the same project calculator create a new python file in that which includes all operations of calculator', '.py', 'D:\\calculator', ['calculator.py']],
  ['create a python file for calculator operations', '.py', '', ['calculator.py']],
  ['create a python file for calculator operations there', '.py', 'C:\\x\\calc', ['calculator.py']],
  ['create a python file with a login function', '.py', '', ['login.py']],
  ['create a java program to sort numbers', '.java', '', ['sort_numbers.java']],
  ['create a python file that handles student attendance', '.py', 'D:\\test123', ['student_attendance.py']],
  ['create a python file for the calculator in the same project', '.py', 'D:\\calculator', ['calculator.py']],
  ['create a python file for student marks', '.py', 'D:\\attendance', ['student_marks.py']],   // the request says what it's for → that, not the folder name
  ['create a python file', '.py', 'D:\\calculator', ['calculator.py']],                           // nothing said → the folder's name
  ['create a python file', '.py', '', []],                                                                     // nothing to go on → ask
]) {
  const got = NLU.inferFileNames(said, ext, folder);
  check('File names', '"' + said.slice(0, 60) + '…" → ' + (want.length ? want.join(' / ') : 'ask'), JSON.stringify(got) === JSON.stringify(want), got);
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
// your own folder names, matched by SOUND (what the mic really heard on this laptop)
{
  const names = ['AGRILOOP-1', 'AGRILOOP61', 'AGRRILOOP', 'dsa_sprint', 'calculator', 'pythonProject', 'Downloads', 'Projects', 'notes', 'books', 'tools', 'music'];
  const heard = s => SpeechFix.fixNames(SpeechFix.fixDrives(SpeechFix.fix(s), ['C', 'D']), names);
  for (const [said, want] of [['open agri look folder', 'open AGRILOOP-1 folder'], ['open ugly loop folder', 'open AGRILOOP-1 folder'], ['open agree look folder', 'open AGRILOOP-1 folder'],
    ['open agri Roop folder', 'open AGRILOOP-1 folder'], ['start agree loop backend', 'start AGRILOOP-1 backend'], ['open DSS print folder in plot code', 'open dsa_sprint folder in vs code'],
    ['open calculater folder', 'open calculator folder'], ['list folders in b drive', 'list folders in D drive'], ['open agriloop holder', 'open AGRILOOP-1 folder'],
    // left alone
    ['open the new folder', 'open the new folder'], ['open python project folder', 'open python project folder'], ['open pics folder', 'open pics folder'], ['open travis folder', 'open travis folder'],
    ['open apple pie folder', 'open apple pie folder'], ['create a folder called notes', 'create a folder called notes'], ['open my projects folder', 'open my projects folder'], ['list folders in c drive', 'list folders in c drive']])
    check('Speech names', '"' + said + '" → "' + want + '"', heard(said) === want, heard(said));
}
check('Speech', 'of the recogniser’s guesses, the one with JARVIS words wins', SpeechFix.pickAlternative(['create a front', 'create a frontend', 'create a front and']) === 'create a frontend');
check('Speech', 'the first guess is kept when no other is clearly better', SpeechFix.pickAlternative(['open chrome', 'open crow']) === 'open chrome');
// after repair, the misheard request reaches the right place
check('Speech', 'repaired "creative front and for calculator app" is a frontend request', /frontend/.test(SpeechFix.fix('creative front and for calculator app')));

/* ---------- "Did you mean…?": which names count as close (server.js nameSimilarity) ---------- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const grab = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const code = grab('const squashName', 'function sameName') + grab('function jaroWinkler', 'const SIM_NOISE') + grab('function nameSimilarity(', 'function similarNames');
  const sim = new Function(code + '; return nameSimilarity;')();
  const CLOSE = [['calculator', 'Calculater'], ['calculator', 'calc_app'], ['calculator', 'CalcApp'], ['calculator', 'my-calculator'], ['calculator', 'calculator project'],
    ['calc', 'calculator'], ['agriloop', 'AGRRILOOP'], ['agriloop', 'AGRILOOP-1'], ['dsa sprint', 'dsa_sprint'], ['dsa sprint', 'dss print'], ['python project', 'pythonProject'], ['agri look', 'AGRILOOP-1'], ['agri look', 'AGRRILOOP'], ['notes', 'notes (2)']];
  const FAR = [['calculator', 'calendar'], ['calculator', 'calculus'], ['calculator', 'tools'], ['agriloop', 'airplane'], ['notes', 'photos'], ['dsa sprint', 'sprint planning']];
  for (const [w, c] of CLOSE) check('Did you mean', '"' + w + '" ≈ "' + c + '"', sim(w, c) >= 0.82, sim(w, c));
  check('Did you mean', 'a one-typo match ranks above a two-typo one (calculater > calculation)', sim('calculator', 'Calculater') > sim('calculator', 'calculation'));
  check('Did you mean', 'a name that contains it ranks above a two-typo word (Forest-Competition-Simulator > forecast)', sim('forest', 'Forest-Competition-Simulator') > sim('forest', 'forecast'));
  for (const [w, c] of FAR) check('Did you mean', '"' + w + '" is not "' + c + '"', sim(w, c) < 0.82, sim(w, c));
}

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
  check('Frontend', 'no such project → one question about the design', /Anything specific/.test(r.text) && Skills.state.site && Skills.state.site.stage === 'brief', r.text);
  r = await Skills.intercept('dark theme with big buttons');
  check('Frontend', 'then it asks WHERE to save (never picks silently)', /Where should I save it/.test(r.text) && /zzweather/.test(r.text), r.text);
  r = await Skills.intercept('on my desktop');
  const last2 = calls.filter(c => c[0] === '/skill/site').pop();
  check('Frontend', 'the answers become the brief and the place', last2 && last2[1].sections === 'dark theme with big buttons' && last2[1].where === 'desktop' && !last2[1].folder, last2);
  Skills.state.site = null;
  r = await Skills.intercept('Create a frontend website for a calculator');
  check('Frontend', '"Create a frontend website for a calculator" (the failing demo) starts the builder', r && /I found \*\*calculator\*\*/i.test(r.text), r && r.text);
  r = await Skills.intercept('no'); r = await Skills.intercept('go ahead');
  check('Frontend', 'not in the project folder → asks where', /Where should I save it/.test(r.text), r.text);
  r = await Skills.intercept('D drive');
  const last3 = calls.filter(c => c[0] === '/skill/site').pop();
  check('Frontend', '"D drive" → saved there as real files', last3 && last3[1].where === 'D drive' && /Built/.test(r.text), [last3, r.text]);
  Skills.state.site = null;
  r = await Skills.intercept('build a website for my college fest');
  check('Frontend', 'a normal website request still asks its usual questions', /What should be on it/.test(r.text), r.text);
  done();
})();
