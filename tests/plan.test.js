// Goal-level planning tests: a stated goal + several commands become one merged, ordered, verified plan.
// Run: node tests/plan.test.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'nlu.js'), 'utf8') + ';global.NLU=NLU;');

const APPS = { chrome: { proc: 'chrome' }, vscode: { proc: 'Code' }, notepad: { proc: 'notepad' }, spotify: { proc: 'Spotify' } };
const T = require(path.join(root, 'agent-tools.js'))({ APPS, safePath: n => path.join('C:/x', n), OLLAMA: '', DEFAULT_MODEL: '' });
const REGISTRY = { tools: Object.fromEntries(Object.entries(T.TOOLS).map(([n, t]) => [n, { intent: t.intent, tier: t.tier, reason: t.reason || '', check: t.check || null, plan: t.plan !== false }])), intents: T.INTENT_TIERS, noNesting: [] };

global.settings = { wakeWord: 'jarvis', focusMin: 25 };
global.ctx = {};
const _store = new Map();
global.store = { get: (k, d) => (_store.has(k) ? _store.get(k) : d), set: (k, v) => _store.set(k, v) };
global.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
global.log = () => {}; global.bumpStat = () => {}; global.setState = () => {}; global.idleState = () => {};
global.busy = false;
global.Persona = { sir: () => 'sir' };
global.todos = []; global.timers = []; global.reminders = []; global.focus = null;
global.getJSON = async () => REGISTRY;
global.deliver = () => {};
global.LLM_TOOLS = {};
const said = [];
global.jarvisSay = o => { said.push(o); if (o.confirm) setTimeout(() => o.confirm.onConfirm(), 0); };

// A tiny fake computer: which apps are running, what the volume is, which notes exist.
const world = { running: ['discord', 'spotify'], volume: 0, files: ['dbms notes.md'] };
global.callTool = async (url, body) => {
  if (url === '/tool/runningApps') return { checked: body.apps, running: body.apps.filter(a => world.running.includes(a)) };
  if (url === '/sys/volume') return { level: world.volume };
  if (url === '/agent/exists') return { exists: world.files.includes(body.name) };
  return {};
};
const executed = [];
global.executeTool = async p => {
  executed.push(p.intent + (p.args && p.args.noFocus ? '(noFocus)' : ''));
  switch (p.intent) {
    case 'VOLUME_SET': world.volume = 30; return { text: 'Volume set to 30%.' };
    case 'FOCUS_START': global.focus = { min: +((/(\d+)/.exec(p.text) || [])[1]) || 25 }; return { text: 'Focus session started.' };
    case 'BLOCK_DISTRACTIONS': return { text: 'Deep work mode', op: { kind: 'distractions', closed: ['discord', 'spotify'], all: [] },
      confirm: { onConfirm: async () => { world.running = world.running.filter(a => !['discord', 'spotify'].includes(a)); } } };
    case 'READ_FILE': return { text: '**dbms notes.md**', op: { kind: 'file', name: 'dbms notes.md' } };
    case 'CREATE_FOLDER': return { text: 'Created.', op: { kind: 'file', name: 'dsa' } };
    case 'OPEN_IN_EDITOR': return { text: 'Opened.' };
  }
  return { text: 'ok' };
};
const src = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
eval(src.slice(src.indexOf('function expandSteps('), src.indexOf('async function runDiagnostics(')) + ';global.expandSteps=expandSteps;');
eval(fs.readFileSync(path.join(root, 'agent.js'), 'utf8') + ';global.Agent=Agent;');

const results = [];
const check = (d, ok) => results.push([d, !!ok]);

(async () => {
  await Agent.registry();
  const SENTENCE = "I'm going to study. Set the volume to 30, enable focus mode, close distracting apps, open my DBMS notes and start a 45-minute session.";

  // routing: the goal is split off, every part maps to a known command
  const r = Agent.route(SENTENCE);
  check('goal sentence is routed as a multi-step plan', r.kind === 'multi');
  check('the stated goal becomes the plan goal, not a step', r.goal === 'Study' && r.parts.length === 5);
  check('every part is a command JARVIS knows', r.allKnown);
  check('"I need to open chrome, close spotify" keeps both commands (no goal swallowed)', Agent.route('I need to open chrome, close spotify').goal === '');
  check('a plain goal with no commands is not a plan', Agent.route("I'm going to study").kind === 'simple');

  // optimizer
  const o = Agent.optimize(r.classified.map((p, i) => ({ id: 's' + i, intent: p.intent, args: {}, text: p.text, label: p.step })));
  const intents = o.steps.map(s => s.intent);
  check('two focus steps merge into one', intents.filter(i => i === 'FOCUS_START').length === 1);
  check('the merged session keeps the 45-minute step', /45/.test(o.steps.find(s => s.intent === 'FOCUS_START').text));
  check('closing distractions runs before the session and starts no second timer', intents.indexOf('BLOCK_DISTRACTIONS') < intents.indexOf('FOCUS_START') && o.steps.find(s => s.intent === 'BLOCK_DISTRACTIONS').args.noFocus === true);
  check('the merge is explained in the plan notes', o.notes.length >= 1);

  // dependencies
  const dep = Agent.optimize([
    { intent: 'CREATE_FOLDER', args: {}, text: 'create a folder called dsa', label: 'a' },
    { intent: 'OPEN_IN_EDITOR', args: {}, text: 'open it in vs code', label: 'b' },
  ]);
  check('"create a folder … open it in vs code": the open step needs the folder step', dep.steps[1].needs.length === 1 && dep.steps[1].needs[0] === dep.steps[0].id);

  // full run: one preview showing what needs permission, then everything verified for real
  said.length = 0; executed.length = 0;
  const res = await Agent.handleMulti(SENTENCE, r, 0);
  const previews = said.filter(s => s.intent === 'AGENT_PREVIEW');
  check('one up-front preview for a plan that needs permission', previews.length === 1 && /needs your permission/.test(previews[0].text));
  check('no per-step permission cards after the preview', said.filter(s => s.intent === 'AGENT_CONFIRM').length === 0);
  check('the preview names the goal', /Study/.test(previews[0].text));
  if (process.env.DEBUG_PLAN) console.log(executed.join(','), '\n' + res.text);
  check('steps ran in the planned order', executed.join(',') === 'VOLUME_SET,BLOCK_DISTRACTIONS(noFocus),READ_FILE,FOCUS_START');
  check('the distracting apps really closed (verified against running apps)', /closed Discord, Spotify|closed .*iscord/i.test(res.text));
  check('volume is read back', /volume is 30%/.test(res.text));
  check('the notes file is checked to exist', /exists: dbms notes\.md/.test(res.text));
  check('the 45-minute session is verified against the live timer', /45-minute focus session running/.test(res.text));
  check('the run ends with a verification summary', /\*\*\d of \d verified\*\*/.test(res.text) && !/failed/.test(res.text));

  // a failed close is caught, not reported as done
  world.running = ['discord']; world.volume = 0; said.length = 0;
  const realExec = global.executeTool;
  global.executeTool = async p => p.intent === 'BLOCK_DISTRACTIONS'
    ? { text: 'Deep work mode', op: { kind: 'distractions', closed: ['discord'], all: [] }, confirm: { onConfirm: async () => {} } }   // Discord refuses to close
    : realExec(p);
  const res2 = await Agent.handleMulti(SENTENCE, Agent.route(SENTENCE), 0);
  check('an app that will not close is reported as failed', /✗ .*[Cc]lose distracting apps — Discord still running/.test(res2.text) || /Discord still running/.test(res2.text));
  global.executeTool = realExec;

  // missing prerequisite: the dependent step is skipped, not run on a broken result
  global.executeTool = async p => p.intent === 'CREATE_FOLDER' ? { text: 'I could not create that folder.', actions: [{}] } : realExec(p);
  const r3 = Agent.route('create a folder called dsa and open it in vs code');
  const res3 = await Agent.handleMulti('create a folder called dsa and open it in vs code', r3, 0);
  check('a step whose prerequisite failed is not run', /not run/.test(res3.text) && /didn’t complete/.test(res3.text));
  global.executeTool = realExec;

  // state-aware: closing an app that is not running is already done — no permission card, not a failure
  world.running = []; said.length = 0; executed.length = 0;
  const r4 = Agent.route('close spotify and set volume to 30');
  const res4 = await Agent.handleMulti('close spotify and set volume to 30', r4, 0);
  check('closing an already-closed app is verified as nothing to do', /Spotify was already closed — nothing to do/.test(res4.text));
  check('…and the close command is never sent', !executed.includes('CLOSE_APPLICATION'));
  check('the preview says it will be skipped', said.some(s => s.intent === 'AGENT_PREVIEW' && /already closed → skip/.test(s.text)));

  // preview notes from live state
  world.running = ['vscode', 'discord']; global.focus = { phase: 'focus', min: 25, end: Date.now() + 6e5 };
  const ann = [{ intent: 'OPEN_APPLICATION', args: { app: 'vscode' }, text: 'open vs code' }, { intent: 'BLOCK_DISTRACTIONS', args: {}, text: 'block distractions' },
    { intent: 'FOCUS_START', args: {}, text: 'start a 45 minute focus session' }];
  await Agent.annotate(ann);
  check('an open app is reused', ann[0].state === 'already open → reuse');
  check('only the distracting apps actually running are listed', ann[1].state === 'will close Discord');
  check('a running focus session is shown with what will happen to it', ann[2].state === 'a 25-minute session is running → replace with 45 minutes');
  global.focus = null;

  // dev-project dependencies: locate → backend → frontend → browser
  global.callTool = (orig => async (url, body) => url === '/agent/validate' ? T.validateStep({ tool: body.tool, args: body.args }, 0) : orig(url, body))(global.callTool);
  const envRun = async backend => {
    executed.length = 0;
    global.executeTool = async p => { executed.push(p.intent + (p.args.which ? ':' + p.args.which : ''));
      if (p.intent === 'START_PROCESS' && p.args.which === 'backend') return backend;
      if (p.intent === 'START_PROCESS') return { text: 'Started.', op: { kind: 'process', which: p.args.which } };
      if (p.intent === 'LOCATE_PROJECT') return { text: 'Found.', op: { kind: 'project', name: 'AgriLoop' } };
      return { text: 'ok' }; };
    return Agent.prepareEnvironment('prepare my environment for AgriLoop', 'AgriLoop', 0);
  };
  const crash = await envRun({ text: 'Could not start the backend for "AgriLoop": exited', actions: [{}] });
  check('a crashed backend stops the frontend and browser', !executed.includes('START_PROCESS:frontend') && /skipped — step 3/.test(crash.text));
  await envRun({ text: 'no backend in this project', absent: true });
  check('a frontend-only project (no backend at all) still starts its frontend', executed.includes('START_PROCESS:frontend'));

  // failure recovery: a backend that crashed on missing dependencies → ask → the project's own install → restart → verify
  const baseTool = global.callTool, calls = [];
  const devTools = (over = {}) => async (url, body) => {
    calls.push(url);
    if (url in over) return typeof over[url] === 'function' ? over[url](body) : over[url];
    if (url === '/tool/installDeps') return { success: true, command: 'npm install', ms: 900 };
    if (url === '/tool/startProcess') return { success: true, port: 5000 };
    // a role counts as running once it was (re)started in this run
    if (url === '/tool/processStatus') return (body.which === 'backend' ? calls.includes('/tool/installDeps') : executed.includes('START_PROCESS:' + body.which)) ? { found: true, alive: true, port: body.which === 'backend' ? 5000 : 5173, responding: true } : { found: false };
    return baseTool(url, body);
  };
  const DEPS = { text: 'Could not start the backend for "AgriLoop"', startFailed: true, missingDeps: { tool: 'npm', command: 'npm install', module: 'express' }, project: 'AgriLoop', which: 'backend', tail: "Error: Cannot find module 'express'" };
  calls.length = 0; said.length = 0; global.callTool = devTools();
  const healed = await envRun(DEPS);
  check('missing dependencies: the fix is explained and asked for', said.some(o => o.intent === 'AGENT_CONFIRM' && /npm install/.test(o.text) && /“express” isn’t installed/.test(o.text)));
  check('…the install runs, then the backend is started again', calls.indexOf('/tool/installDeps') >= 0 && calls.lastIndexOf('/tool/startProcess') > calls.indexOf('/tool/installDeps'));
  check('…the restarted server is verified as answering', /installed dependencies .*backend on port 5000 is answering/.test(healed.text));
  check('…and the rest of the plan carries on, verified', /frontend is answering/.test(healed.text));
  calls.length = 0; said.length = 0;
  global.jarvisSay = o => { said.push(o); if (o.confirm) setTimeout(() => (o.intent === 'AGENT_CONFIRM' ? o.confirm.onCancel() : o.confirm.onConfirm()), 0); };
  const declined = await envRun(DEPS);
  check('declining the install runs nothing and says why the step failed', !calls.includes('/tool/installDeps') && /you declined `npm install`/.test(declined.text));
  global.jarvisSay = o => { said.push(o); if (o.confirm) setTimeout(() => o.confirm.onConfirm(), 0); };
  calls.length = 0; global.callTool = devTools({ '/tool/startProcess': { success: false, tail: 'MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017' } });
  const still = await envRun(DEPS);
  check('a second, different failure is diagnosed, not retried in a loop', calls.filter(u => u === '/tool/installDeps').length === 1 && /can’t reach MongoDB/.test(still.text));
  calls.length = 0;
  const other = await envRun({ text: 'Could not start the backend', startFailed: true, project: 'AgriLoop', which: 'backend', tail: 'Error: uri parameter to openUri() must be a string, got undefined' });
  check('an unrecognised-by-install crash gets a one-line cause, not just ✗', /backend crashed: a required setting looks missing/.test(other.text));

  // state awareness: a backend already running is kept, not started twice
  calls.length = 0; global.callTool = devTools({ '/tool/processStatus': b => b.which === 'backend' ? { found: true, alive: true, port: 5000, responding: true } : { found: false } });
  said.length = 0;
  const kept = await envRun({ text: 'should not be called' });
  check('the preview says the running backend will be kept', said.some(o => o.intent === 'AGENT_PREVIEW' && /already running on port 5000 → keep/.test(o.text)));
  check('…and it is not started again', !executed.includes('START_PROCESS:backend') && /already running — kept it/.test(kept.text));

  // transactional choices on a failed plan: RETRY, CONTINUE (independent steps only), ROLLBACK (reversible changes only)
  const { createUndo } = require(path.join(root, 'undo.js'));
  global.Undo = createUndo(); global.runUndoTask = id => global.Undo.undoRun(id);
  let rolledBack = 0;
  global.executeTool = async p => {
    if (p.intent === 'CREATE_FOLDER') { Undo.push('created folder dsa', () => { rolledBack++; return 'removed'; }); return { text: 'Created.', op: { kind: 'file', name: 'dsa' } }; }
    if (p.intent === 'OPEN_IN_EDITOR') return { text: 'Could not open it.' };
    return { text: 'Volume set to 30%.' };
  };
  world.files.push('dsa');
  global.callTool = baseTool;
  const tx = await Agent.execute({ goal: 'tx', steps: [
    { id: 'step_1', intent: 'CREATE_FOLDER', args: { name: 'dsa' }, text: 'create a folder called dsa', tier: 'safe', check: 'file', label: 'Create folder dsa', needs: [] },
    { id: 'step_2', intent: 'OPEN_IN_EDITOR', args: { name: 'dsa' }, text: 'open it in vs code', tier: 'safe', label: 'Open dsa in VS Code', needs: ['step_1'] },
    { id: 'step_3', intent: 'READ_FILE', args: {}, text: 'open dsa/notes', tier: 'safe', label: 'Read notes', needs: ['step_2'] },
    { id: 'step_4', intent: 'VOLUME_SET', args: { level: 30 }, text: 'set volume to 30', tier: 'safe', label: 'Set volume', needs: [] },
  ] }, { source: 'planner', stopOnFail: true });
  const act = l => (tx.actions || []).find(a => a.label.startsWith(l));
  check('a failed plan offers RETRY, CONTINUE and ROLLBACK', act('RETRY') && act('CONTINUE') && act('ROLLBACK (1)'));
  check('the card says what each choice means', /continue with the 1 step that don’t depend on it or roll back the 1 reversible change/.test(tx.text));
  let cont = null; global.deliver = r => { cont = r; };
  await act('CONTINUE').fn();
  check('CONTINUE runs only the step that didn’t depend on the failure', cont && /Set volume/.test(cont.text) && !/Read notes/.test(cont.text));
  await act('ROLLBACK').fn();
  check('ROLLBACK reverses the run’s reversible change', rolledBack === 1);
  global.deliver = () => {}; delete global.Undo; delete global.runUndoTask;
  global.callTool = baseTool;
  global.executeTool = realExec;

  // the server's reminder check accepts what the reminder handler accepts — repeats too — and nothing vaguer
  check('a planned yearly reminder passes the server check', T.validateStep({ tool: 'remind', args: { text: 'pay fees', when: 'every year in july' } }, 0).ok);
  check('a vague "when" is still rejected', !T.validateStep({ tool: 'remind', args: { text: 'pay fees', when: 'sometime' } }, 0).ok);

  // misses → teach → alias
  Agent.recordMiss('pay fees every year in july', 'planner');
  Agent.recordMiss('lecture time', 'corrected');
  check('missed phrases are listed newest first', Agent.missList().map(m => m.original).join('|') === 'lecture time|pay fees every year in july');
  check('teaching a phrase as itself is refused', !Agent.teach('lecture time', 'lecture time').ok);
  check('teaching needs a command', !Agent.teach('lecture time', '  ').ok);
  const tv = Agent.teach('lecture time', 'mute and block distractions');
  check('a taught phrase maps to the command', tv.ok && Agent.aliasMatch('Lecture time!') && Agent.aliasMatch('lecture time').command === 'mute and block distractions');
  check('a taught phrase leaves the miss list', !Agent.missList().some(m => m.original === 'lecture time'));
  check('an alias can’t point at another alias (no loops)', !Agent.teach('class mode', 'lecture time').ok);
  check('"what have you learned" includes taught phrases', /lecture time.*mute and block distractions/.test(Agent.learnedSummary().text));
  Agent.forgetAllLearned();
  check('"forget what you’ve learned" clears taught phrases too', !Agent.aliasMatch('lecture time') && Agent.learnedCount() === 0);
  check('"what didn’t you understand?" is recognised', NLU.classify(NLU.normalize("what didn't you understand?", 'jarvis'), {}).intent === 'MISSES_LIST');

  let bad = 0;
  for (const [d, ok] of results) if (!ok) { bad++; console.log('FAIL  ' + d); }
  console.log(`plan: ${results.length - bad}/${results.length}`);
  process.exit(bad ? 1 : 0);
})();
