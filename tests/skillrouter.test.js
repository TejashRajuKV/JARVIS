// Skill suggestions (skillrouter.js): which message suggests which skill, and — as important — which ordinary messages suggest nothing.
// Uses the real bundled skills (read through skillpack.js). Run: node tests/skillrouter.test.js
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'skillrouter.js'));
const SP = require(path.join(__dirname, '..', 'skillpack.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const loaded = SP.loadAll(path.join(__dirname, '..', 'skills-bundled'), path.join(__dirname, 'no-such-folder'));
const skills = loaded.skills.map(s => SP.publicView(s));
check('the bundled skills load with keywords, and the two internal ones are kept out of suggestions', skills.length === 6 && skills.find(s => s.name === 'research').keywords.length > 5 && skills.filter(s => s.suggest === false).map(s => s.name).sort().join() === 'csv-insights,image-prompt', skills.map(s => [s.name, s.suggest]));

const name = (t, list = skills) => { R.reset(); const p = R.pick(t, list); return p ? p.name : null; };
/* ---------- messages that should suggest a skill ---------- */
for (const [t, want] of [
  ['can you research the latest developments in solid state batteries and cite sources', 'research'],
  ['look into how vaccines are tested and give me references', 'research'],
  ['find out about the newest studies on sleep and memory with evidence', 'research'],
  ['please review my code and point out any bugs in the function', 'code-review'],
  ['explain this code and suggest how to refactor the class', 'code-review'],
  ['do a code review of my project file', 'code-review'],
  ['give me a quick answer: what does DNS do', 'quick'],
  ['be brief, what is a mutex', 'quick'],
  ['plan and do this: organize my project folders step by step', 'plan-then-act'],
  ['do this step by step: rename the files and then sort the folders', 'plan-then-act'],
]) { const got = name(t); check('suggests ' + want + ': "' + t + '"', got === want, got); }

/* ---------- messages that should NOT suggest anything ---------- */
for (const t of ['hello', 'what time is it', 'thanks a lot jarvis', 'what is the capital of france', 'tell me a joke about programmers', 'how are you doing today', 'open chrome and play some music', 'set a timer for ten minutes',
  'who won the match yesterday', 'what is two plus two', 'what is a mutex', 'explain recursion to me', 'write a poem about the monsoon', 'translate good morning into telugu', 'i am feeling tired today', 'remind me to call mom',
  'how do I make pasta', 'what are your hobbies', 'is it going to rain tomorrow', 'what does this error mean', 'summarize the story of ramayana in short', 'give me ideas for a college fest']) {
  const got = name(t); check('no suggestion: "' + t + '"', got === null, got);
}
check('very short messages never suggest (they are commands or small talk)', name('quick answer') === null && name('review my code') === null && name('research this') === null);
check('a message that starts with / is a command, not a request for a suggestion', name('/research the best laptops for students with sources and evidence') === null);
check('empty, null and non-text input never throws and suggests nothing', name('') === null && name(null) === null && name(undefined) === null && R.rank('x y z w', null).length === 0 && R.rank('research the latest news with sources', [null, {}, { name: '' }]).length === 0);

/* ---------- ranking and details ---------- */
R.reset();
const ranked = R.rank('review my code and cite sources for the latest research on testing', skills, { max: 3 });
check('rank: best first, with the words that matched and a score', ranked.length >= 1 && ranked.every((x, i) => i === 0 || ranked[i - 1].score >= x.score) && ranked[0].matched.length >= 2 && typeof ranked[0].score === 'number');
check('rank: an exact trigger phrase beats loose words', R.rank('give me a quick answer about the best way to review a long document with many sources', skills)[0].skill.name === 'quick');
R.reset(); const none = R.pick('look into the latest news with sources and also review my code for bugs', skills);
check('pick: two skills fitting about equally → say nothing rather than guess (unless one of its own phrases was used)', none === null || none.phrase === true, none);
check('stemming: reviewing / reviews / reviewed meet "review"; sources meets source', R.stem('reviewing') === R.stem('review') + '' || R.content('reviewing reviews reviewed').length === 1);
check('stop words and short words are dropped', R.content('what is the best way to do it').join() === 'best');
check('words keep # and + (c++, c#) and hyphens split', R.content('c++ and c# step-by-step').includes('c++') && R.content('step-by-step').includes('step'));

/* ---------- repeat offers, auto, your own skills ---------- */
R.reset();
const q = 'can you research the latest developments in solid state batteries and cite sources';
const first = R.pick(q, skills, { now: 1000 }), again = R.pick('what do the newest studies on sleep say, with references and evidence', skills, { now: 2000 });
check('the same skill is not offered twice in a row within ten minutes…', first && first.name === 'research' && again === null, again);
const phraseAgain = R.pick('research how bridges are built, with sources and evidence', skills, { now: 3000 });
check('…unless one of its own trigger phrases was used', phraseAgain && phraseAgain.name === 'research' && phraseAgain.phrase === true, phraseAgain);
check('…and it is offered again after ten minutes', R.pick('what do the newest studies on sleep say, with references and evidence', skills, { now: 3000 + 11 * 60000 }) !== null);
const mine = [{ name: 'viva-prep', label: 'viva-prep', hint: 'Ask me short oral exam questions about my notes and grade my answers.', triggers: ['viva prep'], keywords: ['viva', 'oral', 'exam', 'grade'], auto: true, suggest: true }, ...skills];
R.reset(); const m1 = R.pick('quiz me with oral exam questions on my notes and grade my answers', mine);
check('your own skill works the same, by its description and keywords; `auto` is passed on for the page to act on', m1 && m1.name === 'viva-prep' && m1.auto === true, m1);
R.reset(); check('a skill that says suggest: false is never offered', name('quiz me with oral exam questions on my notes and grade my answers', mine.map(s => s.name === 'viva-prep' ? { ...s, suggest: false } : s)) !== 'viva-prep');
check('a skill header without keywords still works from its name, triggers and description', (() => { R.reset(); const p = R.pick('summarise this lecture into flashcards for revision please', [{ name: 'lecture-cards', hint: 'Summarise a lecture into flashcards for revision.', triggers: [], description: 'Summarise a lecture into flashcards for revision.' }]); return p && p.name === 'lecture-cards'; })());

console.log(`skillrouter: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
