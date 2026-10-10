'use strict';
/* Developer helpers, chat side: what you committed, a commit message for your changes, a standup update, and "why did my build fail?". Explicit wording
   only. Everything here READS (git log/status/diff, files inside your project folders, your clipboard or screen) and writes TEXT; it never stages, commits
   or edits anything. If your AI model runs online, anything that sends code or an error to it asks first. Uses the page's globals (callTool, llm, jarvisSay…).
     "git summary today" · "what did I commit yesterday" · "write my standup" · "write a commit message" · "why did my build fail" · "explain the error on my screen" */
const Dev = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'DEV' }, extra || {});
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const plain = s => String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const ask = (text, yes) => (typeof Extras !== 'undefined' && Extras.confirmCard ? Extras.confirmCard(text, yes) : Promise.resolve(false));
  const PHONE_NO = 'That reads your code, so I only do it for requests made at the laptop. Ask me again from JARVIS on the laptop.';
  const copy = text => (typeof copyText === 'function' ? copyText(text) : Promise.resolve());
  const cloud = () => typeof isCloudModel === 'function' && typeof llm !== 'undefined' && isCloudModel(llm.model);
  const provider = () => (typeof modelInfo === 'function' ? modelInfo(llm.model).providerLabel : 'an online provider');
  const aiOff = () => typeof llmReady === 'function' && !llmReady();

  /* ================= wording ================= */
  const WIN = '(today|yesterday|this week|last week|so far today)';
  const SUMMARY = [
    new RegExp('^(?:please\\s+)?(?:daily\\s+)?git\\s+(?:summary|recap|report)(?:\\s+(?:(?:for|of)\\s+)?' + WIN + ')?(?:\\s+(?:for|of|in)\\s+(.+?))?\\s*[.!?]*$', 'i'),
    new RegExp('^(?:please\\s+)?(?:a\\s+)?(?:summary|recap)\\s+of\\s+(?:my\\s+)?(?:commits|coding|code|work)\\s*' + WIN + '?\\s*[.!?]*$', 'i'),
    new RegExp('^(?:please\\s+)?what\\s+(?:did|have)\\s+i\\s+(?:commit|committed|code|coded|push|pushed|build|built|ship|shipped)\\s*' + WIN + '?\\s*\\??$', 'i'),
    new RegExp('^(?:please\\s+)?(?:show|list)\\s+(?:me\\s+)?my\\s+commits\\s*' + WIN + '?\\s*[.!?]*$', 'i'),
    new RegExp('^(?:my\\s+)?commits\\s+' + WIN + '\\s*[.!?]*$', 'i'),
  ];
  const MESSAGE = /^(?:please\s+)?(?:write|suggest|generate|draft|give\s+me|make|create)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:good\s+|git\s+)?commit\s+message(?:\s+(?:for|from)\s+(?:my\s+)?(?:changes|work|code|diff|this)(?:\s+(?:in|for|on)\s+(.+?))?)?(?:\s+(?:in|for|on)\s+(.+?))?\s*[.!?]*$|^(?:please\s+)?what\s+should\s+(?:my|the)\s+commit\s+message\s+be\s*[?.!]*$/i;
  const STANDUP = /^(?:please\s+)?(?:write|make|draft|give\s+me|generate|prepare)\s+(?:me\s+)?(?:my\s+|a\s+|the\s+)?(?:daily\s+)?stand[\s-]?up(?:\s+(?:update|notes?|report|message))?\s*[.!?]*$|^(?:my\s+)?(?:daily\s+)?stand[\s-]?up(?:\s+(?:update|notes?))?\s*[.!?]*$/i;
  const EXPLAIN = [
    /^(?:please\s+)?why\s+(?:did|has|does|is|was)\s+(?:my|the)\s+(?:build|compile|compilation|code|program|script|app|test|tests|run|install|npm\s+install|deploy(?:ment)?)\s+(?:fail(?:ed)?|failing|break|broke|crash(?:ed)?|not\s+work(?:ing)?|giving\s+(?:an\s+)?error)\s*[?.!]*$/i,
    /^(?:please\s+)?(?:explain|debug|diagnose|decode|translate)\s+(?:this|that|the|my|the\s+last)\s+(?:error|exception|stack\s*trace|traceback|build\s+failure|compiler\s+error)(?:\s+message)?(?:\s+(?:from\s+)?(?:on\s+)?(?:my\s+)?(clipboard|screen))?\s*[.!?]*$/i,
    /^(?:please\s+)?(?:what\s+does|what\s+is)\s+(?:this|that|the)\s+(?:error|exception|stack\s*trace|traceback)\s+(?:mean|saying)\s*[?.!]*$/i,
    /^(?:please\s+)?(?:explain|read|debug)\s+(?:the\s+)?(?:error|exception|stack\s*trace|traceback)\s+(?:on|from|in)\s+(?:my\s+)?(screen|clipboard|terminal)\s*[.!?]*$/i,
    /^(?:please\s+)?(?:fix|help\s+me\s+(?:fix|with))\s+(?:this|the)\s+(?:error|build\s+error|compiler\s+error)\s*[.!?]*$/i,
  ];
  function match(t) {
    t = String(t || '').trim(); let m;
    if (STANDUP.test(t)) return { kind: 'standup' };
    for (const re of SUMMARY) if ((m = t.match(re))) return { kind: 'summary', window: normWin(m[1]), repo: re === SUMMARY[0] ? (m[2] || '').trim() : '' };
    if ((m = t.match(MESSAGE))) return { kind: 'message', repo: (m[1] || m[2] || '').replace(/^(?:the\s+|my\s+)/i, '').replace(/\s+(?:project|repo|repository)$/i, '').trim() };
    for (const re of EXPLAIN) if ((m = t.match(re))) return { kind: 'explain', from: /screen|terminal/i.test(m[1] || '') ? 'screen' : /clipboard/i.test(m[1] || '') ? 'clipboard' : '' };
    return null;
  }
  const normWin = w => { w = String(w || '').toLowerCase(); return w === 'so far today' || !w ? 'today' : w === 'this week' ? 'week' : w; };

  /* ================= git summary ================= */
  const hmm = c => String(c.d || '');
  function summaryText(r, title) {
    if (!r.repos.length) return null;
    return r.repos.map(x => '**' + x.name + '**' + (x.commits.length ? ' — ' + pl(x.commits.length, 'commit') : '') + '\n' + x.commits.slice(0, 10).map(c => '- `' + c.h + '` ' + c.s + ' *(' + hmm(c) + ')*').join('\n') + (x.commits.length > 10 ? '\n- …and ' + (x.commits.length - 10) + ' more' : '') + (x.uncommitted ? (x.commits.length ? '\n' : '') + '- *' + pl(x.uncommitted, 'file') + ' not committed yet' + (x.stat ? ' (' + x.stat + ')' : '') + '*' : '')).join('\n\n');
  }
  async function summary(m, source) {
    if (source === 'phone') return say(PHONE_NO);
    const r = await callTool('/dev/git/summary', { window: m.window, repo: m.repo || undefined });
    if (r.error) return say(r.error);
    const label = r.label === 'week' ? 'this week' : r.label;
    if (!r.searched) return say('I found no git projects. Add your project folders in **Settings → Projects** (or say **“add project D:\\code”**), and I will read their commits.');
    if (!r.repos.length) return say('No commits ' + label + ' in your ' + pl(r.searched, 'project') + ', and nothing waiting to be committed.', { speak: 'No commits ' + label + '.' });
    return say('**Your commits ' + label + '** — ' + pl(r.total, 'commit') + ' in ' + pl(r.repos.length, 'project') + '\n\n' + summaryText(r), { speak: 'You made ' + pl(r.total, 'commit') + ' ' + label + '.', suggestions: ['Write my standup', 'Write a commit message'], actions: [{ label: 'COPY', fn: () => copy(plain(summaryText(r))) }] });
  }

  /* ================= standup ================= */
  async function standup(source) {
    if (source === 'phone') return say(PHONE_NO);
    const [y, t] = await Promise.all([callTool('/dev/git/summary', { window: 'prevday' }), callTool('/dev/git/summary', { window: 'today' })]);
    if (y.error && t.error) return say(y.error);
    if (!(y.searched || t.searched)) return say('I found no git projects. Add your project folders first (**Settings → Projects**), then ask again.');
    const when = (y.label && y.label !== 'yesterday') ? y.label : 'Yesterday';
    const line = x => x.name + ': ' + x.commits.map(c => c.s.replace(/[.\s]+$/, '')).slice(0, 6).join('; ');
    const done = (y.repos || []).filter(x => x.commits.length).map(line), now = (t.repos || []).filter(x => x.commits.length).map(line);
    const wip = [...(t.repos || []), ...(y.repos || [])].filter((x, i, a) => x.uncommitted && a.findIndex(z => z.repo === x.repo) === i).map(x => x.name + ': ' + pl(x.uncommitted, 'file') + ' in progress');
    const soon = (typeof deadlines !== 'undefined' ? deadlines : []).filter(d => !d.done && d.due > Date.now() && d.due < Date.now() + 3 * 864e5).sort((a, b) => a.due - b.due).slice(0, 3).map(d => d.title + ' (due ' + new Date(d.due).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ')');
    const sec = (h, items, none) => '**' + h + '**\n' + (items.length ? items.map(i => '- ' + i).join('\n') : '- ' + none);
    const body = [sec(when[0].toUpperCase() + when.slice(1) + ':', done, 'No commits.'), sec('Today:', [...now.map(i => 'Done so far — ' + i), ...wip, ...soon.map(i => 'Deadline: ' + i)], 'Nothing committed yet.'), '**Blockers:**\n- None'].join('\n\n');
    return say('**Standup — ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '**\n\n' + body + '\n\n*Built from your git commits, uncommitted files and deadlines. Edit it before you send it.*', { speak: 'Your standup is on screen.', actions: [{ label: 'COPY', fn: () => copy(plain(body.replace(/\*\*/g, '')).replace(/ - /g, '\n- ')) }] });
  }

  /* ================= commit message ================= */
  async function message(m, source) {
    if (source === 'phone') return say(PHONE_NO);
    if (aiOff()) return say('Writing a commit message needs the AI brain, and it is off or not reachable.');
    if (cloud()) { const go = await ask('Your AI model runs online (**' + provider() + '**). Writing the message sends the **code changes** (not secrets files like .env or keys) to them. Send it?', 'YES, SEND IT'); if (!go) return say('Okay, nothing was sent.'); }
    return messageFor(m.repo || undefined);
  }
  async function messageFor(repo) {
    typeof setState === 'function' && setState('PROCESSING', 'Reading your changes…');
    const r = await callTool('/dev/git/message', { repo, model: llm.model });
    if (r.error) return say(r.error);
    if (r.choices) return say('More than one project has changes. Which one?', { actions: r.choices.slice(0, 6).map(c => ({ label: c.name.toUpperCase().slice(0, 24), fn: async () => jarvisSay(await messageFor(c.name)) })) });
    return say('**Commit message for ' + r.name + '** *(' + pl(r.files, 'file') + (r.staged ? ', staged' : ', not staged') + (r.truncated ? ', diff shortened' : '') + ')*\n\n```text\n' + r.message + '\n```\n\nI only wrote the text — nothing was staged or committed. ' + (r.staged ? '' : 'Stage your files first with `git add`. ') + '*Made by the AI from the diff: check it says what you actually did.*',
      { speak: 'Here is a commit message: ' + r.subject, actions: [{ label: 'COPY MESSAGE', fn: () => copy(r.message).then(() => { if (typeof toast === 'function') toast('Copied'); }) }] });
  }

  /* ================= explain a failure ================= */
  // a clipboard or screen text counts as "an error" only if it has an error line or a file:line location (the bare word "error" is not enough)
  const isFailure = text => { const p = TraceParse.parseTrace(text); return !!(p.error || p.frames.length); };
  async function readSource(from) {
    if (from !== 'screen') {
      const c = await callTool('/tool/readClipboard', {}); const text = String((c && c.content) || '');
      if (text && isFailure(text)) return { text, where: 'your clipboard' };
      if (from === 'clipboard') return { error: 'Your clipboard has no error message in it. Copy the error from your terminal, then ask again.' };
    }
    if (typeof toast === 'function') { [3, 2, 1].forEach((n, i) => setTimeout(() => toast('Reading your screen in ' + n + '…', true), i * 1000)); }
    const s = await callTool('/sys/screenRead', { source: 'screen', delay: 3, vision: false });
    if (s.error) return { error: 'I could not read the screen: ' + s.error };
    const text = String(s.text || '');
    if (!text.trim() || !isFailure(text)) return { error: 'I could not find an error on your screen or in your clipboard. Copy the error text and ask again, or put the terminal in front and say **“explain the error on my screen”**.' };
    return { text, where: 'your screen', screen: true };
  }
  async function explain(m, source) {
    if (source === 'phone') return say(PHONE_NO);
    if (aiOff()) return say('Explaining an error needs the AI brain, and it is off or not reachable.');
    if (!m.from) {                                                              // first the clipboard; if that is not an error, the screen
      jarvisSay(say('Looking for the error in your clipboard… if it is not there I will read your screen in 3 seconds, so put the terminal in front.', { noTTS: true }));
    }
    const src = await readSource(m.from);
    if (src.error) return say(src.error);
    if (cloud()) { const go = await ask('Your AI model runs online (**' + provider() + '**). Explaining this sends the error text and a few lines of your own code around it to them. Send it?', 'YES, SEND IT'); if (!go) return say('Okay, nothing was sent.'); }
    typeof setState === 'function' && setState('PROCESSING', 'Reading the error…');
    const r = await callTool('/dev/explain', { text: src.text.slice(0, 12000), model: llm.model });
    if (r.error) return say(r.error + (r.files && r.files.length ? '' : ''));
    const files = (r.files || []).map(f => '`' + f.name + ':' + f.line + '`').join(', ');
    return say('**' + (r.type || 'Error') + '** *(from ' + src.where + (files ? '; I read the code around ' + files : r.foundFrames ? '' : '; no line of your own code in it, so this comes from the message alone') + ')*\n\n' + r.answer + '\n\n*Made by the AI: it can be wrong, so check the fix before you rely on it.*', { speak: 'Here is what the error means.', actions: [{ label: 'COPY', fn: () => copy(plain(r.answer)) }] });
  }

  async function intercept(text, source) {
    const m = match(text); if (!m) return null;
    switch (m.kind) {
      case 'summary': return summary(m, source);
      case 'standup': return standup(source);
      case 'message': return message(m, source);
      case 'explain': return explain(m, source);
    }
    return null;
  }
  return { intercept, match };
})();
if (typeof module !== 'undefined') module.exports = Dev;
