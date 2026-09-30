'use strict';
/* JARVIS agent: routes a request (simple / multi-step / question), builds or asks for a plan, then runs it step by step
   with a permission gate, checks that each operation really happened, and records every run with an execution id.
   The server (agent-tools.js) is the authority for which tools exist, their argument limits and their permission
   tier; this file only enforces what the server returns. Uses globals from script.js at call time. */
const Agent = (() => {
  /* ---------- registry (from the server) ---------- */
  let REG = null;
  async function registry() {
    if (REG) return REG;
    const j = await getJSON('/agent/tools');
    if (j && j.tools) REG = j;
    return REG;
  }
  // [tier, reason] for a rule-engine intent (split commands, routines).
  function tierFor(intent, text) {
    if (!REG) return ['unknown', 'The permission list could not be loaded (is the backend running?).'];
    if (REG.noNesting.includes(intent)) return ['nested', 'Routines have to be run on their own.'];
    if (intent === 'RADIO' && /\boff\b/.test(text || '') && /wi-?fi|wireless/.test(text || '')) return REG.intents.WIFI_OFF;
    return REG.intents[intent] || ['safe', ''];
  }

  /* ---------- router (plain code) ---------- */
  const QUESTION = /^(what|what's|whats|why|how|who|whom|whose|when|where|which|can|could|should|would|is|are|am|was|were|do|does|did|will|have|has|tell me (about|why|how|what|who)|explain|define|describe|compare)\b/;
  const THING = '(?:a |an |the |new |my )*(?:folder|directory|file|note|routine|timer|reminder|to-?do|task|deadline|class|snippet)';
  const ACTION = new RegExp('^(?:open|close|launch|quit|exit|start|stop|set|turn|switch|add|remind|play|pause|resume|mute|unmute|lock|search|google|run|save|copy|paste|block|maximi[sz]e|minimi[sz]e|snap|put|cancel|increase|decrease|raise|lower|dim|brighten|enable|disable|prepare|get (?:me )?ready|install|uninstall|download|format|send|email|delete|erase|wipe|change|update|upgrade|show desktop|take (?:a )?screenshot|read my screen|git (?:status|pull|commit)|(?:create|make|new) ' + THING + ')\\b');
  const isAction = t => ACTION.test(t) && !/\?$/.test(t);
  const isQuestion = t => (QUESTION.test(t) || /\?$/.test(t)) && !ACTION.test(t);
  // Wider than isAction, only for handing a phrase the rules didn't understand to the AI planner (which returns
  // "not an action" → normal chat when it isn't one): requests with no command verb that still name something
  // JARVIS controls ("volume a bit lower", "i want the brightness higher"), or a schedule ("pay fees every year in
  // july"). Statements about yourself ("i go to the gym every day") and questions stay with chat.
  const CONTROLLABLE = /\b(volume|sound|brightness|screen|wi-?fi|bluetooth|timer|reminder|alarm|focus|pomodoro|to-?do|task list|attendance|dark mode|light mode|theme)\b/;
  const SCHEDULE = /\b(every|each) (day|week|month|year|morning|evening|night|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(daily|weekly|monthly|yearly|annually)\b|\bat \d{1,2}(:\d\d)?\s*(am|pm)\b/;
  const wantsAction = t => isAction(t) || (!isQuestion(t) && !/^(i|we|he|she|they|it|my|our)\b(?! (?:want|need|would like)\b)/.test(t) && (CONTROLLABLE.test(t) || SCHEDULE.test(t)));
  // "a, b and c" / "a then b" / "a and b" (only when b starts a new command)
  const SPLIT = new RegExp('\\s*(?:,|;|\\band then\\b|\\bthen\\b|\\bafter that\\b)\\s*|\\s+and\\s+(?=' + ACTION.source.slice(1) + ')', 'i');
  const cls = x => NLU.classify(NLU.normalize(x, settings.wakeWord), ctx);
  const known = p => p.intent !== 'CONVERSATION' && p.confidence >= 0.85;
  // "set volume to 30 and tell me a joke": also split on "and" when both sides are commands JARVIS knows —
  // but never inside one command's content ("remind me to buy milk and eggs", "search for tom and jerry").
  function splitAnd(chunk) {
    const re = /\s+and\s+/gi; let m;
    while ((m = re.exec(chunk))) {
      const left = chunk.slice(0, m.index).trim(), right = chunk.slice(m.index + m[0].length).trim();
      if (left.split(' ').length < 2 && !known(cls(left))) continue;
      const starts = ACTION.test(right) || /^(tell|give|show|list|check|what|what's|whats|how|how's|who|when|where|which|is|are|do|does|read|take|remind|mute|unmute|lock)\b/.test(right);
      // "volume 30 and dark mode": neither side starts with a verb, but each is a whole command on its own. Joined,
      // one of them was silently dropped. Only for short device/setting commands (no content that could contain "and").
      const bothSettings = [left, right].every(x => x.split(' ').length <= 4 && /^(VOLUME_\w+|BRIGHTNESS|DARK_MODE|RADIO|THEME_SET|SYS_LOCK|SCREENSHOT|FOCUS_START|BLOCK_DISTRACTIONS)$/.test(cls(x).intent) && known(cls(x)));
      if ((starts && known(cls(right)) && (known(cls(left)) || ACTION.test(left))) || bothSettings) return [left, ...splitAnd(right)];
    }
    return [chunk];
  }
  function parts(text) {
    const raw = String(text || '').split(SPLIT).map(x => x && x.trim().replace(/^and\s+/i, '').replace(/[.]+$/, '')).filter(x => x && x.length > 1);
    const out = raw.flatMap(splitAnd);
    return typeof expandSteps === 'function' ? expandSteps(out) : out;
  }
  // Commands whose content is itself a list of things ("create a routine called X: a, b, c", "take a note: a, then b")
  // are one command, never a plan.
  // The same goes for a request to a coding AI ("open vs code in X, create main.py and tell copilot to …"), for
  // "when X happens, do Y" triggers, and for a study plan ("exam on 12 Feb, topics: OS, DBMS, CN").
  const WHOLE = new Set(['ROUTINE_CREATE', 'ROUTINE_SCHEDULE', 'WRITE_FILE', 'NOTE_APPEND', 'DRAFT_COPY', 'REMEMBER', 'CODE_ASK', 'TRIGGER_CREATE', 'STUDY_PLAN']);
  // → { kind:'multi'|'simple'|'question', parts, classified, allKnown }
  // "I'm going to study. Set the volume to 30, …": a stated intention before the commands is the plan's goal,
  // not a step. Only for goal words (never "I need to open chrome, …"), and only when commands follow.
  const GOAL_RE = /^(?:(?:ok(?:ay)?|alright|so|hey|right)[, ]+)?(?:i'?m going to|i am going to|i'?m gonna|i need to|i have to|i want to|it'?s time to|time to|let'?s)\s+((?:study|focus|work|code|revise|revision|practi[sc]e|concentrate|learn|relax)(?:\s+[a-z0-9+#]+){0,3}?)\s*[.!:;,]\s+(?=\S)/;
  function splitGoal(s) {
    const m = GOAL_RE.exec(s);
    return m ? { goal: cap(m[1].trim()), rest: s.slice(m[0].length) } : { goal: '', rest: s };
  }
  function route(text) {
    const full = NLU.normalize(text, settings.wakeWord).text;
    if (isQuestion(full)) return { kind: 'question' };
    const g = splitGoal(full), s = g.rest;
    const ps = parts(s);
    if (ps.length >= 2 && ps.length <= 8) {
      const classified = ps.map(x => { const n = NLU.normalize(x, settings.wakeWord); const p = NLU.classify(n, ctx); p.original = n.original; p.step = x; return p; });
      if (WHOLE.has(classified[0].intent) || WHOLE.has(NLU.classify(NLU.normalize(text, settings.wakeWord), ctx).intent)) return { kind: 'simple' };
      // "open vs code and the directory should be dsa sprint folder" is one command (VS Code at that folder).
      if (NLU.editorFolder(s)) return { kind: 'simple' };
      const actions = classified.filter(p => isAction(NLU.normalize(p.step).text) || known(p));
      if (actions.length >= 2) return { kind: 'multi', parts: ps, classified, allKnown: classified.every(known), goal: g.goal };
    }
    return { kind: 'simple' };
  }

  /* ---------- run records ---------- */
  const RUNS_KEY = 'jarvis.agentRuns';
  function newId() {
    const d = new Date(), day = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const c = store.get('jarvis.agentCounter', {});
    const n = (c.day === day ? c.n : 0) + 1;
    store.set('jarvis.agentCounter', { day, n });
    return 'AGT-' + day + '-' + String(n).padStart(3, '0');
  }
  function saveRun(rec) {
    const runs = store.get(RUNS_KEY, []);
    runs.push(rec); while (runs.length > 50) runs.shift();
    store.set(RUNS_KEY, runs);
  }
  const lastRuns = (n = 5) => store.get(RUNS_KEY, []).slice(-n).reverse();

  /* ---------- verification (specific operation, plain code) ---------- */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function appState(app) {
    const r = await callTool('/tool/runningApps', { apps: [app] });
    if (r.error || !Array.isArray(r.checked) || !r.checked.includes(app)) return null;   // can't tell
    return r.running.includes(app);
  }
  // Before-state for checks that need it (open/close app).
  async function before(step) {
    if (step.check === 'app_started' || step.check === 'app_closed' || step.intent === 'OPEN_APPLICATION' || step.intent === 'CLOSE_APPLICATION') {
      const app = step.args && step.args.app || (NLU.findApp(step.text || '') || {}).k;
      return app ? { app, running: await appState(app) } : null;
    }
    return null;
  }
  // → { status:'verified'|'failed'|'unverified', note }
  async function verify(step, res, pre) {
    const one = Array.isArray(res) ? res[0] : res;
    const op = one && one.op;
    const nameOf = k => (NLU.appByKey(k) || { n: k }).n;
    try {
      if (op && op.kind === 'todo') return todos.some(t => t.id === op.id) ? { status: 'verified', note: 'to-do saved' } : { status: 'failed', note: 'the to-do is not in the list' };
      if (op && op.kind === 'timer') return timers.some(t => t.id === op.id) ? { status: 'verified', note: 'timer running' } : { status: 'failed', note: 'the timer is not running' };
      if (op && op.kind === 'reminder') return reminders.some(r => r.id === op.id) ? { status: 'verified', note: 'reminder saved' } : { status: 'failed', note: 'the reminder was not saved' };
      if (op && op.kind === 'file') {
        const r = await callTool('/agent/exists', { name: op.name });
        return r.exists ? { status: 'verified', note: (op.existed ? 'already existed: ' : 'exists: ') + op.name } : { status: 'failed', note: op.name + ' was not found' };
      }
      if (op && op.kind === 'focus_kept') return focus && focus.min === op.min ? { status: 'verified', note: 'a ' + op.min + '-minute session was already running (' + op.left + ' min left) — kept it' } : { status: 'failed', note: 'no focus session is running' };
      if (op && op.kind === 'distractions') {
        if (!op.closed.length) return { status: 'verified', note: 'no distracting apps were open' };
        await wait(800);
        const states = await Promise.all(op.closed.map(appState));
        const still = op.closed.filter((k, i) => states[i] === true).map(nameOf);
        if (still.length) return { status: 'failed', note: still.join(', ') + ' still running' };
        return states.some(x => x === null) ? { status: 'unverified', note: 'close command sent (can’t check every app)' } : { status: 'verified', note: 'closed ' + op.closed.map(nameOf).join(', ') };
      }
      if (op && op.kind === 'project') return { status: 'verified', note: 'found: ' + op.name };
      if (op && op.kind === 'attendance') return { status: 'verified', note: 'attendance saved for ' + op.subject };
      if (op && op.kind === 'marks') return { status: 'verified', note: 'result saved: ' + op.title };
      if (op && op.kind === 'process') return { status: 'verified', note: op.port ? op.which + ' listening on port ' + op.port : op.which + ' running' };
      if (op && op.kind === 'process_stopped') return { status: 'verified', note: op.which + ' stopped' };
      if (op && op.kind === 'browser_url') return { status: op.guessed ? 'unverified' : 'verified', note: 'opened ' + op.url };
      if (op && op.kind === 'toolchain_check') return { status: op.found ? 'verified' : 'failed', note: op.found ? op.label + ' found' : op.label + ' not found — I don’t install software myself; install it and try again' };
      if (op && op.kind === 'extension_check') return { status: 'unverified', note: op.found ? 'extension installed' : 'extension not installed (not blocking)' };
      const intent = step.intent;
      if ((intent === 'OPEN_APPLICATION' || intent === 'CLOSE_APPLICATION') && pre && pre.app) {
        const nm = nameOf(pre.app);
        if (pre.running === null) return { status: 'unverified', note: 'command sent (' + nm + ' can’t be checked)' };
        const opening = intent === 'OPEN_APPLICATION';
        if (opening && pre.running) { await wait(300); return (await appState(pre.app)) ? { status: 'verified', note: 'command sent · ' + nm + ' is running (it was already open)' } : { status: 'failed', note: nm + ' is not running' }; }
        if (!opening && !pre.running) return { status: 'failed', note: nm + ' was not running' };
        for (const ms of [1500, 2500]) { await wait(ms); const now = await appState(pre.app); if (now === opening) return { status: 'verified', note: opening ? nm + ' started' : nm + ' closed' }; }
        return { status: 'failed', note: opening ? nm + ' doesn’t seem to have started' : nm + ' is still running' };
      }
      // Target values: from validated args (model plans) or from the command text (rule-engine steps).
      const args = step.args || {}, txt = String(step.text || '').toLowerCase();
      const level = args.level !== undefined ? +args.level : (/\b(?:to|at)\s+(\d{1,3})\s*%?/.exec(txt) || [])[1];
      if (intent === 'VOLUME_SET' && level !== undefined) {
        const r = await callTool('/sys/volume', {});
        return r.level !== undefined && Math.abs(r.level - level) <= 2 ? { status: 'verified', note: 'volume is ' + r.level + '%' } : { status: 'failed', note: 'volume reads ' + r.level + '%' };
      }
      if (intent === 'BRIGHTNESS' && level !== undefined) {
        const r = await callTool('/sys/brightness', {});
        return r.level !== undefined && Math.abs(r.level - level) <= 1 ? { status: 'verified', note: 'brightness is ' + r.level + '%' } : { status: 'failed', note: 'brightness reads ' + r.level + '%' };
      }
      const darkWanted = args.on !== undefined ? !!args.on : /\blight\b|\bdark mode off\b|\bturn off dark\b/.test(txt) ? false : /\bdark\b/.test(txt) ? true : undefined;
      if (intent === 'DARK_MODE' && darkWanted !== undefined) {
        const r = await callTool('/sys/theme', {});
        const want = darkWanted ? 'dark' : 'light';
        return r.mode === want ? { status: 'verified', note: want + ' mode is on' } : { status: 'failed', note: 'Windows is still in ' + r.mode + ' mode' };
      }
      if (intent === 'FOCUS_START') {
        if (!focus) return { status: 'failed', note: 'no focus session is running' };
        const want = +args.minutes || +((/(\d+)[\s-]*(?:minute|min|m)\b/.exec(txt) || [])[1]) || 0;
        if (want && focus.min !== want) return { status: 'failed', note: 'the session is ' + focus.min + ' minutes, not ' + want };
        return { status: 'verified', note: focus.min + '-minute focus session running' };
      }
    } catch (e) { return { status: 'unverified', note: 'check failed: ' + e.message }; }
    return { status: 'unverified', note: '' };
  }

  /* ---------- building steps ---------- */
  // Validated model tool call → a step executeTool understands. Intent and args come from the server.
  function fromTool(v) {
    const m = LLM_TOOLS[v.tool] ? LLM_TOOLS[v.tool](v.args) : {};
    return { id: v.id, tool: v.tool, intent: v.intent, args: Object.assign({}, m.args || {}, v.args), text: (m.text || v.tool.replace(/_/g, ' ') + ' ' + Object.values(v.args).join(' ')).toLowerCase(),
      tier: v.tier, reason: v.reason, check: v.check, label: labelOf(v.tool, v.args) };
  }
  function fromRule(p, i) {
    const [tier, reason] = tierFor(p.intent, p.text);
    return { id: 'step_' + (i + 1), tool: null, intent: p.intent, args: p.args || {}, text: p.text, original: p.original, confidence: p.confidence, tier, reason, check: null, label: cap(p.step || p.text) };
  }
  function labelOf(tool, args) {
    const a = args || {};
    const nm = k => (NLU.appByKey(k) || { n: k }).n;
    const L = { open_app: () => 'Open ' + nm(a.app), close_app: () => 'Close ' + nm(a.app), set_timer: () => 'Set a ' + Math.round(a.seconds / 60 * 10) / 10 + '-minute timer',
      focus: () => 'Start a ' + (a.minutes || settings.focusMin) + '-minute focus session', create_folder: () => 'Create folder "' + a.name + '"', add_todo: () => 'Add "' + a.text + '" to the to-do list',
      remind: () => 'Remind you to ' + a.text + ' ' + a.when, set_volume: () => 'Set volume to ' + a.level + '%', brightness: () => 'Set brightness to ' + a.level + '%',
      youtube: () => 'Play "' + a.query + '" on YouTube', web_search: () => 'Search Google for "' + a.query + '"', write_note: () => 'Write file "' + a.name + '"', dark_mode: () => (a.on ? 'Dark' : 'Light') + ' mode',
      locate_project: () => 'Locate "' + a.name + '"', start_process: () => 'Start the ' + a.which + ' for "' + a.name + '"',
      stop_process: () => 'Stop the ' + a.which + ' for "' + a.name + '"', open_project_url: () => 'Open "' + a.name + '" in the browser',
      check_compiler: () => 'Check for a ' + cap(a.language) + ' compiler/runtime', check_extension: () => 'Check the ' + cap(a.language) + ' VS Code extension',
      attendance_mark: () => 'Mark ' + cap(a.subject || '') + ' ' + a.status, attendance_report: () => 'Show my attendance',
      bunk_check: () => 'Bunk check for ' + (a.subject || 'my classes'), add_marks: () => 'Save ' + a.title + ': ' + a.gpa + ' GPA, ' + a.credits + ' credits', cgpa_report: () => 'Show my CGPA' };
    return L[tool] ? L[tool]() : cap(tool.replace(/_/g, ' ')) + (Object.keys(a).length ? ' ' + Object.values(a).join(', ') : '');
  }

  /* ---------- planning: merge overlaps, order, dependencies ---------- */
  // Turns the literal list of steps into a coherent plan: one focus session (the one that names a duration wins),
  // closing distractions before the session starts (and without a second timer), and `needs` links so a step whose
  // prerequisite failed is skipped instead of running on a broken result. → { steps, notes }
  const MADE = /^(CREATE_FOLDER|WRITE_FILE)$/, USES = /^(OPEN_IN_EDITOR|OPEN_FOLDER|READ_FILE|RUN_FILE)$/;
  const madeName = s => String((s.args && s.args.name) || (/\b(?:called|named)\s+(.+?)\s*$/.exec(s.text || '') || [])[1] || '').toLowerCase().replace(/^["']|["']$/g, '');
  function optimize(steps) {
    const notes = [];
    steps = steps.slice();
    const focusIdx = steps.map((s, i) => s.intent === 'FOCUS_START' ? i : -1).filter(i => i >= 0);
    if (focusIdx.length > 1) {
      const timed = i => +(steps[i].args || {}).minutes || /\d+[\s-]*(?:minute|min|m)\b/.test(steps[i].text || '');
      const keep = focusIdx.filter(timed).pop() ?? focusIdx[focusIdx.length - 1];
      focusIdx.filter(i => i !== keep).forEach(i => notes.push('“' + steps[i].label + '” is covered by “' + steps[keep].label + '”'));
      steps = steps.filter((s, i) => !focusIdx.includes(i) || i === keep);
    }
    const f = steps.findIndex(s => s.intent === 'FOCUS_START');
    if (f >= 0) {
      steps.forEach(s => { if (s.intent === 'BLOCK_DISTRACTIONS') s.args = Object.assign({}, s.args, { noFocus: true }); });
      const b = steps.findIndex(s => s.intent === 'BLOCK_DISTRACTIONS');
      if (b > f) { const [blk] = steps.splice(b, 1); steps.splice(f, 0, blk); notes.push('closing distractions now happens before the focus session starts'); }
    }
    steps.forEach((s, i) => {
      s.id = 'step_' + (i + 1); s.needs = [];
      if (!USES.test(s.intent)) return;
      const t = String(s.text || '') + ' ' + madeName(s);
      for (let j = i - 1; j >= 0; j--) {
        const e = steps[j], n = MADE.test(e.intent) ? madeName(e) : '';
        if (n && (t.includes(n) || (j === i - 1 && /\b(it|there|that)\b/.test(s.text || '')))) { s.needs.push(e.id); break; }
      }
    });
    return { steps, notes };
  }

  /* ---------- state-aware preview ---------- */
  // Apps "block distractions" closes (shared with its handler in script.js).
  const DISTRACTORS = ['discord', 'steam', 'whatsapp', 'spotify'];
  const minutesOf = s => +((s.args || {}).minutes) || +((/(\d+)[\s-]*(?:minute|min|m)\b/.exec(s.text || '') || [])[1]) || 0;
  // One running-apps query for the whole plan, then a short note per step on what the current state means for it:
  // "already open → reuse", "already closed → skip", "a 25-minute session is running → keep". Apps the server can't
  // check get no note (never a guess).
  async function annotate(steps) {
    const appOf = s => (s.args && s.args.app) || (NLU.findApp(s.text || '') || {}).k;
    const apps = [...new Set(steps.flatMap(s => /^(OPEN|CLOSE)_APPLICATION$/.test(s.intent) ? [appOf(s)] : s.intent === 'BLOCK_DISTRACTIONS' ? DISTRACTORS : []).filter(Boolean))];
    const r = apps.length ? await callTool('/tool/runningApps', { apps }) : {};
    const checked = new Set(r.checked || []), running = new Set(r.running || []);
    const nm = k => (NLU.appByKey(k) || { n: k }).n;
    for (const s of steps) {
      const k = appOf(s);
      if (s.intent === 'OPEN_APPLICATION' && checked.has(k) && running.has(k)) s.state = 'already open → reuse';
      if (s.intent === 'CLOSE_APPLICATION' && checked.has(k) && !running.has(k)) s.state = 'already closed → skip';
      if (s.intent === 'BLOCK_DISTRACTIONS' && DISTRACTORS.every(d => checked.has(d))) {
        const on = DISTRACTORS.filter(d => running.has(d));
        s.state = on.length ? 'will close ' + on.map(nm).join(', ') : 'nothing open → skip';
      }
      if (s.intent === 'FOCUS_START' && focus && focus.phase === 'focus') {
        const want = minutesOf(s);
        s.state = 'a ' + focus.min + '-minute session is running → ' + (!want || want === focus.min ? 'keep it' : 'replace with ' + want + ' minutes');
      }
    }
  }

  /* ---------- executor ---------- */
  const ICON = { verified: '✓', unverified: '○', failed: '✗', skipped: '⛔', blocked: '⛔', declined: '✕', pending: '·', notrun: '·' };
  function render(run) {
    const head = (run.goal ? '**' + run.goal + '**' : '**Plan**') + ' · `' + run.id + '`';
    const rows = run.steps.map((s, i) => (i + 1) + '. ' + ICON[s.status || 'pending'] + ' ' + s.label + (s.note ? ' — ' + s.note : '') + (s.status === 'notrun' ? ' *(not run)*' : ''));
    return head + '\n' + rows.join('\n') + (run.notes && run.notes.length ? '\n\n*Plan: ' + run.notes.join('; ') + '.*' : '');
  }
  function logTree(run) {
    log('agent', run.id + ' · ' + run.source + (run.ms_plan ? ' · plan ' + (run.ms_plan / 1000).toFixed(1) + 's' : '') + ' · route ' + run.ms_route + 'ms');
    for (const s of run.steps) log(s.status === 'failed' ? 'err' : 'agent', '  ' + s.id + ' ' + (s.tool || s.intent) + (s.args && Object.keys(s.args).length ? JSON.stringify(s.args) : '') + ' · exec ' + (s.ms_execute ?? '–') + 'ms · verify ' + (s.ms_verify ?? '–') + 'ms · ' + ICON[s.status || 'pending'] + ' ' + (s.note || s.status || ''));
  }
  // Steps left in a not-done state (failed, or skipped after a cancel/stop) — safe to retry without touching
  // anything that already succeeded.
  const retryableSteps = run => run.steps.filter(s => s.status === 'failed' || s.status === 'notrun');
  async function retryRun(run) {
    const steps = retryableSteps(run);
    if (!steps.length) return { text: 'Nothing to retry.', intent: 'AGENT_RUN', noPersona: true };
    steps.forEach(s => { s.status = undefined; s.note = ''; s.ms_execute = undefined; s.ms_verify = undefined; });
    return execute({ goal: run.goal, steps }, { source: run.source, stopOnFail: true });
  }
  function finish(run) {
    run.total = Math.round(performance.now() - run.t0);
    run.done = true;
    const failed = run.steps.filter(s => s.status === 'failed').length, ok = run.steps.filter(s => s.status === 'verified' || s.status === 'unverified').length;
    const rec = { id: run.id, goal: run.goal, source: run.source, at: Date.now(), ms_route: run.ms_route, ms_plan: run.ms_plan || 0, total: run.total, cancelled: !!run.cancelled,
      steps: run.steps.map(s => ({ id: s.id, tool: s.tool || s.intent, args: s.args, tier: s.tier, status: s.status || 'notrun', verified: s.status === 'verified', note: s.note || '', reason: s.reason || '', label: s.label, ms_execute: s.ms_execute ?? null, ms_verify: s.ms_verify ?? null })) };
    saveRun(rec); logTree(run); bumpStat('agentRuns');
    const retryable = retryableSteps(run);
    const nVer = run.steps.filter(s => s.status === 'verified').length, nUn = run.steps.filter(s => s.status === 'unverified').length;
    const nSkip = run.steps.filter(s => ['notrun', 'skipped', 'declined', 'blocked'].includes(s.status)).length;
    const summary = run.steps.length > 1 ? '\n\n**' + nVer + ' of ' + run.steps.length + ' verified**' + (nUn ? ' · ' + nUn + ' sent but not checkable' : '') + (failed ? ' · ' + failed + ' failed' : '') + (nSkip ? ' · ' + nSkip + ' not run' : '') : (failed ? '\n\n1 step failed.' : '');
    const tail = run.cancelled ? '\n\n*Task cancelled.*' : summary;
    const actions = retryable.length ? [{ label: run.cancelled ? 'RESUME' : 'RETRY', fn: () => retryRun(run).then(res => deliver(res, { intent: 'AGENT_RUN', confidence: 1 })) }] : undefined;
    return { text: render(run) + tail, speak: run.cancelled ? 'Task cancelled, ' + Persona.sir() + '.' : (failed ? 'Done, with ' + plural(failed, 'problem') + '. ' : 'All done, ' + Persona.sir() + '. ') + plural(ok, 'step') + ' completed.',
      intent: 'AGENT_RUN', tool: 'agent', meta: 'AGENT · ' + run.id + ' · ' + (run.ms_plan ? 'plan ' + (run.ms_plan / 1000).toFixed(1) + 's · ' : '') + 'total ' + (run.total / 1000).toFixed(1) + 's', noPersona: true, actions };
  }
  // A card asking to allow one step (confirm / explicit tier). Resolves true / false.
  // idx: explicit step number for a virtual step built for failure recovery (not itself in run.steps).
  function ask(run, s, idx) {
    const i = idx !== undefined ? idx : run.steps.indexOf(s);
    return new Promise(resolve => {
      jarvisSay({ text: (s.tier === 'explicit' ? '⚠ ' : '') + 'JARVIS wants permission to: **' + s.label + '**.\nReason: ' + (s.reason || 'this changes something on your computer.') + '\n*Plan `' + run.id + '`, step ' + (i + 1) + ' of ' + run.steps.length + '.*',
        intent: 'AGENT_CONFIRM', noPersona: true, noLocalize: false,
        confirm: { yes: s.tier === 'explicit' ? 'YES — ' + s.label.toUpperCase().slice(0, 30) : 'ALLOW', no: 'CANCEL', onConfirm: () => resolve(true), onCancel: () => resolve(false) } });
    });
  }
  // A backend/frontend failed to start because its port is already in use. Identify the process, and only if
  // it is a leftover JARVIS itself started earlier for this exact project and role, offer to close it and
  // retry once. An unrecognised process is reported, never touched — this bounds the blast radius of
  // "terminate a process" to things JARVIS itself is responsible for.
  async function attemptPortRecovery(run, s, info) {
    const { project, which, port } = info;
    if (!port) return { ok: false, note: 'the port is already in use, and no port number could be read from its output' };
    const idx = run.steps.indexOf(s);
    log('agent', 'recovery: ' + which + ' for ' + project + ' failed — port ' + port + ' already in use; identifying the process…');
    const owner = await callTool('/tool/portOwner', { port });
    if (!owner.found) return { ok: false, note: 'port ' + port + ' is already in use, and I could not identify the process holding it' };
    if (!owner.ownedByJarvis || owner.project !== project || owner.which !== which) {
      return { ok: false, note: 'port ' + port + ' is already in use by ' + (owner.name || 'another process') + ' (PID ' + owner.pid + '); it doesn’t look like a previous run of this project, so I won’t close it automatically' };
    }
    busy = false; idleState();
    const ok = await ask(run, { tier: 'confirm', label: 'Stop the previous ' + which + ' for ' + project + ' (PID ' + owner.pid + ') and restart it',
      reason: 'Port ' + port + ' is already in use by a previous run of ' + project + '’s ' + which + ' that never shut down.' }, idx);
    if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 50); });
    busy = true;
    if (!ok) return { ok: false, note: 'port ' + port + ' is in use by a previous run of this project; you declined to close it' };
    log('agent', 'recovery: stopping the previous ' + which + ' (PID ' + owner.pid + ')…');
    await callTool('/tool/stopProcess', { name: project, which });
    await wait(600);
    log('agent', 'recovery: restarting the ' + which + '…');
    const retry = await callTool('/tool/startProcess', { name: project, which });
    if (retry.success) return { ok: true, note: (retry.port ? which + ' restarted on port ' + retry.port : which + ' restarted') + ' after closing the stale process' };
    return { ok: false, note: 'closed the previous process, but the ' + which + ' failed again' + (retry.tail ? ': ' + retry.tail.trim().slice(-200) : '') };
  }
  // A program createProject just generated failed to compile or exited with an error. Feed the real compiler/
  // runtime output back to the local AI, show the diagnosis and the proposed fix (same transparency as showing
  // the original generated code), ask permission once — same shape as attemptPortRecovery's single confirmation
  // for the whole recovery action — then rewrite the file and recompile directly. Bounded to s.repair.attemptsLeft
  // (set to 2 by createProject) so a stubborn bug can't loop forever; a timeout never triggers a retry.
  async function attemptCompileRecovery(run, s, r) {
    const rep = s.repair;
    const label = r.compileError ? 'compilation failed' : r.timedOut ? 'timed out' : 'exited with code ' + r.exitCode;
    const errorText = (r.stderr || r.stdout || '').trim() || label;
    // A missing compiler/runtime isn't a code bug — no edit could ever fix it. Same "I don't install software
    // myself" honesty as learnLanguage's check_compiler path, instead of wasting a repair attempt and asking
    // permission to apply a fix that could never compile anyway.
    if (/not found.*(?:on )?PATH|is it installed/i.test(errorText)) {
      return { ok: false, note: errorText.split('\n')[0] + ' — I don’t install software myself; install it and try again' };
    }
    if (r.timedOut || rep.attemptsLeft <= 0 || !llmReady()) return { ok: false, note: label };
    const idx = run.steps.indexOf(s);
    log('agent', 'recovery: ' + (r.compileError ? 'compile' : 'runtime') + ' failure in ' + rep.filePath + ' — asking the local AI to diagnose it…');
    const ai = await askLLM('This ' + rep.lang.name + ' program failed:\n\n```text\n' + errorText.slice(0, 2000) + '\n```\n\nHere is the current code:\n\n```\n' + rep.code
      + '\n```\n\nDiagnose the bug in one short sentence, then reply with the complete corrected code in ONE fenced code block.', { noTools: true });
    if (!ai) return { ok: false, note: label };
    const fixed = extractCode(ai.text);
    if (!fixed || !fixed.code.trim()) return { ok: false, note: 'the local AI could not produce a fix' };
    const diagnosis = ai.text.split(/```/)[0].trim().slice(0, 300);
    jarvisSay({ text: (diagnosis ? diagnosis + '\n\n' : '') + 'Proposed fix:\n```' + rep.lang.ext + '\n' + fixed.code + '\n```', noPersona: true });
    busy = false; idleState();
    const ok = await ask(run, { tier: 'confirm', label: 'Apply this fix and recompile ' + rep.filePath.split('/').pop(),
      reason: diagnosis || 'the local AI found a likely cause — see the corrected code above.' }, idx);
    if (busy) await new Promise(res2 => { const t = setInterval(() => { if (!busy) { clearInterval(t); res2(); } }, 50); });
    busy = true;
    if (!ok) return { ok: false, note: 'you declined the fix' };
    rep.attemptsLeft--; rep.code = fixed.code;
    // overwrite:true — the file already exists (it's the one that just failed), and the user just approved
    // replacing it via the confirmation above; without this, writeFile silently no-ops on an existing file.
    await callTool('/tool/writeFile', { name: rep.filePath, content: fixed.code + '\n', overwrite: true });
    log('agent', 'recovery: recompiling ' + rep.filePath + ' (attempt ' + (2 - rep.attemptsLeft + 1) + ')…');
    const retry = await callTool('/tool/runFile', { name: rep.filePath });
    if (retry.error) return { ok: false, note: retry.error };
    if (retry.timedOut) return { ok: false, note: 'timed out' };
    if (retry.compileError || (retry.exitCode && retry.exitCode !== 0)) return attemptCompileRecovery(run, s, retry);
    return { ok: true, note: 'fixed after ' + plural(2 - rep.attemptsLeft, 'repair') + ' — ran successfully' };
  }
  // Runs one step (after its permission gate). Nested handler confirmations count as approved, since the user just allowed it.
  async function runStep(run, s, approved) {
    // State first: closing an app that isn't running is already done — no permission prompt, no "failed".
    const pre = s.tier === 'nested' || s.tier === 'unknown' ? null : await before(s);
    if (s.intent === 'CLOSE_APPLICATION' && pre && pre.running === false) { s.status = 'verified'; s.note = (NLU.appByKey(pre.app) || { n: pre.app }).n + ' was already closed — nothing to do'; return; }
    if (run.unattended && s.tier !== 'safe') { s.status = 'skipped'; s.note = s.tier === 'nested' ? 'routines can’t run inside a routine' : 'needs your permission — run it by itself'; return; }
    if (s.tier === 'nested' || s.tier === 'unknown') { s.status = 'blocked'; s.note = s.reason; return; }
    if (s.tier === 'explicit' || (s.tier === 'confirm' && !run.previewAccepted)) {
      if (!approved) {
        busy = false; idleState();
        const ok = await ask(run, s);
        if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 50); });
        busy = true;
        if (!ok) { s.status = 'declined'; s.note = 'you cancelled it'; return; }
      }
    }
    setState('EXECUTING', run.id + ' → ' + s.label);
    const t0 = performance.now();
    let res;
    try { res = await executeTool({ intent: s.intent, args: s.args, text: s.text, original: s.original || s.text, confidence: s.confidence || .95, tool: s.tool, viaAgent: true }, s.text); }
    catch (e) { res = { text: 'failed: ' + e.message }; }
    s.ms_execute = Math.round(performance.now() - t0);
    const one = Array.isArray(res) ? res[0] : res;
    if (one && one.confirm && typeof one.confirm.onConfirm === 'function') { try { await one.confirm.onConfirm(); } catch (e) { /* reported by the handler */ } }
    if (one && one.askLLM) { s.status = 'skipped'; s.note = 'needs the AI — ask it by itself'; return; }
    if (one && one.absent) { s.status = 'skipped'; s.note = one.text; return; }
    if (one && one.portInUse) {
      const rec = await attemptPortRecovery(run, s, one);
      s.status = rec.ok ? 'verified' : 'failed'; s.note = rec.note;
      return;
    }
    // A compiled/run program that failed or exited non-zero is a real failure, not just "unverified" — otherwise
    // stopOnFail never triggers and later steps (e.g. opening the editor) proceed on a broken result.
    if (s.intent === 'RUN_FILE' && one && one.text) {
      const t = String(one.text);
      const isCompileFail = /compilation failed/i.test(t);
      const exitM = t.match(/✗ exit (-?\d+)/);
      const timedOut = /⏱ stopped after \d+s/.test(t);
      // Only createProject's generated run_file step carries .repair — every other RUN_FILE call (the user
      // manually running a file, learnLanguage's fixed Hello World) is untouched by this branch.
      if ((isCompileFail || exitM) && !timedOut && s.repair && s.repair.attemptsLeft > 0) {
        const errM = t.match(/```text\n([\s\S]*?)\n```/);
        const rec = await attemptCompileRecovery(run, s, { compileError: isCompileFail, exitCode: exitM ? +exitM[1] : 0, stderr: errM ? errM[1] : '', stdout: '' });
        s.status = rec.ok ? 'verified' : 'failed'; s.note = rec.note;
        return;
      }
      if (isCompileFail) { s.status = 'failed'; s.note = 'compilation failed'; return; }
      if (exitM) { s.status = 'failed'; s.note = 'exited with code ' + exitM[1]; return; }
      if (timedOut) { s.status = 'failed'; s.note = 'timed out'; return; }
    }
    if (one && one.actions && !one.op) { s.status = 'failed'; s.note = String(one.text || '').split('\n')[0].replace(/\*\*|`/g, '').slice(0, 90); return; }
    if (one && /^(i could not|could not|failed|i do not have|no .* matches|what should|which|for how long|when should|no (folder|file|project|such)\b|i can.t find|i couldn.t find|✗ no\b)/i.test(String(one.text || ''))) { s.status = 'failed'; s.note = String(one.text).split('\n')[0].replace(/\*\*|`/g, '').slice(0, 90); return; }
    const t1 = performance.now();
    const v = await verify(s, res, pre);
    s.ms_verify = Math.round(performance.now() - t1);
    s.status = v.status; s.note = v.note || String((one && one.text) || '').split('\n')[0].replace(/\*\*|`/g, '').slice(0, 80);
    // Say so when the result couldn't be checked, instead of a plain ✓ that looks verified.
    if (v.status === 'unverified') s.note = (s.note ? s.note + ' · ' : '') + 'not checked';
  }
  // plan: { goal, steps:[step] } · opts: { source:'split'|'planner'|'chat'|'routine', unattended, stopOnFail, ms_route, ms_plan }
  async function execute(plan, opts) {
    opts = opts || {};
    await registry();
    const run = { id: newId(), goal: plan.goal || '', source: opts.source || 'split', steps: plan.steps, unattended: !!opts.unattended, t0: performance.now(),
      ms_route: Math.round(opts.ms_route || 0), ms_plan: Math.round(opts.ms_plan || 0), previewAccepted: false, cancelled: false, notes: opts.notes || [] };
    // Preview (dry run): any plan the model helped build with 2+ steps, or one that needs permission — so a
    // misunderstood step is visible before anything runs. Plain rule-engine splits of safe commands run straight away.
    const risky = run.steps.some(s => s.tier === 'confirm' || s.tier === 'explicit');
    // Split plans of known commands preview too when any step needs permission: one approval up front instead of
    // interruptions half-way through.
    if (!run.unattended && ((run.source === 'planner' && (run.steps.length >= 2 || risky)) || (run.source === 'split' && run.steps.length >= 2 && risky))) {
      try { await annotate(run.steps); } catch (e) { /* preview without state notes */ }
      busy = false; idleState();
      const go = await new Promise(resolve => jarvisSay({ text: '**Plan: ' + (run.goal || 'your request') + '** · `' + run.id + '`\n' + run.steps.map((s, i) => (i + 1) + '. ' + (s.tier === 'safe' || /→ skip$/.test(s.state || '') ? '✓ ' : '⚠ ') + s.label + (s.state ? ' — *' + s.state + '*' : s.tier !== 'safe' ? ' — *' + s.reason + '*' : '') + (s.needs && s.needs.length ? ' *(after step ' + s.needs.map(id => run.steps.findIndex(x => x.id === id) + 1).join(', ') + ')*' : '')).join('\n')
          + (run.notes.length ? '\n\n*Plan: ' + run.notes.join('; ') + '.*' : '') + (risky ? '\n\n*⚠ needs your permission — one EXECUTE approves them all.*' : '') + '\n\n*No changes have been made yet.*',
        intent: 'AGENT_PREVIEW', noPersona: true, confirm: { yes: 'EXECUTE', no: 'CANCEL', onConfirm: () => resolve(true), onCancel: () => resolve(false) } }));
      if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 50); });
      busy = true;
      if (!go) { run.steps.forEach(s => { s.status = 'notrun'; }); finish(run); return { text: 'Cancelled — nothing was changed. (`' + run.id + '`)', intent: 'AGENT_RUN', noPersona: true }; }
      run.previewAccepted = true;
      // The preview itself was "is this what you meant?" — reuse its EXECUTE click as the teach-me confirmation.
      if (opts.learn) learnSave(opts.learn.text, { goal: run.goal, steps: run.steps });
    }
    // A visible way to interrupt a real multi-step run (only for AI-built plans — a split of known-safe
    // commands is normally near-instant, so a cancel button would just be noise for those).
    if (!run.unattended && run.source === 'planner' && run.steps.length > 1) {
      jarvisSay({ text: 'Running **' + (run.goal || 'your request') + '** · `' + run.id + '`…', intent: 'AGENT_CANCEL_OFFER', noPersona: true,
        actions: [{ label: 'CANCEL TASK', fn: () => { run.cancelled = true; } }] });
    }
    for (let i = 0; i < run.steps.length; i++) {
      if (run.cancelled) { for (let j = i; j < run.steps.length; j++) run.steps[j].status = 'notrun'; break; }
      const s = run.steps[i];
      const unmet = (s.needs || []).map(id => run.steps.find(x => x.id === id)).filter(d => d && ['failed', 'declined', 'blocked', 'notrun'].includes(d.status));
      if (unmet.length) { s.status = 'notrun'; s.note = 'skipped — step ' + (run.steps.indexOf(unmet[0]) + 1) + ' (' + unmet[0].label + ') didn’t complete'; continue; }
      await runStep(run, s, i === 0 && !!opts.preApproved);
      if (!run.unattended && run.steps.length > 1) setState('EXECUTING', run.id + ' · ' + (i + 1) + '/' + run.steps.length);
      if (s.status === 'declined' || (s.status === 'failed' && opts.stopOnFail)) {
        for (let j = i + 1; j < run.steps.length; j++) run.steps[j].status = 'notrun';
        break;
      }
      if (i < run.steps.length - 1) await wait(250);
    }
    return finish(run);
  }

  /* ---------- entry points used by script.js ---------- */
  // Multi-step request. r = route() result. Returns a deliverable result, or null to fall through.
  async function handleMulti(text, r, tRoute) {
    await registry();
    if (r.allKnown) {
      const o = optimize(r.classified.map(fromRule));
      return execute({ goal: r.goal || text, steps: o.steps }, { source: 'split', ms_route: tRoute, notes: o.notes });
    }
    // Known parts run through the rules; only the unknown parts go to the model, one part at a time.
    // Every part the user said must map to at least one step — otherwise nothing runs (no silent substitutes).
    setState('PROCESSING', 'Planning…');
    const steps = []; let msPlan = 0;
    for (const p of r.classified) {
      if (known(p)) { steps.push(fromRule(p, steps.length)); continue; }
      const j = await callTool('/agent/plan', { text: p.step, model: llm.model || undefined });
      msPlan += j.ms_plan || 0;
      if (!j.ok) return failure(text, '“' + p.step + '”: ' + (j.empty ? 'I don’t have a tool for that part' : (j.reason || j.error || 'no safe plan')));
      for (const s of j.plan.steps) steps.push(fromTool(s));
    }
    if (steps.length > 8) return failure(text, 'that would take ' + steps.length + ' steps (maximum 8)');
    const o = optimize(steps);
    return execute({ goal: r.goal || '', steps: o.steps }, { source: 'planner', ms_route: tRoute, ms_plan: msPlan, stopOnFail: true, notes: o.notes });
  }
  // "Prepare my development environment for AgriLoop" / "set up AgriLoop for development": a fixed goal
  // template, not a model call — locate the project, open it, start its backend/frontend, open the browser.
  const ENV_GOAL_RE = [
    /^(?:prepare|set\s*up|setup|get\s+(?:me\s+)?ready)\s+(?:my\s+|the\s+)?(?:dev(?:elopment)?\s+)?environment\s+for\s+(.+)$/i,
    /^(?:prepare|set\s*up|setup)\s+(.+?)\s+for\s+dev(?:elopment)?\s*$/i,
  ];
  function envGoal(text) {
    const s = String(text || '').trim();
    for (const re of ENV_GOAL_RE) {
      const m = s.match(re);
      const name = m && m[1] && m[1].trim().replace(/[.?!'"]+$/, '');
      if (name && name.length <= 60) return name;
    }
    return null;
  }
  // Locate → open in editor → start backend → start frontend → open the browser. Every step still goes
  // through the server's validator (same as chatTool), so it gets the same argument checks and permission tiers.
  async function prepareEnvironment(text, name, tRoute) {
    await registry();
    setState('PROCESSING', 'Preparing…');
    const calls = [['locate_project', { name }], ['open_in_editor', { name }], ['start_process', { name, which: 'backend' }],
      ['start_process', { name, which: 'frontend' }], ['open_project_url', { name, which: 'frontend' }]];
    const steps = [];
    for (const [tool, args] of calls) {
      const j = await callTool('/agent/validate', { tool, args });
      if (!j.ok) return failure(text, j.reason || (tool + ' is not available'));
      steps.push(fromTool(Object.assign({}, j.step, { id: 'step_' + (steps.length + 1) })));
    }
    // locate → editor, locate → backend → frontend → browser. A project with no backend at all skips that step
    // (status 'skipped', not failed), so a frontend-only project still starts; a backend that crashes stops the rest.
    const [loc, , back, front, url] = steps;
    steps[1].needs = [loc.id]; back.needs = [loc.id]; front.needs = [loc.id, back.id]; url.needs = [front.id];
    return execute({ goal: 'Prepare the environment for ' + name, steps }, { source: 'planner', ms_route: tRoute, stopOnFail: false });
  }

  // "I want to learn C++" / "teach me Python": a minimal, predictable starter — one folder, one hello-world
  // file with a comment on what to try next. No AI call, no hardcoded curriculum.
  // "c++"'s trailing "+" isn't a word character, so a plain trailing \b would fail right after it and fall
  // through to matching just "c" — the c++ alternative gets its own group with no boundary requirement.
  const LEARN_LANG_RE = /^(?:i want to learn|help me learn|teach me|let'?s learn|start learning)\s+(?:(c\+\+)|(python|cpp|javascript|js|c)\b)/i;
  const LEARN_LANG_MAP = {
    python: { key: 'python', ext: 'py', name: 'Python' }, 'c++': { key: 'cpp', ext: 'cpp', name: 'Cpp' }, cpp: { key: 'cpp', ext: 'cpp', name: 'Cpp' },
    c: { key: 'c', ext: 'c', name: 'C' }, javascript: { key: 'javascript', ext: 'js', name: 'JavaScript' }, js: { key: 'javascript', ext: 'js', name: 'JavaScript' },
  };
  const LEARN_STARTER = {
    cpp: '// Welcome! This is a starting point for learning C++.\n// Change the message below, then ask JARVIS to "run main.cpp" to see the result.\n#include <iostream>\nint main() {\n    std::cout << "Hello, C++!" << std::endl;\n    return 0;\n}\n',
    c: '// Welcome! This is a starting point for learning C.\n// Change the message below, then ask JARVIS to "run main.c" to see the result.\n#include <stdio.h>\nint main() {\n    printf("Hello, C!\\n");\n    return 0;\n}\n',
    python: '# Welcome! This is a starting point for learning Python.\n# Change the message below, then ask JARVIS to "run main.py" to see the result.\nprint("Hello, Python!")\n',
    javascript: '// Welcome! This is a starting point for learning JavaScript.\n// Change the message below, then ask JARVIS to "run main.js" to see the result.\nconsole.log("Hello, JavaScript!");\n',
  };
  function learnGoal(text) {
    const m = String(text || '').trim().match(LEARN_LANG_RE);
    if (!m) return null;
    return LEARN_LANG_MAP[(m[1] || m[2] || '').toLowerCase()] || null;
  }
  // Check compiler → check extension → create folder → write a starter file → compile+run it as a real smoke
  // test → open the editor. Every step still goes through the server's validator, same as prepareEnvironment.
  async function learnLanguage(text, lang, tRoute) {
    await registry();
    setState('PROCESSING', 'Setting up…');
    const folder = 'Learn-' + lang.name;
    const calls = [
      ['check_compiler', { language: lang.key }], ['check_extension', { language: lang.key }],
      ['create_folder', { name: folder }], ['write_note', { name: folder + '/main.' + lang.ext, content: LEARN_STARTER[lang.key] }],
      ['run_file', { name: folder + '/main.' + lang.ext }], ['open_in_editor', { name: folder }],
    ];
    const steps = [];
    for (const [tool, args] of calls) {
      const j = await callTool('/agent/validate', { tool, args });
      if (!j.ok) return failure(text, j.reason || (tool + ' is not available'));
      steps.push(fromTool(Object.assign({}, j.step, { id: 'step_' + (steps.length + 1) })));
    }
    return execute({ goal: 'Set up a ' + lang.name + ' learning environment', steps }, { source: 'planner', ms_route: tRoute, stopOnFail: true });
  }

  // "create a C++ project called SmartCalc, write a basic calculator, compile it and run it": the LLM writes
  // real code for what's described, then the normal validated pipeline creates/compiles/runs/opens it — so
  // the preview shows the actual generated code before anything is compiled or run, not a blind promise.
  const CREATE_PROJECT_RE = /^(?:create|make|build|start)\s+(?:a\s+|an\s+)?(?:new\s+)?(python|c\+\+|cpp|c|javascript|js)?\s*project\s+(?:called|named)\s+([A-Za-z0-9_-]+)\b(.*)$/i;
  function cleanProjectDescription(rest) {
    let m = String(rest || '').match(/\bwrite\s+(?:a\s+|an\s+)?(.+?)(?:,?\s*(?:compile|run|then)\b|[.!]|$)/i)
      || String(rest || '').match(/\b(?:that|which)\s+(.+?)(?:,?\s*(?:compile|run|then)\b|[.!]|$)/i);
    if (m) return m[1].trim();
    const d = String(rest || '').replace(/^[,:]+\s*/, '').replace(/\bcreate\s+the\s+files?\b/gi, '')
      .replace(/\bcompile\s+(?:it|the\s+code)?(?:\s+and\s+run\s+it)?\b/gi, '').replace(/\b(?:and\s+)?run\s+it\b/gi, '')
      .replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
    return d.length > 3 ? d : '';
  }
  function createProjectGoal(text) {
    const m = String(text || '').trim().match(CREATE_PROJECT_RE);
    if (!m) return null;
    return { lang: LEARN_LANG_MAP[(m[1] || '').toLowerCase()] || null, name: m[2], description: cleanProjectDescription(m[3]) };
  }
  async function createProject(text, name, lang, description, tRoute) {
    await registry();
    setState('PROCESSING', 'Writing ' + lang.name + ' code…');
    const ai = await askLLM('Write a complete, runnable ' + lang.name + ' program that ' + description + '.\n\nReply with the complete code in ONE fenced code block (with a language tag), then at most one short sentence.', { noTools: true });
    if (!ai) return failure(text, 'the local AI is unavailable');
    const code = extractCode(ai.text);
    if (!code || !code.code.trim()) return failure(text, 'the local AI didn’t return usable code — try again, maybe with a simpler description');
    const folder = name;
    const filePath = folder + '/main.' + lang.ext;
    const calls = [
      ['create_folder', { name: folder }], ['write_note', { name: filePath, content: code.code + '\n' }],
      ['run_file', { name: filePath }], ['open_in_editor', { name: folder }],
    ];
    const steps = [];
    for (const [tool, args] of calls) {
      const j = await callTool('/agent/validate', { tool, args });
      if (!j.ok) return failure(text, j.reason || (tool + ' is not available'));
      const step = fromTool(Object.assign({}, j.step, { id: 'step_' + (steps.length + 1) }));
      // Only the run_file step carries repair metadata — see attemptCompileRecovery, bounded to 2 fix attempts.
      // fromTool() rebuilds the step from a fixed field whitelist, so this must be attached after, not merged in.
      if (tool === 'run_file') step.repair = { lang, filePath, code: code.code, attemptsLeft: 2 };
      steps.push(step);
    }
    return execute({ goal: 'Create ' + name + ' (' + lang.name + ')', steps }, { source: 'planner', ms_route: tRoute, stopOnFail: true });
  }

  // "design a prompt for my portfolio site" / "help me write a prompt for an app idea": walks the user through
  // TCREI (Task, Context, References, Evaluate, Iterate) one question at a time via ctx.pending, then compiles
  // the answers into one copy-pasteable prompt for the user to take to another AI tool. No LLM call — pure
  // templating from what the user already said, so there's nothing here to get wrong or need verifying.
  const DESIGN_PROMPT_RE = /^(?:help me\s+)?(?:design|write|build|make|create|generate)\s+(?:me\s+)?(?:an?\s+)?(?:tcrei\s+)?(?:ai\s+)?(?:design\s+)?prompt\b(?:\s+(?:for|about)\s+(.+))?$/i;
  function designPromptGoal(text) {
    const m = String(text || '').trim().match(DESIGN_PROMPT_RE);
    if (!m) return null;
    return { task: (m[1] || '').trim() };
  }
  const DESIGN_PROMPT_QUESTIONS = {
    TASK: 'What do you want to design or build? (e.g. "a landing page for my cybersecurity project")',
    CONTEXT: 'Who’s it for, and what’s the goal or tone? (audience, purpose, brand feel)',
    REFERENCES: 'Any style references — sites, apps, or a vibe like "clean like Stripe"? (or say "skip")',
    EVALUATE: 'What would make the result good? (e.g. mobile-friendly, clear call-to-action, accessible)',
    ITERATE: 'How should the AI handle refinement? (e.g. "show 3 variations", "ask me questions first") — or say "skip" for a sensible default',
  };
  const DESIGN_PROMPT_STEPS = ['TASK', 'CONTEXT', 'REFERENCES', 'EVALUATE', 'ITERATE'];
  function buildTcreiPrompt(answers) {
    const references = answers.references || 'None provided — use your best judgement for a clean, modern style.';
    const iterate = answers.iterate || 'Ask clarifying questions if anything is ambiguous, then produce one version. After I give feedback, refine it rather than starting over.';
    return '```text\nTASK\n' + answers.task
      + '\n\nCONTEXT\n' + answers.context
      + '\n\nREFERENCES\n' + references
      + '\n\nEVALUATE\n' + answers.evaluate
      + '\n\nITERATE\n' + iterate
      + '\n```';
  }

  // Generic "ask a few short questions, then compile" flows — same shape as the TCREI prompt generator above,
  // factored out because this adds 7 of them at once. Each flow: a trigger regex (optional captured seed text
  // for step 0), an ordered list of {key, q, skippable?, validate?, invalidMsg?} steps, and a finish(answers)
  // that returns the final reply (sync object or a Promise). STUDY_PLAN has no `finish` here — its answers need
  // `executeTool`, which only exists in script.js, so script.js supplies that one specially.
  const GUIDED_FLOWS = {
    COMMIT_MSG: {
      match: /^(?:help me\s+)?(?:write|generate|create|make)\s+(?:me\s+)?(?:a\s+)?(?:git\s+)?commit\s+message\b(?:\s+for\s+(.+))?$/i,
      steps: [
        { key: 'description', q: 'What changed, in one short line?' },
        { key: 'type', q: 'What kind of change is this — feat, fix, refactor, docs, test, chore, perf, or style?' },
        { key: 'scope', q: 'What part of the project does this touch? (e.g. "auth", "parser") — or say "skip"', skippable: true },
        { key: 'why', q: 'Why was this needed? (or say "skip")', skippable: true },
      ],
      finish: (a) => {
        const type = (a.type || 'chore').toLowerCase().replace(/[^a-z]/g, '') || 'chore';
        const head = a.scope ? type + '(' + a.scope + '): ' + a.description : type + ': ' + a.description;
        return { text: 'Here’s your commit message:\n\n```text\n' + head + (a.why ? '\n\n' + a.why : '') + '\n```', noPersona: true };
      },
    },
    BUG_REPORT: {
      match: /^(?:help me\s+)?(?:write|file|generate|create)\s+(?:me\s+)?(?:a\s+)?bug\s+report\b(?:\s+for\s+(.+))?$/i,
      steps: [
        { key: 'steps', q: 'What were you doing when it happened? (steps to reproduce)' },
        { key: 'expected', q: 'What did you expect to happen?' },
        { key: 'actual', q: 'What actually happened?' },
        { key: 'environment', q: 'What’s the environment? (OS, browser, version) — or say "skip"', skippable: true },
      ],
      finish: (a) => ({ text: 'Here’s your bug report:\n\n```text\n## Steps to Reproduce\n' + a.steps
        + '\n\n## Expected Behavior\n' + a.expected + '\n\n## Actual Behavior\n' + a.actual
        + '\n\n## Environment\n' + (a.environment || 'Not specified.') + '\n```', noPersona: true }),
    },
    RESUME_BULLET: {
      match: /^(?:help me\s+)?(?:write|generate|create|make)\s+(?:me\s+)?(?:a\s+)?(?:star\s+)?resume\s+bullet\b(?:\s+for\s+(.+))?$/i,
      steps: [
        { key: 'situation', q: 'What was the situation or context?' },
        { key: 'task', q: 'What was your specific responsibility or goal?' },
        { key: 'action', q: 'What did you actually do?' },
        { key: 'result', q: 'What was the outcome or impact? (numbers help, e.g. "40% faster")' },
      ],
      finish: (a) => ({ text: 'Here’s your STAR draft — paste it into an AI tool to turn it into a punchy one-line bullet, or use it as-is:\n\n```text\nSITUATION\n' + a.situation
        + '\n\nTASK\n' + a.task + '\n\nACTION\n' + a.action + '\n\nRESULT\n' + a.result + '\n```', noPersona: true }),
    },
    STANDUP: {
      match: /^(?:help me\s+)?(?:write|generate|create|format|make)\s+(?:me\s+)?(?:a\s+|my\s+)?standup(?:\s+update)?\b/i,
      steps: [
        { key: 'yesterday', q: 'What did you do yesterday (or last session)?' },
        { key: 'today', q: 'What are you working on today?' },
        { key: 'blockers', q: 'Any blockers? (or say "none")', skippable: true },
      ],
      finish: (a) => ({ text: 'Here’s your standup update:\n\n```text\nYesterday: ' + a.yesterday
        + '\nToday: ' + a.today + '\nBlockers: ' + (a.blockers || 'None') + '\n```', noPersona: true }),
    },
    STUDY_PLAN: {
      match: /^(?:help me\s+)?(?:make|create|build|plan)\s+(?:me\s+)?(?:a\s+)?study\s+plan\b(?:\s+for\s+(?:my\s+)?(.+))?$/i,
      steps: [
        { key: 'title', q: 'What exam or subject are you studying for?' },
        { key: 'due', q: 'When is it?', validate: raw => !!NLU.parseDate(raw.toLowerCase()), invalidMsg: 'I didn’t catch a date — try "Friday", "next Monday", or a specific date.' },
        { key: 'topics', q: 'What topics do you need to cover? (comma-separated)' },
      ],
      // no finish() — script.js's finishStudyPlan() handles this one.
    },
    WEEKLY_JOURNAL: {
      match: /^(?:help me\s+)?(?:write|save|create|log)\s+(?:me\s+)?(?:a\s+|my\s+)?(?:weekly\s+)?(?:reflection|journal)(?:\s+entry)?\b/i,
      steps: [
        { key: 'good', q: 'What went well this week?' },
        { key: 'bad', q: 'What didn’t go well?' },
        { key: 'change', q: 'What will you change next week?' },
      ],
      finish: async (a) => {
        await registry();
        const stamp = new Date().toISOString().slice(0, 10);
        const content = '# Weekly Reflection — ' + stamp + '\n\n## What went well\n' + a.good
          + '\n\n## What didn’t\n' + a.bad + '\n\n## What I’ll change\n' + a.change + '\n';
        const calls = [['create_folder', { name: 'Journal' }], ['write_note', { name: 'Journal/' + stamp + '.md', content }]];
        const steps = [];
        for (const [tool, args] of calls) {
          const j = await callTool('/agent/validate', { tool, args });
          if (!j.ok) return { text: 'I couldn’t save that — ' + (j.reason || tool + ' is not available') + '.', noPersona: true };
          steps.push(fromTool(Object.assign({}, j.step, { id: 'step_' + (steps.length + 1) })));
        }
        return execute({ goal: 'Save weekly reflection', steps }, { source: 'planner', stopOnFail: true });
      },
    },
    INTERVIEW_PREP: {
      match: /^(?:help me\s+)?(?:generate|create|make|build|write)\s+(?:me\s+)?(?:an?\s+)?interview\s+(?:question(?:s)?(?:\s+bank)?|prep)\b(?:\s+for\s+(.+))?$/i,
      steps: [
        { key: 'role', q: 'What role or topic should I prep you for? (e.g. "backend intern", "DSA rounds", "system design")' },
        { key: 'round', q: 'Which round — behavioral, DSA, system design, or general? (or say "skip" for a mix)', skippable: true },
      ],
      finish: async (a) => {
        if (!llmReady()) return { text: 'The local AI isn’t available right now, so I can’t generate questions.', noPersona: true };
        const ai = await askLLM('Generate 8 realistic interview practice questions for ' + a.role + ', focused on '
          + (a.round || 'a mix of behavioral and technical topics') + '. Reply with ONLY a numbered list of questions, no preamble.', { noTools: true });
        if (!ai) return { text: 'The local AI is unavailable right now.', noPersona: true };
        return { text: 'Practice questions for **' + a.role + '**:\n\n' + ai.text, noPersona: true };
      },
    },
    PROJECT_POST: {
      match: /^(?:help me\s+)?(?:write|draft|generate|create)\s+(?:me\s+)?(?:a\s+)?(?:linkedin|twitter|project)\s+post\b(?:\s+(?:for|about)\s+(.+))?$/i,
      steps: [
        { key: 'project', q: 'What’s the project, and what does it do?' },
        { key: 'challenge', q: 'What was the hardest part, or what did you learn? (or say "skip")', skippable: true },
        { key: 'link', q: 'Any link to include — GitHub, live demo? (or say "skip")', skippable: true },
      ],
      finish: async (a) => {
        if (!llmReady()) return { text: 'The local AI isn’t available right now, so I can’t draft this.', noPersona: true };
        const ai = await askLLM('Write a short, genuine-sounding project announcement post (LinkedIn/Twitter style) about: ' + a.project + '.'
          + (a.challenge ? ' Worth mentioning: ' + a.challenge + '.' : '') + (a.link ? ' Include this link naturally: ' + a.link + '.' : '')
          + ' Keep it under 120 words, first person, no corporate buzzwords. Reply with ONLY the post text.', { noTools: true });
        if (!ai) return { text: 'The local AI is unavailable right now.', noPersona: true };
        return { text: 'Here’s a draft:\n\n```text\n' + ai.text.trim() + '\n```', noPersona: true };
      },
    },
  };
  function matchGuidedFlow(text) {
    for (const [id, flow] of Object.entries(GUIDED_FLOWS)) {
      const m = String(text || '').trim().match(flow.match);
      if (m) return { id, seed: (m[1] || '').trim() };
    }
    return null;
  }

  // "Why did you do that?" — assembled only from what actually happened (the last run's stored goal/reason/
  // label), never a fresh LLM guess, per the transparency principle behind the whole tier system.
  function explainLastAction(text) {
    const runs = lastRuns(1);
    if (!runs.length) return { text: 'I haven’t run anything yet this session.', noPersona: true };
    const run = runs[0];
    const s = String(text || '').toLowerCase();
    const named = run.steps.find(st => {
      const key = String(st.label || '').toLowerCase().replace(/^(open|close|start|stop|create|write|run|locate|check|stop the|start the)\s+(?:the\s+|a\s+|an\s+)?/, '').replace(/["'`]/g, '').trim();
      return key.length > 2 && s.includes(key);
    });
    if (named) {
      const idx = run.steps.indexOf(named) + 1;
      const why = named.reason ? 'because ' + named.reason.charAt(0).toLowerCase() + named.reason.slice(1)
        : 'it was step ' + idx + ' of ' + run.steps.length + ' in the plan to ' + (run.goal || 'do what you asked') + '.';
      return { text: '**' + named.label + '** — ' + why, noPersona: true };
    }
    const labels = run.steps.map(st => st.label).join(', ');
    return { text: 'You asked me to: "' + (run.goal || 'run ' + plural(run.steps.length, 'step')) + '". I ran ' + plural(run.steps.length, 'step') + ': ' + labels + '.', noPersona: true };
  }

  /* ---------- command learning: a phrase confirmed once is replayed directly next time, no AI call ---------- */
  const LEARNED_KEY = 'jarvis.learned';
  const learnedList = () => store.get(LEARNED_KEY, []);
  const learnedKey = text => NLU.normalize(text, settings.wakeWord).text;
  function learnedMatch(text) {
    return learnedList().find(e => e.phrase === learnedKey(text)) || null;
  }
  function learnSave(text, plan) {
    const phrase = learnedKey(text);
    const list = learnedList().filter(e => e.phrase !== phrase);
    list.push({ phrase, original: text, goal: plan.goal || '', steps: plan.steps.map(s => ({ tool: s.tool, args: s.args })),
      label: plan.steps.map(s => s.label).join(', '), createdAt: Date.now(), uses: 0 });
    while (list.length > 200) list.shift();
    store.set(LEARNED_KEY, list);
  }
  /* ---------- misses & taught phrases ---------- */
  // Phrases the rules didn't understand (sent to the AI planner) or that you corrected ("no, that's wrong") — the
  // raw material for new rules, collected from real use instead of guessed. "What didn't you understand?" lists
  // them; TEACH maps one to a command you type, which then runs through the normal pipeline (rules → preview →
  // permission → verify) — an alias, never a stored tool call that could bypass the checks.
  const MISS_KEY = 'jarvis.misses', ALIAS_KEY = 'jarvis.aliases';
  const aliasList = () => store.get(ALIAS_KEY, []);
  const aliasMatch = text => aliasList().find(a => a.phrase === learnedKey(text)) || null;
  function recordMiss(text, how) {
    const phrase = learnedKey(text);
    if (!phrase || phrase.length < 3 || aliasMatch(text) || learnedMatch(text)) return;
    const list = store.get(MISS_KEY, []).filter(m => m.phrase !== phrase);
    list.push({ phrase, original: String(text).slice(0, 120), how, at: Date.now() });
    while (list.length > 30) list.shift();
    store.set(MISS_KEY, list);
  }
  const missList = () => store.get(MISS_KEY, []).filter(m => !aliasMatch(m.original) && !learnedMatch(m.original)).reverse();
  const forgetMiss = phrase => store.set(MISS_KEY, store.get(MISS_KEY, []).filter(m => m.phrase !== phrase));
  // → { ok, text }
  function teach(phrase, command) {
    const cmd = String(command || '').trim().replace(/^["']|["']$/g, '');
    const key = learnedKey(phrase);
    if (!cmd) return { ok: false, text: 'Tell me the command to run, e.g. "set volume to 30".' };
    if (learnedKey(cmd) === key) return { ok: false, text: 'That’s the same phrase — tell me a command I already understand.' };
    if (aliasMatch(cmd)) return { ok: false, text: '“' + cmd + '” is itself a taught phrase — use the command it stands for.' };
    const list = aliasList().filter(a => a.phrase !== key);
    list.push({ phrase: key, original: String(phrase).slice(0, 120), command: cmd.slice(0, 300), at: Date.now() });
    while (list.length > 100) list.shift();
    store.set(ALIAS_KEY, list); forgetMiss(key);
    return { ok: true, text: '✓ From now on, “' + phrase + '” means **' + cmd + '**. Say "forget what you’ve learned" to clear taught phrases.' };
  }
  function forgetLearned(phrase) { store.set(LEARNED_KEY, learnedList().filter(e => e.phrase !== phrase)); }
  function forgetAllLearned() { store.set(LEARNED_KEY, []); store.set(ALIAS_KEY, []); }
  const learnedCount = () => learnedList().length + aliasList().length;
  function learnedSummary() {
    const list = learnedList().map(e => ({ original: e.original, label: e.label, uses: e.uses, at: e.createdAt }))
      .concat(aliasList().map(a => ({ original: a.original, label: a.command, at: a.at }))).sort((x, y) => x.at - y.at);
    if (!list.length) return { text: 'I haven’t learned any new phrases yet.', noPersona: true };
    return { text: 'I’ve learned ' + plural(list.length, 'phrase') + ':\n' + list.slice(-10).reverse().map(e => '- "' + e.original + '" → ' + e.label + (e.uses ? ' (used ' + plural(e.uses, 'time') + ')' : '')).join('\n'), noPersona: true };
  }
  // Every step is re-validated (never trust stored args blindly — the allowlist/schemas may have moved on).
  async function runLearned(entry, text) {
    await registry();
    const steps = [];
    for (const call of entry.steps) {
      const j = await callTool('/agent/validate', { tool: call.tool, args: call.args });
      if (!j.ok) { forgetLearned(entry.phrase); return failure(text, 'a command I learned earlier no longer works (' + (j.reason || 'unknown problem') + ') — I’ve forgotten it, please teach me again'); }
      steps.push(fromTool(Object.assign({}, j.step, { id: 'step_' + (steps.length + 1) })));
    }
    const list = learnedList(); const rec = list.find(e => e.phrase === entry.phrase); if (rec) { rec.uses = (rec.uses || 0) + 1; store.set(LEARNED_KEY, list); }
    return execute({ goal: entry.goal, steps }, { source: 'learned', stopOnFail: true });
  }
  function failure(text, reason) {
    return { text: 'I couldn’t build a safe plan for that — ' + reason + '. Nothing was changed.', intent: 'AGENT_FAILED', noPersona: true,
      suggestions: ['Try: open VS Code, then start a 25 minute focus session'], actions: [{ label: 'RETRY', fn: () => handleUser(text, 'text') }, { label: 'JUST ANSWER IT', fn: () => { ctx.answerOnly = true; handleUser(text, 'text'); } }] };
  }
  // Ask the planner. Action requests never fall back to the chat model.
  async function plan(text, tRoute) {
    setState('PROCESSING', 'Planning…');
    const t0 = performance.now();
    const j = await callTool('/agent/plan', { text, model: llm.model || undefined });
    const ms = performance.now() - t0;
    if (j.empty) return null;                                // the planner says it isn't an action → normal chat path
    if (!j.ok) {
      log('warn', 'plan rejected: ' + (j.reason || j.error) + ' (' + Math.round(ms) + 'ms)');
      return failure(text, j.reason || j.error || 'unknown problem');
    }
    const steps = j.plan.steps.map(fromTool);
    // A single guessed step for a phrase the rules don't know: confirm the interpretation once — folding in
    // the tool's own risk reason so there's one card, not two — then remember it for next time.
    if (steps.length === 1 && !learnedMatch(text)) {
      const s = steps[0];
      busy = false; idleState();
      const go = await new Promise(resolve => jarvisSay({
        text: 'I don’t have a command for that yet — my best guess is: **' + s.label + '**.' + (s.tier !== 'safe' ? '\n*' + s.reason + '*' : '') + '\n\nRun it, and remember this phrase means this from now on?',
        intent: 'AGENT_LEARN', noPersona: true,
        confirm: { yes: 'YES, DO THAT', no: 'NO', onConfirm: () => resolve(true), onCancel: () => resolve(false) } }));
      if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 50); });
      busy = true;
      if (!go) return { text: 'Okay — tell me what you meant and I’ll try again.', intent: 'AGENT_LEARN', noPersona: true };
      learnSave(text, { goal: j.plan.goal, steps });
      return execute({ goal: j.plan.goal, steps }, { source: 'learned-new', ms_route: tRoute, ms_plan: ms, stopOnFail: true, preApproved: true });
    }
    return execute({ goal: j.plan.goal, steps }, { source: 'planner', ms_route: tRoute, ms_plan: ms, stopOnFail: true, learn: { text } });
  }
  // One tool call chosen by the chat model: validate on the server, gate it, run it, verify it.
  async function chatTool(tool, args, tRoute) {
    const j = await callTool('/agent/validate', { tool, args });
    if (!j.ok) {
      log('warn', 'AI tool call rejected: ' + (j.reason || j.error));
      return { text: 'The AI suggested an action I can’t run safely — ' + (j.reason || j.error) + '. Nothing was changed.', intent: 'AGENT_FAILED', noPersona: true };
    }
    return execute({ goal: '', steps: [fromTool(j.step)] }, { source: 'chat', ms_route: tRoute, stopOnFail: true });
  }
  // Unattended steps (routines): rule-engine commands, anything not "safe" is skipped.
  async function runUnattended(name, stepTexts) {
    await registry();
    const steps = stepTexts.map((x, i) => {
      const n = NLU.normalize(x, settings.wakeWord); const p = NLU.classify(n, ctx); p.original = n.original; p.step = x;
      const s = fromRule(p, i);
      if (!known(p)) { s.tier = 'unknown'; s.reason = 'not a command I know'; }
      return s;
    });
    // Nobody is watching a routine/trigger run: changes outside ~/jarvis are refused, not asked about (script.js callTool).
    if (typeof approvalsBlocked !== 'undefined') approvalsBlocked++;
    try { return await execute({ goal: cap(name), steps }, { source: 'routine', unattended: true }); }
    finally { if (typeof approvalsBlocked !== 'undefined') approvalsBlocked--; }
  }
  // Background check after a single rule-engine open/close: never delays the reply; speaks up only on failure.
  function watchSingle(p, prePromise) {
    if (!/^(OPEN_APPLICATION|CLOSE_APPLICATION)$/.test(p.intent)) return;
    const s = { intent: p.intent, args: p.args || {}, text: p.text };
    (async () => {
      const pre = await prePromise;
      if (!pre || !pre.app) return;
      const v = await verify(s, null, pre);
      log(v.status === 'failed' ? 'warn' : 'agent', 'check: ' + (v.note || v.status));
      if (v.status === 'failed') jarvisSay({ text: '⚠ ' + cap(v.note) + '.', intent: 'AGENT_CHECK', noPersona: true });
    })();
  }
  function preSingle(p) {
    if (!/^(OPEN_APPLICATION|CLOSE_APPLICATION)$/.test(p.intent)) return null;
    const app = (NLU.findApp((p.args && p.args.app) || p.text || '') || {}).k;
    return app ? appState(app).then(running => ({ app, running })) : null;
  }
  function history() {
    const runs = lastRuns(3);
    if (!runs.length) return { text: 'I haven’t run any multi-step plans yet.' };
    return { text: 'My last ' + plural(runs.length, 'run') + ':\n' + runs.map(r => '- `' + r.id + '` ' + (r.goal || r.source) + ' — ' + r.steps.map(s => ICON[s.status] + ' ' + s.tool).join(', ') + ' · ' + (r.total / 1000).toFixed(1) + 's').join('\n'), noPersona: true };
  }

  registry();
  return { route, parts, optimize, splitGoal, annotate, DISTRACTORS, isAction, wantsAction, isQuestion, execute, handleMulti, plan, chatTool, runUnattended, watchSingle, preSingle, history, registry, tierFor, lastRuns, envGoal, prepareEnvironment,
    learnedMatch, learnSave, runLearned, learnedSummary, forgetAllLearned, learnedCount, recordMiss, missList, forgetMiss, aliasMatch, teach, learnGoal, learnLanguage,
    createProjectGoal, createProject, explainLastAction, LEARN_LANG_MAP,
    designPromptGoal, buildTcreiPrompt, DESIGN_PROMPT_QUESTIONS, DESIGN_PROMPT_STEPS,
    GUIDED_FLOWS, matchGuidedFlow };
})();
