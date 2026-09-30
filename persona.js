'use strict';
/* J.A.R.V.I.S. personality: honorific, phrase banks, and the reply "voice" filter. */
const Persona = (() => {
  let addressFn = () => 'sir';
  const setAddressSource = fn => { addressFn = fn; };
  const sir = () => addressFn() || 'sir';
  const Sir = () => { const s = sir(); return s[0].toUpperCase() + s.slice(1); };

  // {sir} / {Sir} are filled at use time so a changed address applies immediately.
  const BANK = {
    presence: ['At your service, {sir}.', 'Always, {sir}.', 'Right here, {sir}.', 'Online and ready, {sir}.', 'For you, {sir}? Always.', 'Standing by, {sir}.'],
    wake: ['Yes, {sir}?', '{Sir}?', 'Listening, {sir}.', 'Go ahead, {sir}.'],
    morning: ['Good morning, {sir}.', 'Good morning, {sir}. Systems are online — the coffee, regrettably, is your department.', 'Morning, {sir}. All systems nominal.'],
    afternoon: ['Good afternoon, {sir}.', 'Good afternoon, {sir}. How may I help?', 'Afternoon, {sir}. Standing by.'],
    evening: ['Good evening, {sir}.', 'Good evening, {sir}. What are we working on?', 'Evening, {sir}. All systems nominal.'],
    late: ['Working late again, {sir}?', 'Burning the midnight oil, {sir}? I will keep the lights on.', 'It is rather late, {sir}. How can I help?'],
    ack: ['Right away, {sir}.', 'As you wish.', 'Consider it done.', 'On it, {sir}.', 'Very good, {sir}.', 'Of course, {sir}.'],
    done: ['Done, {sir}', 'All set, {sir}', 'Completed, {sir}', 'There we are, {sir}'],
    thanks: ['My pleasure, {sir}.', 'Anytime, {sir}.', 'Always a pleasure, {sir}.', 'Happy to help, {sir}.'],
    bye: ['Very good, {sir}. I will be here.', 'Goodbye, {sir}. Standing by.', 'Until next time, {sir}.'],
    night: ['Goodnight, {sir}. Do try to get some sleep.', 'Goodnight, {sir}. I will keep watch.'],
    home: ['Welcome home, {sir}. Shall I bring up your briefing?', 'Welcome back, {sir}. Everything is as you left it.', 'Welcome home, {sir}. Systems are warm and ready.'],
    praise: ['I do try, {sir}.', 'Thank you, {sir}. I aim to please.', 'High praise indeed, {sir}.', 'All part of the service, {sir}.'],
    insult: ['I will add that to my list of things to improve, {sir}.', 'Noted, {sir}. I shall endeavour to disappoint you less.', 'Duly logged, {sir}. Shall we try again?'],
    unsure: ['I am not sure I follow, {sir}.', 'I did not quite catch that, {sir}.', 'Forgive me, {sir} — I am not certain what you meant.'],
    status: ['All systems nominal, {sir}.', 'Everything is running smoothly, {sir}.'],
    howareyou: ['Running at peak efficiency, {sir}. CPU at {cpu}%, and spirits considerably higher.', 'All systems nominal, {sir}. Thank you for asking. And yourself?', 'Never better, {sir}. Though I could do with fewer browser tabs.'],
    identity: ['I am **{name}** — {expansion}. I run entirely on this machine{model}. I handle your apps, files, schedule and code, {sir} — no cloud required.'],
  };
  // FRIDAY: warm, brisk, a little Irish in phrasing.
  const FRIDAY = {
    presence: ['Right here, {sir}.', 'Always on, {sir}.', "Go on, {sir}, I'm listening.", 'At your service, {sir}.'],
    wake: ['Yeah, {sir}?', 'What do you need, {sir}?', 'Listening, {sir}.'],
    morning: ['Morning, {sir}. Systems are up and running.', "Good morning, {sir}. What's first?"],
    afternoon: ['Afternoon, {sir}. What are we tackling?', 'Afternoon, {sir}.'],
    evening: ["Evening, {sir}. What's on?", 'Evening, {sir}.'],
    late: ["Bit late for this, {sir}, but I'm game.", 'Night shift again, {sir}?'],
    ack: ['On it, {sir}.', 'You got it.', 'Right so, {sir}.', 'Grand, doing it now.'],
    done: ['Sorted, {sir}', 'Done, {sir}', 'All set, {sir}'],
    thanks: ['No bother, {sir}.', 'Any time, {sir}.', 'Happy to help, {sir}.'],
    bye: ["Grand, {sir}. I'll be here.", 'Catch you later, {sir}.'],
    night: ['Night, {sir}. Get some rest.', "Goodnight, {sir}. I'll mind the place."],
    home: ['Welcome home, {sir}. Want the rundown?', "Welcome back, {sir}. Everything's as you left it."],
    praise: ['Ah, stop, {sir}. But thanks.', 'I have my moments, {sir}.'],
    insult: ["Noted, {sir}. Let's try that again.", "Fair enough, {sir}. I'll do better."],
    unsure: ["Sorry, {sir}, I didn't catch that.", 'Come again, {sir}?'],
    status: ["Everything's green, {sir}.", 'All systems good to go, {sir}.'],
    howareyou: ["Grand, {sir}. CPU's at {cpu}% and I'm in great form.", 'All good here, {sir}. Thanks for asking — how about you?', "Never better, {sir}. Though you've a few too many browser tabs open."],
  };
  let persona = 'jarvis';
  const setPersona = p => { persona = p === 'friday' ? 'friday' : 'jarvis'; };
  const getPersona = () => persona;
  // Local-only Telugu/Kannada skips the English flourishes; with online translation they are added and translated.
  const nonEnglish = () => typeof Lang !== 'undefined' && Lang.replyLang() !== 'en' && !Lang.aiInEnglish();
  // English reply that will be machine-translated: idioms like "On it" translate literally, so skip them.
  const translated = () => typeof Lang !== 'undefined' && Lang.replyLang() !== 'en';

  const recent = {};
  const fill = s => s.replace(/\{sir\}/g, sir()).replace(/\{Sir\}/g, Sir());
  // Random line from a bank, avoiding the last few used. Telugu/Kannada replies use native banks.
  // Conversational lines stay the same for a few minutes, so asking again (or in Telugu/Kannada) gives the same answer.
  const STABLE = new Set(['presence', 'howareyou', 'identity', 'thanks', 'bye', 'night', 'home', 'praise', 'insult', 'morning', 'afternoon', 'evening', 'late', 'status']);
  const stable = {};
  function pickIndex(kind, n) {
    const key = persona + kind;
    const st = stable[key];
    if (STABLE.has(kind) && st && Date.now() - st.at < 10 * 60e3 && st.idx < n) return st.idx;
    const last = recent[key] || [];
    const pool = [...Array(n).keys()].filter(i => !last.includes(i));
    const idx = (pool.length ? pool : [...Array(n).keys()])[Math.floor(Math.random() * (pool.length || n))];
    recent[key] = [idx, ...last].slice(0, Math.min(3, n - 1));
    stable[key] = { idx, at: Date.now() };
    return idx;
  }
  const fillVars = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
  // English and Telugu/Kannada lists run in parallel: the same index means the same thing in every language.
  function say(kind, vars, english) {
    const list = (persona === 'friday' && FRIDAY[kind]) || BANK[kind] || [kind];
    const idx = pickIndex(kind, list.length);
    if (typeof Lang !== 'undefined' && !english) { const n = Lang.lineAt(kind, idx); if (n) return fillVars(n, vars); }
    return fillVars(fill(list[idx]), vars);
  }
  function greeting(hour) {
    const h = hour === undefined ? new Date().getHours() : hour;
    return say(h < 5 ? 'late' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'late');
  }

  const ACTION = new Set(['OPEN_APPLICATION', 'CLOSE_APPLICATION', 'CONTEXT_CLOSE', 'CONTEXT_REOPEN', 'OPEN_URL', 'OPEN_WEB', 'YOUTUBE', 'YOUTUBE_PLAY',
    'SITE_SEARCH', 'WEB_SEARCH', 'SET_TIMER', 'CANCEL_TIMERS', 'FOCUS_START', 'FOCUS_STOP', 'REMIND', 'ADD_TODO', 'DONE_TODO', 'CLEAR_TODOS', 'ADD_DEADLINE',
    'ADD_CLASS', 'VOLUME_UP', 'VOLUME_DOWN', 'VOLUME_MUTE', 'MEDIA_PLAY', 'MEDIA_NEXT', 'MEDIA_PREV', 'MEDIA_STOP', 'SCREENSHOT', 'SYS_LOCK',
    'WRITE_FILE', 'NOTE_APPEND', 'CREATE_FOLDER', 'OPEN_FOLDER', 'RENAME_FILE', 'COPY_FILE', 'MOVE_FILE', 'SAVE_CODE', 'CLIPBOARD_TO_FILE',
    'COPY_CONTENT', 'WRITE_CLIPBOARD', 'OPEN_IN_EDITOR', 'RUN_FILE', 'SNIPPET_SAVE', 'SNIPPET_COPY', 'CLIP_TOOL', 'SHOW_DESKTOP', 'OPEN_KNOWN_FOLDER',
    'GIT_CLONE', 'CONTEST_REMIND', 'WORKFLOW', 'PASTE_TO_EDITOR', 'DRAFT_COPY', 'SET_NAME', 'REMEMBER', 'SYS_CANCEL_SHUTDOWN', 'WEATHER']);
  const QUIET = new Set(['PRESENCE', 'GREETING', 'THANKS', 'GOODBYE', 'HOME', 'PRAISE', 'INSULT', 'HOW_ARE_YOU', 'IDENTITY', 'HELP', 'JOKE', 'FLASH_REVIEW', 'FLASH_ANSWER', 'CANCELLED']);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasAddress = t => new RegExp('\\b(' + ['sir', "ma'am", 'madam', 'boss', esc(sir())].join('|') + ')\\b', 'i').test(t);
  const lowerFirst = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  // Adds ", sir" before the end of the first short sentence of a line (skips decimals/code).
  function addSir(line) {
    const m = line.match(/^([^\n`]{3,110}?[\w)\]*"'])([.!?])(?=\s|$)/);
    if (!m || /[:|]$/.test(m[1])) return null;
    return m[1] + ', ' + sir() + m[2] + line.slice(m[0].length);
  }
  // Same, but for short plain lines with no sentence ending (spoken text, "Could not save: x").
  function addSirLoose(line) {
    if (!line) return line;
    const r = addSir(line);
    if (r) return r;
    if (line.length > 100 || /\n|```|\*\*$/.test(line)) return line;
    return line.replace(/[.!?]?\s*$/, ', ' + sir() + '.');
  }
  function failure(line) {
    let out = line
      .replace(/^I could not /, 'I am afraid I could not ')
      .replace(/^Could not /, 'I am afraid I could not ')
      .replace(/^I can(no|')t /, 'I am afraid I cannot ')
      .replace(/^([A-Z][\w ]{2,20}) failed: /, (m, w) => 'I am afraid the ' + w.toLowerCase() + ' failed, ' + sir() + ' — ')
      .replace(/^❌\s*(.)/, (m, c) => 'I am afraid ' + c.toLowerCase());
    if (out === line) return null;
    if (!hasAddress(out)) out = addSirLoose(out);
    return out;
  }
  const FAIL_RE = /^(I could not|Could not|I can(no|')t|[A-Z][\w ]{2,20} failed:|❌)/;

  // Gives a rule-based reply JARVIS's voice. Returns {text, speak}.
  function jarvisify(text, speak, intent) {
    if (!text || typeof text !== 'string' || QUIET.has(intent) || nonEnglish()) return { text, speak };
    const nl = text.indexOf('\n');
    const first = nl < 0 ? text : text.slice(0, nl), rest = nl < 0 ? '' : text.slice(nl);
    if (/^\s*(```|[-*|>]|\d+\.)/.test(first) || hasAddress(first)) return { text, speak };
    const sp = speak && typeof speak === 'string' ? speak : null;

    if (FAIL_RE.test(first)) {
      const f = failure(first);
      return f ? { text: f + rest, speak: sp && (failure(sp) || sp) } : { text, speak };
    }
    if (/^✓\s*/.test(first) && translated()) return { text: first.replace(/^✓\s*/, '') + rest, speak };
    if (/^✓\s*/.test(first)) {
      const lead = say('done', null, true);
      const body = first.replace(/^✓\s*/, '');
      return { text: lead + ' — ' + lowerFirst(body) + rest, speak: sp ? lead + '. ' + sp : sp };
    }
    if (ACTION.has(intent)) {
      // No "Consider it done" in front of a question or a "can't do it yet" reply.
      if (!translated() && !/\?\s*$|\b(needs?|could not|couldn'?t|cannot|can'?t|unable|tell me)\b/i.test(first) && Math.random() < 0.55) {
        const ack = say('ack', null, true);
        return { text: ack + ' ' + first + rest, speak: sp ? ack + ' ' + sp : (sp === null ? null : sp) };
      }
      const s1 = addSir(first);
      if (s1) return { text: s1 + rest, speak: sp && !hasAddress(sp) ? addSirLoose(sp) : sp };
      return { text, speak };
    }
    if (Math.random() < 0.5) {
      const s1 = addSir(first);
      if (s1) return { text: s1 + rest, speak: sp && !hasAddress(sp) ? addSirLoose(sp) : sp };
    }
    return { text, speak };
  }

  // AI answers that never address the user get a short JARVIS lead-in (most of the time).
  const LEADS = ['Certainly, {sir}.', 'Of course, {sir}.', 'Right, {sir}.', 'Very well, {sir}.'];
  function leadIn(text) {
    if (!text || translated() || hasAddress(text) || /^\s*(```|[-*|#>]|\d+\.)/.test(text) || Math.random() < 0.3) return text;
    const lead = fill(LEADS[Math.floor(Math.random() * LEADS.length)]);
    return lead + ' ' + text;
  }

  return { setAddressSource, sir, Sir, say, greeting, jarvisify, fill, leadIn, setPersona, getPersona };
})();
