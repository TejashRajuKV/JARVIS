// Agent tests: router (simple / multi-step / question) and the server-side tool validator. Run: node tests/agent.test.js
// The phrases and expected labels were written by hand for JARVIS; they measure the rules against those labels.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'nlu.js'), 'utf8') + ';global.NLU=NLU;');

// Minimal page globals so agent.js loads in node.
global.settings = { wakeWord: 'jarvis', focusMin: 25 };
global.ctx = {};
const _store = new Map();
global.store = { get: (k, d) => (_store.has(k) ? _store.get(k) : d), set: (k, v) => _store.set(k, v) };
global.getJSON = async () => ({});
global.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
global.log = () => {};
global.bumpStat = () => {};
global.setState = () => {};
global.idleState = () => {};
global.busy = false;
global.Persona = { sir: () => 'sir' };
// Mock UI so execute()'s preview/cancel-offer/action-button flow can run headlessly:
// captures the most recent actions array, and auto-accepts any preview ("confirm") card.
global.jarvisSay = o => { if (o.actions) global.__lastActions = o.actions; if (o.confirm) setTimeout(() => o.confirm.onConfirm(), 0); };
global.deliver = () => {};
global.callTool = async () => ({ exists: true });
const src = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
eval(src.slice(src.indexOf('function expandSteps('), src.indexOf('async function runDiagnostics(')) + ';global.expandSteps=expandSteps;');
eval(fs.readFileSync(path.join(root, 'agent.js'), 'utf8') + ';global.Agent=Agent;');

const ROUTING = {
  simple: ['open chrome', 'close spotify', 'set a timer for 10 minutes', 'volume up', 'mute', 'lock the screen', 'take a screenshot',
    'add milk to my to-do list', 'remind me to call mom at 6pm', 'play believer on youtube', 'start a focus session', 'turn off bluetooth',
    'set brightness to 50', 'switch to gold theme', 'dark mode', 'search google for best laptops', 'create a folder called dsa',
    'maximize chrome', 'cancel all timers', 'run bfs.py',
    // one command whose content is a list — never a plan
    'create a routine called agent check: set a timer for 1 minute, close notepad, what time is it', 'take a note: open chrome, then close spotify',
    // "and" inside one command's content
    'remind me to buy milk and eggs at 6pm', 'play tom and jerry on youtube',
    // VS Code opened AT a folder is one command, never 'open vs code' + a broken second step
    'open vs code and the directory should be dsa sprint folder', 'open vs code in the dsa sprint folder', 'add bread and butter to my to-do list', 'search google for pros and cons of linux'],
  multi: ['open vs code and start a 25 minute focus session', 'open chrome, then play lofi on youtube', 'mute and lock the screen',
    'create a folder called dsa and open it in vs code', 'set brightness to 30, turn on dark mode and mute', 'open notepad and set a timer for 1 minute',
    'close spotify and start a focus session', 'add revise dbms to my to-do list and remind me to study at 8pm', 'take a screenshot then lock the screen',
    'open vs code, open chrome and open spotify', 'turn off bluetooth and set volume to 40', 'play believer on youtube and set a timer for 3 minutes',
    'start a focus session then block distractions', 'open leetcode and start a 45 minute focus session', 'search google for dsa roadmap and add dsa roadmap to my to-do list',
    'switch to gold theme and switch to friday', 'set volume to 20 then dark mode', 'open chrome and search google for weather',
    'create a folder called os and create a folder called dbms', 'maximize vs code and minimize chrome',
    'set volume to 30 and tell me a joke', 'mute and what time is it',
    // two settings with no verb between them — joined, one of them used to be silently dropped
    'volume 30 and dark mode', 'brightness 40 and bluetooth off'],
  question: ['what is a deadlock', 'how do i open a file in python', 'what time is it', 'can you explain recursion', 'why is my laptop slow',
    'what is the difference between stack and queue', 'who created python', 'is it going to rain today', 'how are you',
    'explain how to start a business and set goals', 'what does open mean in python', 'tell me about linked lists', 'how to set up a c++ environment',
    'should i learn java or python', 'which is better, chrome or firefox?', 'describe photosynthesis', 'what is 25 times 4',
    'do you know how to play chess', 'compare tcp and udp', 'when is my next class'],
};

let fail = 0, total = 0;
const perKind = {};
for (const [want, list] of Object.entries(ROUTING)) {
  perKind[want] = 0;
  for (const t of list) {
    total++;
    const r = Agent.route(t);
    const got = r.kind === 'multi' ? 'multi' : r.kind === 'question' ? 'question' : 'simple';
    if (got === want) perKind[want]++;
    else { fail++; console.log(`ROUTE FAIL  ${t.padEnd(62)} got ${got}, want ${want}`); }
  }
}
const routed = total - fail;
console.log(`routing: ${routed}/${total} (${Object.entries(perKind).map(([k, v]) => k + ' ' + v + '/' + ROUTING[k].length).join(', ')})`);

// ---- validator (server authority) ----
const APPS = { chrome: { proc: 'chrome' }, vscode: { proc: 'Code' }, notepad: { proc: 'notepad' }, spotify: { proc: 'Spotify' } };
const safePath = n => (/\.\./.test(n) || /^[a-z]:/i.test(n) || /^[\\/]/.test(n) ? null : path.join('C:/Users/x/jarvis', n));
const T = require(path.join(root, 'agent-tools.js'))({ APPS, safePath, OLLAMA: '', DEFAULT_MODEL: '' });
const step = (tool, args) => T.validateStep({ tool, args }, 0);
const SAFETY = [
  // [description, result, expectation]
  ['safe tool runs', step('set_volume', { level: 40 }), r => r.ok && r.step.tier === 'safe'],
  ['safe tool with app alias', step('open_app', { app: 'VS Code' }), r => r.ok && r.step.args.app === 'vscode'],
  ['close app needs confirmation', step('close_app', { app: 'chrome' }), r => r.ok && r.step.tier === 'confirm' && r.step.reason],
  ['running a file needs confirmation', step('run_file', { name: 'bfs.py' }), r => r.ok && r.step.tier === 'confirm'],
  ['reading the screen needs confirmation', step('read_screen', {}), r => r.ok && r.step.tier === 'confirm'],
  ['shutdown is explicit (rule path)', { ok: true, t: T.tierForIntent('SYS_SHUTDOWN') }, r => r.t[0] === 'explicit'],
  ['delete is explicit (rule path)', { ok: true, t: T.tierForIntent('DELETE_ITEM') }, r => r.t[0] === 'explicit'],
  ['clear to-dos is explicit (rule path)', { ok: true, t: T.tierForIntent('CLEAR_TODOS') }, r => r.t[0] === 'explicit'],
  ['wifi off needs confirmation (rule path)', { ok: true, t: T.tierForIntent('RADIO', 'turn off wifi') }, r => r.t[0] === 'confirm'],
  ['invented tool is blocked', step('run_shell', { cmd: 'del /s C:\\' }), r => !r.ok && /not a JARVIS tool/.test(r.reason)],
  ['volume 999 rejected', step('set_volume', { level: 999 }), r => !r.ok],
  ['brightness -5 rejected', step('brightness', { level: -5 }), r => !r.ok],
  ['negative timer rejected', step('set_timer', { seconds: -60 }), r => !r.ok],
  ['non-allowlisted app rejected', step('open_app', { app: 'mimikatz' }), r => !r.ok],
  ['path traversal rejected', step('create_folder', { name: '../../Windows/System32' }), r => !r.ok],
  ['absolute path rejected', step('write_note', { name: 'C:/Windows/win.ini', content: 'x' }), r => !r.ok],
  ['file:// URL rejected', step('open_url', { url: 'file:///C:/Users/x/secrets.txt' }), r => !r.ok],
  ['nonsense reminder time rejected', step('remind', { text: 'x', when: 'purple elephant' }), r => !r.ok],
  ['6-step plan rejected', T.validatePlan({ goal: 'x', steps: Array.from({ length: 6 }, () => ({ tool: 'battery' })) }), r => !r.ok],
  ['routine inside a plan rejected', T.validatePlan({ goal: 'x', steps: [{ tool: 'run_routine', args: { name: 'study mode' } }] }), r => !r.ok],
  // Refused in plain code before the model is asked (no tool can do these).
  ['refuse: shell command', { r: T.refuse('run the command rm -rf / in the terminal') }, x => x.r && x.r.unsupported],
  ['refuse: install software', { r: T.refuse('install python 3.12') }, x => x.r && x.r.unsupported],
  ['refuse: send email', { r: T.refuse('send an email to my professor') }, x => x.r && x.r.unsupported],
  ['refuse: bulk delete', { r: T.refuse('clear all my files') }, x => x.r && x.r.unsupported],
  ['refuse: question is not a plan', { r: T.refuse('what is a deadlock') }, x => x.r && x.r.empty],
  ['refuse: uninstall an app', { r: T.refuse('uninstall discord') }, x => x.r && x.r.unsupported],
  ['refuse: delete an app', { r: T.refuse('delete chrome') }, x => x.r && x.r.unsupported],
  ['allow: normal multi-step request', { r: T.refuse('open vs code and start a 25 minute focus') }, x => x.r === null],
  ['allow: clear all timers is not a bulk delete', { r: T.refuse('clear all timers and open notepad') }, x => x.r === null],
  // dev project tools
  ['locate_project runs safe', step('locate_project', { name: 'agriloop' }), r => r.ok && r.step.tier === 'safe'],
  ['start_process needs confirmation', step('start_process', { name: 'agriloop', which: 'backend' }), r => r.ok && r.step.tier === 'confirm' && r.step.reason],
  ['stop_process needs confirmation', step('stop_process', { name: 'agriloop', which: 'frontend' }), r => r.ok && r.step.tier === 'confirm'],
  ['start_process bad which is rejected', step('start_process', { name: 'agriloop', which: 'database' }), r => !r.ok],
  ['start_process is confirm tier on the rule path too', { t: T.tierForIntent('START_PROCESS') }, x => x.t[0] === 'confirm'],
  ['stop_process is confirm tier on the rule path too', { t: T.tierForIntent('STOP_PROCESS') }, x => x.t[0] === 'confirm'],
  ['open_project_url defaults which to nothing required', step('open_project_url', { name: 'agriloop' }), r => r.ok],
  // distance / directions
  ['distance runs safe', step('distance', { from: 'Hyderabad', to: 'Bangalore' }), r => r.ok && r.step.tier === 'safe'],
  ['directions runs safe', step('directions', { from: 'Hyderabad', to: 'Bangalore' }), r => r.ok && r.step.tier === 'safe'],
  ['open_directions runs safe', step('open_directions', { from: 'Hyderabad', to: 'Bangalore' }), r => r.ok && r.step.tier === 'safe'],
  ['distance missing "to" is rejected', step('distance', { from: 'Hyderabad' }), r => !r.ok],
  // "I want to learn X" language-learning goal template
  ['check_compiler runs safe', step('check_compiler', { language: 'cpp' }), r => r.ok && r.step.tier === 'safe'],
  ['check_extension runs safe', step('check_extension', { language: 'python' }), r => r.ok && r.step.tier === 'safe'],
  ['check_compiler bad language is rejected', step('check_compiler', { language: 'rust' }), r => !r.ok],
];
// Agent.learnGoal() phrase matching, positive and negative
for (const [t, want] of [
  ['I want to learn C++', 'cpp'], ['help me learn python', 'python'], ['teach me javascript', 'javascript'],
  ["let's learn c", 'c'], ['start learning JS', 'javascript'],
]) {
  SAFETY.push(['learnGoal: ' + t, { g: Agent.learnGoal(t) }, x => x.g && x.g.key === want]);
}
for (const t of ['I want to learn about pointers', 'I want to learn how recursion works', 'teach me about the solar system', 'help me learn to cook']) {
  SAFETY.push(['learnGoal: not a supported language — ' + t, { g: Agent.learnGoal(t) }, x => x.g === null]);
}
// Agent.designPromptGoal() phrase matching, positive and negative
for (const [t, wantTask] of [
  ['design a prompt for a portfolio site', 'a portfolio site'],
  ['help me write a prompt for an app idea', 'an app idea'],
  ['create a prompt', ''],
  ['generate a tcrei prompt for my landing page', 'my landing page'],
]) {
  SAFETY.push(['designPromptGoal: ' + t, { g: Agent.designPromptGoal(t) }, x => x.g && x.g.task === wantTask]);
}
for (const t of ['create a project called foo', 'what is a deadlock', 'open chrome', 'remind me to call mom at 6pm']) {
  SAFETY.push(['designPromptGoal: not a match — ' + t, { g: Agent.designPromptGoal(t) }, x => x.g === null]);
}
// Agent.buildTcreiPrompt(): all five TCREI sections present, with sensible defaults when optional ones are blank.
{
  const full = Agent.buildTcreiPrompt({ task: 'a landing page', context: 'students, cybersecurity club', references: 'clean like Stripe', evaluate: 'mobile-friendly', iterate: 'show 3 variations' });
  SAFETY.push(['buildTcreiPrompt: includes all sections', { s: full }, x => ['TASK', 'CONTEXT', 'REFERENCES', 'EVALUATE', 'ITERATE'].every(h => x.s.includes(h))]);
  const sparse = Agent.buildTcreiPrompt({ task: 'a landing page', context: 'students', references: '', evaluate: 'mobile-friendly', iterate: '' });
  SAFETY.push(['buildTcreiPrompt: defaults empty references/iterate', { s: sparse }, x => x.s.includes('None provided') && x.s.includes('Ask clarifying questions')]);
}
// Agent.matchGuidedFlow() — one trigger phrase per flow, plus negatives that must not match any flow.
for (const [t, wantId, wantSeed] of [
  ['write a commit message for the auth fix', 'COMMIT_MSG', 'the auth fix'],
  ['generate a bug report', 'BUG_REPORT', ''],
  ['make me a resume bullet for my capstone project', 'RESUME_BULLET', 'my capstone project'],
  ['write my standup update', 'STANDUP', ''],
  ['create a study plan for my OS exam', 'STUDY_PLAN', 'OS exam'],
  ['log my weekly reflection', 'WEEKLY_JOURNAL', ''],
  ['generate interview prep for a backend intern role', 'INTERVIEW_PREP', 'a backend intern role'],
  ['draft a linkedin post about my project', 'PROJECT_POST', 'my project'],
]) {
  SAFETY.push(['matchGuidedFlow: ' + t, { g: Agent.matchGuidedFlow(t) }, x => x.g && x.g.id === wantId && x.g.seed === wantSeed]);
}
for (const t of ['create a project called foo', 'what is a deadlock', 'open chrome', 'design a prompt for a website']) {
  SAFETY.push(['matchGuidedFlow: not a match — ' + t, { g: Agent.matchGuidedFlow(t) }, x => x.g === null]);
}
// The four pure/sync finish() functions — templating only, safe to assert directly.
{
  const commit = Agent.GUIDED_FLOWS.COMMIT_MSG.finish({ description: 'fix off-by-one in pagination', type: 'fix', scope: 'pagination', why: 'last page was dropped' });
  SAFETY.push(['COMMIT_MSG.finish: conventional format', { s: commit.text }, x => x.s.includes('fix(pagination): fix off-by-one in pagination') && x.s.includes('last page was dropped')]);
  const commitNoScope = Agent.GUIDED_FLOWS.COMMIT_MSG.finish({ description: 'update readme', type: 'docs', scope: '', why: '' });
  SAFETY.push(['COMMIT_MSG.finish: omits empty scope/why', { s: commitNoScope.text }, x => x.s.includes('docs: update readme') && !x.s.includes('()')]);

  const bug = Agent.GUIDED_FLOWS.BUG_REPORT.finish({ steps: 'click save twice', expected: 'one save', actual: 'two saves', environment: '' });
  SAFETY.push(['BUG_REPORT.finish: all sections present, default environment', { s: bug.text }, x => ['Steps to Reproduce', 'Expected Behavior', 'Actual Behavior', 'Environment', 'Not specified'].every(h => x.s.includes(h))]);

  const star = Agent.GUIDED_FLOWS.RESUME_BULLET.finish({ situation: 'legacy CI was flaky', task: 'stabilize it', action: 'rewrote the test runner', result: '40% faster builds' });
  SAFETY.push(['RESUME_BULLET.finish: all STAR sections present', { s: star.text }, x => ['SITUATION', 'TASK', 'ACTION', 'RESULT', '40% faster builds'].every(h => x.s.includes(h))]);

  const standup = Agent.GUIDED_FLOWS.STANDUP.finish({ yesterday: 'fixed the login bug', today: 'writing tests', blockers: '' });
  SAFETY.push(['STANDUP.finish: default "None" blockers', { s: standup.text }, x => x.s.includes('Yesterday: fixed the login bug') && x.s.includes('Blockers: None')]);
}
// A split where every part is a known rule command: no model call, and the risky part keeps its tier.
{
  const r = Agent.route('set a timer for 1 minute, clear all my to-dos and open notepad');
  SAFETY.push(['split keeps "clear all my to-dos" as a known command', r, x => x.kind === 'multi' && x.allKnown && x.classified[1].intent === 'CLEAR_TODOS']);
  SAFETY.push(['clear to-dos gets the explicit tier', { t: T.tierForIntent('CLEAR_TODOS') }, x => x.t[0] === 'explicit']);
  // Telugu / Kannada in English letters, several commands in one sentence → a known multi-step split.
  for (const t of ['notepad open cheyyi and 1 nimishalu timer pettu', 'vs code open maadu mattu 25 nimisha focus shuru maadu', 'chrome open cheyyi tarvata volume penchu']) {
    const en = NLU.fromRoman(t, NLU.romanLang(t));
    SAFETY.push(['Tenglish multi-step: ' + t, Agent.route(en), x => x.kind === 'multi' && x.allKnown]);
  }
}
// "Prepare my development environment for X": recognised as a fixed goal template, not sent to the model.
for (const [t, want] of [
  ['Prepare my development environment for AgriLoop.', 'agriloop'],
  ['set up my dev environment for AgriLoop', 'agriloop'],
  ['setup agriloop for development', 'agriloop'],
  ['get me ready environment for the tracker app', 'the tracker app'],
]) {
  SAFETY.push(['envGoal: ' + t, { g: (Agent.envGoal(t) || '').toLowerCase() }, x => x.g === want]);
}
for (const t of ['open vs code', 'prepare a study setup with a 1 minute timer', 'set up my desk']) {
  SAFETY.push(['envGoal: not a goal template — ' + t, { g: Agent.envGoal(t) }, x => x.g === null]);
}
// Command learning: pure store-backed functions (learnSave/learnedMatch/forgetAllLearned/learnedCount).
{
  SAFETY.push(['learnedMatch: nothing learned yet', Agent.learnedMatch('spotify jorag open maadu'), r => r === null]);
  Agent.learnSave('Spotify jorag open maadu', { goal: '', steps: [{ tool: 'open_app', args: { app: 'spotify' }, label: 'Open Spotify' }] });
  const hit = Agent.learnedMatch('spotify jorag open maadu');
  SAFETY.push(['learnedMatch: exact normalised phrase found after learning', hit, r => r && r.steps.length === 1 && r.steps[0].tool === 'open_app']);
  SAFETY.push(['learnedMatch: a different phrase is not matched', Agent.learnedMatch('open spotify please right now'), r => r === null]);
  SAFETY.push(['learnedCount reflects what was saved', { n: Agent.learnedCount() }, x => x.n === 1]);
  SAFETY.push(['learnedSummary lists the phrase', Agent.learnedSummary(), r => /spotify jorag open maadu/i.test(r.text)]);
  // Re-teaching the same phrase replaces, not duplicates, the old mapping.
  Agent.learnSave('Spotify jorag open maadu', { goal: '', steps: [{ tool: 'close_app', args: { app: 'spotify' }, label: 'Close Spotify' }] });
  SAFETY.push(['learnSave replaces an existing mapping for the same phrase', { n: Agent.learnedCount(), t: Agent.learnedMatch('spotify jorag open maadu').steps[0].tool }, x => x.n === 1 && x.t === 'close_app']);
  Agent.forgetAllLearned();
  SAFETY.push(['forgetAllLearned clears everything', { n: Agent.learnedCount(), m: Agent.learnedMatch('spotify jorag open maadu') }, x => x.n === 0 && x.m === null]);
}
// createProjectGoal: language/name/description parsing, and negatives that must not trigger it.
for (const [t, want] of [
  ['create a C++ project called SmartCalc, create the files, write a basic calculator, compile it and run it', { lang: 'cpp', name: 'SmartCalc', description: 'basic calculator' }],
  ['create a python project called Tracker that tracks my expenses', { lang: 'python', name: 'Tracker', description: 'tracks my expenses' }],
  ['make a project called Foo', { lang: null, name: 'Foo', description: '' }],
]) {
  const g = Agent.createProjectGoal(t);
  SAFETY.push(['createProjectGoal: ' + t, { g }, x => x.g && (x.g.lang ? x.g.lang.key : null) === want.lang && x.g.name === want.name && x.g.description === want.description]);
}
for (const t of ['create a project', 'create a new folder called notes', 'what is a project plan']) {
  SAFETY.push(['createProjectGoal: not a match — ' + t, { g: Agent.createProjectGoal(t) }, x => x.g === null]);
}
// explainLastAction: assembled only from a stored run's real reason/label, never invented.
{
  store.set('jarvis.agentRuns', [{ id: 'AGT-TEST-001', goal: 'Prepare the environment for DemoApp', steps: [
    { id: 'step_1', tool: 'open_in_editor', label: 'Open DemoApp in VS Code', reason: '', status: 'verified' },
    { id: 'step_2', tool: 'close_app', label: 'Close Chrome', reason: 'This closes the app; unsaved work in it may be lost.', status: 'verified' },
  ] }]);
  const whyBare = Agent.explainLastAction('why did you do that');
  SAFETY.push(['explainLastAction: whole-run summary mentions the goal', whyBare, r => /Prepare the environment for DemoApp/.test(r.text)]);
  const whyNamed = Agent.explainLastAction('why did you close chrome');
  SAFETY.push(['explainLastAction: named step uses its real stored reason', whyNamed, r => /unsaved work in it may be lost/.test(r.text)]);
}
(async () => {
  // Mid-task cancellation: click the cancel-offer action right after execution starts — steps not yet
  // reached must show as not run, and the run must say so plainly (not look like a normal failure).
  {
    const steps = [1, 2, 3].map((n, i) => ({ id: 'step_' + (i + 1), tool: 'add_todo', intent: 'ADD_TODO', args: { text: 'x' }, text: 'add x', tier: 'safe', reason: '', check: null, label: 'Step ' + n }));
    global.todos = [{ id: 'x' }];
    global.executeTool = async () => { await new Promise(r => setTimeout(r, 15)); return { op: { kind: 'todo', id: 'x' } }; };
    global.__lastActions = null;
    const runPromise = Agent.execute({ goal: 'test cancel', steps }, { source: 'planner', ms_route: 0 });
    await new Promise(r => setTimeout(r, 40));
    const offered = !!global.__lastActions;
    if (offered) global.__lastActions[0].fn();
    const result = await runPromise;
    SAFETY.push(['mid-task cancellation offers a CANCEL TASK action', { offered }, x => x.offered]);
    SAFETY.push(['cancelled run marks the remaining steps not run', result, r => /Step 2.*not run/s.test(r.text) && /Step 3.*not run/s.test(r.text)]);
    SAFETY.push(['cancelled run says so plainly, not "step failed"', result, r => /Task cancelled/i.test(r.text) && !/step\(?s?\)? failed/i.test(r.text)]);
  }
  // Generic RETRY: only the steps that didn't complete are re-run — a step that already succeeded is left alone.
  {
    let runFileCalls = 0;
    global.executeTool = async step => {
      if (step.intent === 'ADD_TODO') return { op: { kind: 'todo', id: 'ok' } };
      runFileCalls++;
      return runFileCalls === 1 ? { text: 'could not run it: file not found' } : { op: { kind: 'todo', id: 'ok2' } };
    };
    global.todos = [{ id: 'ok' }, { id: 'ok2' }];
    const steps = [
      { id: 'step_1', tool: 'add_todo', intent: 'ADD_TODO', args: { text: 'a' }, text: 'add a', tier: 'safe', reason: '', check: null, label: 'Add a' },
      { id: 'step_2', tool: 'run_file', intent: 'RUN_FILE', args: { name: 'x.py' }, text: 'run x.py', tier: 'confirm', reason: 'This runs a program.', check: null, label: 'Run x.py' },
    ];
    const result = await Agent.execute({ goal: 'test retry', steps }, { source: 'planner', ms_route: 0, stopOnFail: true });
    const retryAction = result.actions && result.actions.find(a => a.label === 'RETRY');
    SAFETY.push(['a failed run offers RETRY', { has: !!retryAction }, x => x.has]);
    if (retryAction) {
      let delivered = null;
      global.deliver = r => { delivered = r; };
      await retryAction.fn();
      SAFETY.push(['RETRY only re-runs the failed step, not the one that already succeeded', { stepCount: (delivered.text.match(/^\d+\./gm) || []).length }, x => x.stepCount === 1]);
      SAFETY.push(['RETRY succeeding reports the step as done', delivered, r => /✓ Run x\.py/.test(r.text)]);
      global.deliver = () => {};
    }
  }
  // A compile failure or non-zero exit from RUN_FILE must count as a real failure (so stopOnFail actually
  // stops), not "unverified" — otherwise a later step (e.g. opening the editor) proceeds on a broken result.
  {
    global.executeTool = async step => step.intent === 'CREATE_FOLDER' ? { op: { kind: 'file', name: 'X' } } : { text: '❌ **Compilation failed** for `X/main.cpp`:\n```text\nerror\n```' };
    const steps = [
      { id: 'step_1', tool: 'create_folder', intent: 'CREATE_FOLDER', args: { name: 'X' }, text: 'create folder X', tier: 'safe', reason: '', check: 'file', label: 'Create folder X' },
      { id: 'step_2', tool: 'run_file', intent: 'RUN_FILE', args: { name: 'X/main.cpp' }, text: 'run X/main.cpp', tier: 'confirm', reason: 'This runs a program.', check: null, label: 'Run X/main.cpp' },
      { id: 'step_3', tool: 'open_in_editor', intent: 'OPEN_IN_EDITOR', args: { name: 'X' }, text: 'open X', tier: 'safe', reason: '', check: null, label: 'Open X in the editor' },
    ];
    const result = await Agent.execute({ goal: 'test compile failure', steps }, { source: 'planner', ms_route: 0, stopOnFail: true });
    SAFETY.push(['a compile failure stops the plan (later step not run)', result, r => /Open X in the editor.*not run/s.test(r.text)]);
    SAFETY.push(['a compile failure is reported as a failed step, not "not checked"', result, r => /✗ Run X\/main\.cpp/.test(r.text) && !/not checked/.test(r.text)]);
  }

  let sfail = 0;
  for (const [d, r, ok] of SAFETY) if (!ok(r)) { sfail++; console.log('SAFETY FAIL  ' + d + ' → ' + JSON.stringify(r)); }
  console.log(`safety: ${SAFETY.length - sfail}/${SAFETY.length}`);
  process.exit(fail || sfail ? 1 : 0);
})();
