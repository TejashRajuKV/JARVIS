'use strict';
/* JARVIS agent tool registry — the single authority for what the AI may ask JARVIS to do.
   Everything the model outputs (a one-tool call or a multi-step plan) is checked here before the page runs it:
   the tool must exist, every argument must pass its schema, and the permission tier comes from this file,
   never from the model. Endpoints keep their own checks too (app allowlist, volume clamp, sandboxed paths). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function agentTools({ APPS, safePath, llm, DEFAULT_MODEL }) {
  // The page's NLU (app names, date parsing) — loaded once so the server validates with the same rules.
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'nlu.js'), 'utf8') + ';this.NLU = NLU;', sandbox);
  const NLU = sandbox.NLU;

  /* ---------- argument schemas ---------- */
  const T = {
    app: { type: 'app' },
    text: (max = 200) => ({ type: 'string', max }),
    num: (min, max) => ({ type: 'number', min, max }),
    oneOf: (...values) => ({ type: 'enum', values }),
    bool: { type: 'bool' },
    url: { type: 'url' },
    path: { type: 'path' },
    when: { type: 'when' },
    // a place on the laptop: "desktop", "D drive", "C:\Users\me\Projects", "laptop" — any write there still asks first
    place: { type: 'place' },
  };
  const req = s => Object.assign({ required: true }, s);

  // tier: safe = runs (also in routines) · confirm = asks first, with the reason; skipped when unattended
  //       explicit = its own confirmation card when it runs; never unattended · (not listed) = blocked
  // plan: false = allowed as a single chat tool call, but not as a step inside a plan
  // check: how the page verifies the specific operation afterwards
  const TOOLS = {
    open_app: { intent: 'OPEN_APPLICATION', desc: 'open a desktop app (chrome, vscode, notepad, spotify, whatsapp, calculator, terminal, word, excel, ...)', args: { app: req(T.app) }, check: 'app_started' },
    close_app: { intent: 'CLOSE_APPLICATION', desc: 'close a running app', args: { app: req(T.app) }, tier: 'confirm', reason: 'This closes the app; unsaved work in it may be lost.', check: 'app_closed' },
    open_url: { intent: 'OPEN_URL', desc: 'open a website', args: { url: req(T.url) } },
    youtube: { intent: 'YOUTUBE', desc: 'play a song, artist, playlist or video (preferred for any "play X" / "put on X" music request)', args: { query: req(T.text(150)) } },
    web_search: { intent: 'WEB_SEARCH', desc: 'search Google in the browser', args: { query: req(T.text(200)) } },
    weather: { intent: 'WEATHER', desc: 'current weather', args: { city: T.text(60) } },
    set_timer: { intent: 'SET_TIMER', desc: 'countdown timer', args: { seconds: req(T.num(1, 86400)), label: T.text(40) }, check: 'timer' },
    remind: { intent: 'REMIND', desc: 'reminder; "when" is natural language like "in 20 minutes", "tomorrow at 9am" or a repeat like "every year in july"', args: { text: req(T.text(200)), when: req(T.when) }, check: 'reminder' },
    add_todo: { intent: 'ADD_TODO', desc: 'add to the to-do list', args: { text: req(T.text(200)) }, check: 'todo' },
    list_todos: { intent: 'LIST_TODOS', desc: 'show the to-do list', args: {} },
    add_deadline: { intent: 'ADD_DEADLINE', desc: 'assignment/exam deadline; "due" natural language like "friday" or "25 oct"', args: { title: req(T.text(120)), due: req(T.text(60)) } },
    list_deadlines: { intent: 'LIST_DEADLINES', desc: '', args: {} },
    add_class: { intent: 'ADD_CLASS', desc: 'add a class to the weekly timetable', args: { name: req(T.text(80)), day: req(T.text(20)), time: req(T.text(20)) } },
    next_class: { intent: 'NEXT_CLASS', desc: '', args: {} },
    focus: { intent: 'FOCUS_START', desc: 'start a Pomodoro focus session', args: { minutes: T.num(1, 240) }, check: 'focus' },
    volume: { intent: 'VOLUME', desc: 'action: up | down | mute | unmute', args: { action: req(T.oneOf('up', 'down', 'mute', 'unmute')) } },
    media: { intent: 'MEDIA', desc: 'key: play | next | prev | stop', args: { key: req(T.oneOf('play', 'next', 'prev', 'stop')) } },
    screenshot: { intent: 'SCREENSHOT', desc: '', args: {} },
    battery: { intent: 'SYS_BATTERY', desc: '', args: {} },
    system_info: { intent: 'SYS_ALL', desc: 'CPU, RAM, disk', args: {} },
    processes: { intent: 'SYS_PROCESSES', desc: 'top running processes', args: {} },
    lock: { intent: 'SYS_LOCK', desc: 'lock the screen', args: {} },
    network: { intent: 'SYS_NETWORK', desc: 'IP address', args: {} },
    write_note: { intent: 'WRITE_FILE', desc: 'save text into a file in the ~/jarvis sandbox', args: { name: req(T.path), content: req(T.text(20000)) }, check: 'file' },
    read_file: { intent: 'READ_FILE', desc: '', args: { name: req(T.path) } },
    list_files: { intent: 'LIST_FILES', desc: 'list the folders and files in a place ("dir": desktop, D drive, a full path; empty = ~/jarvis)', args: { dir: T.place } },
    count_folders: { intent: 'COUNT_FOLDERS', desc: 'count folders and files on the laptop or in a place ("scope": laptop, D drive, desktop, a full path)', args: { scope: T.place } },
    create_folder: { intent: 'CREATE_FOLDER', desc: 'create a folder ("where": desktop, D drive or a full path; empty = ~/jarvis)', args: { name: req(T.path), where: T.place } },
    git_status: { intent: 'GIT_STATUS', desc: '', args: {} },
    briefing: { intent: 'BRIEFING', desc: 'daily briefing', args: {} },
    save_code: { intent: 'SAVE_CODE', desc: 'save the most recent code block from this chat into a file (e.g. "bfs.py")', args: { name: T.path }, check: 'file' },
    run_file: { intent: 'RUN_FILE', desc: 'run a .py/.js/.c/.cpp file and show its output ("it" = the last file)', args: { name: T.path }, tier: 'confirm', reason: 'This runs a program on your laptop.' },
    open_in_editor: { intent: 'OPEN_IN_EDITOR', desc: 'open a file or project folder in VS Code', args: { name: T.path } },
    code_ask: { intent: 'CODE_ASK', desc: 'open a coding tool (vscode/copilot, kiro, trae, antigravity, devin, opencode, claude, gemini, codex, qwen, codebuff) in a project folder and hand its AI a prompt', args: { tool: req(T.oneOf('vscode', 'kiro', 'trae', 'antigravity', 'devin', 'opencode', 'claude', 'gemini', 'codex', 'qwen', 'codebuff')), folder: T.path, prompt: req(T.text(2000)) }, tier: 'confirm', reason: 'This sends your request to a coding AI that can edit files in that folder.' },
    clipboard_to_file: { intent: 'CLIPBOARD_TO_FILE', desc: 'save the clipboard contents into a file', args: { name: T.path }, check: 'file' },
    copy_code: { intent: 'COPY_CONTENT', desc: 'copy the most recent code block to the clipboard', args: {} },
    paste_to_editor: { intent: 'PASTE_TO_EDITOR', desc: "copy the most recent code and paste it into the user's active window after a countdown", args: {}, tier: 'confirm', reason: 'This types into whichever window is in front.' },
    save_snippet: { intent: 'SNIPPET_SAVE', desc: 'save the most recent code as a named snippet', args: { name: req(T.text(40)) } },
    copy_snippet: { intent: 'SNIPPET_COPY', desc: 'copy a saved snippet to the clipboard', args: { name: req(T.text(40)) } },
    block_distractions: { intent: 'BLOCK_DISTRACTIONS', desc: 'close distracting apps and start a focus session', args: {}, tier: 'confirm', reason: 'This closes apps like WhatsApp, Discord and Spotify.' },
    show_desktop: { intent: 'SHOW_DESKTOP', desc: 'minimise all windows', args: {} },
    productivity_report: { intent: 'PRODUCTIVITY_REPORT', desc: 'what the user got done today', args: {} },
    open_best: { intent: 'OPEN_WEB', desc: 'open the best web page for something (e.g. "SIH 2026 problem statements", "GATE syllabus")', args: { query: req(T.text(150)) } },
    research: { intent: 'RESEARCH', desc: 'search the web and answer with sources (for current facts)', args: { query: req(T.text(200)) } },
    contests: { intent: 'CONTESTS', desc: 'upcoming programming contests', args: { platform: T.oneOf('codeforces', 'leetcode', 'codechef', 'all') } },
    plan_day: { intent: 'PLAN_DAY', desc: 'build a schedule for the rest of today', args: {} },
    ask_files: { intent: 'ASK_FILES', desc: "answer a question from the contents of the user's own notes/files/projects (searches them locally and cites the file names)", args: { query: req(T.text(300)) } },
    summarise_file: { intent: 'SUMMARISE_FILE', desc: "summarise one of the user's files", args: { name: req(T.path) } },
    make_flashcards: { intent: 'FLASH_MAKE', desc: 'create flashcards from a file ("that" = the last answer)', args: { name: T.text(120) } },
    review_flashcards: { intent: 'FLASH_REVIEW', desc: 'quiz the user with their flashcards', args: { deck: T.text(60) } },
    clone_repo: { intent: 'GIT_CLONE', desc: 'git clone a GitHub/GitLab repo into the project folder', args: { url: req(T.url) }, tier: 'confirm', reason: 'This downloads code from the internet onto your laptop.', plan: false },
    run_routine: { intent: 'ROUTINE_RUN', desc: 'run one of the user\'s routines (e.g. "study mode", "morning", "bedtime")', args: { name: req(T.text(40)) }, plan: false },
    set_theme: { intent: 'THEME_SET', desc: 'HUD colour theme', args: { theme: req(T.oneOf('arc', 'gold', 'crimson', 'violet')) } },
    switch_persona: { intent: 'PERSONA_SET', desc: '', args: { persona: req(T.oneOf('jarvis', 'friday')) } },
    diagnostics: { intent: 'DIAGNOSTICS', desc: 'full systems check report', args: {} },
    read_screen: { intent: 'SCREEN_READ', desc: "read the text on the user's screen (explain: true to explain/fix what is shown)", args: { explain: T.bool }, tier: 'confirm', reason: 'This captures everything visible on your screen, including anything private.' },
    brightness: { intent: 'BRIGHTNESS', desc: 'screen brightness 0-100', args: { level: req(T.num(0, 100)) }, check: 'brightness' },
    dark_mode: { intent: 'DARK_MODE', desc: 'true = dark mode, false = light mode', args: { on: req(T.bool) }, check: 'theme' },
    set_volume: { intent: 'VOLUME_SET', desc: 'exact volume 0-100', args: { level: req(T.num(0, 100)) }, check: 'volume' },
    arrange_window: { intent: 'WINDOW_LAYOUT', desc: '', args: { app: req(T.app), position: req(T.oneOf('left', 'right', 'top', 'bottom', 'maximize', 'minimize')) } },
    locate_project: { intent: 'LOCATE_PROJECT', desc: 'find a project folder by name among the user\'s project folders (Settings → Project folders) — use this before opening or starting a project', args: { name: req(T.text(100)) }, check: 'project_found' },
    start_process: { intent: 'START_PROCESS', desc: 'start a project\'s backend or frontend dev server. The command is never invented — it only ever comes from that project\'s own package.json "dev"/"start"/"serve" script, or a known entry file (manage.py, app.py); fails cleanly if none exists', args: { name: req(T.text(100)), which: req(T.oneOf('backend', 'frontend', 'app')) }, tier: 'confirm', reason: 'This starts a long-running dev server process on your laptop.', check: 'process_running' },
    stop_process: { intent: 'STOP_PROCESS', desc: 'stop a dev server JARVIS previously started for a project', args: { name: req(T.text(100)), which: req(T.oneOf('backend', 'frontend', 'app')) }, tier: 'confirm', reason: 'This stops a running dev server; unsaved state in it will be lost.', check: 'process_stopped' },
    open_project_url: { intent: 'OPEN_PROJECT_URL', desc: 'open the browser at the local port a project\'s frontend (or app) is currently running on', args: { name: req(T.text(100)), which: T.oneOf('backend', 'frontend', 'app') }, check: 'browser_url' },
    distance: { intent: 'DISTANCE', desc: 'driving distance and travel time between two places', args: { from: req(T.text(100)), to: req(T.text(100)) } },
    directions: { intent: 'DIRECTIONS', desc: 'turn-by-turn driving directions between two places, shown as text', args: { from: req(T.text(100)), to: req(T.text(100)) } },
    open_directions: { intent: 'DIRECTIONS_OPEN', desc: 'open driving directions between two places in the browser (Google Maps)', args: { from: req(T.text(100)), to: req(T.text(100)) } },
    check_compiler: { intent: 'CHECK_COMPILER', desc: 'check whether a compiler/runtime for a language is installed', args: { language: req(T.oneOf('python', 'cpp', 'c', 'javascript')) } },
    check_extension: { intent: 'CHECK_EXTENSION', desc: 'check whether the recommended VS Code extension for a language is installed', args: { language: req(T.oneOf('python', 'cpp', 'c', 'javascript')) } },
    check_exists: { intent: 'CHECK_EXISTS', desc: 'check whether a file or folder exists in the sandbox or project folders', args: { name: req(T.path) } },
    attendance_mark: { intent: 'ATTENDANCE_MARK', desc: 'record a class as attended (status: present) or missed (status: absent) for a subject', args: { subject: req(T.text(60)), status: req(T.oneOf('present', 'absent')) }, check: 'attendance' },
    attendance_report: { intent: 'ATTENDANCE_REPORT', desc: 'attendance percentage per subject and how many classes can still be skipped above the 75% line', args: {} },
    bunk_check: { intent: 'BUNK_CHECK', desc: 'how many classes of a subject can still be skipped without falling below the attendance threshold', args: { subject: T.text(60) } },
    add_marks: { intent: 'ADD_MARKS', desc: 'save one semester result: name (e.g. "S3"), grade point average 0-10 and total credits', args: { title: req(T.text(80)), gpa: req(T.num(0, 10)), credits: req(T.num(1, 60)) }, check: 'marks' },
    cgpa_report: { intent: 'CGPA_REPORT', desc: 'current SGPA/CGPA from the saved semester results', args: {} },
  };
  for (const t of Object.values(TOOLS)) t.tier = t.tier || 'safe';

  // Rule-engine intents that are not model tools but can appear as steps of a split command ("save it and shut down").
  const INTENT_TIERS = {
    SYS_SHUTDOWN: ['explicit', 'This shuts the computer down; unsaved work in other apps will be lost.'],
    SYS_RESTART: ['explicit', 'This restarts the computer; unsaved work in other apps will be lost.'],
    SYS_SLEEP: ['explicit', 'This puts the computer to sleep.'],
    DESTRUCTIVE: ['explicit', 'This moves everything in the sandbox to the trash.'],
    DELETE_ITEM: ['explicit', 'This moves a file or folder to the trash.'],
    CLEAR_TODOS: ['explicit', 'This removes items from your to-do list.'],
    FLASH_DELETE: ['explicit', 'This deletes a flashcard deck.'],
    SNIPPET_DELETE: ['explicit', 'This deletes a saved snippet.'],
    GIT_COMMIT: ['confirm', 'This commits all changes in the project.'],
    GIT_CLONE: ['confirm', 'This downloads code from the internet onto your laptop.'],
    DISPLAY_OFF: ['confirm', 'This turns the screen off.'],
    CLOSE_APPLICATION: ['confirm', 'This closes the app; unsaved work in it may be lost.'],
    BLOCK_DISTRACTIONS: ['confirm', 'This closes apps like WhatsApp, Discord and Spotify.'],
    RUN_FILE: ['confirm', 'This runs a program on your laptop.'],
    PASTE_TO_EDITOR: ['confirm', 'This types into whichever window is in front.'],
    SCREEN_READ: ['confirm', 'This captures everything visible on your screen, including anything private.'],
    SCREEN_EXPLAIN: ['confirm', 'This captures everything visible on your screen, including anything private.'],
    WIFI_OFF: ['confirm', 'This disconnects the internet; online tools stop until it is back.'],
    START_PROCESS: ['confirm', 'This starts a long-running dev server process on your laptop.'],
    STOP_PROCESS: ['confirm', 'This stops a running dev server; unsaved state in it will be lost.'],
    TRIGGER_CREATE: ['confirm', 'This sets up something that will run automatically later.'],
    CODE_ASK: ['confirm', 'This sends your request to a coding AI that can edit files in that folder.'],
    LEARN_FORGET_ALL: ['confirm', 'This clears every phrase you’ve taught me.'],
  };
  // Routines can't run inside another plan (no nesting, no loops).
  const NO_NESTING = new Set(['ROUTINE_RUN', 'ROUTINE_CREATE', 'ROUTINE_DELETE', 'ROUTINE_SCHEDULE']);

  /* ---------- validation ---------- */
  function checkArg(spec, v) {
    if (v === undefined || v === null || v === '') return spec.required ? { err: 'missing' } : { skip: true };
    switch (spec.type) {
      case 'string': {
        const s = String(v).trim();
        if (!s) return spec.required ? { err: 'empty' } : { skip: true };
        if (s.length > spec.max) return { err: 'longer than ' + spec.max + ' characters' };
        return { v: s };
      }
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) return { err: 'not a number' };
        if (n < spec.min || n > spec.max) return { err: 'must be ' + spec.min + '–' + spec.max };
        return { v: n };
      }
      case 'enum': {
        const s = String(v).trim().toLowerCase();
        return spec.values.includes(s) ? { v: s } : { err: 'must be one of ' + spec.values.join(', ') };
      }
      case 'bool':
        if (v === true || v === 'true' || v === 'on') return { v: true };
        if (v === false || v === 'false' || v === 'off') return { v: false };
        return { err: 'must be true or false' };
      case 'app': {
        const s = String(v).trim().toLowerCase();
        const hit = APPS[s] ? s : (NLU.findApp(s) || {}).k;
        // Fixed allowlist, or an app installed on this laptop (Start menu, discovered by the server).
        return hit && (APPS[hit] || /^app:/.test(hit)) ? { v: hit } : { err: '"' + s + '" is not an allowlisted or installed app' };
      }
      case 'url': {
        let u; try { u = new URL(String(v).trim()); } catch (e) { return { err: 'not a valid URL' }; }
        return /^https?:$/.test(u.protocol) ? { v: u.href } : { err: 'only http/https URLs' };
      }
      case 'path': {
        const s = String(v).trim();
        if (/^(it|that|this)$/i.test(s)) return { v: s };
        if (s.length > 200 || /(^|[\\/])\.\.([\\/]|$)/.test(s) || /^[a-z]:/i.test(s) || /^[\\/]/.test(s) || /[\0<>|"?*]/.test(s)) return { err: 'must be a plain name inside the ~/jarvis sandbox' };
        return safePath(s) ? { v: s } : { err: 'outside the allowed folders' };
      }
      case 'place': {
        const s = String(v).trim();
        if (s.length > 200 || /(^|[\\/])\.\.([\\/]|$)/.test(s) || /[\0<>|"?*]/.test(s)) return { err: 'not a valid place' };
        return { v: s };
      }
      case 'when': {
        const s = String(v).trim();
        // Same rule as the REMIND handler: a one-off time, or a repeat ("every year in july", "every monday at 8").
        const low = s.toLowerCase();
        return s.length <= 80 && (NLU.parseWhen(low) || NLU.parseRepeat(low)) ? { v: s } : { err: 'not a time I understand ("in 20 minutes", "tomorrow at 9am", "every monday at 8am")' };
      }
    }
    return { err: 'unknown type' };
  }
  // → { ok, step:{id,tool,intent,args,tier,reason,check} } or { ok:false, reason }
  function validateStep(raw, i, { inPlan } = {}) {
    const id = raw && raw.id != null && /^[\w-]{1,20}$/.test(String(raw.id)) ? String(raw.id) : 'step_' + (i + 1);
    const name = String((raw && raw.tool) || '').trim();
    const def = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
    if (!def) return { ok: false, reason: id + ': "' + name.slice(0, 40) + '" is not a JARVIS tool — blocked' };
    if (inPlan && (def.plan === false || NO_NESTING.has(def.intent))) return { ok: false, reason: id + ': ' + name + ' has to be asked for on its own' };
    const inArgs = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args : {};
    const args = {};
    for (const [k, spec] of Object.entries(def.args)) {
      const r = checkArg(spec, inArgs[k]);
      if (r.err) return { ok: false, reason: id + ': ' + name + ' "' + k + '" ' + r.err };
      if (!r.skip) args[k] = r.v;
    }
    let intent = def.intent, tier = def.tier, reason = def.reason || '';
    if (intent === 'VOLUME') intent = { up: 'VOLUME_UP', down: 'VOLUME_DOWN' }[args.action] || 'VOLUME_MUTE';
    if (intent === 'MEDIA') intent = { next: 'MEDIA_NEXT', prev: 'MEDIA_PREV', stop: 'MEDIA_STOP' }[args.key] || 'MEDIA_PLAY';
    if (intent === 'SCREEN_READ' && args.explain) intent = 'SCREEN_EXPLAIN';
    return { ok: true, step: { id, tool: name, intent, args, tier, reason, check: def.check || null } };
  }
  function validatePlan(plan) {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return { ok: false, reason: 'the plan was not in the expected format' };
    if (!plan.steps.length) return { ok: false, reason: 'no executable steps' };
    if (plan.steps.length > 5) return { ok: false, reason: 'too many steps (' + plan.steps.length + ', maximum 5)' };
    const steps = [];
    for (let i = 0; i < plan.steps.length; i++) {
      const r = validateStep(plan.steps[i], i, { inPlan: true });
      if (!r.ok) return r;
      if (steps.some(s => s.id === r.step.id)) r.step.id = 'step_' + (i + 1);
      steps.push(r.step);
    }
    return { ok: true, plan: { goal: String(plan.goal || '').trim().slice(0, 120) || 'Run ' + steps.length + ' steps', steps } };
  }
  // Tier for a rule-engine step (split commands); Wi-Fi off is detected from the text.
  function tierForIntent(intent, text) {
    if (intent === 'RADIO' && /\boff\b/.test(text || '') && /wi-?fi|wireless/.test(text || '')) return INTENT_TIERS.WIFI_OFF;
    if (NO_NESTING.has(intent)) return ['nested', 'Routines have to be run on their own.'];
    return INTENT_TIERS[intent] || ['safe', ''];
  }

  /* ---------- prompt text ---------- */
  const line = (n, t) => n + ' {' + Object.keys(t.args).map(k => '"' + k + '"').join(',') + '}' + (t.desc ? ' — ' + t.desc : '');
  const catalogue = () => Object.entries(TOOLS).map(([n, t]) => line(n, t)).join('\n');
  const planCatalogue = () => Object.entries(TOOLS).filter(([, t]) => t.plan !== false).map(([n, t]) => line(n, t)).join('\n');
  const PLAN_PROMPT = () => `You turn a user's request into a short plan of tool calls for JARVIS, a PC assistant on Windows.
Available tools (name {"args"} — meaning):
${planCatalogue()}

Rules:
- Output ONLY JSON: {"goal":"<short goal>","steps":[{"id":"step_1","tool":"<tool name>","args":{...}}]}
- Use only the tools above, with exactly their argument names. Maximum 5 steps, in the order they should run.
- Numbers as numbers (set_timer "seconds": 25 minutes = 1500). Apps by short name (vscode, chrome, notepad).
- Do not invent tools, shell commands or file paths outside the user's words.
- A focus session, pomodoro or study session is the focus tool (minutes), not set_timer.
- FRIDAY and JARVIS are assistant personas (switch_persona), not days of the week.
- If any part of the request needs something none of these tools can do, output {"goal":"","steps":[]} — never substitute a different tool.
- If the request is a question or conversation rather than something to do, output {"goal":"","steps":[]}.`;

  /* ---------- requests no tool can do: refused in plain code, before the model is asked ---------- */
  // The model will otherwise build a "plan" out of unrelated safe tools (e.g. "run rm -rf" → open terminal + write a note)
  // and JARVIS would report success for something it never did.
  const QUESTION = /^(what|what's|whats|why|how|who|whom|whose|when|where|which|can|could|should|would|is|are|am|was|were|do|does|did|will|tell me (about|why|how|what|who)|explain|define|describe|compare)\b/i;
  const UNSUPPORTED = [
    [/\b(install|uninstall|reinstall|upgrade|update)\b.*\b(app|apps|program|software|package|python|node|nodejs|java|jdk|compiler|g\+\+|gcc|driver|drivers|extension|windows|library|libraries|pip|npm)\b|\b(install|uninstall|reinstall)\s+\w+/i, 'I don’t have a tool for installing or uninstalling software yet'],
    [/\bdownload\b/i, 'I don’t download files on my own'],
    [/\b(run|execute|type|enter)\b.*\b(command|commands|shell|powershell|terminal|cmd|bash|script)\b|\b(cmd|terminal|powershell|shell)\b.*\b(run|execute|type)\b|\brm\s+-rf\b|\bsudo\b|\bdel\s+\/|\breg\s+(add|delete)\b/i, 'I don’t run shell commands — only specific, checked tools'],
    [/\bsend\b.*\b(email|mail|message|text|dm|sms)\b|\b(email|mail|message|text)\s+(my\s+)?(professor|teacher|friend|mom|dad|boss|team|him|her|them)\b/i, 'I can’t send messages or email for you'],
    [/\b(password|passwords|account|accounts|registry|firewall|antivirus|defender|bios|uac|admin(istrator)? (rights|access))\b/i, 'I don’t change passwords, accounts or security settings'],
    [/\b(environment variables?|path variable|to (my |the )?path)\b/i, 'I don’t change system environment settings'],
    [/\b(delete|erase|wipe|remove|clear|empty)\s+(out\s+)?(every|all|everything)\b(?!\s+(my\s+|the\s+)?timers?\b)|\bformat\b.*\b(drive|disk|partition|[a-z]:)/i, 'Deleting is only done by a direct command, one item at a time, with your confirmation'],
  ];
  function refuse(text) {
    if (QUESTION.test(text) || /\?\s*$/.test(text)) return { empty: true, reason: 'not an action request' };
    for (const [re, why] of UNSUPPORTED) if (re.test(text)) return { unsupported: true, reason: why };
    // "delete chrome" / "remove spotify" = uninstalling an app, not closing it.
    if (/^(please\s+)?(delete|remove|get rid of|uninstall)\b/i.test(text) && NLU.findApp(text.toLowerCase())) return { unsupported: true, reason: 'I don’t uninstall or delete apps' };
    return null;
  }

  /* ---------- routes ---------- */
  function routes(app) {
    app.get('/api/agent/tools', (req, res) => {
      res.json({ success: true, tools: Object.fromEntries(Object.entries(TOOLS).map(([n, t]) => [n, { intent: t.intent, tier: t.tier, reason: t.reason || '', check: t.check || null, plan: t.plan !== false }])),
        intents: INTENT_TIERS, noNesting: [...NO_NESTING] });
    });
    // One tool call from the chat model: <<tool {args}>>
    app.post('/api/agent/validate', (req, res) => {
      const r = validateStep({ tool: req.body.tool, args: req.body.args }, 0);
      res.json(r.ok ? { ok: true, step: r.step } : { ok: false, reason: r.reason });
    });
    // Tier for rule-engine steps of a split command.
    app.post('/api/agent/tier', (req, res) => {
      const [tier, reason] = tierForIntent(String(req.body.intent || ''), String(req.body.text || '').toLowerCase());
      res.json({ tier, reason });
    });
    app.post('/api/agent/plan', async (req, res) => {
      const text = String(req.body.text || '').trim().slice(0, 600);
      if (!text) return res.status(400).json({ ok: false, reason: 'text required' });
      const no = refuse(text);
      if (no) return res.json(Object.assign({ ok: false, ms_plan: 0 }, no));
      const t0 = Date.now();
      let raw = '';
      try {
        // What "that folder" / "it" / "there" refer to right now (the page's conversation focus).
        const context = String(req.body.context || '').trim().slice(0, 600);
        raw = await llm.complete({ model: String(req.body.model || DEFAULT_MODEL), system: PLAN_PROMPT(), messages: [{ role: 'user', content: (context ? 'Context (what "that folder", "there", "it" mean): ' + context + '\n\nRequest: ' : '') + text }],
          json: true, temperature: 0, maxTokens: 300, timeoutMs: 60000 });
      } catch (e) {
        return res.json({ ok: false, reason: 'the AI is unavailable (' + e.message + ')', ms_plan: Date.now() - t0 });
      }
      const parsed = require('./llm').extractJSON(raw);
      if (!parsed) return res.json({ ok: false, reason: 'the AI did not return a valid plan', ms_plan: Date.now() - t0 });
      if (Array.isArray(parsed.steps) && !parsed.steps.length) return res.json({ ok: false, empty: true, reason: 'not an action request', ms_plan: Date.now() - t0 });
      const v = validatePlan(parsed);
      res.json(Object.assign(v, { ms_plan: Date.now() - t0 }));
    });
    // Does a sandbox file/folder exist? (verification of create_folder / write_note / save_code)
    app.post('/api/agent/exists', (req, res) => {
      const p = safePath(String(req.body.name || ''));
      if (!p) return res.json({ exists: false, error: 'outside the allowed folders' });
      fs.stat(p, (err, st) => res.json({ exists: !err, dir: !err && st.isDirectory() }));
    });
  }

  return { TOOLS, INTENT_TIERS, validateStep, validatePlan, tierForIntent, refuse, catalogue, routes, PLAN_PROMPT, setInstalledApps: names => NLU.setInstalledApps(names) };
};
