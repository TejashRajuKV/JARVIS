'use strict';
/* Chat side of the website generator, DSA coach and viva practice (server side: skills.js).
   Skills.intercept(text) runs early in the turn pipeline: it answers while a skill is active (a viva or a coaching
   session, or the website questions), starts a skill from its trigger phrase, and otherwise returns null so the
   normal command handling carries on. Uses the page's globals (callTool, jarvisSay, llm, Undo, saveToFile…). */
const Skills = (() => {
  const S = { site: null, lastSite: null, coach: null, viva: null, uip: null };
  const say = (text, extra) => Object.assign({ text, noPersona: true }, extra || {});
  const needAI = () => llmReady() ? null : say('That needs my AI brain, and it’s off or unreachable. Turn it on in **Settings → AI BRAIN** (or add an API key there), then try again.');
  const busyMsg = t => { setState('PROCESSING', t); jarvisSay({ text: '⏳ ' + t, intent: 'SKILL', noTTS: true, noPersona: true }); };
  const cancelRe = /^(cancel|never ?mind|forget it|stop|quit|exit)$/i;
  const slug = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-website';

  /* ================= website generator ================= */
  const SITE_START = /^(?:please\s+)?(?:build|make|create|generate|design|code|develop)\s+(?:me\s+)?(?:a\s+|an\s+|my\s+|the\s+)?(?:simple\s+|nice\s+|new\s+|modern\s+|small\s+)?(website|web\s?site|web\s?page|web\s?app|front[\s-]?end(?:\s+(?:ui|page|design|website|web\s?site|web\s?page|web\s?app|app|site|interface))?|(?:ui|user interface)(?:\s+(?:page|design))?|landing\s+page|portfolio(?:\s+(?:website|site|page))?|home\s?page|site)\b(?:\s+(?:for|about|on|of)\s+(.+?))?[.!]?$/i;
  const SITE_Q = [
    ['what', 'What is the website for? (e.g. "my college tech fest", "my portfolio as a CS student")'],
    ['sections', 'What should be on it? List the sections or content — e.g. "events, schedule, registration form, contact".'],
    ['style', 'How should it look? Colours, dark or light, a site it should feel like — or say "skip".'],
  ];
  // After the questions: build straight away if the place is known (an existing project), otherwise ask where.
  function siteNext() {
    const a = S.site.a;
    if (a.folder || a.where !== undefined) { S.site = null; return siteBuild(a); }
    S.site.stage = 'where';
    const folder = slug(a.project || a.what.replace(/^(?:my|a|an|the|our)\s+/i, '').split(/\s+/).slice(0, 5).join(' '));
    return say('Where should I save it, ' + (typeof Persona !== 'undefined' ? Persona.sir() : 'sir') + '? I’ll make a folder **' + folder + '** there with the page in it. Say **desktop**, **D drive**, a full path like `D:\\Projects`, or **jarvis** for ~/jarvis/Projects.',
      { intent: 'WEBSITE', speak: 'Where should I save it?', suggestions: ['Desktop', 'D drive', 'Jarvis folder'] });
  }
  function siteAsk() { return say(SITE_Q[S.site.step][1], { intent: 'WEBSITE', speak: SITE_Q[S.site.step][1].split(' (')[0].split(' —')[0] }); }
  async function siteBuild(a) {
    const nm = (a.project || a.what.replace(/^(?:my|a|an|the|our)\s+/i, '')).split(/\s+/).slice(0, 5).join(' ');
    busyMsg((a.folder ? 'Building the frontend in ' + a.folder : 'Building your website' + (a.where ? ' in ' + a.where : '')) + ' — this can take 1–3 minutes with a local AI model…');
    const r = await callTool('/skill/site', { what: a.what, sections: a.sections, style: a.style || '', name: nm, model: llm.model, folder: a.folder || undefined, where: a.where || undefined });
    if (r.error) return say('I couldn’t build it: ' + r.error, { intent: 'WEBSITE' });
    S.lastSite = r.name; S.lastSiteAbs = r.dir || null; S.lastSiteDir = r.dir || r.folder;
    if (r.dir && typeof setFocus === 'function') { setFocus('folder', r.dir); setFocus('created', r.path || r.dir); if (a.folder) setFocus('project', a.folder); }
    Undo.push('built the ' + r.name + ' website', async () => { const x = await callTool('/tool/undoCreate', { name: r.folder }); if (x.error) throw new Error(x.error); return 'Removed the website folder `' + r.folder + '` (it’s in the trash).'; });
    if (a.project || a.where) return say('✓ Built ' + (a.project ? 'the frontend for **' + a.project + '**' : 'your website') + ' → `' + (r.path || r.file) + '` (' + r.lines + ' lines) and opened it in your browser.\n\nWant changes? Just say them — e.g. **"make the buttons bigger"**, **"use a dark theme"**. Say **"go back to the previous version"** if a change goes wrong.',
      { intent: 'WEBSITE', speak: 'The frontend is ready. I opened it in your browser.', suggestions: ['Make the buttons bigger', 'Use a dark theme', 'Open it in VS Code'],
        actions: [{ label: 'OPEN AGAIN', fn: () => callTool('/skill/siteOpen', { name: r.name, dir: r.dir }) }, { label: 'OPEN IN VS CODE', fn: () => callTool('/tool/openInEditor', { name: r.dir || r.folder }) }] });
    return say('✓ Built your website → `' + r.file + '` (' + r.lines + ' lines) and opened it in your browser.\n\nWant changes? Just say them — e.g. **"make the header bigger"**, **"add a contact section"**, **"use a blue colour scheme"**. Say **"go back to the previous version"** if a change goes wrong.',
      { intent: 'WEBSITE', speak: 'Your website is ready. I opened it in your browser.', suggestions: ['Make the header bigger', 'Add a contact section', 'Open the website in VS Code'],
        actions: [{ label: 'OPEN AGAIN', fn: () => callTool('/skill/siteOpen', { name: r.name }) }, { label: 'OPEN IN VS CODE', fn: () => callTool('/tool/openInEditor', { name: r.folder }) }] });
  }
  // "project calculator" / "my calculator project" / "the calculator app" → "calculator"
  const projectName = x => String(x || '').trim().replace(/[.!?]+$/, '').replace(/^(?:my|the|a|an|our)\s+/i, '').replace(/^(?:project|app)\s+(?:called\s+|named\s+)?/i, '')
    .replace(/\s+(?:project|app|application|website|folder)$/i, '').replace(/^(?:my|the)\s+/i, '').trim();
  // An existing folder with that name: the folder in focus, then anywhere on the laptop (file index).
  async function findProjectFolder(name) {
    const f = typeof focusOf === 'function' && focusOf('folder');
    const sq = x => String(x || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (f && sq(f.path.split(/[\\/]/).pop()) === sq(name)) return f.path;
    const r = await callTool('/tool/findFolderAnywhere', { name });
    const paths = (r && r.paths) || [];
    const exact = paths.find(p => sq(p.split(/[\\/]/).pop()) === sq(name));
    if (exact) return exact;
    // Not by that exact name: a close one ("calc_app", "my-calculator", "calculater") — asked about, never assumed.
    if (typeof similarTo === 'function') { const sims = await similarTo(name, 'folder'); if (sims.length && sims[0].score >= 0.84) return { path: sims[0].path, close: true }; }
    return null;
  }
  // "make the header bigger" after a site was built → edit it in place.
  const SITE_WORDS = /\b(website|site|web ?page|page|landing page|section|header|footer|hero|banner|navbar|nav bar|menu|button|buttons|colou?rs?|theme|font|fonts|background|logo|image|images|title|heading|text|card|cards|form|layout|dark mode|light mode|gallery|schedule|events?|contact|about|faq)\b/i;
  const SITE_EDIT = /^(?:please\s+)?(?:change|make|add|remove|delete|edit|update|move|put|use|increase|decrease|replace|turn|give|set|switch|include|show|hide)\b/i;
  async function siteEdit(change) {
    if (needAI()) return needAI();
    busyMsg('Updating the website…');
    const r = await callTool('/skill/siteEdit', { name: S.lastSite, dir: S.lastSiteAbs || undefined, change, model: llm.model });
    if (r.error) return say('I couldn’t change it: ' + r.error, { intent: 'WEBSITE' });
    const name = S.lastSite, dir = S.lastSiteAbs || undefined;
    Undo.push('website change', async () => { const x = await callTool('/skill/siteRevert', { name, dir }); if (x.error) throw new Error(x.error); return 'The website is back to the previous version.'; });
    return say('✓ Updated and reopened the website. Say **"undo"** to go back.', { intent: 'WEBSITE', speak: 'Done. I reopened the website.', suggestions: ['Undo'] });
  }

  /* ================= UI design prompt ================= */
  const UIP_START = /^(?:ui design(?: prompt)?|(?:write|give|make)(?: me)? (?:a |an )?(?:detailed )?(?:ui|ux)(?: design)? prompt|i want to design (?:a )?ui(?: page)?)\b(?:\s+(?:for|of)\s+(.+?))?[.!:]?$/i;
  // TCREI: Task, Context, References → the prompt; Evaluate + Iterate are written into it.
  const UIP_Q = [
    ['task', '**T — Task.** What should the AI design? (e.g. "a dashboard page", "login + signup screens", "a landing page")'],
    ['context', '**C — Context.** What is your project, who uses it, and what must the page do? (e.g. "attendance tracker for my college; students check their % and teachers mark attendance")'],
    ['refs', '**R — References.** Any look, sites or tech to follow? (e.g. "dark and minimal like Linear, React + Tailwind") — or say "skip".'],
    ['must', '**E — Evaluate.** What must the result get right? (e.g. "works on phones, big readable numbers, under 3 clicks to mark attendance") — or say "skip".'],
  ];
  const uipAsk = () => say((S.uip.step ? '' : 'Let’s build your UI prompt with **TCREI** — 4 quick questions (say "cancel" to stop).\n\n') + UIP_Q[S.uip.step][1], { intent: 'UI_PROMPT', speak: UIP_Q[S.uip.step][1].replace(/\*\*[^*]+\*\*\s*/, '').split(' (')[0] });
  async function uipBuild(a) {
    busyMsg('Writing your UI design prompt…');
    const r = await callTool('/skill/uiprompt', a);
    if (r.error) return say('I couldn’t write it: ' + r.error, { intent: 'UI_PROMPT' });
    return say(r.text, { intent: 'UI_PROMPT', speak: 'Here is your UI design prompt.', suggestions: ['Build a website for my project'] });
  }

  /* ================= DSA coach ================= */
  const DSA_WORDS = /\b(leetcode|lc|codeforces|gfg|hackerrank|problem|array|arrays|string|strings|tree|trees|bst|graph|graphs|dp|dynamic programming|linked ?list|two ?sum|3 ?sum|three sum|subarray|substring|subsequence|palindrome|binary search|sort|sorting|stack|queue|heap|matrix|dsa|algorithm|recursion|backtracking|greedy|sliding window|two pointers?|anagram|parentheses|bfs|dfs|knapsack|fibonacci)\b/i;
  const COACH_START = /^(?:please\s+)?(?:coach me (?:on|through|for|with)|dsa coach(?:\s+(?:for|on|with))?|i(?:'m| am) stuck on|give me (?:a\s+)?hints?\s+(?:for|on)|teach me (?:how )?to solve|help me (?:with|solve|on|crack))\s+(?:the\s+)?(.{3,400})$/i;
  const LANGS = { python: 'Python', py: 'Python', 'c++': 'C++', cpp: 'C++', java: 'Java', javascript: 'JavaScript', js: 'JavaScript', c: 'C' };
  const EXT = { Python: '.py', 'C++': '.cpp', Java: '.java', JavaScript: '.js', C: '.c' };
  const coachHelp = '\n\nSay **"next hint"**, **"my approach is …"** to get it checked, **"show solution"** (add "in C++" / "in Java"), **"save it"**, or **"stop coaching"**.';
  async function coachCall(mode, extra) {
    if (needAI()) return { error: 'no-ai' };
    setState('PROCESSING', mode === 'solution' ? 'Writing the solution…' : mode === 'check' ? 'Checking your approach…' : 'Thinking of a hint…');
    return callTool('/skill/coach', Object.assign({ problem: S.coach.problem, mode, model: llm.model, previous: S.coach.hints.slice() }, extra || {}));
  }
  async function coachStart(problem) {
    if (needAI()) return needAI();
    S.coach = { problem: problem.replace(/[?.!]+$/, ''), level: 1, lang: null, solution: null, hints: [] };
    const r = await coachCall('hint', { level: 1 });
    if (r.error) { S.coach = null; return say('I couldn’t start coaching: ' + r.error); }
    S.coach.hints.push(r.text);
    return say('**DSA coach — ' + S.coach.problem + '**\n\n**Hint 1:** ' + r.text + coachHelp, { intent: 'DSA_COACH', speak: 'Hint 1. ' + r.text });
  }
  async function coachTurn(text) {
    const t = text.trim(), low = t.toLowerCase();
    if (/^(?:stop|end|quit|exit|done|finish)(?:\s+(?:the\s+)?(?:coaching|coach|session|dsa coach))?[.!]?$/i.test(t) || /^stop coaching$/i.test(t)) {
      const p = S.coach.problem; S.coach = null; return say('Coaching on **' + p + '** ended. Nice work — say "coach me on …" any time.', { intent: 'DSA_COACH' });
    }
    if (/^(?:(?:next|another|more|one more|give me (?:a|another|the next))\s+hint|hint(?:\s*\d)?|i need (?:a|another) hint|more help)[.!?]?$/i.test(t)) {
      if (S.coach.level >= 3) return say('That was the last hint. Have a go — tell me **"my approach is …"** and I’ll check it, or say **"show solution"**.', { intent: 'DSA_COACH' });
      S.coach.level++;
      const r = await coachCall('hint', { level: S.coach.level });
      if (!r.error) S.coach.hints.push(r.text);
      return r.error ? say('Couldn’t get a hint: ' + r.error) : say('**Hint ' + S.coach.level + ':** ' + r.text, { intent: 'DSA_COACH', speak: 'Hint ' + S.coach.level + '. ' + r.text });
    }
    if (/^(?:explain (?:the |this )?(?:problem|question)|what does (?:it|the problem|the question) (?:mean|ask)|i don'?t understand the (?:problem|question))\b/i.test(t)) {
      const r = await coachCall('explain');
      return r.error ? say('Couldn’t explain it: ' + r.error) : say(r.text, { intent: 'DSA_COACH' });
    }
    const lm = low.match(/\bin\s+(python|py|c\+\+|cpp|javascript|java|js|c)(?![\w+#])/);
    if (/\b(?:show|give|tell)\b.*\b(?:solution|answer|code)\b|^(?:solution|answer|i give up|give up|reveal)\b/i.test(t)) {
      S.coach.lang = lm ? LANGS[lm[1]] : S.coach.lang || 'Python';
      const r = await coachCall('solution', { lang: S.coach.lang });
      if (r.error) return say('Couldn’t get the solution: ' + r.error);
      S.coach.solution = r.text;
      return say(r.text + '\n\nSay **"save it"** to save this to ' + (dsaFolder() === 'Code' ? '~/jarvis/Code' : '**' + dsaFolder() + '**') + ', or **"stop coaching"**.', { intent: 'DSA_COACH', speak: 'Here is the solution in ' + S.coach.lang + '.', suggestions: ['Save it', 'Stop coaching'] });
    }
    if (/^(?:save(?:\s+(?:it|this|that|the solution|the code))?(?:\s+(?:to|in)\s+.+)?)[.!]?$/i.test(t)) {
      if (!S.coach.solution) return say('Get the solution first — say **"show solution"**.');
      const m = S.coach.solution.match(/```[\w+#-]*\s*\n([\s\S]*?)```/);
      if (!m) return say('I couldn’t find the code in that answer. Say **"show solution"** again.');
      const file = dsaFolder() + '/' + slug(S.coach.problem).replace(/-/g, '_').slice(0, 30) + (EXT[S.coach.lang] || '.py');
      return saveToFile(file, m[1].replace(/\s+$/, '') + '\n', { what: S.coach.lang + ' solution' });
    }
    // An attempt at the problem: said as one ("my approach is …"), or phrased loosely but about solving it. A long
    // message on another subject ("what is the price of bitcoin right now", "remember that my exam is on 12 december")
    // or a command JARVIS knows is NOT an attempt: it falls through to normal handling and the session stays open.
    const explicit = /^(?:my (?:approach|idea|plan|solution|logic)|check(?: my (?:approach|idea|code|logic))?|is (?:this|it|my (?:approach|idea)) (?:right|correct|ok|fine|good|efficient)|here'?s my (?:idea|approach|plan))\b/i.test(t);
    const loose = /^(?:i (?:think|would|will|can|could)|what if|can i|should i|how about|we can|use a|using)\b/i.test(t) || t.split(/\s+/).length >= 8;
    if (explicit || (loose && looksLikeAttempt(t) && !isCommand(t))) {
      const r = await coachCall('check', { approach: t });
      return r.error ? say('Couldn’t check it: ' + r.error) : say(r.text, { intent: 'DSA_COACH', speak: r.text.split(/(?<=[.!?])\s/)[0] });
    }
    return null; // anything else ("open chrome", "what time is it") works as normal during a session
  }
  const dsaFolder = () => (typeof projectRoots !== 'undefined' && projectRoots.find(r => /dsa/i.test(r))) || 'Code';
  // Words people use when describing how they'd solve a problem.
  const ATTEMPT_WORDS = /\b(hash|hashmap|map|dict(?:ionary)?|set|loop|loops|iterate|iterating|index|indices|pointer|pointers|complement|target|brute|nested|traverse|visited|memo(?:ize|ization)?|recurs\w*|sum|left and right|mid(?:point)?|prefix|sorted|swap|o\s*\(|n\s*\^?\s*2|n log n|time complexity|space complexity)\b/i;
  const looksLikeAttempt = t => DSA_WORDS.test(t) || ATTEMPT_WORDS.test(t);
  // A sentence the rule engine confidently maps to a command ("remind me …", "set a timer …") is that command.
  const isCommand = t => {
    try { const c = NLU.classify(NLU.normalize(t, settings.wakeWord), ctx); return c.intent !== 'CONVERSATION' && c.confidence >= 0.85; } catch (e) { return false; }
  };

  /* ================= viva / interview practice ================= */
  const VIVA_START = [
    /^(?:please\s+)?(?:take|start|conduct|do|begin|run|give me)\s+(?:my\s+|a\s+|an\s+|the\s+)?(.{2,80}?)\s+(?:viva|oral(?:\s+exam)?|mock interview|interview)(?:\s+practice)?[.!]?$/i,
    /^(?:please\s+)?(?:viva|mock interview|interview me|quiz me orally|practice (?:viva|interview))\s+(?:on|for|about|in)\s+(.{2,80}?)[.!]?$/i,
    /^(?:please\s+)?(?:take|start|give me|do)\s+(?:a\s+|my\s+)?(?:viva|mock interview|interview)\s+(?:on|for|about|in)\s+(.{2,80}?)[.!]?$/i,
  ];
  const vivaQ = () => '**Q' + (S.viva.i + 1) + ' of ' + S.viva.qs.length + '.** ' + S.viva.qs[S.viva.i];
  async function vivaStart(topic) {
    if (needAI()) return needAI();
    topic = topic.replace(/^(?:my|the|a|an)\s+/i, '').trim();
    busyMsg('Preparing 5 ' + topic + ' questions…');
    const r = await callTool('/skill/viva/questions', { topic, n: 5, model: llm.model });
    if (r.error) return say('I couldn’t prepare the viva: ' + r.error);
    S.viva = { topic: r.topic, level: r.level, qs: r.questions, i: 0, results: [] };
    return say('**' + (/interview/.test(r.level) ? 'Mock interview' : 'Viva') + ' — ' + r.topic + '** · ' + r.questions.length + ' questions. Answer out loud (tap 🎤) or type. Say **skip**, **repeat**, or **stop viva** any time.\n\n' + vivaQ(),
      { intent: 'VIVA', speak: 'Let’s begin. Question 1. ' + r.questions[0] });
  }
  function vivaSummary(early) {
    const v = S.viva, done = v.results;
    S.viva = null;
    if (!done.length) return say('Viva stopped — no answers yet. Say "take my ' + v.topic + ' viva" to start again.', { intent: 'VIVA' });
    const total = done.reduce((s, r) => s + r.score, 0), avg = Math.round(total / done.length * 10) / 10;
    const verdict = avg >= 8 ? 'Excellent — you’re ready. 🔥' : avg >= 6 ? 'Good. Revise the points you missed.' : avg >= 4 ? 'Getting there — revise these topics and try again.' : 'Needs work — go through the model answers below.';
    const weak = done.filter(r => r.score < 7);
    const lines = done.map((r, i) => (i + 1) + '. ' + (r.score >= 7 ? '✓' : '✗') + ' **' + r.score + '/10** — ' + r.q);
    const missed = [...new Set(weak.flatMap(r => r.missed))].slice(0, 6);
    return say('**' + v.topic + ' — ' + (early ? 'stopped early, ' : '') + 'score ' + avg + '/10** (' + total + '/' + done.length * 10 + ')\n' + verdict + '\n\n' + lines.join('\n') + (missed.length ? '\n\n**Revise:** ' + missed.join('; ') : ''),
      { intent: 'VIVA', speak: 'Viva complete. Your average is ' + avg + ' out of 10. ' + verdict.replace(/🔥/, ''), card: [['SCORE', avg + ' / 10']],
        actions: weak.length ? [{ label: 'MAKE ' + weak.length + ' FLASHCARDS', fn: () => {
          const deck = 'Viva: ' + v.topic;
          for (const r of weak) flashcards.push({ id: rid(), deck, q: r.q, a: r.model || r.missed.join('; '), box: 1, due: Date.now() });
          saveFlash(); jarvisSay({ text: '✓ Added ' + plural(weak.length, 'flashcard') + ' to **' + deck + '**. Say "review my flashcards" to practise them.', intent: 'VIVA' });
        } }] : undefined,
        suggestions: ['Take my ' + v.topic + ' viva again'] });
  }
  async function vivaTurn(text) {
    const t = text.trim();
    if (/^(?:stop|end|quit|exit|finish)(?:\s+(?:the\s+)?(?:viva|interview|test|exam))?[.!]?$/i.test(t)) return vivaSummary(true);
    if (/^(?:repeat|say (?:it|that) again|pardon|come again|again|repeat the question)[.!?]?$/i.test(t)) return say(vivaQ(), { intent: 'VIVA', speak: S.viva.qs[S.viva.i] });
    const v = S.viva, q = v.qs[v.i];
    let g;
    if (/^(?:skip|pass|next|i don'?t know|no idea|dont know)[.!]?$/i.test(t)) g = { score: 0, feedback: 'Skipped.', missed: [], model: '' };
    else {
      setState('PROCESSING', 'Checking your answer…');
      g = await callTool('/skill/viva/grade', { topic: v.topic, question: q, answer: t, model: llm.model });
      if (g.error) return say('I couldn’t check that answer (' + g.error + '). Say it again, or **skip**.', { intent: 'VIVA' });
    }
    if (g.score === 0 && !g.model) { // skipped: still show a good answer for learning
      const g2 = await callTool('/skill/viva/grade', { topic: v.topic, question: q, answer: '', model: llm.model });
      if (!g2.error) g = Object.assign(g2, { score: 0, feedback: 'Skipped.' });
    }
    v.results.push({ q, a: t, score: g.score, missed: g.missed || [], model: g.model || '' });
    const fb = '**' + g.score + '/10** — ' + (g.feedback || '') + (g.missed && g.missed.length ? '\n**Missed:** ' + g.missed.join('; ') : '') + (g.model && g.score < 8 ? '\n**A strong answer:** ' + g.model : '');
    v.i++;
    if (v.i >= v.qs.length) { const sum = vivaSummary(false); sum.text = fb + '\n\n———\n\n' + sum.text; return sum; }
    return say(fb + '\n\n' + vivaQ(), { intent: 'VIVA', speak: g.score + ' out of 10. ' + (g.feedback || '') + ' Next question. ' + v.qs[v.i] });
  }

  /* ================= skill packs (SKILL.md folders; server side: skillpack.js) ================= */
  let packs = [], packSkipped = [], packFolder = '';
  async function loadPacks() {
    try {
      const r = await fetch(API + '/skills').then(x => x.json());
      if (r && r.success) { packs = r.skills || []; packSkipped = r.skipped || []; packFolder = r.folder || ''; }
      return r;
    } catch (e) { return null; }
  }
  const findPack = n => packs.find(p => p.name === String(n || '').toLowerCase());
  // "/quick what is a mutex", "use the research skill to …": unambiguous, so checked before the built-in starts.
  function packExplicit(t) {
    let m = t.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
    if (m && findPack(m[1])) return { pack: findPack(m[1]), input: (m[2] || '').trim() };
    m = t.match(/^(?:please\s+)?use\s+(?:the\s+|my\s+)?([a-z0-9-]+)\s+skill(?:\s+(?:to|for|on|with)\s+([\s\S]+?))?[.!]?$/i);
    if (m && findPack(m[1])) return { pack: findPack(m[1]), input: (m[2] || '').trim() };
    return null;
  }
  // A skill's own trigger phrases count only at the start of the message ("research the latest node version").
  function packByTrigger(t) {
    const low = t.toLowerCase();
    for (const p of packs) for (const tr of p.triggers || []) {
      if (low.startsWith(tr) && (low.length === tr.length || /[\s:,]/.test(low[tr.length]))) return { pack: p, input: t.slice(tr.length).replace(/^[\s:,]+/, '').trim() };
    }
    return null;
  }
  const PACK_LIST = /^(?:(?:list|show)(?: me)?(?: all)?(?: (?:my|the))? skills|what skills (?:do you have|are installed)|which skills do you have)[.!?]?$/i;
  const PACK_RELOAD = /^(?:reload|refresh|rescan)(?: (?:my|the))? skills[.!]?$/i;
  async function packMeta(t) {
    if (PACK_RELOAD.test(t)) {
      const r = await callTool('/skills/reload', {});
      if (r.error) return say('I couldn’t reload the skills: ' + r.error, { intent: 'SKILL' });
      await loadPacks();
      return say('✓ Reloaded: **' + packs.length + '** skill' + (packs.length === 1 ? '' : 's') + '.' + packSkippedNote(), { intent: 'SKILL' });
    }
    if (PACK_LIST.test(t)) {
      if (!packs.length) return say('I have no extra skills loaded. Put a folder with a `SKILL.md` in ' + (packFolder ? '`' + packFolder + '`' : '`~/jarvis/Skills`') + ', then say **reload skills**.', { intent: 'SKILL' });
      return say('**Skills** — say `/name …` or “use the name skill to …”:\n' + packs.map(p => '- `/' + p.name + '` — ' + p.hint + (p.source === 'yours' ? ' *(yours)*' : '')).join('\n') + packSkippedNote()
        + '\n\nAdd your own: a folder with a `SKILL.md` in ' + (packFolder ? '`' + packFolder + '`' : '`~/jarvis/Skills`') + ', then **reload skills**.', { intent: 'SKILL' });
    }
    return null;
  }
  const packSkippedNote = () => packSkipped.length ? '\n\n⚠ Skipped: ' + packSkipped.map(s => '`' + s.folder + '` (' + s.reason + ')').join('; ') : '';
  const firstSentences = s => String(s || '').replace(/[*_`#>]/g, '').split(/(?<=[.!?])\s/).slice(0, 2).join(' ').slice(0, 300);
  const FILE_RE = [/["“']([^"”']+?\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))["”']/i, /(?:^|[\s(])([\w().-]+\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))\b/i];
  // What a skill does depends on its `uses`: nothing special (just the AI with its instructions), the web, your files, or the planner.
  async function runPack(pack, input) {
    if (!input) return say('What should the **' + pack.name + '** skill work on? Say it like `/' + pack.name + ' …`.', { intent: 'SKILL' });
    if (needAI()) return needAI();
    if (pack.uses === 'plan') {
      if (typeof Agent === 'undefined' || !Agent.plan) return say('The planner isn’t available right now.', { intent: 'SKILL' });
      const r = await Agent.plan(input, 0);
      return r || say('That doesn’t look like something I can do with my tools, so I didn’t make a plan. Try describing the steps — e.g. “open VS Code, then start a 25 minute focus session”.', { intent: 'SKILL' });
    }
    let content = input, tail = '', extra = {};
    if (pack.uses === 'research') {
      if (typeof settings !== 'undefined' && !settings.online)
        return say('The **' + pack.name + '** skill searches the web, and **Online tools** is off.', { intent: 'SKILL', actions: typeof enableOnlineAction === 'function' ? enableOnlineAction() : undefined });
      const r = await doResearch(input);                         // the search + the "only from these sources" prompt, as for any web question
      if (!r.askLLM) return Object.assign({ noPersona: true, intent: 'SKILL' }, r);
      content = r.askLLM; tail = (r.after && r.after.sources) || ''; extra.suggestions = r.after && r.after.suggestions;
    } else if (pack.uses === 'files') {
      const fm = FILE_RE[0].exec(input) || FILE_RE[1].exec(input);
      setState('PROCESSING', 'Searching your files…');
      const rs = await callTool('/rag/search', { query: input, k: 5, file: fm ? fm[1].trim() : undefined });
      if (rs.error) return say(cap(rs.error) + '.', { intent: 'SKILL' });
      if (!rs.results || !rs.results.length) return say('I couldn’t find anything about that in your files' + (rs.files ? ' (I searched ' + plural(rs.files, 'file') + ' in ~/jarvis and your project folders)' : '') + '. Name the file — e.g. `/' + pack.name + ' calc.py` — or add the folder in Settings → Project folders.', { intent: 'SKILL' });
      const where = x => x.page ? 'page ' + x.page : 'lines ' + x.start + '–' + x.end;
      content = 'Question: ' + input + '\n\n' + rs.results.map((x, i) => '[' + (i + 1) + '] ' + x.file + ' (' + where(x) + ')\n' + x.text).join('\n\n---\n\n');
      tail = '\n\n**Sources**\n' + rs.results.map((x, i) => (i + 1) + '. ' + x.file + ' (' + where(x) + ')').join('\n')
        + (typeof isCloudModel === 'function' && isCloudModel(llm.model) ? '\n\n⚠ These snippets from your files were sent to ' + modelInfo(llm.model).providerLabel + ' to write this answer.' : '');
    }
    setState('PROCESSING', 'Running the ' + pack.name + ' skill…');
    const r = await callTool('/skill/run', { skill: pack.name, input: content, model: llm.model });
    if (r.error) return say('I couldn’t run the **' + pack.name + '** skill: ' + r.error, { intent: 'SKILL' });
    return say((r.text || '(no answer)') + tail, Object.assign({ intent: 'SKILL', speak: firstSentences(r.text) }, extra));
  }

  /* ================= router ================= */
  async function intercept(text, source) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 1. an active viva takes every answer
    if (S.viva) return vivaTurn(t);
    // 1b. UI design prompt questions in progress
    if (S.uip) {
      if (cancelRe.test(t)) { S.uip = null; return say('Okay, cancelled.'); }
      const [key] = UIP_Q[S.uip.step];
      const skip = (key === 'refs' || key === 'must') && /^(skip|none|any|no|whatever|you choose|your choice)$/i.test(t);
      if (!skip && t.length < 2) return uipAsk();
      S.uip.a[key] = skip ? '' : [S.uip.a[key], t].filter(Boolean).join('; '); S.uip.step++;
      if (S.uip.step < UIP_Q.length) return uipAsk();
      const a = S.uip.a; S.uip = null;
      return uipBuild(a);
    }
    // 2. website questions in progress
    if (S.site && S.site.stage === 'folder') {   // "I found Calculator at D:\… — create the frontend there?"
      if (cancelRe.test(t)) { S.site = null; return say('Okay, cancelled.'); }
      if (/^(?:y|yes|yeah|yep|sure|ok(?:ay)?|do it|go ahead|please do|there|that one|correct|right)\b/i.test(t)) S.site.a.folder = S.site.found;
      else if (!/^(?:n|no|nope|nah|not there|somewhere else|new folder|in jarvis)\b/i.test(t)) return say('Shall I create the frontend in **' + S.site.found + '**? Say **yes**, or **no** and I’ll ask where to save it instead.', { intent: 'WEBSITE' });
      S.site.stage = 'brief';
      return say('Anything specific — features, colours, style? Or say **go ahead** and I’ll design it.', { intent: 'WEBSITE', speak: 'Anything specific, or shall I go ahead?' });
    }
    if (S.site && S.site.stage === 'brief') {   // one optional question for a named project, not three
      if (cancelRe.test(t)) { S.site = null; return say('Okay, cancelled.'); }
      const a = S.site.a;
      if (!/^(?:go ahead|go|no|nothing|skip|you decide|you choose|just do it|do it|start|build it|proceed|ok(?:ay)?|that's it)\b/i.test(t)) a.sections = t;
      return siteNext();
    }
    if (S.site && S.site.stage === 'where') {   // "Where should I save it?"
      if (cancelRe.test(t)) { S.site = null; return say('Okay, cancelled.'); }
      const ans = t.replace(/[.!?]+$/, '').replace(/^(?:save it |put it |in |on |to |at |inside |into )+/i, '').replace(/^(?:the |my )+/i, '').replace(/\s+folder$/i, '').trim();
      const a = S.site.a; S.site = null;
      a.where = /^(?:jarvis|jarvis folder|~\/jarvis|default|here|anywhere|you choose|your choice|projects|wherever|go ahead)$/i.test(ans) ? '' : ans;
      return siteBuild(a);
    }
    if (S.site) {
      if (cancelRe.test(t)) { S.site = null; return say('Okay, cancelled the website.'); }
      const [key] = SITE_Q[S.site.step];
      const skip = key === 'style' && /^(skip|none|any|no|whatever|you choose|your choice)$/i.test(t);
      if (!skip && t.length < 2) return siteAsk();
      S.site.a[key] = skip ? '' : t; S.site.step++;
      if (S.site.step < SITE_Q.length) return siteAsk();
      return siteNext();
    }
    // 2b. skill packs: "/name …", "use the X skill …", "list my skills", "reload skills"
    const px = packExplicit(t);
    if (px) return runPack(px.pack, px.input);
    const pmeta = await packMeta(t);
    if (pmeta) return pmeta;
    // 2c. the extra tools (extras-page.js): AI health, watchdog, nearby, CSV, wiki, images, PDFs; explicit wording only
    if (typeof Extras !== 'undefined') { const ex = await Extras.intercept(t, source); if (ex) return ex; }
    // 3. starts
    const um = t.match(UIP_START);
    if (um) {
      if (needAI()) return needAI();
      S.uip = { step: 0, a: {} };
      if (um[1] && um[1].trim().length > 2) S.uip.a.context = um[1].trim(); // "ui design prompt for my attendance app": still ask, but keep it
      return uipAsk();
    }
    const sm = t.match(SITE_START);   // misheard voice ("creative front and for…") is already repaired by speechfix.js
    if (sm) {
      if (needAI()) return needAI();
      S.site = { step: 0, a: {} };
      // "a frontend / UI for (my) (project) calculator": it's for one of your projects — find it, then one question.
      const forProject = sm[2] && /^(?:front|ui|user interface|web ?app)/i.test(sm[1]) ? projectName(sm[2]) : '';
      if (forProject) {
        S.site.a.project = forProject;
        S.site.a.what = 'the frontend (user interface) of the ' + forProject + ' app — ' + sm[2].trim();
        const found = await findProjectFolder(forProject);
        if (found && found.close) { S.site.stage = 'folder'; S.site.found = found.path; const nm = found.path.split(/[\\/]/).pop();
          return say('I didn’t find a project called exactly **' + forProject + '**, but **' + nm + '** at `' + found.path + '` looks close. Did you mean that one — shall I create the frontend there? (**yes** / **no**)', { intent: 'WEBSITE', speak: 'Did you mean ' + nm + '?' }); }
        if (found) { S.site.stage = 'folder'; S.site.found = found;
          return say('I found **' + forProject + '** at `' + found + '`. Shall I create the frontend there? (**yes** / **no** — no makes a new project in ~/jarvis/Projects)', { intent: 'WEBSITE', speak: 'I found ' + forProject + '. Shall I create the frontend there?' }); }
        S.site.stage = 'brief';
        return say('I’ll build a frontend for **' + forProject + '** (HTML, CSS and JavaScript, saved as real files — no copy-pasting). Anything specific — features, colours, style? Or say **go ahead**.', { intent: 'WEBSITE', speak: 'Anything specific, or shall I go ahead?' });
      }
      if (sm[2] && sm[2].trim().length > 2) { S.site.a.what = sm[2].trim(); S.site.step = 1; }
      else if (/portfolio/i.test(sm[1])) { S.site.a.what = 'my personal portfolio'; S.site.step = 1; }
      return siteAsk();
    }
    for (const re of VIVA_START) { const m = t.match(re); if (m && m[1] && !/^(?:a|an|the|my)$/i.test(m[1].trim())) return vivaStart(m[1]); }
    const cm = t.match(COACH_START);
    if (cm && (/^(?:coach me|dsa coach|i(?:'m| am) stuck|give me (?:a\s+)?hints?|teach me (?:how )?to solve)/i.test(t) || DSA_WORDS.test(cm[1]))) return coachStart(cm[1]);
    // 4. an active coaching session
    if (S.coach) { const r = await coachTurn(t); if (r) return r; }
    // 4b. a skill pack's own trigger phrase ("research …", "quick answer …")
    const pt = packByTrigger(t);
    if (pt) return runPack(pt.pack, pt.input);
    // 5. change the website that was just built
    if (S.lastSite && SITE_EDIT.test(t) && SITE_WORDS.test(t) && !/\b(to-?do|todo|list|reminder|volume|brightness|timer|alarm)\b/i.test(t)) return siteEdit(t);
    if (S.lastSite && /^(?:go back to the (?:previous|old|last) version|revert the (?:website|site|page))/i.test(t)) { const x = await callTool('/skill/siteRevert', { name: S.lastSite, dir: S.lastSiteAbs || undefined }); return say(x.error ? 'Couldn’t go back: ' + x.error : '✓ The website is back to the previous version (reopened).'); }
    if (S.lastSite && /^open (?:the |my )?(?:website|site) in (?:vs ?code|editor)$/i.test(t)) { const x = await callTool('/tool/openInEditor', { name: S.lastSiteDir || ('Projects/' + S.lastSite) }); return say(x.error ? cap(x.error) + '.' : 'Opening the website in **VS Code**.'); }
    return null;
  }
  return { intercept, state: S, SITE_START, VIVA_START, COACH_START, DSA_WORDS, loadPacks, packExplicit, packByTrigger, get packs() { return packs; } };
})();
