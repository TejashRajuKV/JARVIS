// Routines (routines.js): finding a routine by what you say, splitting steps, creating / replacing / removing with undo, and runs that wait in line instead of
// being dropped. Page globals are stubbed; the agent that runs the steps is a fake. Run: node tests/routines.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);

const store = (() => { const d = {}; return { get: (k, f) => (k in d ? JSON.parse(JSON.stringify(d[k])) : f), set: (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); }, d }; })();
const said = [], undo = [], runs = [], logs = [];
let ids = 0, release = null;
const ctx = vm.createContext({
  console, setTimeout, store, rid: () => 'x' + (++ids), reminders: [], saved: 0, busy: false,
  saveTasks() { ctx.saved++; }, Undo: { push: (label, fn) => undo.push([label, fn]) }, jarvisSay: m => said.push(m), Persona: { sir: () => 'sir' },
  bumpStat() {}, cap: s => s.charAt(0).toUpperCase() + s.slice(1), $: () => null, log: (k, m) => logs.push([k, m]), describeRepeat: () => 'every day', escHtml: s => s,
  // the fake agent: each run waits until the test lets it finish
  Agent: { runUnattended: (name, steps) => new Promise(res => { runs.push(name); release = () => res({ text: 'ran ' + name + ': ' + steps.join(', ') }); }) },
});
vm.runInContext(fs.readFileSync(root('nlu.js'), 'utf8') + ';this.NLU = NLU;', ctx);
vm.runInContext(fs.readFileSync(root('routines.js'), 'utf8') + ';this.Routines = Routines;', ctx);
const R = ctx.Routines;
const tick = () => new Promise(r => setTimeout(r, 10));

(async () => {
  // ---- the built-in routines and finding them
  check('defaults: study mode, morning, bedtime and leaving exist', ['study mode', 'morning', 'bedtime', 'leaving'].every(n => R.find(n)), R.list().map(r => r.name));
  check('find: "run study mode", "start the bedtime routine", "activate my morning routine"', R.match('run study mode') && R.match('run study mode').name === 'study mode' && R.match('start the bedtime routine').name === 'bedtime' && R.match('activate my morning routine').name === 'morning');
  check('find: a small typo still finds it ("run studdy mode")', R.match('run studdy mode') && R.match('run studdy mode').name === 'study mode');
  check('find: a two-word name said on its own runs it ("study mode")', R.match('study mode') && R.match('study mode').name === 'study mode');
  check('find: a one-word name said on its own is ordinary speech, NOT a routine ("leaving", "morning")', !R.match('leaving') && !R.match('morning'));
  check('find: "leaving routine" (with the word) does run it', R.match('leaving routine') && R.match('leaving routine').name === 'leaving');
  check('find: an unknown name is nothing', !R.match('run the dance party protocol') && !R.match('open chrome'));

  // ---- splitting steps
  const P = R.parseSteps;
  check('steps: commas, semicolons, "then" and "and then" split', JSON.stringify(P('open vs code, block distractions; then start a focus session and then mute')) === JSON.stringify(['open vs code', 'block distractions', 'start a focus session', 'mute']), P('open vs code, block distractions; then start a focus session and then mute'));
  check('steps: "and" splits only before an action word ("open notes and start a timer" is two, "salt and pepper" is not split)', P('open notes and start a timer').length === 2 && P('remind me to buy salt and pepper').length === 1, [P('open notes and start a timer'), P('remind me to buy salt and pepper')]);
  check('steps: trailing dots and empty bits go; at most 12 steps', JSON.stringify(P('mute. , ,lock the screen.')) === JSON.stringify(['mute', 'lock the screen']) && P(Array.from({ length: 20 }, (_, i) => 'step' + i).join(', ')).length === 12);

  // ---- create, replace, remove with undo
  const n0 = R.list().length;
  const r1 = R.create('Exam Prep', ['open vs code', 'open leetcode']);
  check('create: saved with a lower-case name and its steps, in the store', r1 && r1.name === 'exam prep' && R.list().length === n0 + 1 && store.d['jarvis.routines'].some(x => x.name === 'exam prep'));
  const r1b = R.create('exam prep', ['start a focus session']);
  check('create: the same name again REPLACES the steps (no second routine)', r1b === r1 && r1.steps.join() === 'start a focus session' && R.list().length === n0 + 1);
  check('create: no name or no steps → nothing', R.create('', ['x']) === null && R.create('empty', []) === null && R.list().length === n0 + 1);
  ctx.reminders.push({ id: 'rem1', routineId: r1.id, text: 'routine: exam prep', at: Date.now() + 1e6 });
  R.remove(r1);
  check('remove: the routine and its schedule are gone, with one undo', !R.find('exam prep') && !ctx.reminders.some(x => x.routineId === r1.id) && undo.length === 1);
  undo[0][1]();
  check('remove → undo: the routine AND its schedule come back', R.find('exam prep') && ctx.reminders.some(x => x.routineId === r1.id));

  // ---- running: one at a time, the next waits in line (once), none is dropped
  const a = R.create('alpha', ['mute']), b = R.create('beta', ['lock the screen']), c = R.create('gamma', ['what time is it']);
  R.runById(a.id); await tick();
  check('run: the first routine starts', runs.join() === 'alpha' && ctx.busy === true);
  R.runById(b.id); R.runById(c.id); R.runById(b.id);
  check('run: routines due while one runs wait in line, each once, in the order they were due', R.waiting.join() === [b.id, c.id].join(), R.waiting);
  check('run: …and say so in the log', logs.some(l => /beta.*waits/.test(l[1])));
  release(); await tick(); await tick();
  check('run: when the first ends, its result is said and the next starts', said.some(m => /ran alpha/.test(m.text)) && runs.join() === 'alpha,beta', runs);
  release(); await tick(); await tick();
  check('run: then the third', runs.join() === 'alpha,beta,gamma' && R.waiting.length === 0, runs);
  release(); await tick(); await tick();
  check('run: all three were said, nothing was dropped, and JARVIS is free again', said.filter(m => /^ran (alpha|beta|gamma)/.test(m.text)).length === 3 && ctx.busy === false);
  check('run: a routine id that no longer exists does nothing', (R.runById('nope'), runs.length === 3));

  {
  // ---- the builder (NEW / EDIT in the Tasks tab): what SAVE does
  ctx.repeatStart = () => Date.now() + 3600e3; ctx.describeRepeat = () => 'every day at 9am';
  const pv = R.preview('open vs code\nstart a focus session for 25 minutes\ndo the thing with the stuff');
  check('builder: one step per line; known steps are marked with what they do, an unknown one is marked ?', pv.steps.length === 3 && pv.rows[0].ok && pv.rows[0].intent === 'OPEN_APPLICATION' && pv.rows[1].ok && !pv.rows[2].ok, pv.rows);
  undo.length = 0; const n1 = R.list().length;
  let b = R.saveFromBuilder(null, 'Night Owl', 'mute\nset brightness to 20', '');
  check('builder: SAVE makes a new routine with its steps, says so, with one undo', b.ok && R.find('night owl') && R.find('night owl').steps.join() === 'mute,set brightness to 20' && R.list().length === n1 + 1 && undo.length === 1 && /Made the routine/.test(b.text), b);
  check('builder: no name, no steps, or a name that is taken are refused with a reason (nothing saved)', !R.saveFromBuilder(null, '', 'mute', '').ok && !R.saveFromBuilder(null, 'x', '', '').ok && /already a routine/.test(R.saveFromBuilder(null, 'night owl', 'mute', '').text) && R.list().length === n1 + 1);
  const owl = R.find('night owl');
  b = R.saveFromBuilder(owl, 'late owl', 'mute\nlock the screen', 'every day at 11pm');
  check('builder: EDIT renames and changes the steps of the SAME routine, and schedules it', b.ok && owl.name === 'late owl' && owl.steps.join() === 'mute,lock the screen' && R.list().length === n1 + 1 && ctx.reminders.some(x => x.routineId === owl.id && x.repeat), [b, ctx.reminders.filter(x => x.routineId === owl.id)]);
  check('builder: a schedule that cannot be read is refused and nothing changes', !R.saveFromBuilder(owl, 'late owl', 'mute', 'whenever i feel like it').ok && owl.steps.join() === 'mute,lock the screen');
  undo[undo.length - 1][1]();
  check('builder: undo of the edit puts the old name and steps back and removes the new schedule', owl.name === 'night owl' && owl.steps.join() === 'mute,set brightness to 20' && !ctx.reminders.some(x => x.routineId === owl.id), owl);
  undo[0][1]();
  check('builder: undo of the new one removes it', !R.find('night owl') && R.list().length === n1);
  }
  console.log(`routines: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
